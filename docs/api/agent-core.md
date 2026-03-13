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

## Important Public Methods

- `initialize()`
- `runTask(input)`
- `prompt(input)`
- `abort()`
- `isRunning()`
- `listProfiles()` / `setProfile()`
- `listModels()` / `setModel()`
- `listSessions()` / `switchSession()`
- `listSessionNodes()` / `switchBranch()`
- `inspectContext(prompt?)`
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
- `abort()` must stop the active run and prevent stale results from landing
- prompt memory injection may combine execution memory and structured memory
- prompt skill injection may combine builtin, global, and project skills
- local session replay and task todo state remain authoritative even when OpenViking is enabled
- image-bearing inputs are rejected up front when the selected model reports `supportsAttachments === false`
