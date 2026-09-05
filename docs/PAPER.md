# 拓扑接地的 LLM Agent Harness 一致性测试与变异分析

**Topology-Grounded Conformance Testing and Mutation Analysis for LLM Agent Harnesses**

> 论文草案 / 研究方向文档 · hsl-gauntlet v1.0 · 全部数字可由 `bun gauntlet/cli.ts all` 复现

---

## 摘要（草稿）

大语言模型（LLM）Agent 的运行容器——harness——正在成为一类新的关键软件构件（DeepSeek Harness、AIOS、各类 Agent 框架）。但 harness 的测试方法论停留在两个都不合适的极端：**代码覆盖率**对非确定性决策毫无意义（行业已形成共识），**端到端评测**（成功率/LLM-as-judge）则是黑盒，无法定位失败在拓扑结构中的位置。

本文提出把 harness 的**声明拓扑**（节点、带守卫的边、环）当作**可测试契约**：当编排结构以一等语法声明（如 HSL 的 `graph/node/edge on Guard`），静态拓扑成为 ground truth，事件总线成为观测面，经典测试三大支柱——**覆盖率准则、故障注入、变异分析**——可以在拓扑层重建：

1. **守卫边覆盖率**（edge coverage on declared topology）；
2. **Agent 特有故障分类学 + 确定性故障注入**（协议漂移 / 工具故障 / 预算耗尽 / 审查驳回）；
3. **首组面向 harness 声明拓扑的变异算子**（边删除 / 端点改写 / 守卫交换 / 行为闸门）与**变异杀死率**；
4. **轨迹不变式**（事件序列上的时序性质：always/never/implies）。

在 9 节点 / 17 边 / 5 守卫环的 SRE 告警分诊 harness（Vigil，15 个 HSL 模块，全 HSL 实现）上的实证：15 个确定性场景达到 **100% 边覆盖**，其中 **6 条边（35%）仅在故障注入下可达**——故障注入不是 harness 测试的可选项而是必要条件；**96.3% 变异杀死率**，唯一存活变异体经静态分析判定为 SUT 结构性等价变异（探查计划门结构使被测阈值边界不可达）——这给出了「等价变异的构造性判定」线索。此外提出的 **G-7 可观测性 lint** 在 DeepSeek Harness 的 HSL 复现（dsh）上静态检出一从未发射的声明边，验证了方法在既有真实 harness 上的适用性。

**关键词**：LLM agent；harness；拓扑覆盖；故障注入；变异测试；领域特定语言；一致性测试

---

## 1. 引言：三堵墙与一个被忽略的资产

### 1.1 行业现状（2025-2026 实证调研）

- **DeepSeek Harness（dsh）**：2026-09 开发者预览，"Everything is a Plugin" 架构。其编排结构（planner→tool→observe→reviewer 循环）存在于插件装配中，无独立声明层，不可静态校验。
- **AIOS** 等操作系统化路线：把调度/内存下推到 OS 层——解决的是资源面，不解决「harness 自身的拓扑是否被测试过」。
- **AgentVerify**（2026 preprint）：LLM 视为非确定性 oracle，对 FSM 形式化验证——理论优雅，但形式模型与实现代码之间的同步是手工的（dual-artifact 问题）。
- **agent-chaos / ReliabilityBench**：运行期故障注入框架——无静态拓扑基准，覆盖无从谈起；注入点在 API 层而非「harness 编排语义」层。
- 行业共识（rhesis.ai 等）：**"代码覆盖率对 LLM Agent 无意义"**——但没有人给出拓扑级的替代准则。

### 1.2 被忽略的资产：声明拓扑

用 DSL 描述 harness（HSL 路线）时，编排结构从代码里**升起来**成为一等语法：`graph G(mut state)` / `node n: T` / `edge a -> b on Guard`。此时：

- 拓扑是**静态已知的**（ground truth）；
- 运行期每条边的发射是**可观测的**（事件总线 `edge(from,to,on)`）；
- 二者的差距 = **测试充分性的直接度量**。

这是代码覆盖率精神在 harness 层的忠实再现：不再数「语句执行了没有」，而是数「**编排契约里的转移被触发过没有**」。

### 1.3 贡献

1. **方法论**：拓扑接地的 harness 一致性测试四件套（覆盖率 / 故障注入 / 变异 / 不变式），全部以声明拓扑为 ground truth、事件流为观测面；
2. **故障分类学**：Agent harness 特有的 11 类故障场景（含 6 类仅故障可达的拓扑路径）；
3. **首组 harness 拓扑变异算子**（8 类 27 个变异体）与双判据杀死准则（黄金偏差 ∨ 拓扑签名差分 ∨ 不变式违反）；
4. **等价变异的构造性判定案例**：存活变异体经 SUT 门结构静态分析归因（非测试盲区而是结构不可达）；
5. **G-7/G-8 拓扑 lint** 与 dsh 实证（静态检出不可观测声明边）；
6. **全栈开源实现**：SUT + 框架 + 场景 + 上游语言修复（多轨道剧本 / 故障注入宿主闸门 / import 别名三通道一致性），MIT。

---

## 2. 问题形式化

### 2.0 前置定义

**Harness 拓扑** $H = (N, E, G)$：节点集 $N$（可执行单元），边集 $E \subseteq N \times N$，守卫函数 $G: E \to \mathcal{V}$（每边绑定守卫变体 $v \in \mathcal{V}$，$\mathcal{V}$ 为各阶段词汇枚举的变体名集合）。

**运行轨迹** $\tau = e_1 e_2 \ldots e_k$：一次运行的 edge 事件序列，$e_i \in E$（由事件总线观测）。

**场景套件** $S = \{s_j\}$：每个场景 = 确定性剧本（多轨道 fixture）× 工作区状态 × 故障注入计划 $\phi$ × CLI 预算。

### 2.1 守卫边覆盖率

$$
\text{cov}(S) = \frac{|\{e \in E : \exists \tau_j,\ e \in \tau_j\}|}{|E|}
$$

**Fault-only 边**：$\text{FO} = \{e \in E : \forall \tau_j,\ e \in \tau_j \Rightarrow s_j \in S_{\text{fault}}\}$——度量「nominal 套件的结构性盲区」。

### 2.2 一致性（conformance）

场景 $s_j$ 的观测向量 $o_j = \langle$exit, ok, verdict, dispositions, edgeFull-multiset, faultEvents, deniedEvents$\rangle$，与黄金向量 $g_j$ 的相等性 + 不变式集合 $\mathcal{I}(\tau_j)$ 全满足。

### 2.3 变异测试

变异算子 $\mu: \text{src} \to \text{src}'$（源级单点编辑）。杀死判据（三选一）：

$$
\text{killed}(\mu) \iff \exists j: o_j^{\mu} \neq g_j \ \lor\ \text{sig}(o_j^{\mu}) \neq \text{sig}(o_j^{\text{base}}) \ \lor\ \mathcal{I}\text{-viol}(\tau_j^{\mu}) \setminus \mathcal{I}\text{-viol}(\tau_j^{\text{base}}) \neq \emptyset
$$

其中 sig 为差分签名（防黄金表自身腐化）。杀死率 $= |\text{killed}| / |\text{mutants}|$。

### 2.4 唯一守卫纪律（G-8）

若两条边共享守卫变体 $v$，match 臂命中 $v$ 时两边同时发射（**边发射别名**），边覆盖不可判定。故要求 $G$ 单射。Vigil 17 条边 17 个互异守卫变体。

### 2.5 可观测性纪律（G-7）

边 $e$ 的守卫 $G(e)$ 必须出现在某 match 臂模式中，否则 $e$ **结构性不可观测**（永不发射，覆盖率永远缺失且无法定位）。G-7 是纯静态检查。

---

## 3. Gauntlet 方法

### 3.1 观测契约（宿主 ABI）

事件总线事件（microkernel 尺度）：

| 事件 | 载荷 | 测试语义 |
|:---|:---|:---|
| `node` | `{graph,node,initialized}` | 节点初始化（顶点可达性） |
| `edge` | `{graph,from,to,on}` | **拓扑转移触发（覆盖率的原子）** |
| `fault_injected` | `{target,nth,kind,message}` | 故障触发（注入即观测） |
| `capability_denied` | `{target,reason}` | 权限拒绝（安全闸门触发） |
| `run_end/run_panic` | `{ok/elapsed/message}` | 韧性判定 |

### 3.2 故障注入：宿主边界闸门

故障在 **`$host.*` API 边界**注入（fs.read / shell.run / json.fields / llm.complete / fixture.next），五类动作：`error / deny / empty / corrupt / slow`。关键设计决策：

- **失败是值不是异常**（工具层返回 `ok=false` 结构）→ harness 的降级路径成为**拓扑上可声明的 Probe 枚举**（EvidencePending / EvidenceFailed），而不是栈展开；
- 注入以 `(target, nth)` 定位——**序号脆性**是实测发现（f11：json.fields 第 1 次调用属 parse_alert_line 而非 parse_triage），记录为已知局限，未来工作：按调用点命名定位。

### 3.3 故障分类学（11 场景）

| 类 | 场景 | 拓扑后果 |
|:---|:---|:---|
| 模型协议漂移 | f1 漂移→恢复 / f2 漂移→硬上限放弃 | Retryable 自环 × N → Parked |
| 工具缺失 | f3 遥测端宕机 | EvidencePending×n → EvidenceFailed |
| 工具损坏 | f4 返回截断 / f11 字段损坏 | 同上 + 软漂移 |
| 权限拒绝 | f5 capability 撤销 | capability_denied + EvidenceFailed |
| 证据不足 | f6 指标与假设无关 | Insufficient 回环 → 预算耗尽 → Failed |
| 审查驳回 | f7 驳回→返工→通过 / f8 驳回→耗尽→升级 | Rejected 回环 / Escalated |
| 预算耗尽 | f9 会话轮预算 | Exhausted → 会话停靠 |
| 草稿协议漂移 | f10 纠错回路 | 纠错 continue（无新边，验证预算路径） |

### 3.4 变异算子（首组 harness 拓扑算子）

| 算子 | 变异 | 期望杀死机制 |
|:---|:---|:---|
| M1 EDGE_DEL ×17 | 删除一条边声明 | 拓扑签名差分（该边事件消失） |
| M2 EDGE_REDIRECT ×3 | 改写边端点 | 拓扑签名差分（from/to 变化） |
| M3 GUARD_SWAP ×2 | 交换边守卫 | G-8 违规 / 事件流变化 |
| M4 BUDGET_OFF | 预算 `>=`→`>` | 行为黄金偏差（f9） |
| M5 ROUTE_FLIP | critical→warning | disposition 偏差（n2/f8） |
| M6 CRITIC_THRESH | ≥2→≥1 | **存活**：结构不可达（见 §5.3） |
| M7 DRIFT_CAP | ×2→×3 | 行为偏差（f2 预算语义） |
| M8 COMMIT_DROP | 提交丢弃落盘 | 不变式 INV-7/8 + disposition 偏差 |

### 3.5 轨迹不变式（11 条）

时序性质示例：`Accepted → 立即 Committed`（INV-1 窗口检查）；`DriftWarn ⇒ 此前 ≥2 次 Retryable`（INV-5 因果计数）；`fault_injected ⇒ 其后无 run_panic`（INV-10 故障韧性）；`committed 案例 == Accepted 边数`（INV-7 跨产物一致性）。完整清单：`gauntlet/invariants.ts`。

---

## 4. 实现

- **SUT Vigil**：15 个 HSL 模块（types×4 / providers / tools×2 / agents×6 / config / 主图），503 行主图。设计纪律：唯一守卫（17 边 17 变体）、确定性闸门（critic/router/ledger 非 LLM）、失败即值、mut 预算节点。
- **框架**：7 个 TS 模块（topo/lint/runner/coverage/invariants/mutate/report），bun 子进程契约运行（与 CLI 用户行为一致，隔离）。
- **上游贡献**：Host Fixture v2（多轨道 + 故障注入）；L-1/L-2 import 别名三通道一致（113/113 绿）；G-7/G-8 提案。

## 5. 实证结果

### 5.1 覆盖率（RQ1：拓扑能否作为覆盖率基准）

100%（17/17），6 条 fault-only 边（35%）：Retryable / EvidenceFailed / Insufficient / Rejected / Exhausted / DriftWarn。**推论**：任何不做故障注入的 harness 测试套件，对本 SUT 至多 65% 拓扑覆盖——且该缺口**可静态枚举**（对照 G-7 的全程序 match 臂分析）。

### 5.2 变异（RQ2：拓扑级测试能杀死什么）

96.3%（26/27）。M1 全部 17 个边删除变异体被拓扑签名差分杀死——**删除一条不改变控制流的纯声明边也会被抓住**，这是「声明拓扑 = 可测试契约」的直接证据。M4-M8 行为变异体由黄金/不变式杀死，与经典变异测试结论一致。

### 5.3 等价变异的构造性判定（RQ3：存活体意味着什么）

M6-CRITIC 存活。归因分析：Vigil 探查计划为顺序门结构——`if metrics==0 → 主信号; else if metrics==1 → 次级; else if runbook==0 → runbook(→Ready); else → Failed`。critic 只在 EvidenceReady（即 metrics 计数已达 2）之后执行，故 `metrics_total` 在 critic 评估点恒为 2，`>=2` 与 `>=1` 在**可达状态空间内不可区分**。这不是套件弱点而是 **SUT 结构性等价变异**——与经典软件中「等价变异不可判定」不同，harness 的声明结构 + 确定性剧本使这类判定**构造性可行**。方法论意义：变异分析的存活报告从「需要更多测试」的模糊信号，细化为「套件盲区」与「结构不可达」二分类。

### 5.4 外部效度（RQ4：方法适用于既有 harness 吗）

G-7 lint 对 dsh（DeepSeek Harness 的 HSL 复现，参考实现级工程）检出：`edge executor -> model on Event::Observed` 的守卫变体从未出现在任何 match 臂——该边在其真实运行（transcript 验证）中确实从未发射事件。方法在「既有真实 harness 存在可静态检出的拓扑债」上获得交叉验证。

## 6. 与相关工作的关系

| 路线 | 代表 | Gauntlet 的差异 |
|:---|:---|:---|
| OS 化 | AIOS / PwC Agent OS | 资源调度层 vs 编排契约层；互补 |
| 插件化 | DeepSeek Harness (dsh) | 拓扑藏在装配代码中 → Gauntlet 的 G-7 直接检出其复现的盲区 |
| 形式验证 | AgentVerify | 形式模型/实现双工件 vs 单一声明工件（拓扑即代码） |
| 混沌工程 | agent-chaos, ReliabilityBench | 无静态拓扑基准的运行期注入 vs 拓扑接地的注入+覆盖+变异闭环 |
| 协议一致性测试（电信/网络） | TTCN-3, coId | 方法论同源（被测规格=契约），harness 拓扑与故障分类学为新实例化 |

## 7. 效度威胁与诚实清单

- **单 SUT**：Vigil 为自建 SUT（demonstration bias）。缓解：G-7 在 dsh 上的交叉验证；后续计划接入 LangGraph 导出的图拓扑。
- **确定性边界**：全场景剧本化（零外联），live LLM 模式下覆盖率/变异结论需重验（非确定性 → 多次运行取覆盖并集）。
- **序号脆性**：故障以 `(target, nth)` 定位，对内部调用次序敏感（f11 实录）。
- **守卫匹配口径**：traceEdgeFire 按变体名（末段）匹配，故要求唯一守卫纪律（G-8）——这是 HSL 实现的约束而非方法论必然。
- **变异体规模**：27 个算子实例覆盖 8 类；EDGE_REDIRECT/GUARD_SWAP 只取代表性子集。

## 8. 论文路线图（下一步实验）

1. **多 SUT 泛化**：再写 2-3 个不同域的 HSL harness（代码修复型 / 研究综合型），验证故障分类学与算子的跨域稳定性；
2. **非确定性扩展**：live LLM 下 k 次重复的覆盖并集与「概率性边覆盖」；
3. **算子完整性**：EDGE_REDIRECT/GUARD_SWAP 全量枚举 + 等价变异静态判定器（G-7 式的膜拜分析推广到「守卫-计划可达性」）;
4. **对照实验**：同域 Python 实现的 harness（LangGraph）× 同故障注入——验证「声明拓扑带来的测试增益」不是 DSL 情结；
5. **真实事故回放**：以 SRE 真实 postmortem 中的故障链（如遥测损坏导致误升级）反推场景，验证分类学的生态效度。

## 9. 复现

```bash
bun gauntlet/cli.ts all     # 全流水线（~60s）：results/report.md + gauntlet.json
```

全部数字（17/17、6 fault-only、15/15、11/11、26/27、96.3%）来自该命令的输出。工具链与 SUT 全部 MIT 开源。
