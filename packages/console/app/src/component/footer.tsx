import { A, createAsync, query } from "@solidjs/router"
import { createMemo } from "solid-js"

const githubStars = query(async () => {
  "use server"
  try {
    const response = await fetch("https://api.github.com/repos/sst/opencode")
    const json = await response.json()
    return json.stargazers_count as number
  } catch {}
  return undefined
}, "githubStars")

export function Footer() {
  const stars = createAsync(() => githubStars())
  const starCount = createMemo(() =>
    stars()
      ? new Intl.NumberFormat("en-US", {
          notation: "compact",
          compactDisplay: "short",
        }).format(stars()!)
      : "25K",
  )

  return (
    <footer data-component="footer">
      <div data-slot="cell">
        <A href="https://github.com/sst/opencode" target="_blank">
          GitHub <span>[{starCount()}]</span>
        </A>
      </div>
      <div data-slot="cell">
        <A href="/docs">Docs</A>
      </div>
      <div data-slot="cell">
        <A href="https://opencode.ai/discord">Discord</A>
      </div>
      <div data-slot="cell">
        <A href="https://x/opencode">X</A>
      </div>
    </footer>
  )
}
