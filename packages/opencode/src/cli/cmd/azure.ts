import type { Argv } from "yargs"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import path from "path"
import os from "os"
import fs from "fs/promises"

const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode")
const CONFIG_FILE = path.join(CONFIG_DIR, "opencode.json")

export const AzureCommand = cmd({
  command: "azure [action]",
  describe: "Configure Azure OpenAI",
  builder: (yargs: Argv) => {
    return yargs
      .positional("action", {
        describe: "Action: setup (default), status, mcp-trim",
        type: "string",
        choices: ["setup", "status", "mcp-trim"],
        default: "setup",
      })
  },
  handler: async (args) => {
    const action = args.action as string

    if (action === "status") {
      await showStatus()
    } else if (action === "mcp-trim") {
      await trimMcps()
    } else {
      await setupAzure()
    }
  },
})

async function setupAzure() {
  prompts.intro("Azure OpenAI Setup")

  // Load existing config
  let existing: any = {}
  try {
    existing = JSON.parse(await fs.readFile(CONFIG_FILE, "utf-8"))
  } catch {}

  const currentEndpoint = existing.provider?.azure?.options?.baseURL || ""
  const currentVersion = existing.provider?.azure?.options?.apiVersion || "2024-12-01-preview"

  // Endpoint
  const endpoint = await prompts.text({
    message: "Azure OpenAI Endpoint",
    placeholder: "https://your-resource.openai.azure.com/openai",
    initialValue: currentEndpoint,
    validate: (v) => !v ? "Required" : !v.startsWith("https://") ? "Must start with https://" : undefined,
  })
  if (prompts.isCancel(endpoint)) return

  // API Key
  const apiKey = await prompts.password({
    message: "API Key",
    validate: (v) => !v ? "Required" : undefined,
  })
  if (prompts.isCancel(apiKey)) return

  // Deployment
  const deployment = await prompts.text({
    message: "Deployment name",
    initialValue: "model-router",
    validate: (v) => !v ? "Required" : undefined,
  })
  if (prompts.isCancel(deployment)) return

  // API Version
  const apiVersion = await prompts.text({
    message: "API Version",
    initialValue: currentVersion,
  })
  if (prompts.isCancel(apiVersion)) return

  // Test
  const spinner = prompts.spinner()
  spinner.start("Testing connection...")

  let ok = false
  try {
    const url = `${endpoint}/deployments/${deployment}/chat/completions?api-version=${apiVersion}`
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], max_completion_tokens: 5 }),
    })
    ok = res.ok
    spinner.stop(ok ? "Connection successful!" : `Failed: ${res.status}`, ok ? 0 : 1)
    if (!ok) {
      const body = await res.text()
      prompts.log.error(body.slice(0, 200))
    }
  } catch (e: any) {
    spinner.stop(`Error: ${e.message}`, 1)
  }

  if (!ok) {
    const cont = await prompts.confirm({ message: "Save anyway?" })
    if (prompts.isCancel(cont) || !cont) return
  }

  // Save
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: `azure/${deployment}`,
    provider: {
      azure: {
        npm: "@ai-sdk/azure",
        name: "Azure OpenAI",
        options: {
          baseURL: endpoint,
          apiKey: apiKey,
          useDeploymentBasedUrls: true,
          apiVersion: apiVersion,
        },
        models: {
          [deployment]: {
            name: deployment,
            limit: { context: 200000, output: 16384 },
          },
        },
      },
    },
    ...(existing.mcp ? { mcp: existing.mcp } : {}),
  }

  await fs.mkdir(CONFIG_DIR, { recursive: true })
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2))

  prompts.outro("Configuration saved!")

  // Warn about MCPs
  if (existing.mcp && Object.keys(existing.mcp).length > 10) {
    prompts.log.warn(`${Object.keys(existing.mcp).length} MCPs configured - may exceed 128 tool limit`)
    prompts.log.info("Run: opencode azure mcp-trim")
  }
}

async function showStatus() {
  try {
    const config = JSON.parse(await fs.readFile(CONFIG_FILE, "utf-8"))
    const azure = config.provider?.azure

    console.log("\n Azure OpenAI Configuration")
    console.log("─".repeat(35))

    if (azure) {
      console.log(`Endpoint:   ${azure.options?.baseURL || "Not set"}`)
      console.log(`API Key:    ${azure.options?.apiKey ? "****" + azure.options.apiKey.slice(-4) : "Not set"}`)
      console.log(`Model:      ${config.model || "Not set"}`)
      console.log(`Version:    ${azure.options?.apiVersion || "Not set"}`)
    } else {
      console.log("Not configured. Run: opencode azure")
    }

    if (config.mcp) {
      const n = Object.keys(config.mcp).length
      console.log(`\nMCPs:       ${n} configured${n > 10 ? " ⚠️  (may exceed limit)" : ""}`)
    }
    console.log()
  } catch {
    console.log("\nNot configured. Run: opencode azure\n")
  }
}

async function trimMcps() {
  prompts.intro("MCP Trimmer")

  let config: any
  try {
    config = JSON.parse(await fs.readFile(CONFIG_FILE, "utf-8"))
  } catch {
    prompts.log.error("No config found. Run: opencode azure")
    return
  }

  if (!config.mcp || Object.keys(config.mcp).length === 0) {
    prompts.log.info("No MCPs configured")
    return
  }

  const names = Object.keys(config.mcp)
  prompts.log.info(`${names.length} MCPs found`)

  if (names.length <= 4) {
    prompts.log.success("Count is already low")
    return
  }

  const keep = await prompts.multiselect({
    message: "Select MCPs to KEEP",
    options: names.map((n) => ({ label: n, value: n })),
    required: false,
  })

  if (prompts.isCancel(keep)) return

  // Backup
  await fs.writeFile(CONFIG_FILE + ".backup", JSON.stringify(config, null, 2))
  prompts.log.info("Backup saved")

  // Filter
  const newMcp: any = {}
  for (const name of keep as string[]) {
    newMcp[name] = config.mcp[name]
  }
  config.mcp = newMcp

  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2))
  prompts.outro(`Trimmed to ${Object.keys(newMcp).length} MCPs`)
}
