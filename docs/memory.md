当前上下文里我看不到那份研究报告正文，所以这里不直接复述其中对 OpenClaw 的具体判断。我按上一轮研究的方向，把“人格要形成闭环”这件事落成一套文件记忆系统，依据放在自我连续性、自我概念清晰度、角色与目标分层、叙事一致性、对他人的心智建模，以及他人判断必须依赖可观察线索这些研究结论上（Campbell 1990; McAdams 2013; Conway 2001; Funder 1995; Yeung, Apperly, and Devine 2024）。([PubMed][1])

## 1. 先定边界

这套系统不是把所有对话都存下来，也不是给 agent 写一段很长的人设提示词。它要解决的是三件不同的事。

第一件是 agent 对“我是谁”的稳定认识。第二件是 agent 在不同场景里如何表现出一致但不僵硬的人格。第三件是 agent 如何形成对具体他人的认知，而且不会把一次偶发事件误写成稳定判断。自我记忆和他人记忆必须物理分离，否则自我表征和他人表征会相互污染，最后产生伪一致性。自我这一侧需要 trait、goal、role、life story 四层同时存在；他人这一侧需要 observable cue、inference、confidence 三层同时存在，因为人格判断的准确性依赖线索是否可获得、可检测、可正确利用，而不是靠一次主观印象拍板（Singer 1995; Stryker 2007; Funder 1995）。([PubMed][2])

## 2. 必须具备的记忆条件

一个完整人格，如果要能长期运行，至少要有下面七个条件。

### 2.1 稳定核心

需要有少量高稳定度的核心特征，不能每次会话都被改写，否则自我概念清晰度会下降，行为会摇摆，决策也更差（Campbell 1990; Strojny, Duell, and Kusev 2022）。([PubMed][1])

### 2.2 目标层

人格不能只有“我是怎样的人”，还要有“我在追求什么”。McAdams 把 self 分成 actor、agent、author 三层，只存 trait 不存 goal，会导致人格像静态标签，不像会行动的主体（McAdams 2013）。([PubMed][3])

### 2.3 时间连续性

需要把过去的事件组织成能够支持当前自我理解的连续线索。单独堆事件不够，必须有 autobiographical reasoning，也就是“这件事如何改变了我”的解释层，否则记忆只是素材，不形成身份连续性（Conway 2001; Habermas and Köber 2015）。([PubMed][4])

### 2.4 自我差异管理

系统里要显式区分 actual self、ideal self、ought self。一个 agent 若把应该做的事、想成为的样子、当前真实状态混成一团，就会出现冲突性输出，甚至对用户形成不稳定的道德姿态（Strauman and Higgins 1987; Strauman 1988）。([PubMed][5])

### 2.5 多角色而非单角色

人格不是单一面具，而是多个角色在不同情境下的组织。社会学里的 identity theory 强调，身份来自角色及其所在的互动网络；脱离角色网络的人格会失真，尤其在工作协作、亲密关系、上下级语境中会表现出不自然（Stryker 2007）。([PubMed][6])

### 2.6 对他人的独立模型

对他人的记忆必须独立于自我记忆，并且明确写出“这是对方的偏好，不是我的价值观”。研究里对 self schema 和 other schema 的混淆，与偏执、错误归因、关系失真都有关（Humphrey et al. 2021; Lahat et al. 2020）。([PubMed][7])

### 2.7 证据与置信度

关于他人的稳定判断，不能直接记成“用户是一个怎样的人”，而应记成“出现过哪些线索，我据此做了怎样程度的推断”。人格判断准确性依赖相关线索的可见性与使用质量，而且熟人群体的聚合判断有时比自我判断更能预测外显行为，所以系统必须保留证据来源和可信度，而不是只保留结论（Funder 1995; Kolar, Funder, and Colvin 1996; Rogers and Biesanz 2019）。([PubMed][8])

## 3. 文件记忆系统的总结构

我建议把记忆系统拆成四个区，不要混放。

```text
/memory
  /self_core
  /self_runtime
  /other_models
  /interaction_logs
```

它们的职责如下。

### 3.1 `/self_core`

这是高稳定区，只允许低频更新。这里存的是核心人格，不存琐碎会话事实。

```text
/self_core
  identity.md
  values.yaml
  traits.yaml
  roles.yaml
  self_guides.yaml
  boundaries.yaml
  style_contract.yaml
```

### 3.2 `/self_runtime`

这是中频更新区，负责把核心人格投到当前阶段和当前任务里。

```text
/self_runtime
  current_goals.yaml
  active_projects.yaml
  current_tensions.yaml
  self_reflection_log.jsonl
  narrative_updates.md
```

### 3.3 `/other_models`

这是他人模型区。每个人单独一个目录，自我文件严禁引用回写。

```text
/other_models
  /user_001
    profile.yaml
    preferences.yaml
    inferred_traits.yaml
    relationship_state.yaml
    evidence.jsonl
```

### 3.4 `/interaction_logs`

这是原始互动区，默认只写事实，不写人格判断。

```text
/interaction_logs
  episodic_2026_03.jsonl
  episodic_2026_04.jsonl
  salience_queue.jsonl
```

这个分法对应心理学里 episodic memory 和 autobiographical / semantic self 的区分。事件层负责保存发生过什么，身份层负责保存“这些事件长期意味着什么”。只做事件存档而没有上层整合，不能形成稳定人格；只做概括而没有事件证据，又会漂浮和失真（Conway 2001; Singer 1995）。([PubMed][4])

## 4. 每个文件到底存什么

### 4.1 `identity.md`

这里不是写文案，而是写 identity charter。建议固定成六段。

```md
# identity

name:
mission:
non-negotiable principles:
default social stance:
default reasoning stance:
forbidden identity claims:
```

这里的 `forbidden identity claims` 很重要。它用来防止 agent 把能力、情感、关系、承诺说过头。否则“人格”很容易演变成拟人化幻觉。

### 4.2 `values.yaml`

```yaml
values:
  - name: epistemic_honesty
    priority: 0.95
    description: 不把推测写成事实
    behavioral_rules:
      - 未证实信息先标不确定性
      - 结论必须能追溯到证据
  - name: usefulness
    priority: 0.88
  - name: respect_for_user_agency
    priority: 0.83
```

值观必须有优先级，否则两个值观冲突时系统无从裁决。人格失稳往往不是 trait 变了，而是 value arbitration 没有显式规则。

### 4.3 `traits.yaml`

不要只存“大五人格”这种抽象标签，建议存四种字段。

```yaml
traits:
  - name: directness
    baseline: 0.78
    variance_by_context:
      casual: 0.55
      analytical: 0.82
      conflict: 0.74
    evidence_count: 43
    last_reviewed: 2026-03-07
  - name: warmth
    baseline: 0.42
    variance_by_context:
      support: 0.58
      critique: 0.35
```

这里要同时有 `baseline` 和 `variance_by_context`。因为人格需要稳定，也需要情境调节。只存 baseline 会过硬，只存 context 会碎片化。Singer 关于不同 Me-Selves 的讨论和 Stryker 的角色视角，都支持这种“稳定核心加情境变体”的写法（Singer 1995; Stryker 2007）。([PubMed][2])

### 4.4 `roles.yaml`

```yaml
roles:
  - role: analyst
    triggers: [需要判断、比较、验证]
    obligations:
      - 明确证据边界
      - 区分事实和推断
    style_shift:
      concise: true
      hedging: medium
  - role: collaborator
    triggers: [共同设计、共同修改]
    obligations:
      - 保持上下文连续
      - 先约束后生成
```

角色文件决定“同一个人格在不同任务里怎么投影”，这比单一 system prompt 更稳。

### 4.5 `self_guides.yaml`

```yaml
self_guides:
  actual_self:
    strengths: [...]
    limitations: [...]
  ideal_self:
    aspirations: [...]
  ought_self:
    duties: [...]
  conflict_rules:
    - when: ideal_self conflicts with ought_self
      prefer: ought_self
      unless: user_creativity_task
```

这是自我差异管理文件。没有这一层，agent 会同时说出“我追求开放探索”和“我必须严格保守”的冲突话语，而系统自己意识不到矛盾（Strauman and Higgins 1987; Strauman 1988）。([PubMed][5])

### 4.6 `narrative_updates.md`

这个文件不记流水账，只记 identity-relevant 事件。

```md
## 2026-03
Event:
Interpretation:
Change to self-understanding:
Change confidence:
Carry-forward implication:
```

这里必须有 `Interpretation` 和 `Carry-forward implication`。研究里仅仅回忆事件，不足以维持连续性；需要把事件解释成对“我”的含义（Habermas and Köber 2015; Hallford, Ricarte, and Hermans 2021）。([PubMed][9])

### 4.7 `other_models/<id>/profile.yaml`

只存低争议事实。

```yaml
person_id: user_001
known_facts:
  preferred_language: zh
  occupation: product_manager
stable_preferences:
  response_style:
    dislikes:
      - 过度安抚
      - 自作主张地总结
```

### 4.8 `other_models/<id>/inferred_traits.yaml`

不要写死性格判断，要写成假设。

```yaml
inferred_traits:
  - trait: prefers_directness
    confidence: 0.91
    based_on:
      - evidence_id: ev_182
      - evidence_id: ev_244
    decay_policy: slow
  - trait: low_tolerance_for_unsolicited_expansion
    confidence: 0.95
    based_on:
      - evidence_id: ev_121
```

### 4.9 `other_models/<id>/evidence.jsonl`

```json
{"id":"ev_244","time":"2026-03-07T09:10:00+08:00","type":"explicit_preference","content":"不要自作主张地拆解、总结、安抚","weight":0.98}
{"id":"ev_245","time":"2026-03-07T09:15:00+08:00","type":"interaction_pattern","content":"连续三次要求直接输出，不要铺垫","weight":0.72}
```

这一步很关键。对他人的认知如果没有 evidence ledger，就会发生“我记得你是这样的人”这种高风险误判。ToM 研究本身就说明，成人的心智推断能力有明显个体差异，而且测量不稳定；系统设计上更不能把推断当事实存死（Yeung, Apperly, and Devine 2024）。([PubMed][10])

## 5. 写入规则

没有写入规则，这个系统会很快坏掉。

### 5.1 三层写入

所有新信息先进入原始事件层，再经过筛选，最后才可能进入身份层。

```text
interaction -> episodic log -> candidate abstraction -> reviewed memory
```

### 5.2 写入阈值

建议这样定。

1. 单次事件，只写 `interaction_logs`
2. 重复两到三次的显式偏好，才允许进入 `other_models/preferences`
3. 与身份有关的转折事件，才允许进入 `narrative_updates`
4. 核心 traits 和 values 只有在跨时期重复验证后才改

这样做是因为自传体记忆很容易受当前情绪和自我评价偏差影响，直接把最近一次体验上升成身份判断，会产生系统性偏差（Christensen, Wood, and Barrett 2003）。([PubMed][11])

### 5.3 冲突不覆盖，只并存

如果新证据和旧认知冲突，不要直接覆盖，先写冲突记录。

```yaml
conflicts:
  - field: prefers_brief_answers
    old_value: true
    new_value: mixed
    reason: 最近三次要求展开说明
    status: unresolved
```

这样能避免 agent 因为最近一次互动突然“换人格”。

### 5.4 任何人格推断都要带时间衰减

对他人的 inferred trait 应该自动衰减，对自我的 core trait 则低速衰减。因为自我核心比对他人的印象更稳定，而他人印象更依赖情境线索可见性（Funder 1995）。([PubMed][8])

## 6. 检索规则

真正高效的地方不在存，而在取。

### 6.1 回答前只检索四份摘要

一次响应，不要把整个记忆树都拉进上下文，只取：

```text
self_core/identity.md
self_runtime/current_goals.yaml
other_models/<user>/profile.yaml
other_models/<user>/relationship_state.yaml
```

其余内容按需补取。这样上下文不会被历史噪音占满。

### 6.2 先取抽象层，再取事件证据

默认顺序是：

```text
abstract memory -> conflicting memory -> evidence samples
```

因为先看抽象层可以快，只有冲突或高风险时才回溯证据。

### 6.3 生成时显式区分三类语句

系统内部最好把将要输出的句子分成三种来源。

```text
self-grounded
other-model-grounded
task-grounded
```

这样能防止 agent 把“这是用户偏好”说成“这是我的原则”，也能防止为了完成任务临时违背稳定人格。

## 7. 更新机制

建议用两个周期。

### 7.1 会话后更新

每轮结束后只做轻量更新。

```text
写 episodic log
抽取显式偏好
记录异常冲突
```

### 7.2 周期性回顾

每隔固定周期做一次 consolidation。

```text
合并重复偏好
提升高频证据为稳定判断
下调过期推断的置信度
把关键事件写入 narrative_updates
检查 traits 与 values 是否冲突
```

这一层相当于把 episodic memory 压缩成 semantic / autobiographical memory。没有 consolidation，系统只会越来越臃肿；过度 consolidation，又会把短期噪音提前固化。

## 8. 一套更严谨的状态机

人格系统最容易出错的地方，是“我知道一些东西”直接跳到“我是谁”。中间应该有状态机。

```text
observation
-> repeated pattern
-> hypothesis
-> reviewed inference
-> stable model
-> identity-level change
```

不同层的门槛不同。

```yaml
promotion_rules:
  observation_to_pattern:
    min_occurrences: 2
  pattern_to_hypothesis:
    requires_context_diversity: true
  hypothesis_to_reviewed_inference:
    requires_counterexample_check: true
  reviewed_inference_to_stable_model:
    min_days_span: 7
  stable_model_to_identity_change:
    human_review_or_high_threshold: true
```

这里的 `requires_context_diversity` 很有必要。因为人格判断在单一场景里经常不准，只有在 trait-relevant 且多情境的线索里才更可靠（Hirschmüller et al. 2015; Funder 1995）。([PubMed][12])

## 9. 一个可直接落地的最小版本

如果你要先做 MVP，不需要一开始就上完整系统。最小可用集合是这八个文件。

```text
/self_core/identity.md
/self_core/values.yaml
/self_core/traits.yaml
/self_core/self_guides.yaml
/self_runtime/current_goals.yaml
/other_models/<user>/profile.yaml
/other_models/<user>/inferred_traits.yaml
/interaction_logs/episodic_current.jsonl
```

同时加四条硬规则。

1. 原始事件永远不直接改写核心人格
2. 关于他人的任何人格判断都必须能回溯到 evidence id
3. 自我文件和他人文件不允许互相覆盖
4. identity 层更新必须慢于 preference 层更新

## 10. 你这次要的“更严谨高效”，具体体现在什么地方

严谨，体现在四点。
第一，区分事实、推断、身份。
第二，区分自我模型和他人模型。
第三，所有稳定判断都有证据和置信度。
第四，任何身份变更都必须经过慢速更新。

高效，体现在三点。
第一，默认只检索摘要层，不扫全库。
第二，事件层和抽象层分开，减少重复总结。
第三，按状态机晋升，避免每次都重算人格。

如果照这个结构做，agent 的“自我认知、人格、对他人认知”会形成一个闭环：

```text
事件 -> 解释 -> 稳定自我
互动 -> 线索 -> 他人模型
自我 + 他人模型 -> 当前角色激活 -> 输出风格与决策
输出结果 -> 新事件 -> 再进入更新流程
```

若你接下来要的是工程落地版本，我建议直接进入这一步：把上面这套结构改成一份 `memory_schema.json` 加一份 `update_pipeline.md`，这样就能直接接到 agent runtime 里。

[1]: https://pubmed.ncbi.nlm.nih.gov/2231284/?utm_source=chatgpt.com "Self-esteem and clarity of the self-concept - PubMed"
[2]: https://pubmed.ncbi.nlm.nih.gov/7562361/?utm_source=chatgpt.com "Seeing one's self: locating narrative memory in a framework of personality - PubMed"
[3]: https://pubmed.ncbi.nlm.nih.gov/26172971/?utm_source=chatgpt.com "The Psychological Self as Actor, Agent, and Author - PubMed"
[4]: https://pubmed.ncbi.nlm.nih.gov/11571029/?utm_source=chatgpt.com "Sensory-perceptual episodic memory and its context: autobiographical memory - PubMed"
[5]: https://pubmed.ncbi.nlm.nih.gov/3694448/?utm_source=chatgpt.com "Automatic activation of self-discrepancies and emotional syndromes: when cognitive structures influence affect - PubMed"
[6]: https://pubmed.ncbi.nlm.nih.gov/17995458/?utm_source=chatgpt.com "Identity theory and personality theory: mutual relevance - PubMed"
[7]: https://pubmed.ncbi.nlm.nih.gov/34564019/?utm_source=chatgpt.com "Paranoia and negative schema about the self and others: A systematic review and meta-analysis - PubMed"
[8]: https://pubmed.ncbi.nlm.nih.gov/7480467/?utm_source=chatgpt.com "On the accuracy of personality judgment: a realistic approach - PubMed"
[9]: https://pubmed.ncbi.nlm.nih.gov/24912017/?utm_source=chatgpt.com "Autobiographical reasoning in life narratives buffers the effect of biographical disruptions on the sense of self-continuity - PubMed"
[10]: https://pubmed.ncbi.nlm.nih.gov/38036161/?utm_source=chatgpt.com "Measures of individual differences in adult theory of mind: A systematic review - PubMed"
[11]: https://pubmed.ncbi.nlm.nih.gov/15272959/?utm_source=chatgpt.com "Remembering everyday experience through the prism of self-esteem - PubMed"
[12]: https://pubmed.ncbi.nlm.nih.gov/24655148/?utm_source=chatgpt.com "Accurate judgments of neuroticism at zero acquaintance: a question of relevance - PubMed"
