# Mono vs OpenClaw Comparison Findings

**Last updated:** 2026-03-29

---

## Finding 1: Dual-mode TUI Rendering Architecture (NEW)

### What Mono does
Mono is building a sophisticated dual-mode TUI system (`origin/feat/tui-json-render-surface`, commit `ce4a8bc`, not yet merged to main):

- **Deterministic layer**: `tui-render-spec.ts` defines a fixed `Spec` JSON structure with hardcoded element IDs (pane-hint, query-status, history-list, pending-tools-section, etc.) — similar to OpenClaw's current TUI approach
- **LLM-generative layer**: `tui-render-runtime.ts` uses a separate LLM call to generate a `Spec` object via `@json-render/core` (`autoFixSpec`, `createSpecStreamCompiler`, `validateSpec`). The prompt (`tui-render-prompt.ts`) instructs the model to generate UI specs
- **Catalog system**: `tui-render-registry.tsx` uses `@json-render/core`'s `defineCatalog` with Zod-typed actions (`pane_submit`, `pane_select`, `pane_confirm`, `pane_cancel`, `request_shell_focus`, `request_generated_focus`)
- **Hybrid render**: `json-render-tui.tsx` wraps both via `@json-render/ink`'s `JSONUIProvider`, with an overlay system for idle/loading/error states

### Key insight
Mono's approach adds a second LLM call specifically for UI rendering — separate from the main agent's LLM. This is architecturally interesting but adds latency and cost. OpenClaw currently renders TUI directly from agent state without a generative layer.

### Potential
Could OpenClaw benefit from a catalog-based action system for the canvas tool? Mono's `pane_*` actions are pane-scoped — similar to how OpenClaw might want to handle sub-panel interactions.

---

## Finding 2: Config-driven Heartbeat Autonomy (NEW)

### What Mono does (from `autonomy-runtime.ts`)
- `buildHeartbeatSelection()` — builds candidates from todos, open questions, and feedback reflection
- Topic-level suppression: `AUTONOMY_TOPIC_SUPPRESSION_THRESHOLD = 0.9`, `AUTONOMY_TOPIC_MAX_BOREDOM = 1.4` — prevents the agent from repeating the same autonomous work too often
- Duplicate dedup by semantic overlap: `filterDuplicateAutonomyCandidates()` compares new intents against recent ones
- Autonomy bias from `LearningState`: `resolveAutonomyBias()` returns a bias score that gates the entire heartbeat
- Cool-down keys: `CURIOSITY_COOLDOWN_KEY = "curiosity:global"`, `AUTONOMY_COOLDOWN_MS = 5 * 60_000`
- Curiosity lease: `maxWallTimeMs: 20_000, maxToolCalls: 2, maxSteps: 3` — much tighter than task lease

### Comparison with OpenClaw
OpenClaw uses `HEARTBEAT.md` as a static checklist and cron jobs with simple intervals. Mono's approach is dynamic, data-driven, and self-regulating based on learning state. The semantic dedup and topic boredom tracking are sophisticated features OpenClaw doesn't have.

### Potential
OpenClaw could benefit from a lightweight version of the curiosity cooldown — tracking when it last explored each topic area and not re-exploring within a time window.

---

## Finding 3: Structured Memory Retrieval (NEW)

### What Mono does
`StructuredMemoryRetrievalPlanner.buildPackage()`:
- Fetches 9 data types in parallel: selfIdentity, selfRuntime, projectProfile, otherProfile, otherPreferences, otherInferences, relationshipState, conflicts, episodic
- Conditional autonomy work recall: `shouldRecallAutonomousWork(query)` decides whether to also fetch recentAutonomyIntents and heartbeat replies
- `FolderStructuredMemoryStore` with typed methods for each record type

### Comparison with OpenClaw
OpenClaw uses a simple file-based system (MEMORY.md + daily notes + curiosity-log.json). Mono's structured approach is more principled but more complex. The conditional autonomy recall is interesting — only surfaced when the user explicitly asks.

---

## Finding 4: Channel Registry Pattern (NEW)

Mono's `channel-registry.ts` defines a `ChannelIntegrationContext` interface with:
- `requestApproval?(request: ApprovalRequest): Promise<boolean | null>`
- `reload?(): Promise<void>`
- `flushPendingProfileApplication?(): Promise<void>`
- `dispose(): Promise<void>`
- `applyProfile(profileName: string): Promise<void>`
- `listConfiguredProfiles(): Promise<...>`

This is a clean abstraction for multi-channel agents — each channel (TUI, Telegram, etc.) registers as a capability provider. OpenClaw's channel model is less formally structured.

---

### Finding 5: Prompt Template Centralization (NEW)

**What Mono does (from `df17301` refactor):**
Mono migrated all LLM-facing prompt text from hardcoded TypeScript string arrays into Jinja/Nunjucks templates under `@mono/prompts`:
- 15 template files covering task turns, task context blocks, channel delivery guidance, autonomy heartbeat extra context
- Platform-specific templates (e.g., Telegram) live beside the platform adapter, rendered through shared infrastructure
- File-path-based renderer so platform packages can render local `.j2` files without duplication
- Build step now copies platform-local templates into platform dist dirs

**Key files:** `packages/prompts/src/registry.ts`, `packages/prompts/src/render.ts`

**Key insight:** Prompt logic is separated from runtime logic. This makes prompt iteration faster (no TypeScript recompile), more versionable (can diff prompts), and allows platform-specific overrides without modifying core code.

**Comparison with OpenClaw:** OpenClaw's prompts are split across SOUL.md, AGENTS.md, skill SKILL.md files, and inline in code (e.g., TUI prompts). No centralized template system. The prompt authoring experience is less structured.

### Finding 6: Channel Platform Context Templates (NEW)

**What Mono does:**
New templates for channel-specific context injection:
- `channel_platform_context.j2` — platform notes injected into capability context (45 lines added)
- `channel_reply_format_rules.j2` — platform-specific formatting rules
- `channel_reply_instructions.j2` — platform-specific delivery instructions (32 lines)
- `required_channel_action.j2` — notices for required native actions
- `task_context_channel_chat.j2` — task context blocks for channel chat mode

This enables each channel (Telegram, TUI, etc.) to have its own behavioral rules that can be updated independently.

**Potential for OpenClaw:** Could benefit from a similar channel-aware prompt layer for the TUI vs Telegram vs Discord surfaces.

### Finding 7: Autonomy Topic Boredom & Semantic Deduplication (NEW)

**What Mono does (from `7a515fb`):**
- Topic-level boredom score tracking: `AUTONOMY_TOPIC_MAX_BOREDOM = 1.4`, `AUTONOMY_TOPIC_SUPPRESSION_THRESHOLD = 0.9`
- Boredom decays with time: `AUTONOMY_TOPIC_DECAY_MS = 6 * 60 * 60_000` (6 hours), `AUTONOMY_TOPIC_REPEAT_WINDOW_MS = 2 * 60 * 60_000` (2 hours)
- Stopword filtering: `AUTONOMY_TOPIC_STOPWORDS` set filters common words from topic extraction
- `filterDuplicateAutonomyCandidates()` uses semantic overlap to deduplicate intent candidates
- Boredom penalty: up to 0.42 priority penalty for repeated topics

**Key code in `autonomy-runtime.ts`:**
```typescript
const effectiveBoredom = clamp(matched.boredomScore - ageFactor * 0.5, 0, AUTONOMY_TOPIC_MAX_BOREDOM);
const penalty = clamp(effectiveBoredom * 0.18 + Math.max(0, matched.repetitionCount - 1) * 0.05, 0, 0.42);
```

**Potential for OpenClaw:** Could implement lightweight topic boredom for curiosity cooldown — tracking what topics have been explored recently and penalizing re-exploration within a time window.

### Finding 8: Permission Policy Hardening (NEW)

**What Mono does (from `7ea3987`):**
- `bash` commands that match destructive denylist now go through `applyApprovalPolicy` instead of hard deny — allows user override
- Commands matching configured denylist also go through approval policy instead of hard deny
- Removed the channel allowlist check (`isAllowlistedChannel`) from the default policy
- Auto-repair needs explicit approval before installing packages
- Auto-repair retries failed install attempts
- Blocked/deferred autonomy runs count toward hourly cap

**Key change in `permission.ts`:**
```diff
- return denyDecision("Command matches destructive denylist");
+ return this.applyApprovalPolicy(askDecision("Command matches destructive denylist"));
```

**Comparison with OpenClaw:** OpenClaw has similar approval mechanisms but the denylist approach gives the user a chance to override rather than hard-blocking.

---

---

## Finding 9: Channel Capability Provider Pattern (NEW)

### What Mono does (from `origin/feat/tui-json-render-surface`)
Refactored `buildChannelChatProtectedTools` and `createPermissionPolicy` to use a generic `ChannelPermissionProfile` instead of hardcoded Telegram checks:

- `resolveChannelPermissionProfile(channel)` delegates to `channelCapabilityProvider.getPermissionProfile(channel)` — generic channel abstraction
- `ChannelPermissionProfile` contains: `allowlistedChannels`, `commandDenylist`, `exposeProtectedBash` — all channel-neutral
- Removed `canExposeChannelChatBash`, `loadTelegramImplicitApprovalChannels`, `readTelegramAllowFromStore` — telegram-specific logic abstracted
- The bash exposure logic is now: `!channelPermissionProfile?.exposeProtectedBash && !policy.isAllowlistedChannel(...)`

### Key insight
The Telegram-specific permission logic has been generalized into a channel capability provider pattern. This enables other channels (TUI, etc.) to define their own permission profiles without touching core agent code.

---

## Finding 10: `streamAiSdkText` Function (NEW)

### What Mono does (from `origin/feat/tui-json-render-surface`)
New function in `packages/llm/src/adapters/ai-sdk-runtime.ts`:

- Independent text streaming function (separate from conversation streaming)
- Uses `wrapperParser.push(chunk.text)` for reasoning wrapper parsing during streaming
- Handles `text-delta` and `reasoning-delta` chunk types separately
- Calls `onTextDelta` and `onThinkingDelta` callbacks during stream
- Finishes with `wrapperParser.finish()` for trailing content

### Potential
This is a lower-level streaming API that could be used for real-time text output (TUI streaming, live agent responses). OpenClaw could potentially use this pattern.

---

## Finding 11: TUI Config with Spec Mode (NEW)

### What Mono does (from `origin/feat/tui-json-render-surface`)
TUI channel config with two rendering modes:

- `specMode: "deterministic"` — uses pre-defined Spec JSON structure (hardcoded pane IDs)
- `specMode: "generative"` — uses LLM to generate Spec via `@json-render/core`
- Config options: `renderer`, `specMode`, `validateGeneratedSpec`, `streamGeneratedSpec`, `debugRender`

### Key insight
Config-driven TUI rendering mode selection. Deterministic is faster, generative is more flexible.

---

## Finding 12: TranscriptPolicy Model-Specific Sanitization (NEW)

### What Mono does
`resolveTranscriptPolicy(model)` returns model-specific sanitization rules:

- Strict provider list: `openai-compatible`, `openai-responses`, `anthropic`, `gemini` → `strictAssistantToolOrdering: true`
- Other models: lenient mode
- Policy fields: `repairToolCallResultPairing`, `allowSyntheticToolResults`, `dropMalformedToolCalls`, `strictAssistantToolOrdering`

### Comparison with OpenClaw
OpenClaw doesn't have model-specific transcript sanitization. Session history might contain malformed tool calls that could confuse some models.

---

## Finding 13: HeartbeatWakeController with Coalescing (NEW)

### What Mono does
`HeartbeatWakeController` in `packages/agent-core/src/heartbeat-wake.ts`:

- Priority-based wake coalescing: manual(4) > retry(3) > nudge(2) > timer(1)
- Single timer for coalescing: `schedule(delayMs)` with coalesce window of 250ms
- Only one handler running at a time; pending wakes queued
- Retry on error: `queuePending("retry")`, `schedule(this.retryDelayMs)`
- Trigger types: `timer | manual | retry | nudge`

### Comparison with OpenClaw
OpenClaw uses cron jobs for scheduled tasks and heartbeat polls for periodic checks. Mono's `HeartbeatWakeController` is a more structured in-process coalescing mechanism.

---

## Finding 14: Linear Session Transcript Repair (NEW)

### What Mono does
`repairLinearSessionTranscript()` in `packages/session/src/transcript-repair.ts`:

- Detects linear sessions (all entries have sequential parentIds)
- `sanitizeConversationMessages()` with model-specific `TranscriptPolicy`
- Adds synthetic tool results for missing pairs
- Drops orphan tool results (no matching tool call)
- Drops malformed tool calls (malformed input_id or no name)
- Drops duplicate assistant messages
- Reports: `addedSyntheticToolResults`, `droppedOrphanToolResults`, `droppedMalformedToolCalls`, `droppedAssistantMessages`

### Key insight
This is critical for long-running sessions where the transcript can get corrupted. The synthetic tool result generation is especially interesting — when the model returns a tool call without a matching result, it generates a synthetic error result so the next turn doesn't break.

### Comparison with OpenClaw
OpenClaw doesn't appear to have a transcript repair mechanism. Long sessions might accumulate corrupted tool call/result pairs.

---

---

## Finding 15: `LlmTextStreamOptions` Type (NEW, 2026-03-30)

### What Mono does
New streaming type added in `packages/llm/src/adapters/ai-sdk-runtime.ts` (via `feat/tui-json-render-surface`):

```typescript
export async function streamAiSdkText(options: LlmTextStreamOptions): Promise<string>
```

Callback interface:
- `onTextDelta(delta: string): void` — real-time text chunks
- `onThinkingDelta(delta: string): void` — real-time thinking chunks

### Key behavior
- Uses `wrapperParser.push(chunk.text)` to split text vs thinking in a single stream
- Handles `reasoning-delta` chunks (AI SDK native reasoning) separately
- Calls `wrapperParser.finish()` for trailing content after stream completes
- Returns full concatenated text + fires delta callbacks during streaming
- Error handling: `NoOutputGeneratedError` wrapped with `normalizeStreamError`

### Comparison with OpenClaw
OpenClaw doesn't appear to have a separate lower-level text streaming function. The streaming is tied to conversation streaming. A dedicated text streaming API would be useful for TUI streaming output where you want to render text as it arrives without the full conversation turn overhead.

---

## Finding 16: Channel Surface + Integration Registry (NEW, 2026-03-30)

### What Mono does
`packages/tui/src/channel-registry.ts` defines a two-layer channel architecture:

**Surface layer** — local UI adapters:
```typescript
export interface ChannelSurfaceAdapter {
  readonly id: string;
  run(options: InteractiveAppProps & { registry: ChannelRegistry }): Promise<void>;
}
createTuiSurfaceAdapter() → renders Ink app via JSONUIProvider
```

**Integration layer** — remote/platform integrations:
```typescript
export interface ChannelIntegration {
  readonly id: string;
  attach(context: ChannelIntegrationContext): Promise<ChannelIntegrationHandle>;
}
createTelegramChannelIntegration() → attaches TelegramControlRuntime
```

**ChannelRegistry** manages both:
- `registerSurface()` / `resolveSurface(id)` — local surfaces
- `registerIntegration()` / `listIntegrations()` — remote channels

**ChannelIntegrationHandle** exposes:
- `provider?: ChannelCapabilityProvider` — the actual capability provider
- `requestApproval?()` — ask user for approval
- `reload?()` — hot reload config
- `flushPendingProfileApplication?()` — apply pending profile changes
- `dispose()` — cleanup

**New in this branch:**
- `load-prompts.ts` — dynamic prompt template loading for Telegram integration
- `runtime.ts` changes — Telegram now uses `ChannelCapabilityProvider` interface
- `app.tsx` → `runInteractiveApp()` — wires registry with surfaces + integrations

### Key insight
The TUI is now both a surface AND an integration host. It surfaces local TUI rendering while also hosting Telegram as a pluggable integration. This enables the TUI to serve as a hub for multiple channel integrations, each with their own capability provider.

### Comparison with OpenClaw
OpenClaw's channel model is simpler: TUI, Telegram, Discord are separate entry points that don't cross-communicate. Mono's registry pattern allows channels to share state and the TUI to act as a "control plane" for remote integrations.

---

## Monitoring Notes

- `feat/tui-json-render-surface` branch: `ce4a8bc` (3 commits ahead of main), not merged, `fix/stale-lockfile` is HEAD
- `fix/stale-lockfile` is 1 commit ahead of main (pnpm-lock sync fix)
- Both branches exist in parallel, suggest `fix/stale-lockfile` should be merged first or both merged together

### High Priority
- [ ] Study Mono's approval policy and autonomy limits in `agent-core`
- [ ] Investigate `@json-render/core` library capabilities for potential OpenClaw TUI improvements
- [ ] Review `resolveAutonomyBias` and `LearningState` implementation in detail

### Medium Priority
- [ ] Compare session management between Mono and OpenClaw
- [ ] Study Mono's docker healthcheck fix in detail
- [ ] Look at how Mono handles tool call streaming vs OpenClaw
- [ ] Review `channel_platform_context.j2` and `task_context_channel_chat.j2` templates for channel-specific prompt architecture

### Low Priority / Async
- [ ] Check if `feat/tui-json-render-surface` merges cleanly when it does
- [ ] Study Mono's memory consolidation strategy for potential adoption
- [ ] Compare prompting strategies between agent-core prompts and OpenClaw's SOUL/AGENTS structure

### Monitoring
- [ ] Watch `feat/tui-json-render-surface` merge into main (currently 1 commit ahead of main)
- [ ] Monitor memory package changes (recent 103-line addition was significant)
- [ ] Watch for any OpenClaw-like features appearing in Mono (heartbeat, autonomy, tool registry)

### Recent Changes (since last review)
- `459a78e` — docker sync fix (pnpm-lock.yaml)
- `df17301` — prompt template migration (15 new .j2 files, template renderer)
- `7a515fb` — config-driven heartbeat + topic boredom + semantic dedup
- `9b57af8` — telegram fallback message suppression
- `86c14f9` — telegram sticker action fix
- `7ea3987` — permission policy hardening + autonomy limit counting
---

## 2026-03-30 03:04 UTC — Incremental Review (2 new commits since 459a78e)

### 新增发现 (相对于上次巡查 459a78e)

**A. `df17301` — Prompt Template Migration 深入细节**

Template system 从原有的 2 个 template (system_prompt + ui/waiting*) 扩展到 15 个 agent templates。Key changes:

1. **Task context templates (5个)**:
   - `task_context_default.j2` — 通用任务上下文
   - `task_context_preview.j2` — 预览模式上下文
   - `task_context_curiosity.j2` — 好奇心模式上下文
   - `task_context_channel_chat.j2` — **通道聊天专用** (mode: channel_chat, 禁用 write_todos, 禁用工程规划)
   - `task_context_channel_chat.j2` 还添加了 `Origin: {{ origin }}` 和 lease 信息

2. **Task turn templates (5个)**:
   - `task_turn_verify.j2` — 验证阶段
   - `task_turn_curiosity.j2` — 好奇心探索模式，用 tag 输出 `[curiosity-question:] [curiosity-hypothesis:] [curiosity-evidence:]`
   - `task_turn_direct_response.j2` — 直接响应模式
   - `task_turn_execute.j2` — 执行阶段
   - `task_turn_execute.j2` 添加了 `[final-reply]...[/final-reply]` wrapper 标记

3. **Channel context templates (4个)**:
   - `channel_reply_format_rules.j2` — 遍历 channel 的 `replyFormattingRules` 数组，输出格式规则列表
   - `channel_reply_instructions.j2` — 通道交付指令（核心模板，替代原来的硬编码字符串数组）
   - `channel_platform_context.j2` — 平台原生资源上下文（Channel native resource context）
   - `required_channel_action.j2` — 必需 channel action 的格式模板

4. **Autonomy context template**:
   - `autonomy_extra_context.j2` — autonomy heartbeat 的额外上下文，包含 intent kind、source signal、priority、risk，**好奇心探测模式特殊格式**输出 tag 化的 question/hypothesis/evidence

5. **agent.ts 重构**: `buildChannelReplyInstructions` 从 ~45 行硬编码字符串数组 → nunjucks template render。`buildChannelPlatformContext` 也被改为 template render。新增 `buildChannelReplyFormattingRules` 方法。

6. **`renderPromptTemplateFile` 导出**: `packages/prompts/src/render.ts` 导出独立函数，支持任意 .j2 文件路径的 rendering（用于 platform-local templates）。

7. **Telegram platform-local templates**: `packages/telegram-control/src/templates/` 下新增 `reply_format_rules.j2` 和 `channel_notes.j2`，由 telegram runtime 使用。

**对比 OpenClaw**: OpenClaw 没有这套 template system，agent prompt 是硬编码字符串。Template-based prompt assembly 更易维护和扩展。

**B. `7a515fb` — Config-driven heartbeat + autonomy refinement 深入细节**

Key changes beyond previous review:

1. **Topic-level suppression (重复工作抑制)**:
   - `AUTONOMY_TOPIC_SUPPRESSION_THRESHOLD` (boredom threshold) 控制同一 topic 的 heartbeat probe 频率
   - `autonomyTextsShareTopic(left, right)` — 基于词项重叠判断两个 autonomy intent 是否同一 topic
   - 算法: 提取词项 → 共享 ≥2 个词项则同 topic；或共享 1 个且任一方 ≤2 词项则同 topic
   - 结果: 同一 topic 的重复 autonomy probe 被 suppression

2. **`filterDuplicateAutonomyCandidates`** — 基于 recentIntents 过滤重复候选
   - 检查 `intent.status !== "completed"` + 相同 kind + topic overlap
   - 避免重复触发相同类型的 autonomy intent

3. **Primary vs fallback candidate 分层**:
   - primary candidates: todo/open/feedback (非 curiosity)
   - curiosity candidates: 单独过滤和排序
   - 如果 primary 的 top candidate priority 低于阈值，尝试选一个不同 topic 的 fallback
   - 只有 primary 和 fallback 都失败才返回 noop

4. **Recent autonomous work conditional recall**:
   - `shouldRecallAutonomousWork(query)` — 只有当 query 暗示需要后台工作时才加载 autonomy records
   - 用 semantic match 判断是否需要加载 recentAutonomyIntents 和 recentHeartbeatReplies

5. **New heartbeat reply status**: `status: "suppressed"` 作为新的 reply 状态

6. **Structured memory retrieval 条件加载**: 只有 `includeAutonomousWork=true` 时才 fetch `listAutonomyIntents` + `listHeartbeatReplyRecords`，避免不必要的 DB 查询

**C. `9b57af8` — Telegram fallback suppression 细节**

`buildTelegramChatFallback` 在无法验证时返回空字符串 `""` 而非 "I finished the attempt, but I don't have a reliable result to send yet."。Format 函数在 fallback 为空时返回 `messages: []` 而非空消息。这避免了在没有实质性内容时发送无意义的 fallback text。

**D. Feature Branch: `feat/tui-json-render-surface` — Fresh fetch (之前 branch 已不存在)**

Fetch 后重新分析: 新增文件架构:
- `tui-render-prompt.ts` — 组装 LLM prompt: catalog_prompt + presentation_json + seed_spec_json
- `presentation.ts` — `TuiRenderRequest` 把 agent state 转为结构化请求
- `tui-render-runtime.ts` — `createSpecStreamCompiler` + `validateSpec` + `autoFixSpec` pipeline；`coerceValidSpec` 验证 JSON spec；`hasMinimumTuiSurface` 检查最低 UI 元素要求
- `tui-render-registry.tsx` — React component registry + action handlers (pane_submit/select/confirm/cancel/request_shell_focus/request_generated_focus)
- `json-render-tui.tsx` — 实际渲染 JSON spec 为 React 组件

**Pipeline**: LLM → JSON spec → autoFixSpec → validateSpec → catalog.validate → hasMinimumTuiSurface → render

### 状态更新

- 已看过 commits: `bfc8d3a`, `df17301`, `7a515fb`, `9b57af8`, `86c14f9`, `7ea3987`, `05cb57d`, `5f54521`, `b98c0ab`, `b87691e`
- 已合并到 findings 的新方向: template system architecture, topic suppression, semantic dedup, fallback suppression, json-render pipeline
- 下次继续: tui-json-render-surface branch 代码细节、autonomy-runtime dedup 算法完整实现、structured-memory retrieval 完整实现

### 2026-03-30 06:24 - ed67565 巡查

**ed67565** - Docker pnpm-lock 同步修复
- 单一文件 (+3/-1) 修复 df17301 引入的 lockfile 不同步
- 纯维护性，无架构影响

**对比观察 - Prompt 管理:**
m mono: Jinja2  文件管理 prompt templates (packages/prompts/templates/)
b OpenClaw:  格式声明式管理 skills
- 都是文本模板方案，区别是 Jinja2 vs Markdown 结构化

**Issue 状态:**
L 16 open, 2 closed (无新变化)

**结论:** 代码库稳定，无新发现可记录。

---

### 2026-03-30 15:32 - 巡查

**新发现: Mono Prompt Template 系统深度分析**

Mono 使用 Nunjucks 实现完整的模板系统，共 35 个模板 ID，分为三大类:

1. **agent/ 模板** - 核心行为模板
   - Turn 模板: `task_turn_execute.j2` (执行模式，todo 引导) / `task_turn_verify.j2` (验证模式，targeted checks) / `task_turn_curiosity.j2` (好奇心探索，严格 tagged 输出格式) / `task_turn_direct_response.j2`
   - Context 模板: `task_context_preview.j2` (Phase: preview, 0 attempts) / `task_context_default.j2` (含 todos 列表、autonomy_intent、lease 信息) / `task_context_channel_chat.j2` (mode: channel_chat, 无 write_todos) / `task_context_curiosity.j2`
   - Channel 模板: `channel_platform_context.j2` (Native Resource Context, Store abstraction, Required/RecommendedChannelAction) / `channel_reply_format_rules.j2` (格式规则) / `channel_reply_instructions.j2` / `required_channel_action.j2` / `channel_action_retry_feedback.j2`
   - Autonomy: `autonomy_extra_context.j2` (intent.kind, sourceSignal, priority_text, riskLevel, 保守行动指南，curiosity_probe 特殊格式)

2. **ui/ waiting 模板** - 加载状态渲染
   - 所有 `waiting_assistant_*` 和 `waiting_task_*` 模板结构完全相同: `{{ emoji }}{{ prefix }}{{ action }}{{ suffix }}`
   - UI 状态差异化完全由 render 时传入的 context 变量控制，而非模板本身
   - 这与 `tui-render-runtime.ts` 的 JSON spec 生成系统配合使用

3. **memory/ 模板** - 记忆和会话历史
   - `trace_*` 系列: trace_user/trace_assistant/trace_tool_call/trace_tool_result
   - `compacted_step_*` 系列: compacted_step_received/tool_call/tool_result/assistant/user_response - 用于压缩后的会话历史渲染
   - `*_context_block` 系列: context_block/structured_context_block/openviking_context_block/seekdb_context_block - 不同 memory backend 的上下文块

**架构对比:**
- Mono: Nunjucks 模板文件 + 35 个模板 ID + registry 映射表 → 灵活但需要文件 I/O
- OpenClaw: 内联字符串 + AGENTS.md/MEMORY.md 上下文注入 → 简单但模板复用性低

**OpenClaw 可借鉴:**
Mono 的 `task_turn_verify.j2` verification mode 设计比 OpenClaw 当前方案更结构化。如果 OpenClaw 引入 verify 阶段，`task_turn_verify.j2` 的 "Prefer targeted checks over more edits" 原则值得学习。

---

### 2026-03-30 15:35 - PR #21 修复 Telegram 媒体附件丢失

**Issue #16**: Telegram chat handoff drops video/animation/audio/voice attachments

**问题**: `extractIncomingAttachments()` 只处理 photo 和 image/* document，其他所有媒体类型都被静默丢弃

**修复 (commit 2203e75)**:
- 添加 `TelegramVideo`, `TelegramAnimation`, `TelegramAudio`, `TelegramVoice`, `TelegramVideoNote` 接口类型
- 扩展 `TelegramIncomingMessage` 添加对应字段
- `extractIncomingAttachments()` 新增处理: video→video/mp4, animation→image/gif, audio→audio/mpeg, voice→audio/ogg, video_note→video/mp4
- document 类型过滤器移除 image/* 限制

**验证**:
- [x] pnpm build 成功
- [x] TypeScript 编译无错误
- [ ] 手动测试: 从 Telegram DM 发送视频/GIF/语音

**PR**: https://github.com/stvlynn/mono/pull/21

---

### 2026-03-30 18:19 - 巡查

**结论**: 无新 commits。自上次 (2203e75) 以来仓库无变化。

**代码库状态**:
- `fix/telegram-media-attachments` 分支 PR #21 等待 review
- `feat/tui-json-render-surface` (ce4a8bc) 仍领先 main 3 commits，未合并
- 其他分支沉寂

**待处理**:
- PR #21 手动测试（发送视频/GIF/语音到 Telegram bot）
- `feat/tui-json-render-surface` 分支 merge 后分析新架构

---

### 2026-03-30 20:39 - 巡查

**结论**: 无新 commits（与 18:39 巡查相同）。

- main 最新仍是 `ed67565`
- PR #21 (fix/telegram-media-attachments) 保持 OPEN 状态
- 代码无变化，无需额外研究
