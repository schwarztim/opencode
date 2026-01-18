# OpenCode → Claude Code Parity: Development Sprint Map

**Date:** 2026-01-18
**Objective:** Achieve 1:1 feature parity with Claude Code
**Architecture:** Manager Agent decomposition with Sonnet implementation tasks

---

## Executive Summary

This Sprint Map defines **4 parallel workstreams** to bring OpenCode to Claude Code feature parity:

| Sprint | Component | Priority | Effort | Dependencies |
|--------|-----------|----------|--------|--------------|
| **Sprint 1** | Hooks & Safety System | P0 | 3 days | None |
| **Sprint 2** | Plugin & Skills Architecture | P0 | 2 days | Sprint 1 (partial) |
| **Sprint 3** | Codebase Indexing | P1 | 10 days | None |
| **Sprint 4** | Subagent Orchestration | P1 | 2 days | None |

**Total Timeline:** 10 days (parallel execution)

---

## Sprint 1: Hooks & Safety System (P0)

### Component Overview
Add lifecycle hooks (PreToolUse, PostToolUse, Stop, Notification) enabling plugins to intercept, block, or transform agent behavior.

### Technical Specifications

**Libraries:**
- Uses existing `Plugin.trigger()` infrastructure
- No new dependencies required

**New Files:**
```
packages/opencode/src/hook/
├── types.ts     # Hook interfaces
└── index.ts     # HookOrchestrator namespace
```

**Modified Files:**
- `packages/plugin/src/index.ts` - Add 4 hook type definitions
- `packages/opencode/src/session/processor.ts` - SessionStop hook integration
- `packages/opencode/src/session/prompt.ts` - PreToolValidate + PostToolTransform hooks

### Implementation Prompt (Secret Sauce)

```markdown
You are implementing the Hooks system for OpenCode.

## Context
Codebase: /tmp/opencode-explore
Existing plugin infrastructure: packages/opencode/src/plugin/index.ts

## Step 1: Create Hook Types
File: /tmp/opencode-explore/packages/opencode/src/hook/types.ts

```typescript
export namespace Hook {
  export interface Context {
    sessionID: string
    abort: AbortSignal
    metadata: Record<string, any>
  }

  export namespace PreToolValidate {
    export interface Input { tool: string; sessionID: string; callID: string; args: any }
    export interface Output { args: any; blocked: boolean; reason?: string }
  }

  export namespace PostToolTransform {
    export interface Input { tool: string; sessionID: string; callID: string }
    export interface Output { title: string; output: string; metadata: any }
  }

  export namespace SessionStop {
    export interface Input { sessionID: string; reason: "stop" | "compact" | "error" }
    export interface Output { metadata: Record<string, any> }
  }

  export namespace Notification {
    export interface Input { sessionID: string; type: string }
    export interface Output { title: string; body: string; data: any }
  }
}
```

## Step 2: Create HookOrchestrator
File: /tmp/opencode-explore/packages/opencode/src/hook/index.ts

Implement 4 methods:
- preToolValidate() - throws Error if blocked
- postToolTransform() - mutates result
- sessionStop() - fire-and-forget
- notification() - non-blocking, catches errors

## Step 3: Extend Plugin Interface
File: /tmp/opencode-explore/packages/plugin/src/index.ts (after line 222)

Add optional hook methods to Hooks interface.

## Step 4: Integrate into Session Processor
File: /tmp/opencode-explore/packages/opencode/src/session/processor.ts (lines 394-401)

Call HookOrchestrator.sessionStop() before returning "stop" or "compact".

## Step 5: Integrate into Tool Execution
File: /tmp/opencode-explore/packages/opencode/src/session/prompt.ts (lines 697-721)

Call preToolValidate before execution, postToolTransform after.

## Success Criteria
- [ ] `bun run build` succeeds
- [ ] grep finds all 4 hook types in plugin interface
- [ ] Hooks integrate with processor and prompt
```

### Success Verification
```bash
cd /tmp/opencode-explore
bun run build
grep -r "tool.execute.validate" packages/plugin/src/index.ts
grep -r "HookOrchestrator.sessionStop" packages/opencode/src/session/processor.ts
```

---

## Sprint 2: Plugin & Skills Architecture (P0)

### Component Overview
Formalize OPENCODE.md support, enhance skills with categories/tags, add plugin hooks for extensibility.

### Technical Specifications

**Libraries:**
- `gray-matter` (already in use)
- No new dependencies

**Modified Files:**
```
packages/opencode/src/session/system.ts  - OPENCODE.md loading
packages/opencode/src/skill/skill.ts     - Category/tag extraction
packages/opencode/src/tool/skill.ts      - Skill loading hooks
```

**New Files:**
```
.opencode/OPENCODE.md                    - Project instructions template
.opencode/skills/example/SKILL.md        - Example skill
```

### Implementation Prompt (Secret Sauce)

```markdown
You are implementing Plugin & Skills enhancements for OpenCode.

## Step 1: Add OPENCODE.md Support
File: /tmp/opencode-explore/packages/opencode/src/session/system.ts

1. Add "OPENCODE.md" as FIRST item in LOCAL_RULE_FILES (line 65)
2. Add OPENCODE.md to GLOBAL_RULE_FILES (line 70)
3. Add ~/.claude/OPENCODE.md support after line 72

## Step 2: Enhance Skill Schema
File: /tmp/opencode-explore/packages/opencode/src/skill/skill.ts

1. Add to Info schema (line 17):
   - category: z.string().optional()
   - tags: z.array(z.string()).optional()

2. In addSkill function, extract category from path:
   ```typescript
   const pathParts = match.split(path.sep)
   const skillIndex = pathParts.findIndex(p => p === "SKILL.md")
   const category = skillIndex >= 2 ? pathParts[skillIndex - 1] : undefined
   ```

## Step 3: Add Skill Loading Hooks
File: /tmp/opencode-explore/packages/opencode/src/tool/skill.ts

In execute function:
- Before loading: Plugin.trigger("skill.load.before", {...})
- After loading: Plugin.trigger("skill.load.after", {...})

## Success Criteria
- [ ] OPENCODE.md loads from project directory
- [ ] Skills show category extracted from path
- [ ] Skill hooks trigger on load
```

### Success Verification
```bash
echo "# Test" > /tmp/opencode-explore/.opencode/OPENCODE.md
mkdir -p /tmp/opencode-explore/.opencode/skills/dev
echo -e "---\nname: test\ndescription: Test skill\ntags: [test]\n---\nContent" > /tmp/opencode-explore/.opencode/skills/dev/SKILL.md
bun run build
```

---

## Sprint 3: Codebase Indexing & Semantic Search (P1)

### Component Overview
Local-first codebase indexing using SQLite + tree-sitter for fast symbol search and intelligent context pruning.

### Technical Specifications

**Libraries:**
- `better-sqlite3` (NEW) - SQLite driver
- `lru-cache` (NEW) - In-memory caching
- `web-tree-sitter` (existing) - AST parsing
- `@parcel/watcher` (existing) - File watching

**New Files:**
```
packages/opencode/src/index/
├── codeindex.ts      # Core index + SQLite schema
├── extractor.ts      # Tree-sitter symbol extraction
├── query.ts          # Search + context pruning
├── indexer.ts        # Batch + incremental updates
└── README.md

packages/opencode/src/tool/
├── symbolsearch.ts   # New tool
└── symbolsearch.txt  # Tool description
```

### SQLite Schema
```sql
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  language TEXT,
  indexed_at INTEGER NOT NULL
);

CREATE TABLE symbols (
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
);

CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_symbols_kind ON symbols(kind);
CREATE INDEX idx_symbols_file ON symbols(file);
```

### Implementation Prompt (Secret Sauce)

```markdown
You are implementing Codebase Indexing for OpenCode.

## Context
- Use existing tree-sitter setup from packages/opencode/parsers-config.ts
- Follow Instance.state() pattern for project-scoped state
- Integrate with @parcel/watcher for incremental updates

## Phase 1: Core Index (Days 1-2)
Create packages/opencode/src/index/codeindex.ts:
- SQLite database at ~/.opencode/data/index/<project-hash>/index.db
- Files and symbols tables with proper indexes
- CRUD operations: insert, update, delete, query

## Phase 2: Symbol Extraction (Days 3-4)
Create packages/opencode/src/index/extractor.ts:
- Load tree-sitter parsers for supported languages
- Query for functions, classes, methods, interfaces
- Extract name, kind, line, signature, docstring

## Phase 3: Query Interface (Days 5-6)
Create packages/opencode/src/index/query.ts:
- search() - SQL LIKE + fuzzy ranking with fuzzysort
- getContext() - Token-budgeted context assembly

## Phase 4: Tool Integration (Days 7-8)
Create packages/opencode/src/tool/symbolsearch.ts:
- Tool.define("symbolsearch", {...})
- Parameters: query, kind filter, limit

## Phase 5: Incremental Updates (Days 9-10)
Subscribe to FileWatcher.Event.Updated:
- Detect changed files via hash
- Re-extract symbols
- Update database

## Performance Targets
- Index 10k files in <5s
- Query latency <100ms
- Memory <200MB for 50k symbols

## Success Criteria
- [ ] opencode symbolsearch "Tool.define" returns all tool definitions
- [ ] File changes trigger re-indexing within 500ms
```

### Success Verification
```bash
# Install dependencies
cd /tmp/opencode-explore/packages/opencode
bun add better-sqlite3 lru-cache

# Build and test
bun run build

# Benchmark (after implementation)
time bun run src/index/benchmark.ts
```

---

## Sprint 4: Subagent Orchestration & Background Tasks (P1)

### Component Overview
Enable parallel agent execution, background tasks, worktree isolation, and resume capability.

### Technical Specifications

**Libraries:**
- No new dependencies
- Uses existing worktree support

**New Files:**
```
packages/opencode/src/task-manager/
├── index.ts          # TaskManager orchestration
├── storage.ts        # SQLite persistence
├── worktree-pool.ts  # Worktree allocation
├── worker.ts         # Child process executor
├── events.ts         # Task lifecycle events
└── types.ts          # Shared types
```

**Modified Files:**
```
packages/opencode/src/tool/task.ts   # Add run_in_background, resume_task_id
packages/opencode/src/tool/task.txt  # Update description
packages/opencode/src/config/config.ts  # Add experimental.background_tasks
```

### Database Schema
```sql
CREATE TABLE background_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_message_id TEXT,
  agent TEXT NOT NULL,
  prompt TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  worktree_path TEXT,
  result TEXT,
  error TEXT,
  pid INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_status ON background_tasks(status);
CREATE INDEX idx_session ON background_tasks(session_id);
```

### Implementation Prompt (Secret Sauce)

```markdown
You are implementing Subagent Orchestration for OpenCode.

## Context
Existing task tool: packages/opencode/src/tool/task.ts
Worktree support: packages/opencode/src/worktree/index.ts

## Phase 1: Storage Layer (2 hours)
Create packages/opencode/src/task-manager/storage.ts:
- SQLite database at ~/.opencode/data/tasks/<project-id>/tasks.db
- CRUD operations with proper error handling

## Phase 2: Worktree Pool (3 hours)
Create packages/opencode/src/task-manager/worktree-pool.ts:
- allocate() - Get or create worktree
- release() - Return to pool
- cleanup() - Remove idle worktrees after 1 hour
- Max pool size: 3 (configurable)

## Phase 3: Worker Process (4 hours)
Create packages/opencode/src/task-manager/worker.ts:
- Entry: bun run worker.ts <taskId>
- Load task from DB, execute SessionPrompt.prompt()
- Send IPC messages: output, complete, error
- Handle graceful shutdown

## Phase 4: TaskManager (4 hours)
Create packages/opencode/src/task-manager/index.ts:
- queueTask() - Insert to DB, spawn worker, return immediately
- getTask() / listTasks() - Query from DB
- cancelTask() - Kill worker process
- resumeTask() - Re-queue failed task

## Phase 5: Task Tool Integration (2 hours)
Modify packages/opencode/src/tool/task.ts:
- Add parameters: run_in_background, run_in_worktree, resume_task_id
- If run_in_background: call TaskManager.queueTask(), return task ID
- If resume_task_id: call TaskManager.resumeTask()
- Default: existing synchronous behavior (backward compatible)

## Phase 6: Events (1 hour)
Create packages/opencode/src/task-manager/events.ts:
- TaskQueued, TaskStarted, TaskProgress, TaskCompleted, TaskFailed

## Success Criteria
- [ ] 3 background tasks run in parallel
- [ ] Real-time output streams to UI
- [ ] Failed tasks can be resumed
- [ ] Worktrees provide isolation
- [ ] Synchronous tasks still work
```

### Success Verification
```bash
# Test parallel execution (after implementation)
bun run opencode << 'EOF'
Use the task tool 3 times in parallel with run_in_background=true:
1. Search for TODO comments
2. Find all API endpoints
3. Count lines of code
EOF

# Verify all 3 complete
```

---

## Consolidated Build Sequence

### Week 1: Foundation (Parallel)

| Day | Sprint 1 | Sprint 2 | Sprint 3 | Sprint 4 |
|-----|----------|----------|----------|----------|
| 1 | Hook types + orchestrator | OPENCODE.md support | Install deps, schema | Storage layer |
| 2 | Plugin interface extension | Skill enhancements | SQLite CRUD | Worktree pool |
| 3 | Processor integration | Skill hooks | Tree-sitter extraction | Worker process |

### Week 2: Integration (Parallel)

| Day | Sprint 1 | Sprint 2 | Sprint 3 | Sprint 4 |
|-----|----------|----------|----------|----------|
| 4 | Prompt.ts integration | Testing | Query interface | TaskManager core |
| 5 | Testing + docs | Docs | SymbolSearch tool | Task tool integration |
| 6 | ✅ Complete | ✅ Complete | File watcher | Events + UI |

### Week 3: Polish

| Day | Sprint 3 | Sprint 4 |
|-----|----------|----------|
| 7-8 | Optimization | Testing |
| 9-10 | Benchmarks + docs | ✅ Complete |

---

## Success Criteria Summary

### Sprint 1: Hooks & Safety ✓
- [ ] 4 hook types in Plugin interface
- [ ] HookOrchestrator methods work
- [ ] Processor calls sessionStop
- [ ] Prompt calls preToolValidate/postToolTransform
- [ ] No breaking changes

### Sprint 2: Plugin & Skills ✓
- [ ] OPENCODE.md loads from project/global
- [ ] Skills have category/tags
- [ ] Skill hooks trigger
- [ ] Backward compatible

### Sprint 3: Codebase Indexing ✓
- [ ] Index 10k files in <5s
- [ ] symbolsearch tool works
- [ ] Query latency <100ms
- [ ] Incremental updates <500ms

### Sprint 4: Subagent Orchestration ✓
- [ ] 3 parallel background tasks
- [ ] Real-time output streaming
- [ ] Resume failed tasks
- [ ] Worktree isolation
- [ ] Backward compatible

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tree-sitter parser failures | Medium | Graceful fallback, skip file |
| SQLite contention | Low | WAL mode, retry with backoff |
| Worker process crashes | Medium | Save state, enable resume |
| Worktree git conflicts | Low | Fresh rebase on allocation |
| Memory pressure (large repos) | Medium | Streaming, pagination, limits |

---

## Full Output Files

Detailed architecture documents from each agent:

1. `/private/tmp/claude/.../tasks/ab176a4.output` - Hooks & Safety
2. `/private/tmp/claude/.../tasks/af3a23e.output` - Plugin & Skills
3. `/private/tmp/claude/.../tasks/af970e6.output` - Codebase Indexing
4. `/private/tmp/claude/.../tasks/ad51b53.output` - Subagent Orchestration

Each contains:
- Complete TypeScript interfaces
- Exact file paths and line numbers
- Implementation prompts ("Secret Sauce")
- Verification commands
- Test cases

---

**Document Status:** Ready for Implementation
**Generated by:** Claude Opus 4.5 (Manager Agent Architecture)
**Agent Outputs:** 4/4 Complete
