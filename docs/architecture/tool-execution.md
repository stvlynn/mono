# Tool Execution

## Purpose

Document how tools are declared, scheduled, approved, and persisted.

## Built-in Tools

Current built-ins:

- `read`
- `write`
- `edit`
- `bash`
- `write_todos` inside agent-core task wiring

## Tool Metadata

Each tool can expose execution metadata:

- `executionMode`
  - `serial`
  - `parallel_readonly`
- `conflictKey`

This metadata is consumed by the tool batch scheduler.

## Batch Scheduler

The scheduler lives in `packages/llm/src/adapters/tool-batch-scheduler.ts`.

Current behavior:

- if a batch contains only readonly tools marked `parallel_readonly`, it may run in parallel
- if the batch mixes readonly and mutating tools, it falls back to serial execution
- final tool result messages are written back in request order for deterministic history

## Parse Errors

Tool argument parse failures are surfaced as tool error results, not hard scheduler crashes.

## Permissions

Permissions are handled in `packages/tools/src/permission.ts`.

Default policy:

- `read`: allow
- `bash`: allow by default
- other mutating tools: ask
- `channel_action`: ask by default, with same-target channel `send` / `sticker` / `react` allowed on allowlisted channels
- `channel_action` also carries Telegram-native `photo` / `document` actions when the runtime exposes them
- `channel_store`: `list` and `search` allow; `upsert` requires confirmation
- `mono.settings.sensitiveActionMode` defaults to `blacklist`
- `mono.settings.approvalPolicy` defaults to `on-request`
- `mono.settings.sandboxMode` defaults to `danger-full-access`
- invalid `approvalPolicy` / `sandboxMode` config values now fail during config resolution
- in `blacklist` mode, sensitive bash commands still require confirmation
- in `strict` mode, every bash command requires confirmation
- in `allow_all` mode, bash runs without sensitive-command interception
- `approvalPolicy=never` turns approval-requiring actions into immediate denials
- `approvalPolicy=auto-approve` bypasses approval prompts for actions that would otherwise ask, while still respecting hard deny rules
- `sandboxMode=read-only` currently hard-denies `bash`, `write`, and `edit` because mono does not yet provide a true shell sandbox
- `sandboxMode=workspace-write` is reserved but not implemented yet; selecting it fails fast
- when a `bash` command fails with `command not found`, mono can automatically install known missing packages with `apt-get` and retry once in `danger-full-access` environments

Channel-aware behavior:

- permission requests may include an optional channel context
- the current Telegram integration can allow specific chat ids to bypass interactive approval
- authorized Telegram private chats also bypass interactive approval through the same allowlist path used by pairing and `allowFrom`
- Telegram direct-message approvals can be resolved remotely through platform action buttons when the runtime supports them
- Telegram chat handoff runs in a dedicated `channel_chat` interaction mode; those turns expose `channel_action` / `channel_store`, do not expose `write_todos`, and only expose protected `bash` for allowlisted Telegram chats
- when the current Telegram turn contains a photo or document, the runtime can disclose that media as `currentResource` and recommend `channel_action(photo|document)` with the current `fileId`
- destructive and configured denylist bash commands require confirmation before execution
- Telegram-specific bash command denylist entries are checked before normal execution

The TUI or CLI approval callback resolves permission requests.

## Tool Output Artifacts

Large tool output can now be offloaded into workspace artifacts.

Current behavior:

- oversized `bash` output is truncated in the visible tool result
- the full output is copied into `.mono/artifacts/`
- the tool result exposes an artifact handle and appends a short `[artifact ...]` reference to the visible content

This is the first step toward artifact-backed long-running tool traces rather than full prompt inlining.
