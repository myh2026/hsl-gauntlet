# Gauntlet Conformance Report — Vigil + Curator (HSL)

> 生成时间：2026-09-05T05:33:08.118Z
> SUT：2 个（Vigil · SRE 告警分诊（incident triage）；Curator · 文档策展管线（document curation pipeline））

## 0. 跨 SUT 聚合（泛化实验总览）

| SUT | 域 | 拓扑 | 场景 | conformance | 不变式 | Edge Coverage | fault-only 边 | 变异杀死率 |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| Vigil | SRE 告警分诊（incident triage） | 9 节点 / 17 边 / 5 守卫环 / fan-out router 三路处置 | 15 | ✓ | ✓ | 100% | 6 条（35%）| 96.3%（26/27）|
| Curator | 文档策展管线（document curation pipeline） | 8 节点 / 16 边 / 4 守卫环 / fan-in quarantine 五路汇聚 | 15 | ✓ | ✓ | 100% | 8 条（50%）| 100.0%（26/26）|

**聚合：30 场景 · 53 变异体（杀死 52，聚合杀死率 98.1%）· 框架层 SUT 专属代码 0 行**

---

# Vigil（SRE 告警分诊（incident triage））

## 1. 声明拓扑（ground truth）

```
nodes: 9   edges: 17
  intake -> triager on AlertReceived
  triager -> investigator on Investigate
  triager -> router on Escalate
  triager -> triager on Retryable
  investigator -> investigator on EvidencePending
  investigator -> critic on EvidenceReady
  investigator -> router on EvidenceFailed
  critic -> synthesizer on Sound
  critic -> investigator on Insufficient
  synthesizer -> reviewer on Submitted
  reviewer -> ledger on Accepted
  reviewer -> synthesizer on Rejected
  router -> ledger on Parked
  router -> ledger on Escalated
  budget -> router on Exhausted
  budget -> triager on DriftWarn
  ledger -> intake on Committed
```

## 2. 拓扑级 Lint（G-7 可观测性 / G-8 唯一守卫）

全部通过 —— 17 条边守卫均可观测且唯一。

## 3. 场景一致性（nominal + fault）

| 场景 | 类别 | 故障分类 | exit | ok | verdict | committed/parked/escalated | 偏差 | 不变式违反 |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| n1 | nominal | - | 0 | true | inbox-drained | 1/0/0 | ✓ | ✓ |
| n2 | nominal | - | 0 | true | inbox-drained | 0/0/1 | ✓ | ✓ |
| n3 | nominal | - | 0 | true | inbox-drained | 1/1/0 | ✓ | ✓ |
| n4 | nominal | - | 0 | true | inbox-drained | 0/0/0 | ✓ | ✓ |
| f1 | fault | model-protocol-drift | 0 | true | inbox-drained | 1/0/0 | ✓ | ✓ |
| f2 | fault | model-protocol-drift | 0 | true | inbox-drained | 0/1/0 | ✓ | ✓ |
| f3 | fault | tool-absence | 0 | true | inbox-drained | 0/1/0 | ✓ | ✓ |
| f4 | fault | tool-corrupt | 0 | true | inbox-drained | 0/1/0 | ✓ | ✓ |
| f5 | fault | tool-deny | 0 | true | inbox-drained | 0/1/0 | ✓ | ✓ |
| f6 | fault | evidence-insufficient | 0 | true | inbox-drained | 0/1/0 | ✓ | ✓ |
| f7 | fault | review-reject-recover | 0 | true | inbox-drained | 1/0/0 | ✓ | ✓ |
| f8 | fault | review-reject-exhaust | 0 | true | inbox-drained | 0/0/1 | ✓ | ✓ |
| f9 | fault | budget-exhausted | 0 | true | budget-exhausted | 1/1/0 | ✓ | ✓ |
| f10 | fault | model-protocol-drift | 0 | true | inbox-drained | 1/0/0 | ✓ | ✓ |
| f11 | fault | tool-corrupt | 0 | true | inbox-drained | 1/0/0 | ✓ | ✓ |

**Conformance: ALL GREEN · Invariants: ALL GREEN**

## 4. Edge Coverage（声明拓扑 vs 事件总线观测）

**100%**（17/17 边触发）

| edge | guard | fired by |
|:---|:---|:---|
| intake -> triager | `AlertReceived` | n1, n2, n3, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11 |
| triager -> investigator | `Investigate` | n1, n3, f1, f3, f4, f5, f6, f7, f8, f9, f10, f11 |
| triager -> router | `Escalate` | n2, n3 |
| triager -> triager | `Retryable` | f1, f2, f11 |
| investigator -> investigator | `EvidencePending` | n1, n3, f1, f3, f4, f5, f6, f7, f8, f9, f10, f11 |
| investigator -> critic | `EvidenceReady` | n1, n3, f1, f6, f7, f8, f9, f10, f11 |
| investigator -> router | `EvidenceFailed` | f3, f4, f5, f6 |
| critic -> synthesizer | `Sound` | n1, n3, f1, f7, f8, f9, f10, f11 |
| critic -> investigator | `Insufficient` | f6 |
| synthesizer -> reviewer | `Submitted` | n1, n3, f1, f7, f8, f9, f10, f11 |
| reviewer -> ledger | `Accepted` | n1, n3, f1, f7, f9, f10, f11 |
| reviewer -> synthesizer | `Rejected` | f7, f8 |
| router -> ledger | `Parked` | n3, f2, f3, f4, f5, f6, f9 |
| router -> ledger | `Escalated` | n2, f8 |
| budget -> router | `Exhausted` | f9 |
| budget -> triager | `DriftWarn` | f1, f2 |
| ledger -> intake | `Committed` | n1, n3, f1, f7, f9, f10, f11 |

**Fault-only 边（6 条，占 35%）：** `Retryable` (triager->triager) · `EvidenceFailed` (investigator->router) · `Insufficient` (critic->investigator) · `Rejected` (reviewer->synthesizer) · `Exhausted` (budget->router) · `DriftWarn` (budget->triager)

> 这些边在 nominal 套件中结构性不可达 —— 故障注入不是可选项，而是拓扑覆盖的必要条件。

## 5. 变异测试（harness mutation operators）

**Mutation Score: 96.3%（26/27 killed，59.0s）**

| 变异体 | 算子 | 描述 | 结果 | 杀手场景 |
|:---|:---|:---|:---|:---|
| M1-E1 | M1 EDGE_DEL | 删除边声明: edge intake -> triager on IntakeEvent::AlertReceived; | ☠ killed | n1, n2, n3, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11 |
| M1-E2 | M1 EDGE_DEL | 删除边声明: edge triager -> investigator on Triage::Investigate; | ☠ killed | n1, n3, f1, f3, f4, f5, f6, f7, f8, f9, f10, f11 |
| M1-E3 | M1 EDGE_DEL | 删除边声明: edge triager -> router on Triage::Escalate; | ☠ killed | n2, n3 |
| M1-E4 | M1 EDGE_DEL | 删除边声明: edge triager -> triager on Triage::Retryable; | ☠ killed | f1, f2, f11 |
| M1-E5 | M1 EDGE_DEL | 删除边声明: edge investigator -> investigator on Probe::EvidencePending; | ☠ killed | n1, n3, f1, f3, f4, f5, f6, f7, f8, f9, f10, f11 |
| M1-E6 | M1 EDGE_DEL | 删除边声明: edge investigator -> critic on Probe::EvidenceReady; | ☠ killed | n1, n3, f1, f6, f7, f8, f9, f10, f11 |
| M1-E7 | M1 EDGE_DEL | 删除边声明: edge investigator -> router on Probe::EvidenceFailed; | ☠ killed | f3, f4, f5, f6 |
| M1-E8 | M1 EDGE_DEL | 删除边声明: edge critic -> synthesizer on Critique::Sound; | ☠ killed | n1, n3, f1, f7, f8, f9, f10, f11 |
| M1-E9 | M1 EDGE_DEL | 删除边声明: edge critic -> investigator on Critique::Insufficient; | ☠ killed | f6 |
| M1-E10 | M1 EDGE_DEL | 删除边声明: edge synthesizer -> reviewer on Draft::Submitted; | ☠ killed | n1, n3, f1, f7, f8, f9, f10, f11 |
| M1-E11 | M1 EDGE_DEL | 删除边声明: edge reviewer -> ledger on Verdict::Accepted; | ☠ killed | n1, n3, f1, f7, f9, f10, f11 |
| M1-E12 | M1 EDGE_DEL | 删除边声明: edge reviewer -> synthesizer on Verdict::Rejected; | ☠ killed | f7, f8 |
| M1-E13 | M1 EDGE_DEL | 删除边声明: edge router -> ledger on Route::Parked; | ☠ killed | n3, f2, f3, f4, f5, f6, f9 |
| M1-E14 | M1 EDGE_DEL | 删除边声明: edge router -> ledger on Route::Escalated; | ☠ killed | n2, f8 |
| M1-E15 | M1 EDGE_DEL | 删除边声明: edge budget -> router on BudgetSignal::Exhausted; | ☠ killed | f9 |
| M1-E16 | M1 EDGE_DEL | 删除边声明: edge budget -> triager on BudgetSignal::DriftWarn; | ☠ killed | f1, f2 |
| M1-E17 | M1 EDGE_DEL | 删除边声明: edge ledger -> intake on AdvanceSignal::Committed; | ☠ killed | n1, n3, f1, f7, f9, f10, f11 |
| M2-R1 | M2 EDGE_REDIRECT | investigator->critic 改为 investigator->router（EvidenceReady） | ☠ killed | n1, n3, f1, f6, f7, f8, f9, f10, f11 |
| M2-R2 | M2 EDGE_REDIRECT | reviewer->ledger 改为 reviewer->synthesizer（Accepted） | ☠ killed | n1, n3, f1, f7, f9, f10, f11 |
| M2-R3 | M2 EDGE_REDIRECT | ledger->intake 改为 ledger->triager（Committed） | ☠ killed | n1, n3, f1, f7, f9, f10, f11 |
| M3-G1 | M3 GUARD_SWAP | triager->router 守卫 Escalate 换成 Retryable（G-8 违规预期） | ☠ killed | n2, n3, f1, f2, f11 |
| M3-G2 | M3 GUARD_SWAP | budget->router 守卫 Exhausted 换成 Within（守卫语义漂移） | ☠ killed | n1, n2, n3, n4, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11 |
| M4-BUDGET | M4 BUDGET_OFF | 轮预算边界 off-by-one（>= -> >） | ☠ killed | f9 |
| M5-ROUTE | M5 ROUTE_FLIP | 路由分流条件翻转（critical -> warning） | ☠ killed | n2, n3, f2, f3, f4, f5, f6, f8, f9 |
| M6-CRITIC | M6 CRITIC_THRESH | 审查闸门阈值松动（metrics_total >= 2 -> >= 1） | **SURVIVED** | - |
| M7-DRIFT | M7 DRIFT_CAP | 漂移硬上限提升（*2 -> *3） | ☠ killed | f2 |
| M8-COMMIT | M8 COMMIT_DROP | 提交路径丢弃案例落盘（cases.push 删除） | ☠ killed | n1, n3, f1, f7, f9, f10, f11 |

**结构性等价变异（1）—— triage 静态归因成立，非套件盲区（无需补场景）：**
- ◇ M6-CRITIC M6 CRITIC_THRESH: 审查闸门阈值松动（metrics_total >= 2 -> >= 1）
  - 归因：计划门不变式成立：fn assess 的每次求值恒有 metrics_total == 2（构造位计数链 + 全局 push 位上界 + 空起点闭合）。truth(2 >= 2) === truth(2 >= 1) === true —— 变异体在可达状态空间内与原程序不可区分（SUT 结构性等价变异，非套件盲区，无需补场景）。
    - (1) 变异点位于 agents/critic.hsl:41（fn assess），谓词 metrics_total >= 2 松动为 >= 1
    - (2) metrics_total = 对参数 evidence 按 kind=="metrics" 的循环计数（agents/critic.hsl:26 fn assess 体内）
    - (3) fn assess 全部调用点位于 match 臂 Probe::EvidenceReady 之内（vigil.hsl:190）—— 调用被变体构造门控
    - (4) agents/investigator.hsl:81 构造 Probe::EvidenceReady（fn probe_once 内）；链上 metrics 计数条件 ==0/==1（均为假分支）→ 构造时刻 count(metrics) ≥ 2
    - (5) "metrics" 块 push 位全局恰 2 处且均位于计数链分支内（agents/investigator.hsl:41、agents/investigator.hsl:59）—— 每次链推进至多补 1 块 ⇒ count 上界 = push 位数
    - (6) 调用侧累计向量以 Vec::new() 空初始化 —— 计数起点 = 0
- 等价归因后有效杀死率：100.0%（原始 96.3%，结构等价校正 +3.7%）

## 6. 结论摘要

- SUT：Vigil —— 9 节点 / 17 边（9 节点 / 17 边 / 5 守卫环 / fan-out router 三路处置），全 HSL
- 场景：15 个（4 nominal + 11 fault），全部确定性可复现
- Edge coverage：100%，其中 6 条边仅故障场景可达
- 轨迹不变式：全部满足；变异杀死率：96.3%（26/27）

---

# Curator（文档策展管线（document curation pipeline））

## 1. 声明拓扑（ground truth）

```
nodes: 8   edges: 16
  intake -> schema_gate on DocumentReceived
  schema_gate -> extractor on SchemaPassed
  schema_gate -> quarantine on SchemaFailed
  extractor -> extractor on Malformed
  extractor -> validator on EntitiesExtracted
  extractor -> quarantine on ExtractAbandoned
  validator -> enricher on EntitiesValid
  validator -> extractor on EntitiesInvalid
  validator -> quarantine on ValidationExhausted
  enricher -> publisher on EnrichmentComplete
  enricher -> enricher on EnrichmentPartial
  enricher -> quarantine on EnrichmentFailed
  publisher -> intake on Published
  publisher -> enricher on PublicationRejected
  budget -> quarantine on TurnExhausted
  budget -> extractor on DriftAlarm
```

## 2. 拓扑级 Lint（G-7 可观测性 / G-8 唯一守卫）

全部通过 —— 16 条边守卫均可观测且唯一。

## 3. 场景一致性（nominal + fault）

| 场景 | 类别 | 故障分类 | exit | ok | verdict | published/quarantined/deferred | 偏差 | 不变式违反 |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| cn1 | nominal | - | 0 | true | batch-drained | 1/0/0 | ✓ | ✓ |
| cn2 | nominal | - | 0 | true | batch-drained | 1/1/0 | ✓ | ✓ |
| cn3 | nominal | - | 0 | true | batch-drained | 1/0/0 | ✓ | ✓ |
| cn4 | nominal | - | 0 | true | batch-drained | 0/0/0 | ✓ | ✓ |
| cf1 | fault | model-protocol-drift | 0 | true | batch-drained | 1/0/0 | ✓ | ✓ |
| cf2 | fault | model-protocol-drift | 0 | true | batch-drained | 0/1/0 | ✓ | ✓ |
| cf3 | fault | tool-absence | 0 | true | batch-drained | 0/1/0 | ✓ | ✓ |
| cf4 | fault | tool-corrupt | 0 | true | batch-drained | 0/1/0 | ✓ | ✓ |
| cf5 | fault | tool-deny | 0 | true | batch-drained | 0/1/0 | ✓ | ✓ |
| cf6 | fault | validation-repair-exhausted | 0 | true | batch-drained | 0/1/0 | ✓ | ✓ |
| cf7 | fault | review-reject-recover | 0 | true | batch-drained | 1/0/0 | ✓ | ✓ |
| cf8 | fault | model-protocol-drift | 0 | true | batch-drained | 0/1/0 | ✓ | ✓ |
| cf9 | fault | budget-exhausted | 0 | true | budget-exhausted | 1/0/1 | ✓ | ✓ |
| cf10 | fault | enrichment-partial | 0 | true | batch-drained | 1/0/0 | ✓ | ✓ |
| cf11 | fault | tool-corrupt | 0 | true | batch-drained | 1/0/0 | ✓ | ✓ |

**Conformance: ALL GREEN · Invariants: ALL GREEN**

## 4. Edge Coverage（声明拓扑 vs 事件总线观测）

**100%**（16/16 边触发）

| edge | guard | fired by |
|:---|:---|:---|
| intake -> schema_gate | `DocumentReceived` | cn1, cn2, cn3, cf1, cf2, cf3, cf4, cf5, cf6, cf7, cf8, cf9, cf10, cf11 |
| schema_gate -> extractor | `SchemaPassed` | cn1, cn2, cn3, cf1, cf2, cf3, cf4, cf5, cf6, cf7, cf8, cf9, cf10, cf11 |
| schema_gate -> quarantine | `SchemaFailed` | cn2 |
| extractor -> extractor | `Malformed` | cf1, cf2 |
| extractor -> validator | `EntitiesExtracted` | cn1, cn2, cn3, cf1, cf3, cf4, cf5, cf6, cf7, cf8, cf9, cf10, cf11 |
| extractor -> quarantine | `ExtractAbandoned` | cf2 |
| validator -> enricher | `EntitiesValid` | cn1, cn2, cn3, cf1, cf7, cf8, cf9, cf10, cf11 |
| validator -> extractor | `EntitiesInvalid` | cn3, cf6 |
| validator -> quarantine | `ValidationExhausted` | cf3, cf4, cf5, cf6 |
| enricher -> publisher | `EnrichmentComplete` | cn1, cn2, cn3, cf1, cf7, cf9, cf10, cf11 |
| enricher -> enricher | `EnrichmentPartial` | cf10 |
| enricher -> quarantine | `EnrichmentFailed` | cf8 |
| publisher -> intake | `Published` | cn1, cn2, cn3, cf1, cf7, cf9, cf10, cf11 |
| publisher -> enricher | `PublicationRejected` | cf7 |
| budget -> quarantine | `TurnExhausted` | cf9 |
| budget -> extractor | `DriftAlarm` | cf2 |

**Fault-only 边（8 条，占 50%）：** `Malformed` (extractor->extractor) · `ExtractAbandoned` (extractor->quarantine) · `ValidationExhausted` (validator->quarantine) · `EnrichmentPartial` (enricher->enricher) · `EnrichmentFailed` (enricher->quarantine) · `PublicationRejected` (publisher->enricher) · `TurnExhausted` (budget->quarantine) · `DriftAlarm` (budget->extractor)

> 这些边在 nominal 套件中结构性不可达 —— 故障注入不是可选项，而是拓扑覆盖的必要条件。

## 5. 变异测试（harness mutation operators）

**Mutation Score: 100.0%（26/26 killed，51.2s）**

| 变异体 | 算子 | 描述 | 结果 | 杀手场景 |
|:---|:---|:---|:---|:---|
| M1-C1 | M1 EDGE_DEL | 删除边声明: edge intake -> schema_gate on DocEvent::DocumentReceived; | ☠ killed | cn1, cn2, cn3, cf1, cf2, cf3, cf4, cf5, cf6, cf7, cf8, cf9, cf10, cf11 |
| M1-C2 | M1 EDGE_DEL | 删除边声明: edge schema_gate -> extractor on SchemaEvent::SchemaPassed; | ☠ killed | cn1, cn2, cn3, cf1, cf2, cf3, cf4, cf5, cf6, cf7, cf8, cf9, cf10, cf11 |
| M1-C3 | M1 EDGE_DEL | 删除边声明: edge schema_gate -> quarantine on SchemaEvent::SchemaFailed; | ☠ killed | cn2 |
| M1-C4 | M1 EDGE_DEL | 删除边声明: edge extractor -> extractor on ExtractEvent::Malformed; | ☠ killed | cf1, cf2 |
| M1-C5 | M1 EDGE_DEL | 删除边声明: edge extractor -> validator on ExtractEvent::EntitiesExtracted; | ☠ killed | cn1, cn2, cn3, cf1, cf3, cf4, cf5, cf6, cf7, cf8, cf9, cf10, cf11 |
| M1-C6 | M1 EDGE_DEL | 删除边声明: edge extractor -> quarantine on ExtractEvent::ExtractAbandoned; | ☠ killed | cf2 |
| M1-C7 | M1 EDGE_DEL | 删除边声明: edge validator -> enricher on ValidateEvent::EntitiesValid; | ☠ killed | cn1, cn2, cn3, cf1, cf7, cf8, cf9, cf10, cf11 |
| M1-C8 | M1 EDGE_DEL | 删除边声明: edge validator -> extractor on ValidateEvent::EntitiesInvalid; | ☠ killed | cn3, cf6 |
| M1-C9 | M1 EDGE_DEL | 删除边声明: edge validator -> quarantine on ValidateEvent::ValidationExhausted; | ☠ killed | cf3, cf4, cf5, cf6 |
| M1-C10 | M1 EDGE_DEL | 删除边声明: edge enricher -> publisher on EnrichEvent::EnrichmentComplete; | ☠ killed | cn1, cn2, cn3, cf1, cf7, cf9, cf10, cf11 |
| M1-C11 | M1 EDGE_DEL | 删除边声明: edge enricher -> enricher on EnrichEvent::EnrichmentPartial; | ☠ killed | cf10 |
| M1-C12 | M1 EDGE_DEL | 删除边声明: edge enricher -> quarantine on EnrichEvent::EnrichmentFailed; | ☠ killed | cf8 |
| M1-C13 | M1 EDGE_DEL | 删除边声明: edge publisher -> intake on PublishEvent::Published; | ☠ killed | cn1, cn2, cn3, cf1, cf7, cf9, cf10, cf11 |
| M1-C14 | M1 EDGE_DEL | 删除边声明: edge publisher -> enricher on PublishEvent::PublicationRejected; | ☠ killed | cf7 |
| M1-C15 | M1 EDGE_DEL | 删除边声明: edge budget -> quarantine on BudgetSignal::TurnExhausted; | ☠ killed | cf9 |
| M1-C16 | M1 EDGE_DEL | 删除边声明: edge budget -> extractor on BudgetSignal::DriftAlarm; | ☠ killed | cf2 |
| M2-C1 | M2 EDGE_REDIRECT | validator->enricher 改为 validator->quarantine（EntitiesValid 直达隔离） | ☠ killed | cn1, cn2, cn3, cf1, cf7, cf8, cf9, cf10, cf11 |
| M2-C2 | M2 EDGE_REDIRECT | publisher->intake 改为 publisher->quarantine（Published 汇入隔离） | ☠ killed | cn1, cn2, cn3, cf1, cf7, cf9, cf10, cf11 |
| M2-C3 | M2 EDGE_REDIRECT | schema_gate->extractor 改为 schema_gate->validator（SchemaPassed 跳过抽取） | ☠ killed | cn1, cn2, cn3, cf1, cf2, cf3, cf4, cf5, cf6, cf7, cf8, cf9, cf10, cf11 |
| M3-C1 | M3 GUARD_SWAP | extractor->validator 守卫 EntitiesExtracted 换成 Malformed（G-8 违规预期） | ☠ killed | cn1, cn2, cn3, cf1, cf2, cf3, cf4, cf5, cf6, cf7, cf8, cf9, cf10, cf11 |
| M3-C2 | M3 GUARD_SWAP | budget->quarantine 守卫 TurnExhausted 换成 Within（守卫语义漂移） | ☠ killed | cn1, cn2, cn3, cn4, cf1, cf2, cf3, cf4, cf5, cf6, cf7, cf8, cf9, cf10, cf11 |
| M4-BUDGET | M4 BUDGET_OFF | 轮预算边界 off-by-one（>= -> >） | ☠ killed | cf9 |
| M5-SCHEMA | M5 SCHEMA_FLIP | 模式闸最小体长阈值翻转（30 -> 300：快乐路径文档被拦截） | ☠ killed | cn1, cn2, cn3, cf1, cf2, cf3, cf4, cf5, cf6, cf7, cf8, cf9, cf10, cf11 |
| M6-VALIDATE | M6 VALIDATE_THRESH | 校验闸门阈值松动（min_entities 2 -> 1） | ☠ killed | cn3 |
| M7-DRIFT | M7 DRIFT_CAP | 漂移硬上限提升（*2 -> *3） | ☠ killed | cf2 |
| M8-PUBLISH | M8 PUBLISH_DROP | 发布路径丢弃案例落盘（cases.push 删除） | ☠ killed | cn1, cn2, cn3, cf1, cf7, cf9, cf10, cf11 |

## 6. 结论摘要

- SUT：Curator —— 8 节点 / 16 边（8 节点 / 16 边 / 4 守卫环 / fan-in quarantine 五路汇聚），全 HSL
- 场景：15 个（4 nominal + 11 fault），全部确定性可复现
- Edge coverage：100%，其中 8 条边仅故障场景可达
- 轨迹不变式：全部满足；变异杀死率：100.0%（26/26）
