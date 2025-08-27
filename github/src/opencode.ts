import { spawn } from "node:child_process"
import { lazy } from "./lazy"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Git } from "./git"
import { Auth } from "./auth"

export namespace Opencode {
  const HOST = "127.0.0.1"
  const PORT = 4096
  const SERVER_URL = `http://${HOST}:${PORT}`

  export const state = lazy(() => {
    const proc = spawn(`opencode`, [`serve`, `--hostname=${HOST}`, `--port=${PORT}`])
    const client = createOpencodeClient({ baseUrl: SERVER_URL })

    // parse models
    const value = process.env["MODEL"]
    if (!value) throw new Error(`Environment variable "MODEL" is not set`)

    const [providerID, ...rest] = value.split("/")
    const modelID = rest.join("/")

    if (!providerID?.length || !modelID.length)
      throw new Error(`Invalid model ${value}. Model must be in the format "provider/model".`)

    return {
      url: SERVER_URL,
      server: proc,
      client,
      providerID,
      modelID,
    }
  })

  export function url() {
    return state().url
  }

  export function client() {
    return state().client
  }

  export function closeServer() {
    return state().server.kill()
  }

  export async function start(onEvent?: (event: any) => void) {
    state()
    await waitForServer()
    await subscribeSessionEvents(onEvent)
  }

  export async function chat(text: string) {
    console.log("Sending message to opencode...")
    const { providerID, modelID } = state()

    const session = await client()
      .session.create<true>()
      .then((r) => r.data)

    // Add GH_TOKEN for llm to use `gh` cli
    process.env["GH_TOKEN"] = await Auth.token()

    const chat = await client().session.chat<true>({
      path: session,
      body: {
        providerID,
        modelID,
        agent: "build",
        parts: [
          {
            type: "text",
            text,
          },
        ],
      },
    })

    // @ts-ignore
    const match = chat.data.parts.findLast((p) => p.type === "text")
    if (!match) throw new Error("Failed to parse the text response")

    return match.text
  }

  async function waitForServer() {
    let retry = 0
    let connected = false
    do {
      try {
        await client().app.get<true>()
        connected = true
        break
      } catch (e) {}
      await new Promise((resolve) => setTimeout(resolve, 300))
    } while (retry++ < 30)

    if (!connected) {
      throw new Error("Failed to connect to opencode server")
    }
  }

  async function subscribeSessionEvents(onEvent?: (event: any) => void) {
    console.log("Subscribing to session events...")

    const TOOL: Record<string, [string, string]> = {
      todowrite: ["Todo", "\x1b[33m\x1b[1m"],
      todoread: ["Todo", "\x1b[33m\x1b[1m"],
      bash: ["Bash", "\x1b[31m\x1b[1m"],
      edit: ["Edit", "\x1b[32m\x1b[1m"],
      glob: ["Glob", "\x1b[34m\x1b[1m"],
      grep: ["Grep", "\x1b[34m\x1b[1m"],
      list: ["List", "\x1b[34m\x1b[1m"],
      read: ["Read", "\x1b[35m\x1b[1m"],
      write: ["Write", "\x1b[32m\x1b[1m"],
      websearch: ["Search", "\x1b[2m\x1b[1m"],
    }

    const response = await fetch(`${Opencode.url()}/event`)
    if (!response.body) throw new Error("No response body")

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    ;(async () => {
      while (true) {
        try {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split("\n")

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue

            const jsonStr = line.slice(6).trim()
            if (!jsonStr) continue

            try {
              const evt = JSON.parse(jsonStr)

              if (evt.type === "message.part.updated") {
                const part = evt.properties.part

                if (part.type === "tool" && part.state.status === "completed") {
                  const [tool, color] = TOOL[part.tool] ?? [part.tool, "\x1b[34m\x1b[1m"]
                  const title =
                    part.state.title || Object.keys(part.state.input).length > 0
                      ? JSON.stringify(part.state.input)
                      : "Unknown"
                  console.log()
                  console.log(color + `|`, "\x1b[0m\x1b[2m" + ` ${tool.padEnd(7, " ")}`, "", "\x1b[0m" + title)
                }

                if (part.type === "text") {
                  if (part.time?.end) {
                    console.log()
                    console.log(part.text)
                    console.log()
                  }
                }
              }

              await onEvent?.(evt)
            } catch (e) {
              // Ignore parse errors
            }
          }
        } catch (e) {
          console.log("Subscribing to session events done", e)
          break
        }
      }
    })()
  }
}
