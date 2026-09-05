# G-7 / G-8：拓扑可观测性纪律（提案 + 实证）

> 面向 HSL（及一切以声明拓扑描述 harness 的 DSL）的两条静态检查规则提案。Gauntlet 的 `gauntlet/lint.ts` 已实现，并在 dsh（DeepSeek Harness 的 HSL 复现）上完成交叉验证。

---

## G-7 可观测性纪律（edge guard must be matched）

**规则**：graph 中每条边的 Guard 变体必须出现在（全程序）某个 match 臂的模式里。

**动机（dsh 实证）**：HSL 的事件总线通过 `traceEdgeFire` 发射 edge 事件——机制是「match 臂命中变体 ∩ 边声明的守卫变体」。若一个守卫变体从未出现在任何 match 臂中，**该边在事件总线上结构性不可观测**：它永远不发射，无论运行多少场景。

dsh 的 `edge executor -> model on Event::Observed`（dsh.hsl:54）就是这种情况：主循环里没有任何 match `Event` 的臂，「observed」事件是靠 native 块手动 `$host.events.emit("observed", ...)` 发的——**声明边与实际观测机制脱节**。后果：

1. 该边的拓扑覆盖率永远缺失，且无法区分「没测到」vs「不可观测」；
2. 读者从拓扑图推断「executor 观察结果回流 model」——这在事件流里找不到证据；
3. Gauntlet 的 G-7 lint 静态检出该边（`bun gauntlet/cli.ts lint` 对 dsh.hsl 运行输出 G-7 error）。

**实现口径**：lint 遍历全程序 AST（traceEdgeFire 的动态作用域覆盖 graph 调用链上的所有函数，故取全程序而非仅 graph 体）；模式收集覆盖 `path`（单元/带 sub 负载）与 `struct`（带命名字段负载）两种模式形态。

**修复模式**（harness 作者侧）：
- 把「观察完成」建模为真正的 match 臂（如 Vigil 的 `Probe::EvidenceReady`）；
- 或删除装饰性边声明（诚实地缩小拓扑契约）。

## G-8 唯一守卫纪律（unique guard per edge）

**规则**：同一 graph 内，一个 Guard 变体名至多被一条边使用。

**动机（实现口径推导）**：`traceEdgeFire` 按**变体名**（路径末段）匹配——若 `triager->A on Retryable` 与 `triager->B on Retryable` 并存，任何命中 Retryable 的臂会**同时发射两条边**（边发射别名）。后果：

1. edge 覆盖率分子失真（守卫触发 = 多边触发，但语义上只有一条转移发生）；
2. 变异测试的 EDGE_DEL 判定被污染（删一条边，另一条同守卫边还在发射同名事件）。

**实践**：Vigil 的 17 条边使用 17 个互异守卫变体（`types/vocab.hsl` 的枚举设计即为此纪律服务——词汇层注释逐边标注）。设计守卫词汇时把「枚举 = 边的守卫池」当成一等考虑。

**推广**：这两条规则不依赖 HSL 具体实现——任何「声明拓扑 + 事件观测」的 harness DSL（或从 LangGraph 等框架导出的图 schema）都适用：G-7 = 声明边必须与观测机制对齐；G-8 = 观测粒度必须与声明粒度一一对应。

## 复现

```bash
# Vigil（应全绿）
bun gauntlet/cli.ts lint

# dsh（应报 G-7：executor -> model on Observed 不可观测）
cat > /tmp/lint-dsh.ts << 'EOF'
import { extractTopo } from '<abs>/gauntlet/topo';
import { lintTopology } from '<abs>/gauntlet/lint';
const topo = extractTopo('<abs>/harness-specification-language/toolchain/examples/dsh/dsh.hsl');
for (const d of lintTopology('<abs>/.../dsh.hsl', topo)) console.log(d.rule, d.message);
EOF
```

---

## G-9 空臂发射纪律（empty-arm emission，第十轮 #L-23 工具化）

**规则**：挂边守卫变体的 match 臂若体为空（无语句 block / unit），且该臂在
scrutinee 的静态可达变体集内，则报 error；可达集不可判定时报 warning（保守提示）。

**动机（Gatemaster gf9 实证，#L-23）**：HSL 的边事件（`interp.traceEdgeFire`）
语义是「match 臂执行记录」而非「节点转移记录」——穷尽 match 的空臂照样发射
其声明边事件。Gatemaster 黄金校准期实录：修复环顶部的
`BudgetSignal::DeadlineAlarm => {}` 空臂在案中死线路径执行，发射了
`budget -> ledger on DeadlineAlarm` 边事件但没有任何转移动作 → 计数型守恒
不变式 GINV-9 立即翻车（`abandoned(1) != LadderExhausted+DeadlineAlarm edges(2)`）。

三个直接推论（对上层度量）：
1. 边覆盖度量的是「守卫可观测性」，不证明「转移语义真发生」；
2. 计数型守恒不变式必须按臂执行计数（含空臂）；
3. 空臂发射可反向利用：把「案中死线」从空臂改造为有语义动作臂后，发射与
   语义重新对齐（Gatemaster 修复实录）。

**实现口径（scrutinee 定向 —— 避免穷尽性填充误报）**：HSL 要求穷尽 match，
「构造单变体 + 穷尽匹配」是发射边事件的标准习语（如 Curator 的
`let abandoned = ExtractEvent::ExtractAbandoned{..}; match abandoned {...}`
——其余两臂是结构性不可达的穷尽性填充）。直接「空臂 + 挂边守卫 → 报」
会把全部填充臂误报。故 G-9 先解析 scrutinee 的静态可达变体集：

| scrutinee 形态 | 解析策略 |
|:---|:---|
| 构造器直绑（`match abandoned`，let 绑定 = 变体构造） | 可达集 = {该变体} |
| 方法调用（`match budget.clone().status(..)`） | 可达集 = 同名 fn 体内构造集（AST 表达式位 + native 块 `$host.make` 正则扫描） |
| 函数调用（`match parse_classify(raw)`） | 同上（fn 名解析） |
| match 初始化（`let ev = match parse_extract(..) {Ok(e)=>e, Err(e)=>..}; match ev`） | 各臂体并集；`Ok(e) => e` 臂取被调函数的 **Ok 载荷变体集**（`Result::Ok(V)` 首参 / `$host.make("Result::Ok", [$host.make("V"...)` 正则） |
| 复杂表达式 / 回溯超限（4 层） | 不可判定 → 空臂报 warning（宁报不漏） |

臂变体 ∉ 可达集 → 穷尽性填充（不可达），不报；∈ 可达集 → error。

**实测矩阵**：
- 正控（三 SUT 现状）：Vigil / Curator / Gatemaster 全部通过 —— 所有填充臂
  被可达集分析正确豁免（Curator 的 ExtractAbandoned 臂经 Ok 载荷流豁免；
  Gatemaster 的 L1/L2/LadderExhausted 填充臂经 page_direct / force_exhaust
  体内构造集豁免）。
- RED 注入（#L-23 原始形态重现）：把 Gatemaster 案中死线臂改回空臂 →
  G-9 error 精确命中（`守卫变体 DeadlineAlarm（边 budget -> ledger）出现在
  空臂中……scrutinee 可达集：方法 status 体内构造集`），exit 1。
- 负控（判定器可靠性）：三 SUT 的 5 处穷尽性填充臂全部正确不报
  （v1 首版「直接报空臂」会把它们全部误报 —— 保守报 warning 的初版也在
  Curator `match ev` 上翻车过一次：Ok 载荷流缺失 → 补 native 正则扫描修复）。

**修复模式**（harness 作者侧）：
- 挂边变体的臂执行与边目标一致的转移（Gatemaster 案中死线修复实录）；
- 或重构为单变体构造 + 穷尽匹配习语（填充臂天然不可达，G-9 豁免）；
- 计数型不变式按臂执行计数口径陈述（G-9 与不变式作者的契约）。
