import z from "zod"
import path from "path"
import fs from "fs/promises"
import { createHash } from "crypto"
import { Database } from "bun:sqlite"
import { LRUCache } from "lru-cache"
import { Instance } from "@/project/instance"
import { Global } from "@/global"
import { Log } from "@/util/log"

export namespace CodeIndex {
  const log = Log.create({ service: "code.index" })

  export const Symbol = z.object({
    id: z.string(),
    file: z.string(),
    name: z.string(),
    kind: z.enum(["function", "class", "method", "variable", "const", "interface", "type"]),
    line: z.number(),
    endLine: z.number(),
    signature: z.string().optional(),
    docstring: z.string().optional(),
    scope: z.string().optional(),
    language: z.string(),
  })
  export type Symbol = z.infer<typeof Symbol>

  export const FileIndex = z.object({
    file: z.string(),
    hash: z.string(),
    mtime: z.number(),
    language: z.string().nullable(),
  })
  export type FileIndex = z.infer<typeof FileIndex>

  const SCHEMA_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      language TEXT,
      indexed_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      file TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      signature TEXT,
      docstring TEXT,
      scope TEXT,
      language TEXT NOT NULL,
      FOREIGN KEY(file) REFERENCES files(path) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file)`,
    `CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)`,
    `CREATE INDEX IF NOT EXISTS idx_symbols_kind ON symbols(kind)`,
    `CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  ]

  function getProjectHash(): string {
    return createHash("md5").update(Instance.directory).digest("hex").slice(0, 12)
  }

  const state = Instance.state(
    async () => {
      const projectHash = getProjectHash()
      const dbDir = path.join(Global.Path.cache, "codeindex")
      await fs.mkdir(dbDir, { recursive: true })
      const dbPath = path.join(dbDir, `${projectHash}.db`)

      const db = new Database(dbPath)
      db.exec("PRAGMA journal_mode = WAL")
      db.exec("PRAGMA foreign_keys = ON")
      for (const stmt of SCHEMA_STATEMENTS) {
        db.exec(stmt)
      }

      const cache = new LRUCache<string, Symbol[]>({ max: 10000 })

      log.info("Code index initialized", { dbPath })

      return { db, cache, dbPath }
    },
    async (state) => {
      state.db.close()
      log.info("Code index closed")
    },
  )

  export async function init() {
    return state()
  }

  export async function insertFile(file: string, hash: string, mtime: number, language: string | null) {
    const { db } = await state()
    db.prepare(
      `
      INSERT OR REPLACE INTO files (path, hash, mtime, language, indexed_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(file, hash, mtime, language, Date.now())
  }

  export async function insertSymbols(symbols: Symbol[]) {
    const { db, cache } = await state()
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO symbols (id, file, name, kind, line, end_line, signature, docstring, scope, language)
      VALUES ($id, $file, $name, $kind, $line, $endLine, $signature, $docstring, $scope, $language)
    `)

    const insertMany = db.transaction((syms: Symbol[]) => {
      for (const s of syms) {
        stmt.run({
          $id: s.id,
          $file: s.file,
          $name: s.name,
          $kind: s.kind,
          $line: s.line,
          $endLine: s.endLine,
          $signature: s.signature ?? null,
          $docstring: s.docstring ?? null,
          $scope: s.scope ?? null,
          $language: s.language,
        })
      }
    })

    insertMany(symbols)

    // Invalidate cache for affected files
    const files = new Set(symbols.map((s) => s.file))
    for (const file of files) {
      cache.delete(`file:${file}`)
    }
  }

  export async function removeFile(filePath: string) {
    const { db, cache } = await state()
    db.prepare("DELETE FROM symbols WHERE file = ?").run(filePath)
    db.prepare("DELETE FROM files WHERE path = ?").run(filePath)
    cache.delete(`file:${filePath}`)
  }

  export async function getFileHash(filePath: string): Promise<string | null> {
    const { db } = await state()
    const row = db.prepare("SELECT hash FROM files WHERE path = ?").get(filePath) as { hash: string } | undefined
    return row?.hash ?? null
  }

  export async function getFileSymbols(filePath: string): Promise<Symbol[]> {
    const { db, cache } = await state()

    const cacheKey = `file:${filePath}`
    const cached = cache.get(cacheKey)
    if (cached) return cached

    const results = db.prepare("SELECT * FROM symbols WHERE file = ?").all(filePath) as any[]
    const symbols = results.map((r) => ({
      id: r.id,
      file: r.file,
      name: r.name,
      kind: r.kind,
      line: r.line,
      endLine: r.end_line,
      signature: r.signature,
      docstring: r.docstring,
      scope: r.scope,
      language: r.language,
    })) as Symbol[]

    cache.set(cacheKey, symbols)
    return symbols
  }

  export async function searchSymbols(query: string, opts?: { kind?: string[]; limit?: number }): Promise<Symbol[]> {
    const { db, cache } = await state()

    const cacheKey = `search:${query}:${JSON.stringify(opts)}`
    const cached = cache.get(cacheKey)
    if (cached) return cached

    let sql = "SELECT * FROM symbols WHERE name LIKE ? COLLATE NOCASE"
    const params: any[] = [`%${query}%`]

    if (opts?.kind?.length) {
      sql += ` AND kind IN (${opts.kind.map(() => "?").join(",")})`
      params.push(...opts.kind)
    }

    sql += ` ORDER BY
      CASE WHEN name = ? THEN 0 ELSE 1 END,
      LENGTH(name),
      name
      LIMIT ?`
    params.push(query, opts?.limit ?? 50)

    const results = db.prepare(sql).all(...params) as any[]
    const symbols = results.map((r) => ({
      id: r.id,
      file: r.file,
      name: r.name,
      kind: r.kind,
      line: r.line,
      endLine: r.end_line,
      signature: r.signature,
      docstring: r.docstring,
      scope: r.scope,
      language: r.language,
    })) as Symbol[]

    cache.set(cacheKey, symbols)
    return symbols
  }

  export async function searchByPrefix(prefix: string, opts?: { kind?: string[]; limit?: number }): Promise<Symbol[]> {
    const { db, cache } = await state()

    const cacheKey = `prefix:${prefix}:${JSON.stringify(opts)}`
    const cached = cache.get(cacheKey)
    if (cached) return cached

    let sql = "SELECT * FROM symbols WHERE name LIKE ? COLLATE NOCASE"
    const params: any[] = [`${prefix}%`]

    if (opts?.kind?.length) {
      sql += ` AND kind IN (${opts.kind.map(() => "?").join(",")})`
      params.push(...opts.kind)
    }

    sql += ` ORDER BY LENGTH(name), name LIMIT ?`
    params.push(opts?.limit ?? 50)

    const results = db.prepare(sql).all(...params) as any[]
    const symbols = results.map((r) => ({
      id: r.id,
      file: r.file,
      name: r.name,
      kind: r.kind,
      line: r.line,
      endLine: r.end_line,
      signature: r.signature,
      docstring: r.docstring,
      scope: r.scope,
      language: r.language,
    })) as Symbol[]

    cache.set(cacheKey, symbols)
    return symbols
  }

  export async function getStats(): Promise<{ files: number; symbols: number }> {
    const { db } = await state()
    const files = (db.prepare("SELECT COUNT(*) as count FROM files").get() as any).count
    const symbols = (db.prepare("SELECT COUNT(*) as count FROM symbols").get() as any).count
    return { files, symbols }
  }

  export async function clearCache() {
    const { cache } = await state()
    cache.clear()
  }

  export async function getAllIndexedFiles(): Promise<string[]> {
    const { db } = await state()
    const results = db.prepare("SELECT path FROM files").all() as { path: string }[]
    return results.map((r) => r.path)
  }
}
