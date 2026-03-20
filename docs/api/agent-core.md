# API Reference: `@mono/agent-core`

## Purpose

Summarize the maintainer-facing contract of the agent runtime.

## Main Entry

`packages/agent-core/src/agent.ts`

## Key Responsibilities

- initialize model, config, session, and memory dependencies
- assemble prompt context and expose context inspection helpers
- load builtin, global, and project skills and expose them to prompt assembly
- run tasks and turns
- emit runtime events
- manage task todo memory
- persist execution memory and structured memory
- support cancellation through `abort()`
- support cleanup for short-lived runtimes through `dispose()`

## Important Public Methods

- `initialize()`
- `runTask(input, options?)`
- `prompt(input)`
- `abort()`
- `dispose()`
- `isRunning()`
- `listProfiles()` / `setProfile()`
- `listModels()` / `setModel()`
- `listSessions()` / `switchSession(sessionId, branchHeadId?, options?)`
- `listThreads()` / `resumeThread(threadId, branchHeadId?, options?)`
- `listSessionNodes()` / `switchBranch()`
- `inspectContext(prompt?)`
- `inspectStructuredMemory(entityId?)`
- `getLatestContextReport()`
- memory inspection helpers used by CLI and TUI

## Skills Surface

`@mono/agent-core` now exposes the runtime-facing skill helpers used by the CLI, TUI, and prompt assembly.

Important exports:

- `loadAvailableSkills(cwd)`
- `loadProjectSkills(cwd)`
- `loadGlobalSkills(cwd)`
- `loadBuiltinSkills()`
- `renderSkillsContext(skills, prompt, cwd)`

The shared `ProjectSkill` shape now includes:

- `name`
- `description`
- `location`
- `content`
- `origin`

`origin` is one of:

- `builtin`
- `global`
- `project`

Important contract:

- `loadAvailableSkills()` applies merge precedence before callers see the list
- the agent runtime uses the merged list, not project-only skills
- prompt assembly only inlines the content of active skills for a given turn

## Important Contracts

- `runTask()` is the preferred execution entrypoint
- `prompt()` is compatibility sugar over task execution
- both methods now accept `string | TaskInput`
- `runTask()` options now include channel-aware execution hints such as `channel`, `interactionMode`, and `extraTaskContext`
- `interactionMode: "curiosity"` is a read-only heartbeat exploration mode that disables `write_todos`, restricts tools to `read`/`bash`, and expects tagged curiosity output
- `abort()` must stop the active run and prevent stale results from landing
- prompt memory injection may combine execution memory and structured memory
- task-end structured memory persistence now runs a fast-path observation write followed by consolidation
- prompt skill injection may combine builtin, global, and project skills
- local session replay and task todo state remain authoritative even when OpenViking is enabled
- `listThreads()` and `resumeThread()` are public thread-flavored aliases over the current session store
- `inspectStructuredMemory()` exposes self runtime state, unresolved conflicts, pending queue items, and the current structured-memory package for one entity
- image-bearing inputs are rejected up front when the selected model reports `supportsAttachments === false`
- `switchSession(..., { preserveCurrentModel: true })` allows a caller to reuse an existing session transcript without letting older session metadata replace the current resolved model
- `AgentOptions.heartbeatEnabled=false` disables automatic autonomy-heartbeat scheduling without disabling `runHeartbeatOnce()`
- `getCurrentTask()` / `getCurrentTodoRecord()` are foreground-facing helpers and do not surface background heartbeat/autonomy tasks
- low-risk heartbeat work can now enqueue a `curiosity_probe` intent that scans lightly, writes back one `openQuestion` and one `hypothesis`, and then applies a short global curiosity cooldown

## Shared-session Telegram handoff

Current Telegram chat handoff does **not** create a separate session.

Instead:

- the TUI creates short-lived handoff agent instances
- those handoff agents disable automatic heartbeat scheduling and are disposed after the chat handoff completes
- each handoff agent switches into the current shared session id
- `switchSession(..., { preserveCurrentModel: true })` prevents an older session metadata header from replacing the active Telegram profile/model
- `extraTaskContext` is used to inject unfinished same-chat reply context into the next Telegram handoff turn
