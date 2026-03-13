# API Reference: `@mono/shared` Types

## Purpose

Call out the shared types that form cross-package contracts.

## Most Important Existing Types

- `ConversationMessage`
- `AssistantMessage`
- `ToolResultMessage`
- `UnifiedModel`
- `TaskInput`
- `InputImageAttachment`
- `TaskState`
- `TaskTodoRecord`
- `TaskResult`
- `RuntimeEvent`
- `MonoGlobalConfig`
- `ResolvedMonoConfig`
- `AgentTool`

## Memory and Context Additions

The recent memory and context work added several high-value shared contracts.

Configuration:

- `MonoMemoryV2Config`
- `MonoContextConfig`
- `UnifiedModel.supportsAttachments`

Context reporting:

- `ContextAssemblyReport`
- `ContextSectionReport`
- `ContextMemoryReport`

Structured memory:

- `MemoryEvidenceRecord`
- `SelfIdentityRecord`
- `SelfTraitRecord`
- `SelfRoleRecord`
- `SelfGuidesRecord`
- `OtherEntityProfileRecord`
- `OtherPreferencesRecord`
- `OtherInferenceRecord`
- `OtherRelationshipStateRecord`
- `EpisodicEventRecord`
- `StructuredMemoryPackage`

These types now coordinate behavior across `@mono/config`, `@mono/memory`, `@mono/agent-core`, `@mono/openviking-adapter`, CLI, and the TUI.

## Image Input Additions

The native image-input work adds these cross-package contracts:

- `InputImageAttachment`: normalized `image/*` payload plus base64 data and optional source metadata
- `TaskInput`: generic task entry shape used by CLI, TUI, and platform adapters
- `UserInputOrigin`: source marker for local CLI, local TUI, or remote platform input
- `UnifiedModel.supportsAttachments`: model capability flag used for early rejection before task execution
