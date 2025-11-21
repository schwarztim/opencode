import { createMemo } from "solid-js"
import { useSync } from "@tui/context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "@tui/ui/dialog-select"
import { Dialog, useDialog } from "@tui/ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"

const PROVIDER_PRIORITY: Record<string, number> = {
  opencode: 0,
  anthropic: 1,
  "github-copilot": 2,
  openai: 3,
  google: 4,
  openrouter: 5,
  vercel: 6,
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  const options = createMemo(() => {
    return pipe(
      sync.data.provider_next.all,
      map((provider) => ({
        title: provider.name,
        value: provider.id,
        footer: sync.data.provider_next.connected.includes(provider.id)
          ? "Connected"
          : {
              opencode: "Recommended",
              anthropic: "Claude Max or API key",
            }[provider.id],
        async onSelect() {
          const methods = sync.data.provider_auth[provider.id] ?? [
            {
              type: "api",
              label: "API key",
            },
          ]
          let index: number | null = 0
          if (methods.length > 1) {
            index = await new Promise<number | null>((resolve) => {
              dialog.replace(
                () => (
                  <DialogSelect
                    title="Select auth method"
                    options={methods.map((x, index) => ({
                      title: x.label,
                      value: index,
                      category: "Method",
                    }))}
                    onSelect={(option) => resolve(option.value)}
                  />
                ),
                () => resolve(null),
              )
            })
          }
          if (index == null) return
          const method = methods[index]
          if (method.type === "oauth") {
            const result = await sdk.client.provider.oauth.authorize({
              path: {
                id: provider.id,
              },
              body: {
                method: index,
              },
            })
            if (result.data?.method === "code") {
              while (true) {
                const url = result.data.url
                const code = await DialogPrompt.show(dialog, "Login with " + method.label, {
                  placeholder: "Authorization code",
                  description: () => (
                    <box gap={1}>
                      <text fg={theme.textMuted}>Visit the url to collect your authorization code</text>
                      <text fg={theme.primary}>{url}</text>
                    </box>
                  ),
                })
                if (!code) break
                const { error } = await sdk.client.provider.oauth.callback({
                  path: {
                    id: provider.id,
                  },
                  body: {
                    method: index,
                    code,
                  },
                })
                if (!error) {
                  await sdk.client.instance.dispose()
                  await sync.bootstrap()
                  return
                }
              }
            }

            if (result.data?.method === "auto") {
              const { instructions, url } = result.data
              dialog.replace(() => (
                <PendingDialog
                  title={method.label}
                  description={() => (
                    <box gap={1}>
                      <text fg={theme.primary}>{url}</text>
                      <text fg={theme.textMuted}>{instructions}</text>
                    </box>
                  )}
                />
              ))
              await sdk.client.provider.oauth.callback({
                path: {
                  id: provider.id,
                },
                body: {
                  method: index,
                },
              })
              dialog.clear()
              await sdk.client.instance.dispose()
              await sync.bootstrap()
            }
          }
        },
      })),
      sortBy((x) => PROVIDER_PRIORITY[x.value] ?? 99),
    )
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()

  return <DialogSelect title="Connect a provider" options={options()} />
}

interface PendingDialogProps {
  title: string
  description: () => JSX.Element
}
function PendingDialog(props: PendingDialogProps) {
  const { theme } = useTheme()
  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD}>{props.title}</text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box gap={1}>{props.description}</box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
    </box>
  )
}
