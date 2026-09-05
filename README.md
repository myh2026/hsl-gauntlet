<div align="center">

# Gauntlet — 拓扑级 Harness 一致性测试与变异分析框架

**Topology-Grounded Conformance Testing, Fault Injection & Mutation Analysis for LLM Agent Harnesses**

[![License: MIT](https://img.shields.io/badge/License-MIT-informational.svg)](LICENSE)
[![SUT](https://img.shields.io/badge/SUT-Vigil%20%2B%20Curator-success.svg)](docs/GENERALIZATION.md)
[![Toolchain](https://img.shields.io/badge/toolchain-dhv--ts%20v0.2.52-blue.svg)](vendor/dhv-ts)
[![Scenarios](https://img.shields.io/badge/scenarios-30%20(8%20nominal%20%2B%2022%20fault)-orange.svg)](scenarios)

</div>

---

> **一句话定位**：LLM Agent harness 的测试方法论长期缺位于「代码覆盖率」（对非确定性 Agent 毫无意义）与「端到端评测」（黑盒、无结构判据）之间。Gauntlet 把 harness 的**声明拓扑**（graph / node / edge on Guard）当作可测试契约，在它之上重建经典测试三大支柱——**覆盖率、故障注入、变异测试**——并以事件总线为观测面机械执行。SUT 用 [HSL](https://github.com/myh2026/harness-specification-language) 编写：**Vigil**（SRE 告警分诊，9 节点 / 17 边 / 5 守卫环，fan-out 处置）+ **Curator**（文档策展管线，8 节点 / 16 边 / 4 守卫环，fan-in 隔离）—— 两个刻意不同构的域验证框架泛化性（[GENERALIZATION.md](docs/GENERALIZATION.md)）。

## 核心实证结果（全部可复现）

| 指标 | Vigil（SRE 分诊） | Curator（文档策展） | 含义 |
|:---|:---|:---|:---|
| **Edge coverage** | **100%**（17/17） | **100%**（16/16） | 拓扑作为 ground truth 的可观测契约 |
| **Fault-only 边** | 6 条（**35%**） | 8 条（**50%**） | nominal 套件结构性盲区——故障注入不是可选项，是覆盖的必要条件；失败面更宽的域盲区更大 |
| **场景一致性** | 15/15 全绿 | 15/15 全绿 | exit/verdict/disposition/故障事件数五维黄金断言，确定性零外联 |
| **轨迹不变式** | 11/11 满足 | 11/11 满足 | Accepted→Committed 时序 / fan-in 收敛守恒 / 故障下不 panic… |
| **变异杀死率** | 96.3%（26/27） | **100%（26/26）** | 聚合 52/53 = **98.1%**；Vigil 唯一存活体 = SUT 结构性等价变异（静态归因） |
| **框架 SUT 专属代码** | — | — | **0 行**（第二 SUT 接入零框架改动，见 [GENERALIZATION.md](docs/GENERALIZATION.md)） |
| **G-7 lint 交叉验证** | dsh 的 `executor->model on Observed` 边被静态抓出（真实运行从未发射） | 同 lint 双 SUT 全过 | 立项动机被工具实证 |

## 仓库结构

```
hsl-gauntlet/
├── gauntlet/          框架本体（8 个 TS 模块，bun 运行，SUT 无关）
│   ├── topo.ts        静态拓扑提取器（.hsl → nodes/edges/guards JSON）
│   ├── lint.ts        G-7 可观测性 / G-8 唯一守卫 拓扑级 lint
│   ├── runner.ts      场景运行器（子进程契约 + 黄金预期 + 观测向量提取）
│   ├── coverage.ts    声明边 vs 触发边覆盖率（fault-only 边分析）
│   ├── invariants.ts  Invariant 接口 + 检查器（目录在各 SUT binding）
│   ├── mutate.ts      变异引擎（M1-M8 算子族通用，变异点由 SUT binding 声明；并行池 ×4）
│   ├── subject.ts     SUT 注册表（SubjectSpec —— 多 SUT 泛化层）
│   └── report.ts      report.md + gauntlet.json 双产物（per-SUT + 聚合）
├── subject/vigil/     SUT #1：SRE 告警分诊 harness（15 HSL 模块 + binding.ts）
├── subject/curator/   SUT #2：文档策展管线 harness（15 HSL 模块 + binding.ts）
├── scenarios/         30 个确定性场景（两 SUT 各 15：多轨道 fixture + 工作区 + 故障注入计划）
├── vendor/dhv-ts/     解释器 vendor（+ Fixture v2 多轨道剧本 + 故障注入宿主闸门）
├── docs/              PAPER.md / GENERALIZATION.md / LANGUAGE-EVALUATION.md / FAULT-TAXONOMY.md / TOPO-LINT.md
└── results/           report.md / gauntlet.json（运行产物）
```

## 15 分钟上手

```bash
# 依赖：bun ≥ 1.1（解释器 vendor 零 npm 依赖）
git clone https://github.com/myh2026/hsl-gauntlet.git && cd hsl-gauntlet

# 1) 拓扑提取 + G-7/G-8 lint
bun gauntlet/cli.ts topo
bun gauntlet/cli.ts lint

# 2) 双 SUT 场景一致性 + 不变式 + 覆盖率
bun gauntlet/cli.ts run                      # Vigil + Curator 各 15 场景
bun gauntlet/cli.ts run --subject curator    # 只跑 Curator

# 3) 变异测试（每 SUT 基线 + 26/27 变异体 × 15 场景，池深 4）
bun gauntlet/cli.ts mutate

# 4) 全流水线 + 报告（双 SUT 聚合，~2 分钟）
bun gauntlet/cli.ts all          # → results/report.md（含跨 SUT 对比表）
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
