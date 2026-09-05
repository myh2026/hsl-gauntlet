<div align="center">

# Gauntlet — 拓扑级 Harness 一致性测试与变异分析框架

**Topology-Grounded Conformance Testing, Fault Injection & Mutation Analysis for LLM Agent Harnesses**

[![License: MIT](https://img.shields.io/badge/License-MIT-informational.svg)](LICENSE)
[![SUT](https://img.shields.io/badge/SUT-Vigil-success.svg)](subject/vigil/vigil.hsl)
[![Toolchain](https://img.shields.io/badge/toolchain-dhv--ts%20v0.2.52-blue.svg)](vendor/dhv-ts)
[![Scenarios](https://img.shields.io/badge/scenarios-15%20(4%20nominal%20%2B%2011%20fault)-orange.svg)](scenarios)

</div>

---

> **一句话定位**：LLM Agent harness 的测试方法论长期缺位于「代码覆盖率」（对非确定性 Agent 毫无意义）与「端到端评测」（黑盒、无结构判据）之间。Gauntlet 把 harness 的**声明拓扑**（graph / node / edge on Guard）当作可测试契约，在它之上重建经典测试三大支柱——**覆盖率、故障注入、变异测试**——并以事件总线为观测面机械执行。SUT 是 [HSL](https://github.com/myh2026/harness-specification-language) 写的 **Vigil**（SRE 告警分诊 harness，9 节点 / 17 边 / 5 守卫环，15 个 HSL 模块）。

## 核心实证结果（全部可复现）

| 指标 | 结果 | 含义 |
|:---|:---|:---|
| **Edge coverage** | **100%**（17/17 声明边触发） | 拓扑作为 ground truth 的可观测契约 |
| **Fault-only 边** | **6 条（35%）** | nominal 套件结构性不可达的边——故障注入不是可选项，是覆盖的必要条件 |
| **场景一致性** | 15/15 全绿（exit/verdict/disposition/故障事件数五维黄金断言） | 确定性、零外联、可复现 |
| **轨迹不变式** | 11/11 满足（Accepted→Committed 时序、案例↔边计数一致、故障下不 panic…） | 比黄金对比更结构化的失败语义 |
| **变异杀死率** | **96.3%**（26/27，27 个拓扑/行为变异体） | 唯一存活体经静态分析判定为 **SUT 结构性等价变异**（探查计划门结构保证 critic 阈值边界不可达） |
| **G-7 lint 交叉验证** | dsh 的 `executor->model on Observed` 边被静态抓出（该边在真实运行中从未发射） | 立项动机被工具实证 |

## 仓库结构

```
hsl-gauntlet/
├── gauntlet/          框架本体（7 个 TS 模块，bun 运行）
│   ├── topo.ts        静态拓扑提取器（.hsl → nodes/edges/guards JSON）
│   ├── lint.ts        G-7 可观测性 / G-8 唯一守卫 拓扑级 lint
│   ├── runner.ts      场景运行器（子进程契约 + 黄金预期 + 观测向量提取）
│   ├── coverage.ts    声明边 vs 触发边覆盖率（fault-only 边分析）
│   ├── invariants.ts  11 条轨迹不变式（时序性质）
│   ├── mutate.ts      8 类变异算子（M1 边删除 ×17 / M2 端点改写 / M3 守卫交换 / M4-M8 行为）
│   └── report.ts      report.md + gauntlet.json 双产物
├── subject/vigil/     SUT：SRE 告警分诊 harness（全 HSL，15 模块，~1100 行）
├── scenarios/         15 个确定性场景（fixture 多轨道 + 工作区 + 故障注入计划）
├── vendor/dhv-ts/     解释器 vendor（+ Fixture v2 多轨道剧本 + 故障注入宿主闸门）
├── docs/              PAPER.md / LANGUAGE-EVALUATION.md / FAULT-TAXONOMY.md / TOPO-LINT.md
└── results/           report.md / gauntlet.json（运行产物）
```

## 15 分钟上手

```bash
# 依赖：bun ≥ 1.1（解释器 vendor 零 npm 依赖）
git clone https://github.com/myh2026/hsl-gauntlet.git && cd hsl-gauntlet

# 1) 拓扑提取 + G-7/G-8 lint
bun gauntlet/cli.ts topo
bun gauntlet/cli.ts lint

# 2) 15 场景一致性 + 不变式 + 覆盖率
bun gauntlet/cli.ts run

# 3) 变异测试（基线 + 27 变异体 × 15 场景，~60s）
bun gauntlet/cli.ts mutate

# 4) 全流水线 + 报告
bun gauntlet/cli.ts all          # → results/report.md
bash scripts/run-all.sh          # 同上（含 check 前置）

# 单场景手工运行（理解运行时行为）
bun vendor/dhv-ts/src/main.ts run subject/vigil/vigil.hsl \
  --workspace scenarios/nominal/ws-n1 --task "demo" --model scripted \
  --fixture scenarios/nominal/n1.json --out /tmp/vigil-demo
cat /tmp/vigil-demo/report.md     # 会话报告
cat /tmp/vigil-demo/events.jsonl  # 事件总线（edge/node/fault_injected）
```

## Vigil 拓扑（SUT）

```
                    ┌──────────────── DriftWarn ───────────────┐
                    │                                           ▼
[budget]──Exhausted──►[router]                 [budget] ──► [triager] ◄──AlertReceived── [intake]
                       ▲  ▲                        ▲   ▲                     │
                       │  │ Escalate               │   └──Investigate──► [investigator]
                       │  └────────────┐           │                          │ ▲
[ledger] ◄─Parked/Escalated─ [router]  │           │              EvidencePending(自环)
   ▲  ▲                                   │           │                          │
   │  └──Accepted── [reviewer] ◄──Submitted── [synthesizer] ◄──Sound── [critic] ◄─EvidenceReady
   │                    │ Rejected(返工回环)                                          │
   └──Committed──► [intake]（外层告警回环）                    Insufficient──► [investigator]
```

9 节点 / 17 边 / 5 守卫环。三种角色端口（triage/synthesize/review）可插剧本（确定性）或 live LLM（z-ai 网关）；critic / router / ledger 是**确定性闸门**（非 LLM）——可验证性的锚点。

## 故障注入（Host Fixture v2）

剧本 JSON 内声明故障计划，在**宿主 API 边界**确定性触发，全程事件可观测：

```json
{
  "tracks": {
    "inbox":   ["{\"id\":\"ALT-001\",\"source\":\"prometheus\",...}"],
    "triage":  ["{\"decision\":\"investigate\",\"hypothesis\":\"...\"}"],
    "synthesize": ["{\"text\":\"Postmortem: ...\"}"],
    "review": ["{\"verdict\":\"accept\"}"]
  },
  "faults": [
    { "target": "fs.read", "nth": 1, "kind": "corrupt", "message": "telemetry corrupted in transit" }
  ]
}
```

故障类别：`error`（抛错）/ `deny`（权限拒绝 + capability_denied 事件）/ `empty` / `corrupt`（返回值截断）/ `slow`（延迟，仅异步目标）。

## 对上游 HSL 的贡献（已实测合入 branch）

| 项 | 内容 |
|:---|:---|
| **Host Fixture v2** | `$host.fixture.next(track)` 多轨道剧本 + 故障注入宿主闸门（向后兼容，dsh 回归绿） |
| **L-1/L-2 别名修复** | `import { T as A }` 的构造位/模式位/检查位三通道解析一致（+2 回归用例，113/113 绿） |
| **G-7/G-8 提案** | 拓扑可观测性纪律（lint 已实证 dsh 的结构性盲区边） |

## 许可

MIT —— 见 [LICENSE](LICENSE)。基于 [harness-specification-language](https://github.com/myh2026/harness-specification-language)（MIT）的工具链 vendor。
