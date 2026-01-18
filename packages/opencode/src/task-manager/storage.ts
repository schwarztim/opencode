import Database from "better-sqlite3"
import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import type { BackgroundTask } from "./types"

export namespace TaskStorage {
  const log = Log.create({ service: "task.storage" })

  let db: Database.Database | null = null

  function getDBPath(): string {
    return path.join(Global.Path.data, "tasks", Instance.project.id, "tasks.db")
  }

  export async function init(): Promise<void> {
    if (db) return

    const dbPath = getDBPath()
    await fs.mkdir(path.dirname(dbPath), { recursive: true })

    db = new Database(dbPath)
    db.pragma("journal_mode = WAL")
    db.exec(`
      CREATE TABLE IF NOT EXISTS background_tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_message_id TEXT NOT NULL,
        agent TEXT NOT NULL,
        description TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        worktree_path TEXT,
        pid INTEGER,
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      )
    `)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_status ON background_tasks(status)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_session ON background_tasks(session_id)`)

    log.info("Task storage initialized", { dbPath })
  }

  export async function insert(task: BackgroundTask.Info): Promise<void> {
    await init()
    db!.prepare(`
      INSERT INTO background_tasks
      (id, session_id, parent_message_id, agent, description, prompt, status, worktree_path, pid, result, error, created_at, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.sessionID,
      task.parentMessageID,
      task.agent,
      task.description,
      task.prompt,
      task.status,
      task.worktreePath,
      task.pid,
      task.result,
      task.error,
      task.createdAt,
      task.startedAt,
      task.completedAt,
    )
  }

  export async function update(taskId: string, updates: Partial<BackgroundTask.Info>): Promise<void> {
    await init()
    const fields: string[] = []
    const values: unknown[] = []

    const keyMap: Record<string, string> = {
      sessionID: "session_id",
      parentMessageID: "parent_message_id",
      worktreePath: "worktree_path",
      createdAt: "created_at",
      startedAt: "started_at",
      completedAt: "completed_at",
    }

    for (const [key, value] of Object.entries(updates)) {
      const dbKey = keyMap[key] ?? key
      fields.push(`${dbKey} = ?`)
      values.push(value)
    }

    if (fields.length === 0) return

    values.push(taskId)
    db!.prepare(`UPDATE background_tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values)
  }

  export async function get(taskId: string): Promise<BackgroundTask.Info | null> {
    await init()
    const row = db!.prepare("SELECT * FROM background_tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined
    if (!row) return null

    return {
      id: row.id as string,
      sessionID: row.session_id as string,
      parentMessageID: row.parent_message_id as string,
      agent: row.agent as string,
      description: row.description as string,
      prompt: row.prompt as string,
      status: row.status as BackgroundTask.Info["status"],
      worktreePath: row.worktree_path as string | undefined,
      pid: row.pid as number | undefined,
      result: row.result as string | undefined,
      error: row.error as string | undefined,
      createdAt: row.created_at as number,
      startedAt: row.started_at as number | undefined,
      completedAt: row.completed_at as number | undefined,
    }
  }

  export async function list(sessionID?: string): Promise<BackgroundTask.Info[]> {
    await init()
    const sql = sessionID
      ? "SELECT * FROM background_tasks WHERE session_id = ? ORDER BY created_at DESC"
      : "SELECT * FROM background_tasks ORDER BY created_at DESC"
    const rows = (sessionID ? db!.prepare(sql).all(sessionID) : db!.prepare(sql).all()) as Record<string, unknown>[]

    return rows.map((row) => ({
      id: row.id as string,
      sessionID: row.session_id as string,
      parentMessageID: row.parent_message_id as string,
      agent: row.agent as string,
      description: row.description as string,
      prompt: row.prompt as string,
      status: row.status as BackgroundTask.Info["status"],
      worktreePath: row.worktree_path as string | undefined,
      pid: row.pid as number | undefined,
      result: row.result as string | undefined,
      error: row.error as string | undefined,
      createdAt: row.created_at as number,
      startedAt: row.started_at as number | undefined,
      completedAt: row.completed_at as number | undefined,
    }))
  }

  export async function remove(taskId: string): Promise<void> {
    await init()
    db!.prepare("DELETE FROM background_tasks WHERE id = ?").run(taskId)
  }
}
