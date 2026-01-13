import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"

async function getLastModel(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}

export const PlanExitTool = Tool.define("plan_exit", {
  description: EXIT_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: "Planning is complete. Would you like to switch to build mode and start implementing?",
          header: "Build Mode",
          options: [
            { label: "Yes", description: "Switch to build mode and start implementing the plan" },
            { label: "No", description: "Stay in plan mode to continue refining the plan" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]
    const shouldSwitch = answer === "Yes"

    if (shouldSwitch) {
      const model = await getLastModel(ctx.sessionID)

      const userMsg: MessageV2.User = {
        id: Identifier.ascending("message"),
        sessionID: ctx.sessionID,
        role: "user",
        time: {
          created: Date.now(),
        },
        agent: "build",
        model,
      }
      await Session.updateMessage(userMsg)
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: userMsg.id,
        sessionID: ctx.sessionID,
        type: "text",
        text: "User has approved the plan. Switch to build mode and begin implementing the plan.",
        synthetic: true,
      } satisfies MessageV2.TextPart)
    }

    return {
      title: shouldSwitch ? "Switching to build mode" : "Staying in plan mode",
      output: shouldSwitch
        ? "User confirmed to switch to build mode. A new message has been created to switch you to build mode. Begin implementing the plan."
        : "User chose to stay in plan mode. Continue refining the plan or address any concerns.",
      metadata: {
        switchToBuild: shouldSwitch,
        answer,
      },
    }
  },
})

export const PlanEnterTool = Tool.define("plan_enter", {
  description: ENTER_DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question:
            "Would you like to switch to plan mode? In plan mode, the AI will only research and create a plan without making changes.",
          header: "Plan Mode",
          options: [
            { label: "Yes", description: "Switch to plan mode for research and planning" },
            { label: "No", description: "Stay in build mode to continue making changes" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const answer = answers[0]?.[0]
    const shouldSwitch = answer === "Yes"

    if (shouldSwitch) {
      const model = await getLastModel(ctx.sessionID)

      const userMsg: MessageV2.User = {
        id: Identifier.ascending("message"),
        sessionID: ctx.sessionID,
        role: "user",
        time: {
          created: Date.now(),
        },
        agent: "plan",
        model,
      }
      await Session.updateMessage(userMsg)
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: userMsg.id,
        sessionID: ctx.sessionID,
        type: "text",
        text: "User has requested to enter plan mode. Switch to plan mode and begin planning.",
        synthetic: true,
      } satisfies MessageV2.TextPart)
    }

    return {
      title: shouldSwitch ? "Switching to plan mode" : "Staying in build mode",
      output: shouldSwitch
        ? "User confirmed to switch to plan mode. A new message has been created to switch you to plan mode. Begin planning."
        : "User chose to stay in build mode. Continue with the current task.",
      metadata: {
        switchToPlan: shouldSwitch,
        answer,
      },
    }
  },
})
