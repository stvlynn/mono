# API Reference: `@mono/llm`

## Purpose

Describe the public responsibilities of the LLM layer.

## Main Components

- `ModelRegistry`
- `runConversation()`
- adapter router
- tool batch scheduler

## Current Provider Model

`mono` currently routes through OpenAI-compatible `xsai` paths.

Important caveat:
- Anthropic support in this repo is via an OpenAI-compatible path, not native Anthropic Messages API support.

## Main Files

- `packages/llm/src/registry.ts`
- `packages/llm/src/router.ts`
- `packages/llm/src/adapters/`
- `packages/llm/src/adapters/tool-batch-scheduler.ts`
