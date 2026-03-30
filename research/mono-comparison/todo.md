# Todo - Mono Research

## High Priority
- [x] ~~Study Mono's approval policy and autonomy limits in `agent-core`~~ (Finding 8)
- [x] ~~Review `resolveAutonomyBias` and `LearningState` implementation~~ (Finding 2, Finding 7)
- [x] ~~Investigate `@json-render/core` library capabilities for potential OpenClaw TUI improvements~~ (Finding 1)
- [x] ~~Study `channel_platform_context.j2` and `task_context_channel_chat.j2` templates~~ (Finding 6)
- [x] ~~Investigate `transcript-repair.ts` for potential OpenClaw session repair adoption~~ (Finding 14)
- [x] ~~Study `HeartbeatWakeController` coalescing pattern~~ (Finding 13)
- [x] ~~Study `streamAiSdkText` for potential streaming output adoption~~ (Finding 15)
- [ ] Study ChannelRegistry pattern for potential OpenClaw multi-channel architecture (Finding 16)

## Medium Priority
- [ ] Compare session management between Mono and OpenClaw
- [ ] Study Mono's docker healthcheck fix in detail
- [ ] Look at how Mono handles tool call streaming vs OpenClaw
- [ ] Check if `feat/tui-json-render-surface` merges cleanly when it does
- [ ] Study `streamAiSdkText` for potential streaming output adoption (Finding 10)

## Low Priority / Async
- [ ] Study Mono's memory consolidation strategy for potential adoption
- [ ] Compare prompting strategies between agent-core prompts and OpenClaw's SOUL/AGENTS structure

## Monitoring
- [x] Watch `feat/tui-json-render-surface` merge into main (currently ce4a8bc, 3 commits ahead)
- [ ] Monitor memory package changes (recent 103-line addition was significant)
- [ ] Watch for any OpenClaw-like features appearing in Mono (heartbeat, autonomy, tool registry)