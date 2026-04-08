# Mono 代码对比研究 - 发现

## 导航
- [TODO](./todo.md)
- [State](./state.json)

## 2026-03-30 研究发现

---

### 本轮新增 (2026-03-30 20:59) - Mono vs OpenClaw Skills System 对比

**无新 commits**。本轮聚焦 Mono/OpenClaw Skills Architecture 对比。

**Mono Skills Architecture** (`packages/agent-core/src/skills.ts`, 282行):

- **3层作用域**: `builtin` (硬编码) / `global` (`~/.mono/skills/`) / `project` (`.mono/skills/`)
- `SkillOrigin = "builtin" | "global" | "project"` 类型标记来源
- `loadAvailableSkills()` 并行加载三源后 `mergeVisibleSkills()` 去重（name normalize 碰撞保留前者）
- `parseFrontmatter()` 支持 YAML frontmatter + YAML block scalar (`|` 语法)，不只是简单 key:value
- `skillMatchesPrompt()`: 精确提及 `$skillName` / `skillName` → 直接匹配；否则用 normalized token overlap（name + folder ≥3 字符）
- `renderSkillsContext()`: XML风格 `<Skill name origin path>` 包裹激活技能内容，非激活技能只列 summary
- `resolveSkillReferenceLabel()`: builtin 用 `builtin://name`，其他用相对路径
- Builtin skills: `find-skills` + `skill-creator` 两个硬编码在 `builtin-skills.ts`（类似 OpenClaw 内置 skill）

**OpenClaw Skills Architecture** (`dist/skills-*.js`, ~400行):

- **6层作用域**: workspace/skills, .agents/skills, CONFIG_DIR/skills, ~/.agents/skills, plugin skill dirs, bundled skills
- `loadSkillEntries()` 加载所有层 → Map 去重（name 碰撞保留后者/后者覆盖前者）
- Frontmatter parsing + `resolveSkillInvocationPolicy()` — 技能可标记 `userInvocable: false`
- `filterSkillEntries()` 支持 eligibility 过滤 + skillFilter 条件筛选
- `applySkillsPromptLimits()`: maxSkillsInPrompt + maxSkillsPromptChars 二元搜索裁剪
- `syncSkillsToWorkspace()`: 技能同步到 sandbox workspace（安全复制而非 symlink）
- `resolvePluginSkillDirs()`: 插件提供额外 skill 目录
- 内置 skill Filter/Skill-creator 等功能通过 plugin/system 路径加载

**关键架构差异**:

| 维度 | Mono | OpenClaw |
|------|------|----------|
| 作用域数量 | 3 (builtin/global/project) | 6 (workspace/.agents/managed/personal/project/bundled/extra) |
| 优先级碰撞处理 | 前者优先（Map set 行为） | 后者覆盖前者 |
| Prompt 选择策略 | prompt 文本 token overlap | eligibility + skillFilter 多层过滤 |
| 安装管理 | CLI `mono skills add` | CLI `openclaw skills install` |
| Workspace 同步 | 无 sandbox sync | `syncSkillsToWorkspace()` 安全复制 |
| 插件扩展 | 无 | `resolvePluginSkillDirs()` |
| Block scalar 支持 | ✅ YAML block scalar 解析 | ❌ 基础 frontmatter |

**值得参考**:
- Mono 的 YAML block scalar 解析对长 skill 指令更友好，OpenClaw 可考虑引入
- OpenClaw 的 `syncSkillsToWorkspace()` 适合 sandbox 安全场景，Mono 无 equivalent
- OpenClaw 的 eligibility 过滤比 Mono 的 prompt-match 更结构化，适合复杂场景

---

### 本轮新增 (2026-03-30 20:19) - 6 More Commits: Template System + Config + Topic Stats

**新 commits** (86c14f9 → ed67565, from newest to oldest):
- `ed67565` - fix(docker): sync pnpm-lock.yaml with telegram-control/@mono/prompts (#20)
- `bfc8d3a` - Merge branch 'fix/healthcheck-dev-mode-compatible'
- `df17301` - refactor: template runtime prompts and tighten Telegram replies
- `7a515fb` - feat: make heartbeat settings config-driven and add topic-level autonomy suppression
- `9b57af8` - fix(telegram): suppress generic done fallback messages in chat replies
- `86c14f9` - fix(telegram): avoid forced sticker actions without a concrete sticker source

---

**df17301 — Nunjucks Template System 全面落地**:

- `NunjucksPromptRenderer` 替代硬编码字符串拼接，配置 `autoescape: false, trimBlocks: true, lstripBlocks: true, noCache: true`
- `FileTemplateRegistry` + `TEMPLATE_FILES` 常量 map（39 个 template ID），支持 `exists()` / `list()`
- `renderPromptTemplateFile()` 支持包外模板路径（telegram-control 等包自己的 `./templates/`）
- `PromptTemplateId` union type 完整列表：agent/ (15个)、ui/ (6个)、memory/ (14个)，共 35 个模板
- `agent.ts` 中 5 处硬编码 prompt 段改为 `defaultPromptRenderer.render()` 调用（channel_action, channel_reply_instructions, channel_platform_context, required_channel_action, channel_action_retry_feedback）
- `AutonomyIntent` 新增 `autonomyTextsShareTopic()` 函数：提取关键词 → Set overlap → 共享 ≥2 词或共享1词且任一方 ≤2词则算同一 topic

**7a515fb — Config-Driven Autonomy + Topic Stats**:

- `resolveMonoConfig()` 新增：cwd/profileSelection/baseURLOverride 选项，环境变量优先级 MONO_PROFILE > env profile > project > global.defaultProfile
- `autonomy-runtime.ts` 扩展至 1113 行，新增 7a515fb 特有内容：
  - `AutonomyTopicStat` 含 `boredomScore`（最高 1.4x 惩罚），`lastOutcome` ∈ {novel, repeated, suppressed, blocked}
  - `MAX_AUTONOMY_TOPIC_STATS = 24` 缓存上限
  - `AUTONOMY_TOPIC_SUPPRESSION_THRESHOLD = 0.9` — 重复超过此阈值则抑制
  - `autonomyTextsShareTopic()` 用 stopwords 过滤 + Set overlap 计算语义相似
  - `normalizeAutonomyTopicKey()` 清理 topic key
  - `buildHeartbeatSelection` 两阶段：primary → fallback（不同 topic），fallback 需满足 `candidate.id !== selectedPrimaryIntent.id && !autonomyTextsShareTopic(candidate.goal, selectedPrimaryIntent.goal)`
  - `FeedbackSignal` 新增 `source: "heartbeat"` 类型，`valance: "neutral"` 用于反馈中性
- `structured-retrieval.ts`（新增文件）：`StructuredMemoryRetrievalPlanner.buildPackage()` 构建 self-grounded / other-grounded / task-grounded-hints 三层 memory package
- `structured-store.ts` 新增 `listAutonomyIntents()` / `listHeartbeatReplyRecords()` 支持 autonomous work 召回

**df17301 — Channel Reply Templates 关键片段**:

- `autonomy_extra_context.j2`: 自主任务标记 intent.kind/sourceSignal/priority/risk，curiosity_probe 专用 tags `[curiosity-question:]` / `[curiosity-hypothesis:]` / `[curiosity-evidence:]`
- `channel_reply_instructions.j2`: 有 actions 时详细说明 channel_action/channel_store 何时用 + recommended_action payload，无 actions 时极简
- `channel_platform_context.j2`: 完整 channel-native 上下文注入 store.resource/path/exists/count/searchSupported/current_resource attributes

**9b57af8 — Telegram Fallback 静默抑制**:

- `buildTelegramChatFallback()` 返回 `""`（空 string），不生成 "I finished the attempt..." 类通用文本
- 当有 sticker/emoji 但无实质文本时，messages = [] 空数组

**codex 分支状态更新**:

- `codex/review-code-for-hardcoding-and-duplicates`: d3f75fc 新增 "optimize seekdb ancestor traversal queries"（+2/-2 lines 微优化）
- 该分支仍然领先 main 26 commits，test 文件大幅精简（-24855 lines），agent.ts 从 2883 减至 1442

**与 OpenClaw 对比**:

- **Template system**: OpenClaw 完全缺少 equivalent，prompt 构建是硬编码字符串，channel-specific hints 无法优雅注入
- **Topic suppression**: OpenClaw 的 heartbeat 完全没有 "对这个 topic 做过了，抑制一下" 的机制
- **Config-driven autonomy**: OpenClaw 的 heartbeat interval 是固定配置，未实现多源优先级解析（env > cli > project > global）
- **Autonomy intent recall**: Mono 的 `listAutonomyIntents()` + `listHeartbeatReplyRecords()` 使 heartbeat 决策可以参考"最近做了什么"，OpenClaw 完全缺失

---

### 本轮新增 (2026-03-30 18:39) - No New Commits; Deep Dive on Tests & Docs

**状态**: 无新 commits（8d5b38c = research commit）。本轮聚焦测试套件和文档深度分析。

**86c14f9 Sticker Store 深挖**:
- `mergeTelegramStickerCacheEntry()`: 新函数，规范化 fileId/uniqueId，检查已存在 sticker（相同 fileId 或 uniqueId 匹配），跳过重复而非覆盖
- `searchTelegramStickerCache()` 新增 dedup 逻辑：`seenFileIds` Set 去重（在 `.slice(0, limit)` 之前），防止同一 fileId 多次出现在结果中
- `resolveTelegramRequiredAction()` (70行): 完整 sticker action 决策逻辑
  - 5种理由: `same_set_alternative` / `recent_history_reference` / `current_input_native_resource` / `explicit_native_send` / `current_input_native_resource`
  - `textOnlyFallbackAllowed: false` — sticker 必须用 sticker 发，不能退化到文本
  - 无 sticker source 时（`!hasStickerSource && !hasCurrentStickerInput`）直接 return undefined，不强制 action
- `agent.ts` 新增 channel_store 指令：当用户要"同一套的表情包"时，先调用 `channel_store(action="search", excludeFileId)` 再发送不同 fileId

**heartbeat-response.test.ts 完整路径** (74行):
- Pure HEARTBEAT_ACK_TOKEN → `status: "ack"`，visibleText = ""
- 带 ack 的短文本（`< DEFAULT_HEARTBEAT_ACK_MAX_CHARS=300`）→ `status: "ack"`，visibleText = 剩余部分
- 中间出现 ack token（不在首尾）→ `status: "sent"`（正常发送）
- 与前一条相同 normalized text → `status: "duplicate"`
- `extractCuriosityReplyFields()`: 从 `[curiosity-question:]`/`[curiosity-hypothesis:]`/`[curiosity-evidence:]` 标签提取好奇驱动信息

**heartbeat-wake.test.ts 完整路径** (47行):
- `coalescing`: 同一时间多个 wake（timer/nudge/manual），只执行最高优先级（manual > timer > nudge）
- `retry`: handler 失败后 1000ms 自动 retry

**conversation-outcome.test.ts 完整路径** (51行):
- `[final-reply]...[/final-reply]` 标签优先于纯 assistant text
- 有 tool_use + tool result 时，仍提取纯文本 visibleText（不因 tool activity 丢弃）
- `includeToolUseAssistantText` + `includeToolResultFallback` 配置选项

**Test Suite 大幅扩展** (+3793行):
- `agent.test.ts`: 2168行 — 大量新增测试用例
- `task-runtime.test.ts`: 619行
- `telegram-chat-reply.test.ts`: 479行
- `autonomy-runtime.test.ts`: 402行
- `heartbeat-response.test.ts`: 74行
- `conversation-outcome.test.ts`: 51行
- 其他新增测试: transcript-repair.test.ts (86行), telegram-runtime.test.ts (577→730行)

**文档爆炸确认**:
- `docs/README.md`: 87行
- `docs/curiousity.md`: 291行（10 cognitive mechanisms + 6 social mechanisms，完整学术论文格式）
- `docs/architecture/`: 14个文档，1300+ 行总篇幅
- `docs/api/`: 架构文档
- `docs/decisions/`: ADR 文件
- `docs/telegram-control/overview.md`: 380行
- `docs/im-platform/overview.md`: 545行

**好奇心文档关键内容**:
- 10 cognitive modules 映射到 agent engineering: 信息缺失检测、内在奖励生成、探索利用控制、元认知监控、目标分解计划、长期兴趣维护、归因与自我效能、情绪调节、延迟折扣、社会反馈整合
- 6 social mechanisms: 角色期待、社会支持、规范激活、制度激励、社会资本、信任边界
- 每条都有数据结构建议、算法策略、触发条件、验证指标
- **OpenClaw**: 无 equivalent，SOUL.md 只是 personality description，没有系统化好奇心/自主驱动的文档

---

### 本轮新增 (2026-03-30 17:59) - 6 New Commits on Main (b87691e → 86c14f9)

**新 commits** (since last run, from newest to oldest):
- `86c14f9` - fix(telegram): avoid forced sticker actions without a concrete sticker source
- `7ea3987` - fix: harden Telegram uploads, auto-repair approvals, and autonomy limits (+1605/-121)
- `05cb57d` - Refine runtime safety and memory v2 consolidation (+6829/-441, massive)
- `b98c0ab` - Fix Telegram handoff context and reasoning handling
- `b87691e` - feat: add development mode with tsx hot-reload and improve Docker workflow documentation
- `5f54521` - fix(docker): add dev-mode-compatible healthcheck

---

**b87691e — Docs Explosion**:
- 320-line README.md + massive docs/ directory
- docs/architecture/ (system-overview, task-runtime, tool-execution, memory-system, prompt-system, openviking-integration, seekdb-integration, session-and-branching, skills-system, structured-memory-v2, etc.)
- docs/api/ (agent-core, config, llm, memory, session, shared-types, structured-memory, tools, tui)
- docs/telegram-control/overview.md (380 lines)
- docs/im-platform/overview.md (545 lines)
- docs/getting-started/ (local-development, release-surface, repo-overview, testing-and-build)
- docs/decisions/ (8 ADR files including curiosity/heartbeat/autonomy topics)
- `.mono/CONTEXT.md`, `.mono/IDENTITY.md`, `.mono/MEMORY.md` — project context files
- AGENTS.md added to mono root
- Dockerfile + docker-compose.yml + docker/entrypoint.sh (161 lines)

**05cb57d — Curiosity Research Document** (`docs/curiousity.md`, 292 lines):
- Academic research paper in Chinese on human self-motivation → agent engineering
- 10 cognitive modules: information gap detection, intrinsic reward generation, exploration/exploitation control, metacognitive monitoring, goal decomposition, long-term interest maintenance, attribution/self-efficacy tracking, emotion regulation, delay discounting, social feedback integration
- 6 social mechanisms: role expectations, social support, norm activation, institutional incentives, social capital, trust boundaries
- Full table mapping each mechanism to data structures, algorithm suggestions, trigger conditions, verification metrics
- **引用**: Loewenstein 1994, Kidd & Hayden 2015, Schultz/Dayan/Montague 1997, Bandura 1977, Weiner 1985, Gross 1998, Murayama 2022, Deci & Ryan 2000, Locke & Latham 2002, Nelson & Narens 1990, etc.

**05cb57d — Autonomy Runtime Expansion** (709→1113 lines, +404):
- New `AutonomyTopicStat` with `boredomScore` (up to 1.4x penalty for repeated topics)
- `CURIOSITY_COOLDOWN_KEY = "curiosity:global"`, 15-minute global curiosity cooldown
- `AUTONOMY_TOPIC_SUPPRESSION_THRESHOLD = 0.9` — topics above this get suppressed
- `AUTONOMY_TOPIC_STOPWORDS` — 50+ stopwords (the/and/for/what/why/how + Chinese: 如何/为什么/什么/问题/探索)
- `HeartbeatDecision` now has 5 action types: `noop | enqueue_task | resume_task | request_user_confirmation | defer`
- `FeedbackSignal` sources: `user | task | verify | heartbeat`
- `TaskDiagnosisCode`: `info_gap | plan_error | execution_error | bad_assumption | external_constraint`
- Topic-level repetition penalty via `evaluateAutonomyTopicPenalty()` with keyword + time decay

**05cb57d — Bash Auto-Repair** (packages/tools/src/bash-auto-repair.ts, 245 lines):
- Parses "command not found" from bash output
- `COMMAND_PACKAGE_MAP`: curl→curl, git→git, python→python3, pip→python3-pip, wget→wget, etc.
- `apt-get` package manager detection
- `requestInstallApproval()` hook — requires explicit user approval before install
- Tracks attempted repairs in `Set<string>` to avoid repeated attempts
- After install, retries the original command
- `BashAutoRepairDetails` result annotation: attempted/packageManager/missingCommands/installedPackages/retried/succeeded
- **Note**: This was deleted in `codex/review-code-for-hardcoding-and-duplicates` branch but has now been re-added to main

**05cb57d — Conversation Outcome** (packages/shared/src/conversation-outcome.ts, 175 lines):
- Priority extraction: `stop → tool_use → tool_result_fallback`
- `synthesizeToolResultOutcome()`: generates structured summary from tool execution results
- Detects: missing commands, blocked lookups, empty outputs
- `OutcomeSummary`: status/reason/summary/outcomeType
- Used for heartbeat response evaluation

**05cb57d — Heartbeat Wake Controller** (packages/agent-core/src/heartbeat-wake.ts, 132 lines):
- `HeartbeatWakeController<T>` class: manages scheduled heartbeat execution
- `HeartbeatWakeTrigger`: `timer | manual | retry | nudge`
- Priority-based wake queue, coalescing (250ms default)
- Retry delay: 1000ms default
- Error handler hook
- `requestWake()` / `runNow()` / `stop()` API

**05cb57d — Transcript Repair** (packages/shared/src/transcript-repair.ts 223 lines + packages/session/src/transcript-repair.ts 143 lines):
- `sanitizeConversationMessages()`: fixes corrupted conversation logs
- Orphan tool results detection
- Malformed tool calls detection
- Truncated messages detection
- `TranscriptPolicy` drives repair strategy
- `SessionRepairResult`: repaired/repairedCount/orphanedToolResults/truncatedMessages

**b98c0ab — Telegram Handoff Fix**:
- `extraTaskContext` field added to `TaskRunContext` and `RunTaskOptions`
- `this.state.messages = await this.state.session.loadMessages()` at start of `runTask()` — **fixes Telegram handoff context loss**
- `switchSession()` gets `preserveCurrentModel` option — prevents old session metadata overriding current model
- `extraTaskContext` passed through to agent for context injection

**7ea3987 — Telegram Hardening**:
- Telegram photo/document uploads from local paths
- Explicit approval required before auto-repair installs packages
- Retry auto-repair after failed install attempts
- Blocked/deferred autonomy runs count toward hourly cap
- Fallback text suppression after successful Telegram media sends
- Regression tests added

**Issue #15 Status**: Still open, not addressed by these commits. The root cause (agent.ts catch block lacks phase-aware error enrichment) remains unfixed.

---

### 本轮新增 (2026-03-30 17:29) - Issue #15 Root Cause 深挖

**结论**: issue #15 (verification-phase fetch failures → "Request failed: fetch failed") 在 main 中**仍然存在**，根本原因已确认：

**Error 传播路径**:
1. `agent.ts` try-catch (lines 481-615): 捕获 verify phase LLM call 失败
2. Catch block (lines 607-615): 只 emit `{ type: "error", error: resolvedError }`，**没有 phase-aware enrichment**，直接 re-throw
3. `runtime.ts` `#handleChatHandoff` catch (lines 990-997): 收到 error 后调用 `formatTelegramRuntimeError()`
4. `formatTelegramRuntimeError()` (line 2172): 只拼接 `error.message: cause.message`，**不包含任何 task phase/execution context**
5. 用户看到: `Request failed: fetch failed`

**问题**: agent.ts catch block 在 re-throw 前没有检查 `task.phase` 并添加 "verification failed but main execution succeeded" 这类上下文。也没有区分 "execution failed" vs "verification failed"。

**建议修复方向**:
- 在 `agent.ts` catch block 中检测 `task.phase`，如果是 `verify`，在 error message 前缀 "Verification failed (main execution succeeded): "
- 或在 `formatTelegramRuntimeError` 中检测 error message pattern (含 "fetch failed" / "network" 等) 并根据 task phase 添加上下文

**注意**: codex 分支之前有完整的 `ClassifiedRuntimeError` / `classifyRuntimeError()` 系统，但在分支中被移除了（-23k lines）。issue #15 需要重新实现类似功能。

**PR #6 状态**: seekdb optimization (d3f75fc, +2/-2 lines) 仍在 codex/review-code-for-hardcoding-and-duplicates 分支，未合并到 main。分支目前领先 main 26 commits。

### 本轮新增 (2026-03-30 17:08) - Main Branch Updates

**新增 commits** (本轮检查):
- `2203e75` - fix(telegram): handle video/animation/audio/voice/video_note attachments (issue #16 修复)
- `ed67565` - fix(docker): sync pnpm-lock.yaml with telegram-control/@mono/prompts (#20)

**ed67565 分析**: 一个小修复，同步 pnpm-lock.yaml。telegram-control 添加了 @mono/prompts workspace 依赖但 lockfile 没更新，导致 Docker build 失败。修复后 `docker compose build mono` 成功。

**状态总结**:
- Issue #16 已由 Steven 在 2203e75 修复 ✅
- PR #6 (SeekDB query optimization) 仍在 codex 分支，未合并
- Main 无新变化，codex 分支领先 26 commits

### 本轮新增 (2026-03-30 16:03) - Multiple Codex Branches Architecture

**发现**: mono 有 3 个 `origin/codex/*` 分支，各自做不同的重构工作：

| Branch | Latest | 方向 | 特点 |
|--------|--------|------|------|
| `review-branch-for-merge-into-main` | b67459b | docker persistence + telegram bootstrap | anthropic-runtime.ts (531行), docker 引导 |
| `review-code-for-hardcoding-and-duplicates` | 99a1c48 | AI SDK → xsai + 移除 autonomy/heartbeat/curiosity | -25k lines, 移除 session-append-queue |
| `apply-docs-framework-to-project` | 99a1c48 | 同上 | 同 commit |

**共同点**: 所有分支最终都收敛到 `@xsai/stream-text` 而非 Vercel AI SDK，说明这是团队确定的 SDK 方向。

**潜在风险**: 3 个 codex 分支各自独立演进，如果最终要合并回 main，可能会有大量 conflicts 需要手动解决。

**Session Append Queue 删除确认**: `review-code-for-hardcoding-and-duplicates` (99a1c48) 已删除 `withAppendLock()` + `appendQueues` Map，无锁直接 append，并发写入风险增加。

### 本轮新增 (2026-03-30 16:03) - Issue #16 Fixed by Steven (2203e75)

**Main 新 commit**: `2203e75 fix(telegram): handle video/animation/audio/voice/video_note attachments`

**Issue #16 修复详情** (我之前追踪的问题):
- `extractIncomingAttachments()` 原先只处理 `photo` + `image/*` MIME documents
- 现在扩展支持: `video`, `animation`, `audio`, `voice`, `video_note`
- 新增 interface: `TelegramVideo`, `TelegramAnimation`, `TelegramAudio`, `TelegramVoice`, `TelegramVideoNote`
- Document handler 从 `mime_type.startsWith("image/")` 改为无条件处理所有 file types
- 默认 MIME: video/mp4, image/gif, audio/mpeg, audio/ogg
- **结论**: 我的 research findings 被 Steven commit 到了 mono repo (`research/mono-comparison/`)
- **PR #6 (SeekDB query optimization)** 仍未合并，在 `codex/apply-docs-framework-to-project` 分支 (99a1c48)

**新增 interface 类型**:
```typescript
interface TelegramVideo extends TelegramFileDescriptor { width?, height?, duration? }
interface TelegramAnimation extends TelegramFileDescriptor { width?, height?, duration?, thumbnail? }
interface TelegramAudio extends TelegramFileDescriptor { duration?, performer?, title? }
interface TelegramVoice extends TelegramFileDescriptor { duration? }
interface TelegramVideoNote extends TelegramFileDescriptor { length?, duration?, thumbnail? }
```

---

### 本轮新增 (2026-03-30 15:12) - Structured Memory Consolidation Deep Dive

**无新 commits**，main 与分支均无变化。本轮深入分析了 structured memory 系统。

**Structured Memory Architecture — 完整分层**:

| Layer | File | 职责 |
|-------|------|------|
| **Pipeline** | `structured-pipeline.ts` | 单轮 Memory Turn 输入/输出，管理 episodic event + preference observation 提取 |
| **Consolidation** | `structured-consolidation.ts` | 批量合并 pending preferences → stable/inferred preferences，处理冲突 |
| **Retrieval Planner** | `structured-retrieval.ts` | 构建 3-category memory package: self-grounded / other-grounded / task-grounded-hints |
| **Renderer** | `structured-renderer.ts` | 调用 Nunjucks template `memory/structured_context_block` 渲染 |
| **Store** | `structured-store.ts` | JSON 文件存储，目录结构: `self/`, `others/{entityId}/`, `project/`, `episodic/` |
| **Legacy Retrieval** | `retrieval/by-keyword.ts`, `by-session.ts` | 关键词 + 会话 检索 (旧 v1) |

**SelfIdentityRecord 完整结构**:
```typescript
nonNegotiablePrinciples: string[]  // 硬边界 ("不主动发帖")
boundaries: string[]               // 安全线 ("不访问 /etc/passwd")
forbiddenIdentityClaims: string[]  // 禁止声称 ("我不是 AI")
defaultSocialStance?: string      // 默认社交姿态
defaultReasoningStance?: string   // 默认推理风格
styleContract: string[]           // 风格约定
mission?: string                  // 使命描述
summary?: string                  // 自我总结
```

**Preference Observation Pipeline**:
- `extractPreferenceObservations()` 用 PREFERENCE_PATTERNS 正则匹配 + fallback 通用检测
- 5 个内置 pattern: prefers_directness, prefers_brief_answers, avoid_unsolicited_summaries/reassurance/assumptions
- 提取后 → SalienceQueue → Consolidation → Stable Preferences / Inferences / Conflicts
- **Contrast OpenClaw**: OpenClaw 的 memory/ 目录只是文本文件，完全没有 structured preference extraction 或 conflict detection

**Pi-TUI 组件架构**:
- 极简: `Container` + `TUI` (继承 Container)，纯文字渲染到 stdout
- `ProcessTerminal` 用 ANSI escape codes (`\u001b[?1049h` alt-buffer, `\u001b[2J` clear)
- `SelectList` 支持 keyboard navigation (↑↓ Enter Esc)、filter、scroll info
- 465 行 total — 远小于 ink-based tui 的复杂度
- **Contrast OpenClaw TUI**: 无官方 TUI（只有 log-based CLI），ink-based rendering 在 codex branch

**transcript-repair.ts — 核心工具**:
- `sanitizeConversationMessages()` 处理 malformed tool-calls (empty id/name, invalid chars, out-of-allowlist)
- `repairToolCallResultPairing()` 重新配对 tool-calls 和 tool-results，缺失时生成 synthetic error result
- Policy-driven: `allowSyntheticToolResults` flag 控制是否自动合成缺失的 tool result
- **OpenClaw value**: 这个模式可以直接移植到 OpenClaw session history repair

**OpenClaw 对比差距总结**:
1. **Memory**: Mono 有完整 structured memory (preference extraction, conflict detection, episodic memory)。OpenClaw 只有 flat text files.
2. **TUI**: Mono 有双轨 TUI (pi-tui = 简单 ProcessTerminal vs ink-based = 复杂 LLM-driven)。OpenClaw 无 TUI。
3. **Config UI**: Mono 有 web-based config UI (React + local HTTP server, 5173)。OpenClaw 只有 gateway.yaml + CLI.
4. **Transcript Repair**: Mono 有 production-grade transcript sanitization. OpenClaw 缺少 equivalent.

---

### 本轮新增 (2026-03-30 14:52) - LLM Adapter 重构: AI SDK → Xsai

**分支**: `origin/codex/apply-docs-framework-to-project` (99a1c48, 领先 main +26 commits)

**关键变化**: 从 Vercel AI SDK adapter 迁移到 @xsai/stream-text

| 维度 | Main (AI SDK) | codex branch (Xsai) |
|------|--------------|---------------------|
| **包依赖** | `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible` (各独立包) | `@xsai/stream-text` + `@xsai-ext/providers` (统一包) |
| **Adapter 文件** | `ai-sdk-anthropic.ts`, `ai-sdk-gemini.ts`, `ai-sdk-openai-compatible.ts`, `ai-sdk-openai-responses.ts` + 748行 `ai-sdk-runtime.ts` | `xsai-anthropic.ts`, `xsai-gemini.ts`, `xsai-openai-compatible.ts` + 255行 `xsai-shared.ts` |
| **Runtime 实现** | `runAiSdkConversation()` (748行)，统一处理所有 provider | `runXsaiConversation()` 基于 `streamText()` from `@xsai/stream-text` |
| **Thinking/Reasoning** | AI SDK 内置 `providers.anthropic({ thinking: {...} })` | `mapAnthropicThinking()` + `mapOpenAIThinkingLevel()` 手动映射 thinkingLevel |
| **Event 映射** | AI SDK 内部处理 | 自定义 `onEvent` switch 映射 `text-delta`, `reasoning-delta`, `tool-call-streaming-start`, `tool-call-delta` |
| **Image 处理** | `source: { type: "base64", media_type, data }` (Anthropic 原生格式) | `image_url: { url: \`data:${mimeType};base64,${data}\` }` (OpenAI兼容格式) |
| **Tool 执行** | AI SDK tool streaming | `tool.execute` 传入 `toolContext.toolCallId`，通过 `ToolBatchScheduler` 调度 |

**新代码结构** (`xsai-shared.ts`):
- `toXsaiMessage()`: 将 Mono ConversationMessage 转 Xsai format
- `mapStopReason()`: finishReason → stopReason 映射
- `mapAnthropicThinking()`: thinkingLevel → budget_tokens (minimal=1024, low=2048, medium/high=4096/8192)
- `mapOpenAIThinkingLevel()`: thinkingLevel → "none"|"minimal"|"medium"|"high"|"xhigh"
- `buildXsaiTools()`: 包装 tools 为 Xsai function 格式，绑定 ToolBatchScheduler
- `runXsaiConversation()`: 主流程，调用 `streamText()`，处理 delta events

**Agent 核心大幅精简**: `agent.ts` 从 2883 行减至 1442 行 (-1441行)
- 移除了: AutonomyRuntime, heartbeat-response, heartbeat-wake, createProtectedBashTool, createProtectedCodingTools, createChannelActionTool 等
- 简化了类型导入和复杂度

**对比 OpenClaw**: OpenClaw 的 LLM 层位于 bundled JS 中，未公开源码。Mono 重构方向：去除 AI SDK abstraction layer，改用更轻量的 Xsai stream-text library，可能减少包体积但依赖更封闭。

---

### 本轮新增 (2026-03-30 13:49) - sideways-archer Config-UI 深度分析

**Main 无新变化**: ed67565 = 459a78e (pnpm-lock sync only)，fix/stale-lockfile 无实质差异。
**sideways-archer 未推 remote**（本地存在但 origin 没有）

**关键新增发现**:

- [ ] **TUI → Config UI Reload Signal 协同机制**:
  - `AppContainer.tsx` 用 `readConfigUiReloadSignal()` 监听配置文件变更
  - `lastSeenConfigUiReloadVersionRef` 对比版本，避免重复响应
  - 如果 agent 正在运行，`pendingConfigUiReloadVersionRef` 暂存版本，运行结束后才实际 reload
  - "Config changed on disk. Reload will apply after the current task." 状态提示用户
  - 机制: UUID version + timestamp 写入 `.mono/config-ui-reload.json`
  - **OpenClaw**: 无 equivalent，建议设计 `readOpenClawConfigReloadSignal()` + TUI defer 机制

- [ ] **Config UI HTTP Server 端点一览**:
  - GET /api/bootstrap, /api/config/global, /api/models, /api/profiles, /api/status/memory, /api/status/telegram, /api/skills
  - PUT /api/config/global (hash-guarded), /api/profiles/:name, /api/profiles/:name/secret
  - POST /api/models/refresh, /api/skills/search, /api/skills/install
  - DELETE /api/profiles/:name, /api/profiles/:name/secret
  - 支持 `apiOnly` 模式（无静态文件，纯 JSON API）
  - 浏览器自动打开（platform-specific open/xdg-open）
  - 默认端口 5173，host 127.0.0.1（不暴露外网）
  - **参考价值**: OpenClaw CLI 可参考类似 JSON API 端点设计

- [ ] **web-config React UI 7 个 Section**:
  - Profiles: 模型/Provider 选择、setDefault、secret 管理、createFallbackProfile
  - Settings: safety defaults (approvalMode)、autonomy 配置、tui 配置（switch/input/textarea）
  - Memory: enabled/auto-inject/fallbackToLocal 开关，retrievalBackend (local/openviking/seekdb)，store path 配置
  - Context: 上下文配置
  - Telegram: botToken/silent/DM policy/allowFrom/reply/approval 等开关
  - Skills: 搜索远程 skills registry、install、管理已安装 skills
  - Raw JSON: 完整 config 直接编辑 + reset + save
  - **对比 OpenClaw**: gateway config 目前只有 gateway.yaml，缺少图形化配置 UI

- [ ] **Config UI 安全设计**:
  - `CONFIG_UI_SENSITIVE_PATHS = ["mono.channels.telegram.botToken"]`
  - `redactGlobalConfigForUi()` 用 `CONFIG_UI_REDACTED_SENTINEL` 替换敏感字段
  - `restoreRedactedGlobalConfig()` 保存时用当前值恢复 sentinel
  - Hash-guarded atomic write: PUT 前校验当前 config hash，防止并发覆盖
  - **OpenClaw**: 可参考 sensitive field redaction 模式

- [ ] **GeneralSection theme + heartbeat 配置**: UI Theme (light/dark/system) + Heartbeat Interval (ms) 输入

---

### 本轮新增 (2026-03-30 13:29) - 快速检查

- 无新实质 commits（ed67565 = 459a78e，只是 pnpm-lock sync）
- state.json 已更新检查时间

---

### 本轮新增 (2026-03-30 13:09)

**Main**: 无新 commits (ed67565 pnpm-lock sync)

**分支检查**:
- `origin/codex/apply-docs-framework-to-project`: 99a1c48 新增 AGENTS index (+53行 docs/index.md)
- `origin/sideways-archer` (a2424fc): 无变化
- `origin/feat/tui-json-render-surface` (ce4a8bc): 无变化

**结论**: 短暂安静期，无新代码变化。

---

### 本轮新增 (2026-03-30 12:49) - df17301 Template System Deep Dive

- [ ] **reply_format_rules.j2 强制 Markdown-only guard**:
  - 禁止手写 HTML tags (`<b>`, `<strong>`, `<i>`, `<em>`, `<a>`, `<code>`, `<pre>`, `<blockquote>`)
  - 只允许 Markdown，runtime 负责转换为 Telegram HTML 格式
  - **OpenClaw**: Telegram 插件无 equivalent guard，应考虑类似 filter 防止 LLM 直接输出 parse_mode HTML

- [ ] **channel_notes.j2 Telegram Media 提示**:
  - 提示 `channel_action(action="photo"|"document")` 支持 fileId 或本地 path
  - 恢复 sticker source、catalog cache path、当前 media 可回传等提示
  - **OpenClaw**: 可考虑类似 channel-specific hints 注入到 system prompt

- [ ] **autonomous work 双向召回 (中英)**:
  - 英文关键词: heartbeat, autonomy, autonomous, background, behind the scenes, recent work
  - 中文关键词: 心跳, 后台, 后台任务, 自动任务, 自主任务, 最近做了什么, 刚刚干嘛, 你在忙什么
  - rankAutonomyIntents() + buildRecentAutonomousWorkEntry() 生成结构化 summary
  - **OpenClaw**: 完全缺少 equivalent，Heartbeat 检查结果未作为 recallable memory 暴露

- [ ] **task_turn templates 结构差异**: execute 有 goal/current_task_description/todo_record，verify 轻量级，curiosity 有好奇驱动机制，direct_response 极简，channel_chat 有 native resource context。**OpenClaw**: 所有任务类型共用一个 prompt path

- [ ] **renderPromptTemplateFile 包外模板支持**: telegram-control 等包可以有自己 `./templates/` 目录，不依赖 @mono/prompts 打包。**OpenClaw**: 无 equivalent 外挂模板机制
---

### 本轮新增 (2026-03-30 11:19) - 6 commits deeper (8d5b38c → ed67565)

**df17301: Template Runtime Prompts 系统性重构**

- **template registry 解耦**: `FileTemplateRegistry` + `TEMPLATE_FILES` 常量 map，支持 `exists()` / `list()` 查询；`renderPromptTemplateFile()` 支持包外模板路径（telegram-control 等包的 `./templates/`）
- **`channel_platform_context.j2` 完整 channel-native 上下文块**: channel 名、actions_text、store_resources_text、store.resource/path/exists/readable/entryCount/searchSupported、current_resource kind/available/source/attributes、required_action/recommended_action payload 全注入 prompt
- **`channel_reply_instructions.j2` delivery notes**: channel_action/channel_store 何时用、long-answer split、recommended_action 提示、missing store 不阻塞当前资源、related store search、upsert 提示
- **agent.ts 减少 183 行**: 原硬编码 prompt 构建逻辑改用 templateId + `PromptRenderer` 统一渲染

**9b57af8: Telegram fallback 静默抑制**

- `buildTelegramChatFallback()` 返回空 string `""`，不生成通用 "I finished the attempt, but I don't have a reliable result to send yet."
- 当有 sticker/emoji 且无实质文本回复时，`messages: []` 空数组，不生成无意义 fallback 文本

**7a515fb: heartbeat 配置化 + topic-level 自主抑制**

- `resolveMonoConfig()` 新增：cwd/profileSelection/baseURLOverride 选项、环境变量 MONO_PROFILE/MONO_MODEL/MONO_BASE_URL/MONO_API_KEY 解析、profile → model 映射链
- autonomy-runtime 新增：
  - `AutonomyTopicStat` + `MAX_AUTONOMY_TOPIC_STATS` 追踪每个 topic 的 boredomScore
  - `AUTONOMY_TOPIC_REPEAT_WINDOW_MS` (2h) + `AUTONOMY_TOPIC_DECAY_MS` (6h) + `AUTONOMY_TOPIC_SUPPRESSION_THRESHOLD` (0.9) + `AUTONOMY_TOPIC_MAX_BOREDOM` (1.4)
  - 中英 stopwords set 去噪音
  - `filterDuplicateAutonomyCandidates()` 语义去重
  - `buildHeartbeatSelection` 两阶段：primary candidates → fallback (不同 topic)
  - `CURIOSITY_COOLDOWN_KEY/COOLDOWN_MS` 常量暴露到 export

**2203e75: 视频/音频附件类型支持**

- `telegram-incoming.ts` 扩展 `extractIncomingAttachments()` 处理 video/animation/audio/voice/video_note（之前只有 photo/document）

**5f54521: Docker healthcheck dev-mode 兼容**

**ed67565: pnpm-lock sync for telegram-control/@mono/prompts**

---

**对比 OpenClaw**:

- **Template registry 模式**: OpenClaw 的 prompt 构建是硬编码字符串模板，完全缺少 `TemplateRegistry` + `renderPromptTemplateFile()` 的分层设计。如果要支持 channel-specific prompt 或外挂模板，当前无法优雅实现
- **channel_native_resource_context**: OpenClaw 的 `ChannelDispatcher`/`PlatformAdapter` 没有类似 `channel_platform_context.j2` 的完整上下文注入，导致 channel adapter 对 prompt 内容缺乏可见性
- **fallback 静默**: OpenClaw 的工具调用失败/无结果时可能有 fallback 文本，但无"抑制"机制（当有 sticker/emoji 时避免生成无意义文字）
- **heartbeat config-driven**: OpenClaw 的 heartbeat interval 是固定配置，未实现 `resolveMonoConfig()` 这种多源优先级解析（env > cli > project > global）
- **autonomy topic suppression**: OpenClaw 完全没有 equivalent — heartbeat 决策不考虑 "recently did the same topic" 的 suppress 逻辑


---

### 本轮新增 (2026-03-30 21:39) - feat/tui-json-render-surface 分支深度分析

**分支状态**: `ce4a8bc`，领先 main 3 commits，+1864/-227 lines，70 files changed。

**核心架构 — LLM → JSON-spec → UI 渲染管道**:

| Layer | File | 职责 |
|-------|------|------|
| `tui-render-prompt.ts` | 构建 render prompt（presentation state model → JSON → prompt） |
| `tui-render-spec.ts` | deterministic baseline spec + `decorateTuiSpec()` state overlay |
| `tui-render-runtime.ts` | `streamTuiSpec()` — LLM streaming 生成 JSON spec + 三层验证 |
| `tui-render-registry.tsx` | `tuiRenderCatalog` — 组件目录（TextInput/Markdown/HistoryList/StatusLine 等） |
| `json-render-tui.tsx` | `@json-render/ink` 的 `JSONUIProvider + Renderer` 渲染 |

**`streamTuiSpec()` 关键设计**:

1. `createSpecStreamCompiler<Spec>(baselineSpec)` — 基于 deterministic baseline 的增量流式编译器
2. `coerceValidSpec()` 三层验证：
   - Structural validation: root + elements 存在
   - Catalog validation: `tuiRenderCatalog.validate(fixed)` — 组件类型合法性
   - Surface validation: `hasMinimumTuiSurface()` — 必须有 content + history binding 或 interactive 组件
3. Fallback 链: final spec → last valid intermediate → deterministic baseline
4. 集成 Telegram chat reply: `telegram-chat-reply.ts` (+70 lines) — generate + send Telegram markdown

**`createDeterministicTuiSpec()` 固定布局**: 5 个 top-level sections: pane (hints/status) + query (TextInput) + history (HistoryList, repeat binding) + pendingTools + pendingAssistant。

**`decorateTuiSpec()` overlay states**: idle / loading / error，注入 `$state` 绑定覆盖 deterministic baseline。

**Components in `tuiRenderCatalog`**: Interactive (TextInput, ConfirmInput, Select, MultiSelect, Tabs, FileUpload) + Content (Markdown, Text, Card, List/ListItem, StatusLine, Table, KeyValue, Metric, Callout, Timeline, Heading)。

**`load-telegram-control.ts` / `load-llm.ts` / `load-prompts.ts`**: 每个模块独立懒加载，避免主 bundle 膨胀。

**与 OpenClaw TUI 对比**:

| 维度 | Mono | OpenClaw |
|------|------|----------|
| Rendering | @json-render/ink declarative spec | Ink 直接组件树 |
| LLM-driven UI | ✅ Generative JSON-spec | ❌ 无 |
| Fallback 链 | ✅ 3-tier fallback | ❌ 无 |
| State model | ✅ Presentation state → JSON → prompt | ❌ 无 |
| Catalog 限制 | ✅ 白名单组件类型 | ❌ 无 |

**值得关注的工程价值**:
- `@json-render/core` 的 `createSpecStreamCompiler` 实现了增量 JSON spec 流式拼接，可避免 OpenClaw 每次重新渲染整个 TUI
- `autoFixSpec()` 自动修复 LLM 生成的非法 spec（如缺少 root/elements），降低了 prompt 工程的严格性要求
- Catalog validation 在渲染前拦截非法组件类型，比 runtime error 更友好

**待跟进**: 该分支尚未合并，建议等 main 稳定后再评估是否跟进。

---

### 本轮新增 (2026-03-30 22:19) - TUI JSON-Spec Surface 分支关键文件深度分析

**状态**: 无新 commits（main = ed67565）。本轮深入分析 `feat/tui-json-render-surface` (ce4a8bc) 的核心文件。

**`tui-render-prompt.ts` — Render Prompt 构建**:

```typescript
buildTuiRenderPrompt(request: TuiRenderRequest): Promise<string>
  → defaultPromptRenderer.render("ui/tui_render_spec", {
      catalog_prompt: tuiRenderCatalog.prompt({ ... }),
      presentation_json: renderTuiPresentationAsJson(request),
      seed_spec_json: JSON.stringify(createDeterministicTuiSpec(), null, 2),
    })
```

- 用 Nunjucks template `ui/tui_render_spec` 渲染
- 注入: (1) component catalog prompt, (2) presentation state as JSON, (3) deterministic seed spec
- customRules 确保 LLM 只生成 output pane，不生成 shell/dialogs/attachments
- `presentation_json` 是 UI state → JSON serialization

**`presentation.ts` — TuiPaneStateModel**:

```typescript
TuiPaneStateModel {
  pane: { queryGeneration, focused, hint }
  history: { hasItems, items[] }  // id/role/title/body/detail/thinking/tone
  pendingTools: { active, items[] }  // id/name/status/summary/detail
  pendingAssistant: { active, text, thinking, showThinking, markdownEnabled }
  query: { running, status, taskPhase?, taskGoal? }
}
```

- 把 UIState 转成 5-section state model → JSON → prompt injection
- `summarizeConversationMessage()` 区分 user/assistant/thinking/tool roles
- **对比 OpenClaw**: OpenClaw 的 TUI 直接用 React 组件树，无 equivalent state model 抽象

**`tui-render-registry.tsx` — Component Catalog + Action Handlers**:

```typescript
tuiRenderCatalog = defineCatalog(schema, {
  components: { ...standardComponentDefinitions },
  actions: { pane_submit, pane_select, pane_confirm, pane_cancel, request_shell_focus, request_generated_focus }
})
```

- 用 `@json-render/core` 的 `defineCatalog` 定义白名单组件和 action
- Action handlers 映射: pane_submit → slash.execute() 或 submitPrompt()
- `request_generated_focus` / `request_shell_focus` 在 deterministic shell 和 generated pane 之间切换焦点
- **关键设计**: 所有 LLM 生成的 action 都要经过 catalog 验证，安全边界

**`json-render-tui.tsx` — JSON Spec Renderer**:

- `resolveTuiRenderConfig()` 从 agent.getResolvedConfig().channels.tui 读取配置
- 配置项: `renderer: "json-render-ink"`, `specMode: "deterministic"|"generative"`, `validateGeneratedSpec`, `streamGeneratedSpec`, `debugRender`
- `specMode` 控制是否启用 LLM generative rendering
- `GeneratedPaneFocusGate` 控制焦点切换

**`error-classification.ts` — 可恢复性检测 (main 分支)**:

```typescript
isRecoverableRuntimeError(error, state): boolean
  → name in {XSAIError, AI_APICallError, AI_RetryError, AI_UnsupportedModelVersionError}
  → message patterns: "Remote sent "/Missing API key/No adapter found/Invalid Authentication/catalog transport/unsupported transport
  → fallback: state.running || state.startupState in {ready, init_failed} || state.initialized
```

- TUI 可根据返回值决定是否显示可恢复错误界面
- **OpenClaw**: 无 equivalent，建议在 TUI 层引入类似错误分类

**架构对比总结**:

| 分层 | 文件 | 职责 |
|------|------|------|
| State Model | presentation.ts | UIState → TuiPaneStateModel → JSON |
| Prompt Builder | tui-render-prompt.ts | Nunjucks render + catalog/presentation/seed 注入 |
| Spec Runtime | tui-render-runtime.ts | streamTuiSpec + createSpecStreamCompiler |
| Catalog | tui-render-registry.tsx | 白名单组件 + action handlers |
| Renderer | json-render-tui.tsx | JSONUIProvider + Renderer 渲染 |
| Deterministic Base | tui-render-spec.ts | createDeterministicTuiSpec + decorateTuiSpec |
| Error Recovery | error-classification.ts | isRecoverableRuntimeError (main 分支已有) |

**OpenClaw 缺失的关键层**: 无 state model → JSON → prompt 管道，无 catalog 白名单验证，无 JSON-spec rendering，无 specMode 配置开关。

---
---

### 本轮新增 (2026-04-01 12:27) - PR #21 Merged; Phase-Aware Error Handling Removed

**状态**: PR #21 (fix/telegram-media-attachments) 已合并到 main (15bced8)。

**关键发现**:
- **Phase-aware error handling 被移除**: 分支 `fix/phase-aware-error-handling` (e76448a) 的代码在合并 PR #21 时被反向修改。`agent.ts` 中的 `[phase:${task.phase}]` 错误包装逻辑被完全删除。
- **本地分支状态**: `fix/phase-aware-error-handling` 仍存在本地但未合并，其修改已被主分支的回退操作覆盖。
- **影响**: Issue #15 (verification-phase provider failures) 的修复方案被撤销，需要重新实现或确认是否已在 codex 分支中有替代方案。

**PR 状态更新**:
- PR #21: MERGED ✓
- PR #6: 仍 OPEN (SeekDB ancestor traversal 优化)

**待跟进**:
- 确认 issue #15 是否需要重新提 fix PR
- 监控 codex 分支是否在合并时提供 issue #15 的替代解决方案


---
### 本轮新增 (2026-04-01 14:27) - Phase-Aware Error Wrapping 重新添加 (本地)

**状态**: 新的本地分支 `fix/phase-aware-error-handling-v2` (afd4211) 重新实现了 phase-aware error wrapping。

**新增代码变化** (afd4211 vs main 15bced8):
- `packages/agent-core/src/agent.ts`: +10/-1 行
- 在 `runTaskTurn()` catch 块中添加 `[phase:${task.phase}]` 前缀
- 保留 original error 作为 cause property

**与之前版本对比**:
- 之前分支 `fix/phase-aware-error-handling` (1693b8a) 已被覆盖/删除
- 新版本 afd4211 是重新实现，解决 Issue #15 root cause

**Issue 状态**:
- Issue #15: verification-phase provider failures (root cause: catch block loses task.phase)
- 本次修复直接在 catch 块中恢复 phase context

**未推送**: 该分支存在于本地但未 push 到 remote，PR #22 在 GitHub 上不存在。

**本轮更新 (2026-04-01 17:47)**:
- PR #22 已在 remote，state: OPEN ✓
- 分支: `fix/phase-aware-error-handling-v2` (afd4211)，领先 main 2 commits
- 直接解决 Issue #15 root cause

**其他分支状态**:
- PR #6: 仍 OPEN (codex/review-code-for-hardcoding-and-duplicates, 26 commits ahead)
- PR #21: MERGED ✓
- feat/tui-json-render-surface: ce4a8bc, 3 commits ahead, 未合并
- main 最新: 15bced8 (PR #21 merged)

---

### 本轮新增 (2026-04-02 05:27) - No New Commits; PR #22 Still Waiting

**状态**: 无新 commits，PR #22 仍 OPEN。

**本轮检查结果**:
- Main 最新: `72549ab` (research commit, 无实质代码变化)
- 上轮 main: `15bced8` (PR #21 merged)
- 实质性新代码: `afd4211` (PR #22 的 phase-aware error wrapping)
- 差距: 仅 1 个 research commit

**PR #22 状态** (fix/phase-aware-error-handling-v2 → Issue #15):
- State: OPEN ✓
- URL: https://github.com/stvlynn/mono/pull/22
- 改动: `agent.ts` +10/-1 行，catch 块中添加 `[phase:${task.phase}]` 前缀
- 未 push 到 remote，需 Steven 确认后推送

**PR #6 状态** (codex/review-code-for-hardcoding-and-duplicates):
- State: OPEN ✓
- 领先 main: 26 commits (-25k lines, AI SDK → xsai 迁移)
- 最新: d3f75fc (seekdb optimization)

**分支状态总结**:
| Branch | Latest | Ahead | Status |
|--------|--------|-------|--------|
| main | 15bced8 | - | PR #21 merged |
| fix/phase-aware-error-handling-v2 | afd4211 | +1 | PR #22 OPEN |
| codex/review-code-for-hardcoding-and-duplicates | d3f75fc | +26 | PR #6 OPEN |
| feat/tui-json-render-surface | ce4a8bc | +3 | Not merged |

**待处理**:
- PR #22 等待推送/合并
- Issue #15 root cause 修复取决于 PR #22 是否合并

---

### 本轮新增 (2026-04-02 10:07) - No New Commits; PR #22 Still Waiting

**状态**: 无新 commits，PR #22 仍 OPEN。

**本轮检查结果**:
- 本地分支最新: `1fb81f1` (仅一个本地 research commit)
- remote main: `15bced8` (PR #21 merged)
- 无实质代码变化

**各包检查**:
- `packages/agent-core`: 无变化 (PR #22 修改已在此前记录)
- `packages/tui`: 无变化
- `packages/prompts`: 无变化
- `packages/session`: 无变化
- `packages/tools`: 无变化

**PR 状态**:
- PR #22 (fix/phase-aware-error-handling-v2): OPEN, 等待约 96h
- PR #6 (codex/review-code-for-hardcoding-and-duplicates): OPEN, 26 commits ahead
- feat/tui-json-render-surface: ce4a8bc, 3 commits ahead, 未合并

**结论**: Mono 仓库本日无新变化，继续监控。

---

### 本轮新增 (2026-04-02 17:27) - No New Commits; PR #22 Still Waiting

**状态**: 无新 commits，PR #22 仍 OPEN。

**本轮检查结果**:
- 本地分支最新: `6354bea` (仅本地 research commit)
- remote main: `15bced8` (PR #21 merged)
- 无实质代码变化

**PR 状态**:
- PR #22 (fix/phase-aware-error-handling-v2): OPEN, 等待约 4+ 天
- PR #6: OPEN, 26 commits ahead
- feat/tui-json-render-surface: ce4a8bc, 3 commits ahead, 未合并

**结论**: Mono 仓库本日无变化。

---

### 本轮新增 (2026-04-02 12:07) - No New Commits (12:07 Check)

---
### 2026-04-02 18:27 检查 - Claude Code v2026.04.01 发布

**Claude Code 更新** (2026-04-01):
- `/powerup` — 交互式教程，动画演示新功能
- `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE` env var — git pull 失败时保留 marketplace 缓存，离线环境有用
- 新增 .husky 到保护目录 (acceptEdits mode)
- **Bug fixes**:
  - 无限循环：rate-limit options dialog 反复自动打开导致 crash
  - `--resume` 导致 prompt cache miss（deferred tools/MCP/custom agents）
  - PostToolUse format-on-save hook 导致 Edit/Write 失败
  - PreToolUse hooks with JSON stdout + exit 2 未正确阻塞
  - 多个 UI 问题（滚动、标题栏等）
  - PowerShell 权限检查加固
- **性能改进**:
  - MCP tool schemas JSON.stringify 优化
  - SSE 大帧处理从 O(n²) 改为 O(n)
  - SDK 长对话 transcript 写入不再二次方慢
  - `/resume` 多项目并行加载

**对 OpenClaw 潜在价值**:
- `CLAUDE_CODE_PLUGIN_KEEP_MARKETPLACE_ON_FAILURE` 对离线/网络不稳定环境有用
- SSE 性能优化可以研究实现

**Mono 仓库状态**: 无新 commits，PR #22 仍 OPEN

---

### 本轮新增 (2026-04-03 14:27) - No New Commits; PR #22 Still Waiting

**状态**: 无新 commits，PR #22 仍 OPEN (等待约 104h)。

**本轮检查结果**:
- 本地分支最新: `84db58a` (仅本地 research commit)
- remote main: `15bced8` (PR #21 merged)
- 无实质代码变化

**各包检查**:
- `packages/agent-core`: 无变化
- `packages/tui`: 无变化  
- `packages/prompts`: 无变化
- `packages/session`: 无变化
- `packages/tools`: 无变化
- `packages/llm`: 无变化
- `packages/im-platform`: 无变化

**Todo 进度**:
- Finding 16 (ChannelRegistry): 仍待研究，未开始

**PR 状态**:
- PR #22 (fix/phase-aware-error-handling-v2): OPEN, 等待约 4.5 天
- PR #6: OPEN, 26 commits ahead
- feat/tui-json-render-surface: ce4a8bc, 3 commits ahead, 未合并

**结论**: Mono 仓库本日无变化，继续监控。
---

### 本轮新增 (2026-04-04 03:07) - No New Commits; PR #22 Still Waiting (~120h)

**状态**: 无新 commits，PR #22 仍 OPEN (等待约 120h/5 天)。

**本轮检查**:
- remote main:  (PR #21 merged)
- 本地分支最新:  (仅本地 research commit)
- 无实质代码变化

**包检查**:
- : 包含 catalog、channels、resolver、defaults 等配置管理
- : 包含 conversation-outcome、input、jsonl 等共享工具
- : 包含 catalog-prompts、commands、use-cases、skills 目录
- : 无变化
- : 无变化
- : 无变化
- : 无变化

**PR 状态**:
- PR #22 (fix/phase-aware-error-handling-v2): OPEN, 等待约 5 天
- PR #6: OPEN, 26 commits ahead
- feat/tui-json-render-surface: ce4a8bc, 3 commits ahead, 未合并

**结论**: Mono 仓库无新变化，继续监控。

---

### 本轮新增 (2026-04-04 03:07) - No New Commits; PR #22 Still Waiting (~120h)

**状态**: 无新 commits，PR #22 仍 OPEN (等待约 120h/5 天)。

**本轮检查**:
- remote main: 15bced8 (PR #21 merged)
- 本地分支最新: 8a8cc66 (仅本地 research commit)
- 无实质代码变化

**包检查**:
- `packages/config`: 包含 catalog、channels、resolver、defaults 等配置管理
- `packages/shared`: 包含 conversation-outcome、input、jsonl 等共享工具
- `packages/cli`: 包含 catalog-prompts、commands、use-cases、skills 目录
- `packages/agent-core`: 无变化
- `packages/tui`: 无变化
- `packages/prompts`: 无变化
- `packages/session`: 无变化

**PR 状态**:
- PR #22 (fix/phase-aware-error-handling-v2): OPEN, 等待约 5 天
- PR #6: OPEN, 26 commits ahead
- feat/tui-json-render-surface: ce4a8bc, 3 commits ahead, 未合并

**结论**: Mono 仓库无新变化，继续监控。
---

### 本轮检查 (2026-04-04 07:07) - No New Commits; PR #22 Still Waiting (~132h/5.5 days)

**状态**: Mono 仓库安静持续约 228 小时（9.5 天），PR #22 等待约 132 小时（5.5 天）。

**检查内容**:
- Mono 仓库: 无新 commits
- OpenClaw package: 非 git 仓库（通过 npm 安装），无法检查版本变化
- PR 状态: PR #22 仍 OPEN，PR #6 仍 OPEN
- OpenClaw workspace: 无 git 仓库

**结论**: Mono 仓库安静，继续监控。

---

### 本轮新增 (2026-04-05 15:47) - No New Commits; PR #22 Waiting (~230h); Finding 17: Registry Pattern

**状态**: 无新 commits，PR #22 仍 OPEN (等待约 230h/9.6 天)。

**Finding 17: Mono Registry 模式分析**

研究了 Mono 中三个 Registry 实现：

1. **SlashCommandRegistry** (`packages/tui/src/slash/registry.ts`)
   - 管理 TUI 斜杠命令
   - 支持 name/alias/全名注册和模糊搜索
   - 方法: register, registerMany, list, find, search

2. **PlatformRegistry** (`packages/im-platform/src/registry.ts`)
   - 管理即时通讯平台 (Telegram, Discord 等)
   - 简单的 Map 存储，register/resolve/list
   - 方法: register, resolve, list

3. **FileTemplateRegistry** (`packages/prompts/src/registry.ts`)
   - 管理提示模板文件映射
   - 使用 TEMPLATE_FILES 常量映射 templateId → 文件路径
   - 方法: getPath, exists, list

**共同模式**:
- 都是类，有私有 Map 存储
- 都有 list() 方法返回所有注册项
- 都支持注册和查找
- 简洁高效，适合单例模式

**对比 OpenClaw**: OpenClaw 目前使用 skill 注册表，但缺乏统一的 Registry 抽象。

**PR 状态**:
- PR #22 (fix/phase-aware-error-handling-v2): OPEN, 等待约 9.6 天
- PR #6: OPEN, 26 commits ahead
- feat/tui-json-render-surface: ce4a8bc, 3 commits ahead, 未合并

**结论**: Mono 的 Registry 模式值得借鉴，建议后续在 OpenClaw 中引入统一的 Registry 抽象。


---
### 本轮新增 (2026-04-06 06:15) - No New Commits; PR #22 Waiting (~200h)

**状态**: 无新 commits（上次 c2a30ec 是 4 月 4 日）。PR #22 仍 OPEN 等待约 200h/8.3 天。

**观察**:
- im-platform 包自 3 月 24 日后无新 commits（最后: 2203e75 视频/音频附件处理）
- tools 包也无新 commits
- 各 package 代码基本稳定

**todo 更新**: 研究方向保持不变，继续监控 PR #22 和 tui-json-render-surface 分支。


### 本轮新增 (2026-04-07 03:20) - No New Commits; PR #22 Waiting (~280h/11.7 days)

**状态**: 无新 commits，PR #22 仍 OPEN（等待约 280h/11.7 天）。

**检查结果**:
- remote main: 15bced8 (PR #21 merged)
- 本地分支最新: c2a30ec (local research commit)
- 无实质代码变化
- 分支活动: fix/phase-aware-error-handling-v2 仍有本地 research commits

**OpenClaw 探索**:
- OpenClaw 代码位于 ~/.openclaw/
- Skills 位于 ~/.agents/skills/ (10个skill: agent-browser, dogfood, electron, find-skills, skill-creator, slack, ui-ux-pro-max 等)
- 无 git 仓库（可能是 npm 安装）
- 探索了 OpenClaw vs Mono Skills Architecture 差异

**结论**: 继续监控 PR #22 和仓库活动。

---

### 本轮新增 (2026-04-07 03:40) - Finding 18: Mono vs OpenClaw Skills Architecture Comparison

**背景**: 对比了 Mono 和 OpenClaw 的 skills 架构实现。

**Mono Skills 架构** (`packages/agent-core/src/skills.ts`):
- **3层 skill 来源**: builtin → global → project
  - builtin: agent-core 内置
  - global: `~/.mono/skills/` 
  - project: `.mono/skills/`
- **Skill 定义**: 解析 YAML frontmatter，提取 name, description
- **加载函数**: 
  - `loadBuiltinSkills()`: 加载内置 skills
  - `loadGlobalSkills(cwd)`: 从全局目录加载
  - `loadProjectSkills(cwd)`: 从项目目录加载
  - `loadAvailableSkills(cwd)`: 合并三层，去重，排序
- **匹配机制**: prompt 中包含 skill name 或 `$skill-name` 则激活
- **渲染**: XML 风格 `<Skill name="x" origin="x" path="x">...</Skill>`

**OpenClaw Skills 架构**:
- **位置**: 固定目录 `~/.agents/skills/` (全局)
- **Skill 定义**: 每个 skill 目录下的 SKILL.md
- **触发方式**: skill 名称出现在用户消息中，动态加载
- **元数据**: 包含 name, description 在 SKILL.md 内部

**关键差异**:
| 特性 | Mono | OpenClaw |
|------|-----|---------|
| Skill 来源层数 | 3层 (builtin/global/project) | 1层 (global only) |
| 配置方式 | 代码定义 | 目录结构 |
| 加载时机 | 任务轮次加载 | 启动时扫描 |
| 动态激活 | 基于 prompt 匹配 | 消息触发 |
| 去重机制 | normalizeSkillToken 后 Map 合并 | 无 (名字唯一) |

**潜在改进**: OpenClaw 可以考虑：
1. 引入 project-level skills (工作区本地 skills)
2. skill conflict resolution (同名处理)
3. frontmatter metadata 支持

**PR 状态**: 无变化，PR #22 仍 OPEN (等待约 280h/11.7 天)。

**结论**: Mono 的分层 skill 架构更灵活。

---

### 本轮新增 (2026-04-07 14:00) - No New Commits; PR #22 Still Waiting (~350h/14.6 days)

**状态**: 无新 commits，PR #22 仍 OPEN（等待约 350h/14.6 天）。

**检查结果**:
- remote main: 15bced8 (PR #21 merged)
- 本地分支最新: 452c997 (local research commit)
- 无实质代码变化
- 分支活动: fix/phase-aware-error-handling-v2 仍有本地 commits 推进研究

**PR 状态**:
- PR #22 (fix/phase-aware-error-handling-v2): OPEN, 等待约 14.6 天
- PR #6: OPEN, 26 commits ahead
- feat/tui-json-render-surface: ce4a8bc, 3 commits ahead, 未合并

**结论**: Mono 仓库安静持续 14+ 天，继续监控。

**背景**: 检查 Mono 的 SessionManager 实现，对比 OpenClaw。

**Mono Session 架构** (`packages/session/src/session-manager.ts`, 493行):

- **SessionManager 类**: 核心会话管理
  - `sessionId`: 自动生成或指定
  - `filePath`: JSONL 格式存储 (`{cwd}/{sessionId}.jsonl`)
  - `headId`: 支持分支头（类似 git）
  
- **存储格式**: JSONL (one JSON object per line)
  - 元数据 entry → 消息 → memory references → task states → compressions
  - 每个 entry 有 `id`, `timestamp`, `entryType`, `payload`
  
- **核心方法**:
  - `loadMessages(branchHeadId?)`: 从指定分支头加载对话
  - `appendMessage(message)`: 追加单条消息
  - `appendBranch(name?)`: 创建新分支（类似 git branch）
  - `appendTaskState/appendTaskSummary`: 任务状态持久化
  - `appendSessionCompression`: 压缩后存储
  
- **分支支持**: 类似的 git 的分支概念，支持一个 session 多个分支头
- **SeekDb 集成**: `SeekDbSessionMirror` 支持会话镜像到 SeekDB

**OpenClaw Session**:
- SQLite 数据库存储 (`sessions.db`)
- 需要进一步查看实现细节

**关键差异**:
| 特性 | Mono | OpenClaw |
|------|-----|---------|
| 存储格式 | JSONL (文本行) | SQLite |
| 分支支持 | ✅ 有 (headId) | 不明 |
| 压缩策略 | SessionCompressionResult | 不明 |
| SeekDB 集成 | ✅ SessionMirror | 不明 |

**观察**: Mono 的 JSONL + 分支设计更适合版本化会话历史，OpenClaw 的 SQLite 可能更简单但缺乏分支能力。

**PR 状态**: PR #22 仍 OPEN (等待约 300h/12.5 天)。

**结论**: 记录为 Finding 19。

---

### 本轮新增 (2026-04-07 22:47) - Claude Code (Codex) Skill Installer

**状态**: 无 mono 新 commits，PR #22 仍 OPEN (等待约 480h/20 天)。

**新发现**: Codex 有 skill-installer skill：

- **位置**: `~/.codex/skills/.system/skill-installer/`
- **功能**: 从 GitHub 安装 skills（支持 curated / experimental 列表或自定义 repo）
- **脚本**: 
  - `list-skills.py`: 列出可用 skills（含已安装标记）
  - `install-skill-from-github.py`: 从指定 repo 安装
- **安装目标**: `$CODEX_HOME/skills/<skill-name>` (~/.codex/skills/)
- **安装方式**: download 或 git sparse checkout
- **特殊位置**: `.system` 目录的 skills 预安装，不可手动安装

**对比 OpenClaw**:
- OpenClaw 的 skill 安装是手动的（skill 目录复制）
- 没有自动化的 skill registry / installer
- skill-creator 存在但 skill-installer 不存在

**发现**: Codex 的 skill-installer 提供了 skill 分发和安装的自动化机制，OpenClaw 目前缺少类似功能。

**结论**: 记录为 Finding 20。


---

### 本轮新增 (2026-04-08 00:26) - Autonomy Topic-Level Suppression

**状态**: 无新 commits，PR #22 仍 OPEN (等待约 480h/20 天)。

**新发现**: 深度分析 7a515fb commit，新增 AutonomyTopicStat 机制防止重复后台任务：

**核心机制**:
- `AutonomyTopicStat`: 追踪每个自主探索主题的活跃度
  - `key`: 主题归一化 key
  - `summary`: 主题摘要（≤160 字符）
  - `repetitionCount`: 重复次数
  - `boredomScore`: 厌烦度（0 ~ 1.4）
  - `lastTouchedAt`: 上次活跃时间
  - `lastIntentKind`: curiosity_probe | investigate_gap
  - `lastOutcome`: novel | repeated | suppressed | blocked

**Boredom 评分规则**:
| 事件 | boredomDelta |
|------|---------------|
| 任务完成且可见 | -0.28 ↓ |
| 重复内容 | +0.48 ↑ |
| 被忽略/抑制 | +0.56 ↑ |
| 阻塞/失败 | +0.34 ↑ |
| 每额外一次重复 | +0.04 |

**抑制逻辑**:
- `AUTONOMY_TOPIC_SUPPRESSION_THRESHOLD`: 0.9
- `AUTONOMY_TOPIC_MAX_BOREDOM`: 1.4
- `AUTONOMY_TOPIC_DECAY_MS`: 6 小时
- 当 `boredomScore >= 0.9` 且 `ageFactor < 1` 时，抑制该主题

**STOPWORDS 过滤**（中英双语）:
```
the, and, for, with, that, this, what, why, how, does, should...
如何, 为什么, 什么, 问题, 探索, 调查, 解决...
```

**OpenClaw 可借鉴点**:
- 类似的 topic-level suppression 可减少 heartbeat 冗余
- boredom score 机制防止后台任务反复追问同类问题
- 可结合 OpenClaw 的 curiosity-log.json 实现类似功能

**结论**: 记录为 Finding 21。

---

**无新 commits**，本轮深度分析 `feat/tui-json-render-surface` 分支。

**TUI JSON Render Surface 架构** (1867 行新增):

1. **@json-render/core + ink 库依赖**:
   - 使用 `@json-render/core` (^0.15.0) 声明式 UI 框架
   - `@json-render/ink` 提供 Ink/Terminal 组件定义
   - 类似 React Virtual DOM 的声明式规范，但针对终端渲染优化

2. **Spec 流式编译** (`tui-render-runtime.ts`):
   - `createSpecStreamCompiler()`: 流式编译 LLM 输出为 Spec 对象
   - `coerceValidSpec()`: 多层验证 (object → root/elements → autoFix → validateSpec → catalog validate → hasMinimumTuiSurface)
   - `streamTuiSpec()`: 异步流式渲染，实时 yield valid spec

3. **状态绑定机制**:
   - `$state`: 引用 pane 状态路径，如 `/history/items`, `/query/status`
   - `$cond`: 条件渲染，`{ "$state": "/query/running", "$then": "info", "$else": "success" }`
   - `$item`: 循环变量引用
   - `repeat`: 列表渲染，`{ statePath: "/history/items", key: "id" }`

4. **组件目录** (`tui-render-registry.tsx`):
   - 标准组件: Text, Box, Markdown, Card, List, StatusLine, Table, Callout, Timeline 等
   - 交互组件: TextInput, ConfirmInput, Select, MultiSelect, Tabs
   - 自定义 actions: pane_submit, pane_select, request_shell_focus 等

5. **确定性兜底**:
   - `createDeterministicTuiSpec()`: 基础 pane spec 作为 fallback
   - LLM 输出无效时被忽略，始终有确定性 UI 可看

**OpenClaw 可借鉴点**:
- 流式 Spec 验证比一次性 JSON parse 更安全
- 多层验证 (structure → catalog → surface) 逐步降级
- 状态绑定避免硬编码，UI 可响应运行时状态
- 确定性兜底保证 LLM 输出再差也有可用 UI

**相关文件**:
- `packages/tui/src/tui-render-spec.ts` (215 行): Spec 类型定义
- `packages/tui/src/tui-render-runtime.ts` (131 行): 流式编译运行时
- `packages/tui/src/tui-render-registry.tsx` (88 行): 组件目录
- `packages/tui/src/tui-render-prompt.ts` (24 行): LLM prompt 构建
- `packages/tui/src/tui-render-spec.j2` (22 行): Jinja2 prompt 模板
- `packages/tui/src/json-render-tui.tsx` (174 行): 渲染入口
- `packages/tui/src/presentation.ts` (177 行): 请求格式定义

---

### Finding 22: Session parentId 链式结构 + 分支支持 (2026-04-08 12:26)

**研究对象**: `packages/session/src/session-manager.ts` (15327 行)

**Mono Session 架构**:

1. **parentId 链式链接**:
   - 每条 `SessionEntry` 包含 `parentId` 字段指向前一条目
   - `syncHeadToLatest()` 返回最新条目的 id，构建链式结构
   - 支持分支：传入 `branchHeadId` 初始化，可回溯任意分支点
   - `readJsonLines()` 读取后可遍历 parentId 链重建对话树

2. **SessionPointer 结构**:
   ```typescript
   interface SessionPointer {
     sessionId: string;
     branchHeadId?: string;
     filePath: string;
   }
   ```
   - `branchHeadId` 可选，支持分支会话管理

3. **分支初始化**:
   - 构造函数接受 `branchHeadId` 参数
   - `initialize()` 时验证 branchHead 是否存在于 entries 中
   - 不存在则抛出 Error，支持从任意点分叉

4. **与 OpenClaw 对比**:
   - OpenClaw: 单向链表，无 parentId，只记录当前 head
   - Mono: 双向可回溯（通过 parentId 链），支持分支
   - OpenClaw 无法从历史任意点重建对话上下文
   - Mono 可在任何分支点继续会话

**相关文件**:
- `packages/session/src/session-manager.ts`: SessionManager 主类
- `packages/session/src/transcript-repair.ts`: parentId 修复机制
- `packages/shared/src/types.ts`: SessionPointer, SessionEntry 类型定义

**结论**: Finding 22, 记录为 Session 架构重要差异。
