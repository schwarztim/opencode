import { Plugin } from "@/plugin"
import { Log } from "@/util/log"
import type { Hook } from "./types"

export namespace HookOrchestrator {
  const log = Log.create({ service: "hook" })

  /**
   * Execute pre-tool validation hooks
   * Can block tool execution or modify arguments
   */
  export async function preToolValidate(
    input: Hook.PreToolValidate.Input,
    output: Hook.PreToolValidate.Output
  ): Promise<void> {
    try {
      await Plugin.trigger("tool.execute.validate", input, output)
    } catch (err) {
      log.error("preToolValidate hook failed", { error: err, tool: input.tool })
    }

    if (output.blocked) {
      log.info("tool execution blocked by hook", {
        tool: input.tool,
        reason: output.reason,
      })
      throw new Error(`Tool execution blocked: ${output.reason || "No reason provided"}`)
    }
  }

  /**
   * Execute post-tool transform hooks
   * Can modify tool output before returning to LLM
   */
  export async function postToolTransform(
    input: Hook.PostToolTransform.Input,
    output: Hook.PostToolTransform.Output
  ): Promise<void> {
    try {
      await Plugin.trigger("tool.result.transform", input, output)
      log.debug("tool result transformed", { tool: input.tool, callID: input.callID })
    } catch (err) {
      log.error("postToolTransform hook failed", { error: err, tool: input.tool })
    }
  }

  /**
   * Execute session stop hooks
   * Called when agent completes (stop/compact/error)
   */
  export async function sessionStop(
    input: Hook.SessionStop.Input,
    output: Hook.SessionStop.Output
  ): Promise<void> {
    log.info("session stopping", { sessionID: input.sessionID, reason: input.reason })
    try {
      await Plugin.trigger("session.stop", input, output)
    } catch (err) {
      log.error("sessionStop hook failed", { error: err })
    }
  }

  /**
   * Send async notification
   * Non-blocking, errors logged but not thrown
   */
  export async function notification(
    input: Hook.Notification.Input,
    output: Hook.Notification.Output
  ): Promise<void> {
    try {
      await Plugin.trigger("notification.send", input, output)
      log.info("notification sent", { type: input.type })
    } catch (error) {
      log.error("notification failed", { error, type: input.type })
    }
  }
}

export type { Hook } from "./types"
