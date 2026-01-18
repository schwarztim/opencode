import z from "zod"
import { BusEvent } from "@/bus/bus-event"

export namespace TaskEvents {
  export const TaskQueued = BusEvent.define(
    "task.queued",
    z.object({
      taskId: z.string(),
      sessionID: z.string(),
      description: z.string(),
    }),
  )

  export const TaskStarted = BusEvent.define(
    "task.started",
    z.object({
      taskId: z.string(),
      pid: z.number(),
    }),
  )

  export const TaskProgress = BusEvent.define(
    "task.progress",
    z.object({
      taskId: z.string(),
      output: z.string(),
    }),
  )

  export const TaskCompleted = BusEvent.define(
    "task.completed",
    z.object({
      taskId: z.string(),
      result: z.string(),
    }),
  )

  export const TaskFailed = BusEvent.define(
    "task.failed",
    z.object({
      taskId: z.string(),
      error: z.string(),
    }),
  )
}
