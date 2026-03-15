# API Reference: `@mono/llm`

## Purpose

Describe the public responsibilities of the LLM layer.

## Main Components

- `ModelRegistry`
- `runConversation()`
- adapter router
- tool batch scheduler

## Current Provider Model

`mono` routes model execution through the Vercel AI SDK provider layer.

Important caveat:
- Anthropic models use the native Anthropic provider path.
- OpenAI-compatible providers still share one compatibility layer driven by `baseURL`, `transport`, and `providerFactory`.

## Main Files

- `packages/llm/src/registry.ts`
- `packages/llm/src/router.ts`
- `packages/llm/src/adapters/`
- `packages/llm/src/adapters/tool-batch-scheduler.ts`
