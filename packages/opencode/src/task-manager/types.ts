import z from "zod"

export namespace BackgroundTask {
  export const Info = z.object({
    id: z.string(),
    sessionID: z.string(),
    parentMessageID: z.string(),
    agent: z.string(),
    description: z.string(),
    prompt: z.string(),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
    worktreePath: z.string().optional(),
    pid: z.number().optional(),
    result: z.string().optional(),
    error: z.string().optional(),
    createdAt: z.number(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional(),
  })
  export type Info = z.infer<typeof Info>

  export interface WorkerPoolConfig {
    maxConcurrent: number
    maxWorktrees: number
    worktreeIdleTimeout: number
  }

  export type WorkerMessage =
    | { type: "output"; taskId: string; chunk: string }
    | { type: "complete"; taskId: string; result: string }
    | { type: "error"; taskId: string; error: string }
    | { type: "heartbeat"; taskId: string }
}
