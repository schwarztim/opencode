import { Auth } from "../src/auth"
import { Git } from "../src/git"
import { Opencode } from "../src/opencode"
import { Context } from "../src/context"
import { GitHub } from "../src/github"

await GitHub.wrap(async () => {
  try {
    Context.assertEventName("pull_request")
    await Git.configure()
    await Opencode.start()

    const filename = "check-failed-reason.json"
    const pr = Context.payloadPullRequest()
    await Opencode.chat(`
A pull request has been created or updated: '${pr.title}'

<pr-number>
${pr.number}
</pr-number>

<pr-description>
${pr.body}
</pr-description>

Please check:
<check>
${process.env.PROMPT}
</check>

If the check failed, write the reason to ${filename} in this format:
\`\`\`
{
  "reason": "string"
}
\`\`\`

Keep the reason short and concise, only one sentence.

If the check passed, do not create any file.
      `)

    // parse for reason
    let reason
    try {
      reason = await Bun.file(filename).text()
    } catch (e) {}
    if (reason) throw new Error(reason)
  } finally {
    Opencode.closeServer()
    await Auth.revoke()
    await Git.restore()
  }
})
