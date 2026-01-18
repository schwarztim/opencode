import { Identifier } from "@/id/id"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { TaskStorage } from "./storage"
import { TaskEvents } from "./events"
import type { BackgroundTask } from "./types"

export namespace TaskManager {
  const log = Log.create({ service: "task.manager" })

  const DEFAULT_CONFIG: BackgroundTask.WorkerPoolConfig = {
    maxConcurrent: 3,
    maxWorktrees: 3,
    worktreeIdleTimeout: 3600000, // 1 hour
  }

  let config = DEFAULT_CONFIG
  const runningTasks = new Map<string, { pid?: number }>()

  export async function init(userConfig?: Partial<BackgroundTask.WorkerPoolConfig>): Promise<void> {
    config = { ...DEFAULT_CONFIG, ...userConfig }
    await TaskStorage.init()
    log.info("Task manager initialized", { config })
  }

  export async function queueTask(input: {
    sessionID: string
    parentMessageID: string
    agent: string
    description: string
    prompt: string
    runInWorktree?: boolean
  }): Promise<BackgroundTask.Info> {
    await init()

    const task: BackgroundTask.Info = {
      id: Identifier.ascending("task"),
      sessionID: input.sessionID,
      parentMessageID: input.parentMessageID,
      agent: input.agent,
      description: input.description,
      prompt: input.prompt,
      status: "pending",
      createdAt: Date.now(),
    }

    await TaskStorage.insert(task)

    Bus.publish(TaskEvents.TaskQueued, {
      taskId: task.id,
      sessionID: task.sessionID,
      description: task.description,
    })

    log.info("Task queued", { taskId: task.id, description: task.description })

    // Note: In a full implementation, this would spawn a worker process
    // For now, we just queue the task and it can be executed later

    return task
  }

  export async function getTask(taskId: string): Promise<BackgroundTask.Info | null> {
    return TaskStorage.get(taskId)
  }

  export async function listTasks(sessionID?: string): Promise<BackgroundTask.Info[]> {
    return TaskStorage.list(sessionID)
  }

  export async function cancelTask(taskId: string): Promise<void> {
    const task = await TaskStorage.get(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    if (task.status === "running" && task.pid) {
      try {
        process.kill(task.pid, "SIGTERM")
      } catch (err) {
        log.warn("Failed to kill task process", { taskId, pid: task.pid, error: err })
      }
    }

    await TaskStorage.update(taskId, {
      status: "cancelled",
      completedAt: Date.now(),
    })

    runningTasks.delete(taskId)
    log.info("Task cancelled", { taskId })
  }

  export async function resumeTask(taskId: string): Promise<BackgroundTask.Info> {
    const task = await TaskStorage.get(taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    if (!["failed", "cancelled"].includes(task.status)) {
      throw new Error(`Can only resume failed or cancelled tasks, got ${task.status}`)
    }

    // Re-queue with same parameters
    const newTask = await queueTask({
      sessionID: task.sessionID,
      parentMessageID: task.parentMessageID,
      agent: task.agent,
      description: task.description,
      prompt: task.prompt,
    })

    log.info("Task resumed", { oldTaskId: taskId, newTaskId: newTask.id })
    return newTask
  }

  export async function updateTaskStatus(
    taskId: string,
    status: BackgroundTask.Info["status"],
    extra?: Partial<BackgroundTask.Info>,
  ): Promise<void> {
    await TaskStorage.update(taskId, { status, ...extra })

    if (status === "completed") {
      Bus.publish(TaskEvents.TaskCompleted, {
        taskId,
        result: extra?.result ?? "",
      })
      runningTasks.delete(taskId)
    } else if (status === "failed") {
      Bus.publish(TaskEvents.TaskFailed, {
        taskId,
        error: extra?.error ?? "Unknown error",
      })
      runningTasks.delete(taskId)
    }
  }
}

export { BackgroundTask } from "./types"
export { TaskEvents } from "./events"
export { TaskStorage } from "./storage"
