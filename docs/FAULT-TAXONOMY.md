# Agent Harness 故障分类学（Fault Taxonomy）

> Gauntlet 场景库背后的分类学。每个故障类 = 一类「harness 编排层」的失效模式（非模型能力问题、非基础设施宕机问题——而是**harness 面对这些失效时的编排行为**是否被测试过）。
> 实例化：Vigil SUT × 11 个故障场景（scenarios/faults/）。

---

## 1. 分类法总览

```
Agent Harness 故障
├── A. 模型协议漂移（model-protocol-drift）     —— 模型输出违反 harness 协议
│   ├── A1 可恢复漂移 → 纠错回路                 f1（分诊）· f10（草稿）
│   └── A2 不可恢复漂移 → 漂移预算耗尽           f2
├── B. 工具失效（tool-failure）                  —— 工具层返回失败/劣化数据
│   ├── B1 工具缺失（absence）                   f3（遥测端不存在）
│   ├── B2 工具损坏（corrupt）                   f4（返回截断）· f11（字段损坏）
│   └── B3 权限拒绝（deny）                      f5（capability 撤销）
├── C. 证据质量（evidence-quality）
│   └── C1 证据不足/与假设无关                   f6（指标无关 → 审查回环）
├── D. 审查闸门（review-gate）
│   ├── D1 驳回后恢复                            f7（返工→通过）
│   └── D2 驳回至预算耗尽                        f8（→升级）
└── E. 预算耗尽（budget-exhausted）
    └── E1 会话级轮预算                          f9（停靠收束）
```

## 2. 逐类：故障注入机制 → 拓扑后果 → 断言判据

### A1 模型协议漂移（可恢复）

- **注入**：triage 轨道输出非 JSON（`"not json at all"`）或 markdown 围栏（真实 LLM 实录的两种违规形态，dsh 观察一致）
- **拓扑后果**：`Retryable` 自环 × N（triager→triager）；纠错 user 消息入转录
- **判据**：dispositions.committed == 1（恢复成功）；`DriftWarn` 边在 drift_count ≥ max_drift 后出现（f1）；转录含纠错消息
- **为何必须测**：纠错回路是 harness 对非确定性的第一道防线，nominal 测试永不触达

### A2 模型协议漂移（不可恢复）

- **注入**：4 条连续垃圾输出（超过 2×max_drift 硬上限）
- **拓扑后果**：Retryable × 4 → DriftWarn × 多次 → **放弃该告警** → `Parked`
- **判据**：parked == 1；无 panic；exit 0（优雅降级而非崩溃）

### B1 工具缺失

- **注入**：workspace 无 metrics.json（**缺省故障**：不注入 fault，直接缺文件——环境级故障）
- **拓扑后果**：`EvidencePending` × 3（探查计划无法推进）→ 预算耗尽 → 构造降级 `EvidenceFailed` → `Parked`
- **判据**：parked == 1；probe_failures 统计路径
- **方法论注**：缺省故障 vs 注入故障是两个互补机制——B1 用前者，B2/B3 用后者

### B2 工具损坏

- **注入**：`{target: fs.read, nth: 1, kind: corrupt}`（遥测负载传输损坏，返回半截）
- **拓扑后果**：JSON.parse 失败 → ok=false → Pending×n → Failed → Parked
- **f11 变体**：`{target: json.fields, nth: 2, kind: corrupt}` → 解析出空 map → **软漂移**（字段缺失而非抛错）→ Retryable 通道
- **为何必须测**：损坏数据比缺失更阴险——语义静默劣化（half-truth），harness 必须把「解析成功但内容空」也当漂移处理

### B3 权限拒绝

- **注入**：`{target: fs.read, nth: 1, kind: deny}` → capability_denied 事件 + 抛错
- **拓扑后果**：同 B1 形态 + **capability_denied 事件计数**
- **判据**：deniedEvents == 1（安全闸门触发可观测）
- **为何必须测**：dsh 的六道防线第 3 条（shell 白名单）在真实 LLM 运行中拦过 `cd`/`deno`——权限拒绝路径必须被测试覆盖，否则闸门形同虚设

### C1 证据不足

- **注入**：workspace 指标与假设关键词无关（cpu/mem vs "error rate" 假设）
- **拓扑后果**：证据收集完成（EvidenceReady）但 critic 判 `Insufficient` → **回环调查员** → 计划耗尽 → Failed → Parked
- **判据**：insufficient 统计；Insufficient 边恰好出现在 EvidenceReady 之后（INV-4 前置）
- **为何必须测**：这是「工具都健康但结论质量不足」的编排路径——纯 nominal 和纯故障视角都会漏掉

### D1/D2 审查驳回

- **注入**：review 轨道输出 `reject + note`
- **D1 拓扑后果**：`Rejected` 回环（reviewer→synthesizer）→ 返工草稿 → Accepted → Committed
- **D2 注入**：连续 reject 至 max_rounds → 路由升级（critical 告警 → `Escalated`）
- **判据**：rejections 计数；INV-2（accepted+rejected ≤ submitted）

### E1 预算耗尽

- **注入**：`--max-turns 1` + 2 条告警（CLI 级预算注入——预算是宿主配置面）
- **拓扑后果**：第 1 条 commit 后，loop 顶 `Exhausted` 边 → 会话级合成告警停靠 → `budget-exhausted` 裁决
- **判据**：verdict == budget-exhausted；INV-6（Exhausted ⟺ verdict 一致）

## 3. 与经典分布式故障分类的对照

| 经典分类 | 本分类学对应 | harness 特有差异 |
|:---|:---|:---|
| crash fault | —（子进程崩溃由 run_panic 事件观测，INV-9/10） | harness 的「崩溃」= Err 出口或 panic，需区别于**优雅降级** |
| omission fault | B1 工具缺失 / `empty` 注入 | 工具层缺省 vs 传输层丢包不同层 |
| byzantine fault | **B2 corrupt（半真半假）** | LLM 输出天然拜占庭——「协议合法但语义劣化」是 Agent 域的第一公民 |
| performance fault | `slow` 注入（宿主闸门） | 超预算延迟 → 轮预算耗尽路径 |
| 安全策略拒绝 | B3 deny | capability_denied 事件是**安全测试可观测性**的锚点 |

**核心主张**：Agent harness 的故障分类学必须以「**编排后果**」（走哪条边、落在哪个处置）而非「底层原因」（网络/磁盘/API）为主轴——因为 harness 的职责就是把一切底层失效**翻译成编排决策**。翻译表本身就是要测试的对象。

## 4. 场景-故障矩阵（复现用）

| 场景 | 类 | workspace | 故障注入 | CLI | 金金预期 |
|:---|:---|:---|:---|:---|:---|
| f1 | A1 | ws-n1 | — | --max-turns 8 | 1/0/0 committed |
| f2 | A2 | ws-n1 | — | --max-turns 8 | 0/1/0 parked |
| f3 | B1 | **ws-f3**（无 metrics） | — | — | 0/1/0 |
| f4 | B2 | ws-n1 | fs.read#1 corrupt | — | 0/1/0, faultEvents=1 |
| f5 | B3 | ws-n1 | fs.read#1 deny | — | 0/1/0, denied=1 |
| f6 | C1 | **ws-f6**（无关指标） | — | — | 0/1/0 |
| f7 | D1 | ws-n1 | — | — | 1/0/0, rejections=1 |
| f8 | D2 | ws-n1 | — | — | 0/0/1 escalated |
| f9 | E1 | ws-n1 | — | **--max-turns 1** | budget-exhausted, 1/1/0 |
| f10 | A1 | ws-n1 | — | — | 1/0/0, draft 纠错 |
| f11 | B2 | ws-n1 | json.fields#2 corrupt | — | 1/0/0, 软漂移 |

（goldens 的机器可读形态见 `gauntlet/runner.ts: scenarios()`）
