# Image Input Architecture

## Purpose

Describe how `mono` accepts native image input across local and platform entrypoints.

## Scope

This document covers:

- local CLI image input through `--image`
- local TUI image input through `/attach`, `/detach`, and `/attachments`
- platform-native inbound image normalization through `@mono/im-platform`
- the shared contracts that carry image input into the agent runtime and model adapters

This document does not cover:

- OCR-specific prompting strategies
- audio, video, or PDF input
- browser-only drag/drop upload surfaces

## Shared Contract

The image-input boundary is anchored in `@mono/shared`.

Important types:

- `InputImageAttachment`
- `TaskInput`
- `UserInputOrigin`
- `UnifiedModel.supportsAttachments`

Important helpers:

- `readInputImageAttachmentFromPath()`
- `taskInputToUserMessage()`
- `taskInputToPlainText()`
- `supportsImageAttachments()`

Design rules:

- all entrypoints normalize to `TaskInput`
- image payloads are stored as `mimeType + base64`
- agent/runtime code never depends on platform-specific payload shapes
- model capability checks happen before a run starts

## Local Entry Flow

### CLI

`packages/cli/src/commands/root-command.ts`

Current behavior:

- `--image <path>` may be provided multiple times
- paths are loaded before interactive or print execution starts
- print mode accepts either text, images, or both
- interactive mode seeds attachments into the TUI and auto-submits only when an initial prompt exists

### TUI

`packages/tui/src/AppContainer.tsx`

Current behavior:

- pending attachments live in TUI state until submission
- `/attach <path>` loads a local image into the pending list
- `/detach [index|name|all]` removes pending images
- `/attachments` reports the current pending list
- `Enter` submits when either text or pending images are present

The TUI only manages pending attachments. It does not re-encode or reinterpret them after normalization.

## Agent Runtime Flow

`packages/agent-core/src/agent.ts`

Current behavior:

1. `runTask()` accepts `string | TaskInput`
2. empty input is rejected unless at least one image attachment exists
3. image-bearing inputs are rejected when `state.model.supportsAttachments === false`
4. the agent converts `TaskInput` into a `UserMessage`
5. task state and memory summaries use a plain-text projection such as `[image:image/png]`

This keeps session, memory, and task code compatible with existing text-oriented summaries while preserving full image parts in the actual conversation message.

## Platform-Native Entry Flow

`packages/im-platform/src/types.ts`

`ImPlatformProvider` now has an optional inbound normalization capability:

- `normalizeIncomingMessage(payload)`

The provider returns a platform-agnostic `InboundMessage` which can be converted to `TaskInput` through `inboundMessageToTaskInput()`.

### Telegram First Implementation

`packages/im-platform/src/platforms/telegram/telegram-incoming.ts`

Current behavior:

- accepts Telegram update payloads
- extracts text or caption plus supported image attachments
- downloads the resolved Bot API file payload
- normalizes it into `InputImageAttachment`
- returns a generic `InboundMessage`

The Telegram implementation stays inside the provider boundary. Agent and shared runtime code never inspect Telegram-specific fields.

## Model Adapter Boundary

The agent runtime still emits normal `UserMessage` parts:

- text parts
- image parts

Provider-specific LLM adapters remain responsible for final wire conversion:

- OpenAI-compatible, Gemini, and Anthropic paths are converted into provider-native image parts by the AI SDK provider layer

This keeps image-input concerns separated from remote API formatting.
