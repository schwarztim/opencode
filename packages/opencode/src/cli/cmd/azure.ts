import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import path from "path"
import os from "os"
import fs from "fs/promises"

const AZURE_CONFIG_PATH = path.join(os.homedir(), ".config", "opencode", "opencode.json")

interface AzureConfig {
  $schema: string
  model: string
  provider: {
    azure: {
      npm: string
      name: string
      options: {
        baseURL: string
        apiKey: string
        useDeploymentBasedUrls: boolean
        apiVersion: string
      }
      models: {
        [key: string]: {
          name: string
          limit: {
            context: number
            output: number
          }
        }
      }
    }
  }
  mcp?: Record<string, any>
}

export const AzureCommand = cmd({
  command: "azure [action]",
  describe: "Configure Azure OpenAI for opencode",
  builder: (yargs: Argv) => {
    return yargs
      .positional("action", {
        describe: "Action to perform",
        type: "string",
        choices: ["setup", "status", "mcp-trim"],
        default: "setup",
      })
  },
  handler: async (args) => {
    const action = args.action as string

    if (action === "status") {
      await showStatus()
      return
    }

    if (action === "mcp-trim") {
      await trimMcps()
      return
    }

    // Default: setup
    await setupAzure()
  },
})

async function setupAzure() {
  prompts.intro("Azure OpenAI Setup")

  // Check for existing config
  let existingConfig: Partial<AzureConfig> = {}
  try {
    const content = await fs.readFile(AZURE_CONFIG_PATH, "utf-8")
    existingConfig = JSON.parse(content)
  } catch {
    // No existing config
  }

  const existingAzure = existingConfig.provider?.azure?.options

  // Endpoint
  const endpoint = await prompts.text({
    message: "Azure OpenAI Endpoint",
    placeholder: "https://your-resource.openai.azure.com/openai",
    initialValue: existingAzure?.baseURL || "",
    validate: (value) => {
      if (!value) return "Endpoint is required"
      if (!value.startsWith("https://")) return "Endpoint must start with https://"
      return undefined
    },
  })
  if (prompts.isCancel(endpoint)) throw new UI.CancelledError()

  // API Key
  const apiKey = await prompts.password({
    message: "Azure OpenAI API Key",
    validate: (value) => {
      if (!value) return "API Key is required"
      return undefined
    },
  })
  if (prompts.isCancel(apiKey)) throw new UI.CancelledError()

  // API Version
  const apiVersion = await prompts.text({
    message: "API Version",
    initialValue: existingAzure?.apiVersion || "2024-12-01-preview",
  })
  if (prompts.isCancel(apiVersion)) throw new UI.CancelledError()

  // Deployment mode
  const deploymentMode = await prompts.select({
    message: "Deployment Mode",
    options: [
      {
        label: "Model Router - Single deployment for all models (recommended for Azure APIM)",
        value: "router",
      },
      {
        label: "Single Deployment - One deployment name for all requests",
        value: "single",
      },
    ],
  })
  if (prompts.isCancel(deploymentMode)) throw new UI.CancelledError()

  // Deployment name
  const deploymentName = await prompts.text({
    message: deploymentMode === "router"
      ? "Model Router Deployment Name"
      : "Deployment Name",
    placeholder: deploymentMode === "router" ? "model-router" : "gpt-4o",
    initialValue: deploymentMode === "router" ? "model-router" : "gpt-4o",
    validate: (value) => {
      if (!value) return "Deployment name is required"
      return undefined
    },
  })
  if (prompts.isCancel(deploymentName)) throw new UI.CancelledError()

  // Test connection
  const spinner = prompts.spinner()
  spinner.start("Testing Azure connection...")

  let connectionOk = false
  try {
    const testUrl = `${endpoint}/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`
    const response = await fetch(testUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "hi" }],
        max_completion_tokens: 5,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      spinner.stop(`Connection failed: ${response.status}`, 1)
      prompts.log.error(error)
    } else {
      spinner.stop("Connection successful!")
      connectionOk = true
    }
  } catch (error: any) {
    spinner.stop(`Connection test failed: ${error.message}`, 1)
  }

  if (!connectionOk) {
    const continueAnyway = await prompts.confirm({
      message: "Save configuration anyway?",
    })
    if (prompts.isCancel(continueAnyway) || !continueAnyway) {
      throw new UI.CancelledError()
    }
  }

  // Build config
  const config: AzureConfig = {
    $schema: "https://opencode.ai/config.json",
    model: `azure/${deploymentName}`,
    provider: {
      azure: {
        npm: "@ai-sdk/azure",
        name: deploymentMode === "router" ? "Azure Model Router" : "Azure OpenAI",
        options: {
          baseURL: endpoint,
          apiKey: apiKey,
          useDeploymentBasedUrls: true,
          apiVersion: apiVersion,
        },
        models: {
          [deploymentName]: {
            name: deploymentMode === "router"
              ? "Model Router (Auto)"
              : deploymentName,
            limit: {
              context: 200000,
              output: 16384,
            },
          },
        },
      },
    },
    // Preserve existing MCP config
    ...(existingConfig.mcp ? { mcp: existingConfig.mcp } : {}),
  }

  // Save config
  await fs.mkdir(path.dirname(AZURE_CONFIG_PATH), { recursive: true })
  await fs.writeFile(AZURE_CONFIG_PATH, JSON.stringify(config, null, 2))

  prompts.outro(`Configuration saved to ${AZURE_CONFIG_PATH}`)

  // MCP warning
  if (existingConfig.mcp && Object.keys(existingConfig.mcp).length > 10) {
    prompts.log.warn(
      `\nYou have ${Object.keys(existingConfig.mcp).length} MCP servers configured.\n` +
      `Azure/Anthropic API has a 128 tool limit. Consider reducing MCPs if you hit tool limits.\n` +
      `Run: opencode azure mcp-trim  to reduce to essential MCPs only`
    )
  }
}

async function trimMcps() {
  prompts.intro("MCP Trimmer")

  let config: any
  try {
    const content = await fs.readFile(AZURE_CONFIG_PATH, "utf-8")
    config = JSON.parse(content)
  } catch {
    prompts.log.error("No opencode config found. Run 'opencode azure' first.")
    return
  }

  if (!config.mcp) {
    prompts.log.info("No MCPs configured.")
    return
  }

  const mcpNames = Object.keys(config.mcp)
  prompts.log.info(`Found ${mcpNames.length} MCPs configured`)

  if (mcpNames.length <= 5) {
    prompts.log.info("MCP count is already low enough.")
    return
  }

  // Let user select which MCPs to keep
  const selected = await prompts.multiselect({
    message: "Select MCPs to KEEP (others will be removed)",
    options: mcpNames.map((name) => ({
      label: name,
      value: name,
    })),
    required: false,
  })

  if (prompts.isCancel(selected)) throw new UI.CancelledError()

  // Backup original
  const backupPath = AZURE_CONFIG_PATH + ".backup"
  await fs.writeFile(backupPath, JSON.stringify(config, null, 2))
  prompts.log.info(`Backup saved to ${backupPath}`)

  // Filter MCPs
  const newMcp: Record<string, any> = {}
  for (const name of selected as string[]) {
    newMcp[name] = config.mcp[name]
  }
  config.mcp = newMcp

  await fs.writeFile(AZURE_CONFIG_PATH, JSON.stringify(config, null, 2))
  prompts.outro(`Trimmed to ${Object.keys(newMcp).length} MCPs`)
}

async function showStatus() {
  try {
    const content = await fs.readFile(AZURE_CONFIG_PATH, "utf-8")
    const config = JSON.parse(content)

    console.log("\nAzure OpenAI Configuration")
    console.log("─".repeat(40))

    if (config.provider?.azure) {
      const azure = config.provider.azure
      console.log(`Endpoint: ${azure.options?.baseURL || "Not set"}`)
      console.log(`API Version: ${azure.options?.apiVersion || "Not set"}`)
      console.log(`API Key: ${azure.options?.apiKey ? "****" + azure.options.apiKey.slice(-4) : "Not set"}`)
      console.log(`Model: ${config.model || "Not set"}`)

      if (azure.models) {
        console.log(`\nDeployments:`)
        for (const [name, model] of Object.entries(azure.models) as any) {
          console.log(`  - ${name}: ${model.name}`)
        }
      }
    } else {
      console.log("Azure not configured. Run: opencode azure")
    }

    if (config.mcp) {
      const mcpCount = Object.keys(config.mcp).length
      console.log(`\nMCPs: ${mcpCount} configured`)
      if (mcpCount > 10) {
        console.log("⚠️  Warning: High MCP count may exceed 128 tool limit")
        console.log("   Run: opencode azure mcp-trim")
      }
    }
    console.log()
  } catch {
    console.log("No configuration found. Run: opencode azure")
  }
}
