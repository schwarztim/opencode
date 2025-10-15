import { createOpencodeClient } from "@opencode-ai/sdk"
import { createSimpleContext } from "./helper"

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { url: string }) => {
    const client = createOpencodeClient({
      baseUrl: props.url,
      fetch: (req) => {
        // @ts-ignore
        req.timeout = false
        return fetch(req)
      },
    })
    return client
  },
})
