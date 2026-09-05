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
