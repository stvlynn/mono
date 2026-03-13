mono is a local coding-agent monorepo.

Core runtime packages:
- `packages/agent-core`: task loop, prompt assembly, approvals, session wiring
- `packages/prompts`: prompt templates
- `packages/memory`: execution memory retrieval and rendering
- `packages/session`: JSONL session storage and branching
- `packages/cli`: command entrypoints and print-mode flows
- `packages/tui`: interactive UI and slash commands

When changing agent behavior:
- prompt construction: start with `packages/agent-core/src/context-assembly.ts`
- system prompt template: check `packages/prompts/src/templates/agent/system_prompt.j2`
- config defaults and resolution: check `packages/config/src/defaults.ts` and `packages/config/src/resolver.ts`
- runtime state shown in UI: check `packages/tui/src/AppContainer.tsx` and `packages/tui/src/hooks/useAgentBridge.ts`

Prefer small, explicit context layers over one large prompt blob.
