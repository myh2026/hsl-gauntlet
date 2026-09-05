# 泛化实验：第二 SUT Curator 的零框架改动接入

> **主张**：Gauntlet 框架层（拓扑提取 / lint / 场景运行 / 覆盖率 / 不变式 / 变异 / 报告）是 SUT 无关的；
> 接入一个新域的 SUT 只需要「SUT 本体 + 一份 binding 声明」，不触碰任何框架代码。
> 本文档记录第八轮为验证该主张所做的对照实验、实测耦合分析与结果。

---

## 1. 实验设计

### 1.1 自变量：两个刻意不同构的域

| 维度 | Vigil（SUT #1） | Curator（SUT #2） |
|:---|:---|:---|
| 领域 | SRE 告警分诊（incident triage） | 文档策展管线（document curation pipeline） |
| 拓扑 | 9 节点 / 17 边 / 5 守卫环 | 8 节点 / 16 边 / 4 守卫环 |
| 失败汇聚结构 | **fan-out**：router 三路处置（parked/escalated/ledger） | **fan-in**：quarantine 五路汇聚（schema/extract/enrich/publish/budget） |
| 修复回环 | critic 审查回环（Insufficient） | 双修复回环（EntitiesInvalid 重抽取 + PublicationRejected 返工） |
| 漂移自环 | triager on Retryable | extractor on Malformed |
| 部分完成自环 | （无对应） | enricher on EnrichmentPartial |
| 处置词汇 | committed / parked / escalated | published / quarantined / deferred |
| 会话裁决 | inbox-drained / budget-exhausted | batch-drained / budget-exhausted |
| 模型角色轨道 | triage / synthesize / review | extract / enrich |
| 工具面 | telemetry（metrics.json）+ knowledge（runbook.md） | corpus（corpus.json） |
| 模块数 / 行数 | 15 模块 / ~1100 行 | 15 模块 / ~1000 行 |

### 1.2 因变量

1. 框架层需要的**语义改动**行数（主张预测：0 —— 只允许参数化重构）
2. 接入工作量构成（SUT 本体 / binding 声明 / 场景语料）
3. 各 SUT 独立跑出的覆盖率 / 一致性 / 变异杀死率
4. 新 SUT 接入过程中语言层暴露的新问题（实测 #L-22）

---

## 2. 耦合分析（诚实的 delta 清单）

第八轮重构前后 `gauntlet/` 目录的语义变化：

| 模块 | 改动性质 | 语义 or 参数化 |
|:---|:---|:---|
| `topo.ts` | **零改动** | — |
| `coverage.ts` | **零改动** | — |
| `lint.ts` | **零改动** | — |
| `types.ts` | dispositions 由硬编码三元组 `{committed,parked,escalated}` 泛化为 `Record<string, number>` | 参数化（泛化） |
| `runner.ts` | `SUBJECT` 常量 + 硬编码场景清单 → 经 `SubjectSpec` 注入 entry；处置计数改动态键 | 参数化（去 SUT 知识） |
| `invariants.ts` | 硬编码 11 条 Vigil 不变式 → 只保留 `Invariant` 接口 + 检查器，目录迁入 `subject/vigil/binding.ts` | **知识迁移**（净删 ~140 行框架内 SUT 专属代码） |
| `mutate.ts` | `mutantSpecs()`/`subjectDir` 硬编码 → `subject.mutants()`/`subject.subjectDir` 注入；新增并行池（池深 4） | 参数化 + 性能（并行池对两 SUT 通用） |
| `report.ts` | 单 SUT 报告 → per-subject 分节 + 聚合对比表 | 泛化（新增聚合层） |
| `cli.ts` | 单 SUT 流水线 → `--subject` 过滤 + 多 SUT 循环；**修复判据缺口**（见 §4） | 泛化 |
| `subject.ts` | **新增**：`SubjectSpec` 接口 + 注册表（Vigil/Curator 各一行） | 框架新抽象（~100 行） |

**结论**：框架层没有为 Curator 写任何一行 SUT 专属逻辑；所有 Vigil 专属知识（场景黄金 / 不变式 / 变异点）都迁到了 `subject/vigil/binding.ts`（并因此被显式认定为「SUT 资产」而非「框架资产」—— 这本身就是实验产出之一：**原框架里 164 行代码其实是被误分类的 SUT 资产**）。

### 2.1 接入 Curator 的工作量构成

| 工作项 | 规模 | 说明 |
|:---|:---|:---|
| SUT 本体 | 15 个 HSL 模块（~1000 行） | 首版 check 即 0 error / 0 warning（仅 1 处字面量续行语法差异） |
| binding.ts | 1 个 TS 文件（~430 行） | 15 场景黄金 + 11 不变式 + 26 变异点 |
| 场景语料 | 15 个 fixture JSON + 3 个 workspace | 全部确定性 |
| 框架改动 | **0 行 SUT 专属** | §2 表 |

---

## 3. 结果

（复现命令：`bun gauntlet/cli.ts all`，117s，双 SUT 全流水线）

| 指标 | Vigil | Curator | 聚合 |
|:---|:---|:---|:---|
| 场景一致性 | **15/15**（4 nominal + 11 fault） | **15/15**（4 nominal + 11 fault） | 30/30 |
| 轨迹不变式 | 11/11 满足 | 11/11 满足 | 22/22 |
| Edge coverage | **100%**（17/17） | **100%**（16/16） | — |
| fault-only 边 | 6 条（35%） | **8 条（50%）** | — |
| 变异杀死率 | 96.3%（26/27） | **100%（26/26）** | 52/53 = 98.1% |
| 存活体归因 | M6-CRITIC：**triage 静态判定器自动归因**（计划门不变式证据链六步，等价归因后有效杀死率 100%） | 无 | 1 |

### 3.1 值得注意的域差异（论文观察）

- **fault-only 边占比 35% → 50%**：Curator 的失败面更宽（五路 fan-in 中四路是失败出口），nominal 套件的拓扑盲区更大 —— 故障注入作为覆盖必要条件的论断在新域**加强**。
- **变异杀死率 96.3% → 100%**：Curator 的发布闸（publisher）是终态确定性节点，M6 类阈值变异直接改变处置分流被黄金断言抓住；Vigil 唯一存活体源于其探查计划门的结构性等价 —— 两个域给出了存活体的两种典型形态（结构性等价 vs 无存活）。
- **修复回环 ×2**：Curator 有两条独立修复回环（校验重抽取 / 发布返工），不变式目录因此出现新的性质类型（CINV-4 富集守恒）—— 不变式目录是**域知识**，不是框架硬编码，这正好验证了 binding 分层的必要性。

### 3.2 判据真实性（RED 注入）

双 SUT 管线在受控破坏下正确转红：将 Curator 的 published 处置改写为 quarantined 后，
`run-all.sh` 退出码 1，8 个场景的 conformance 偏差 + 4 条不变式违反（CINV-7/CINV-8）被逐条报告；
恢复后退出码 0。判定链：`run-all.sh (set -e) ← cli.ts all 判据（偏差/不变式/无效变异体） ← watchdog GREEN`。


### 3.3 第九轮更新：#L-22 修复后的 Curator 简化（上游反哺 SUT）

Curator 的 `parse_extract.hsl` 以 `$host.make` 直构通道重写（`Result::Ok[ExtractEvent::EntitiesExtracted{entities}]` 全族嵌套构造），
原「拍平字符串 + split_once 逐字段重建」协议全删：

| 项 | 拍平协议版（#L-22 断层期） | $host.make 直构版（第九轮） |
|:---|:---|:---|
| parse_extract 代码量 | ~75 行（含 40 行协议 + 重建定式） | ~35 行 |
| 协议保留字约束 | entity value 不得含 `~` 与 `|` | 无 |
| 错误通道 | 哨兵对 `["__parse_error", msg]` | `Result::Err(HarnessError{...})` 原生嵌套 |
| 黄金输出 | — | **逐字节等价**（15/15 场景 0 偏差 0 不变式违反） |

这是「SUT 泛化实验反哺语言修复」的完整闭环：Curator 接入时踩到的 #L-22（第八轮登记）
在第九轮修复，修复的价值直接用 SUT 的行为等价 + 代码缩减度量。

---

## 4. 顺带修复：`all` 模式的判据缺口（历史遗留）

RED 注入实验暴露：`cli.ts` 的 `all`/`mutate` 模式此前**不因场景偏差退出非零**（只有 `run` 模式会）。
这意味着 watchdog 的 GREEN 在「`all` 模式 + 场景偏差」组合下可能是假绿 —— 该缺口自初版就存在，
历轮 RED 注入恰好都走了 runner 异常路径（exit≠0）而没踩中。
本轮修复：`all`/`mutate` 统一判据（任何场景偏差 / 不变式违反 / 无效变异体 → 退出 1）。

> 元发现（第八课素材）：**护栏判据本身也是需要 RED 验证的代码** —— 第五轮的教训在「判据
> 出口」这个更小的面上再次应验。

---

## 5. 语言层新发现（#L-22，实测实录）

Curator 的实体抽取协议需要把模型 JSON 输出解析成 `Vec<Entity>`。首版实现让 native 块直接
返回结构体数组（探针验证字段读取可行）—— 但运行期在 `entities.clone()` 处 panic：

```
✗ 运行期错误：foreign 没有方法 "clone"
```

**根因**：native（TypeScript 逃逸舱）返回的 plain object 不带 HSL 运行时的 `__struct` 标记，
进入 HSL 值域后类型名为 `foreign` —— 字段读取走直通通道可用，但 `.clone()` / 方法调用 /
S 规则检查全部失效。此前 Vigil 的 native 只返回 String/Map/number，从未把 plain object
放进值域，所以六轮实测都没踩到。

**修复取向**（Curator 采用）：native 只做「JSON → 拍平字符串」的 I/O 搬运，`Entity` 结构体
在 HSL 侧经 `split_once` 逐字段重建（`parse::<f64>()` 恢复置信度）。这同时把 N1 纪律
（逻辑不进 native）落到了值模型层。

**上游建议**（记录，未修）：native 块返回值应有官方的结构体构造通道（如 `$host.make("Entity", {...})`），
或在 checker 层对「native 返回值注解为 struct 的字段」做 foreign 值的静态告警。已登记为
HSL-GUIDE 已知限制候选 #L-22。

---

## 6. 复现

```bash
bun gauntlet/cli.ts subjects                      # 列出注册的 SUT
bun gauntlet/cli.ts all                           # 双 SUT 全流水线（117s）
bun gauntlet/cli.ts all --subject curator         # 只跑 Curator
bash scripts/run-all.sh                           # check 前置 + 全流水线（watchdog 同款）
```
