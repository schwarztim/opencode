import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

export const QuestionTool = Tool.define("question", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: z.array(Question.Info).describe("Questions to ask"),
  }),
  async execute(params, ctx) {
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: params.questions,
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    function format(q: Question.Info, answer: Question.Answer | undefined) {
      if (!answer?.length) return "Unanswered"
      return answer
        .map((label) => {
          const opt = q.options.find((x) => x.label === label)
          if (!opt) return label
          return `${opt.label} - ${opt.description}`
        })
        .join(", ")
    }

    const formatted = params.questions.map((q, i) => `"${q.question}"="${format(q, answers[i])}"`).join(", ")

    return {
      title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
      output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
      metadata: {
        answers,
      },
    }
  },
})
