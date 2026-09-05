# Gauntlet Conformance Report — Vigil (HSL)

> 生成时间：2026-09-05T03:13:17.257Z

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

**Mutation Score: 96.3%（26/27 killed，95.2s）**

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

**存活变异体（1）——测试套件盲区，需补场景：**
- M6-CRITIC M6 CRITIC_THRESH: 审查闸门阈值松动（metrics_total >= 2 -> >= 1）

## 6. 结论摘要

- SUT：Vigil —— 9 节点 / 17 边 / 5 守卫环的 SRE 告警分诊 harness（全 HSL）
- 场景：15 个（4 nominal + 11 fault），全部确定性可复现
- Edge coverage：100%，其中 6 条边仅故障场景可达
- 轨迹不变式：全部满足
- 变异杀死率：96.3%（26/27）
