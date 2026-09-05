# Gauntlet Conformance Report — Vigil (HSL)

> 生成时间：2026-09-05T04:48:49.508Z
> SUT：1 个（Vigil · SRE 告警分诊（incident triage））

## 0. 跨 SUT 聚合（泛化实验总览）

| SUT | 域 | 拓扑 | 场景 | conformance | 不变式 | Edge Coverage | fault-only 边 | 变异杀死率 |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| Vigil | SRE 告警分诊（incident triage） | 9 节点 / 17 边 / 5 守卫环 / fan-out router 三路处置 | 15 | ✓ | ✓ | 100% | 6 条（35%）| 0.0%（0/0）|

**聚合：15 场景 · 0 变异体（杀死 0，聚合杀死率 0.0%）· 框架层 SUT 专属代码 0 行**

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

**Mutation Score: 0.0%（0/0 killed，0.0s）**

| 变异体 | 算子 | 描述 | 结果 | 杀手场景 |
|:---|:---|:---|:---|:---|

## 6. 结论摘要

- SUT：Vigil —— 9 节点 / 17 边（9 节点 / 17 边 / 5 守卫环 / fan-out router 三路处置），全 HSL
- 场景：15 个（4 nominal + 11 fault），全部确定性可复现
- Edge coverage：100%，其中 6 条边仅故障场景可达
- 轨迹不变式：全部满足；变异杀死率：0.0%（0/0）
