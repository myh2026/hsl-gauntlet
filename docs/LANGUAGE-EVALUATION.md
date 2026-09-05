# HSL 语言实战评估报告 —— 写一个 9 节点 / 17 边真实 Harness 的全程实录

> 评估者立场：以「用户」身份从零编写 Vigil（SRE 告警分诊 harness，15 个模块 / ~1100 行 HSL / 27 个拓扑变异体 / 15 个测试场景），全程记录语言的真实表现。本文只记录**实测发生**的事，无推测。
> 环境：dhv-ts v0.2.52（+ 本项目 Fixture v2 扩展），bun 1.3.14。

---

## 0. 总评

| 维度 | 评分（5 分制） | 一句话 |
|:---|:---:|:---|
| 表达力（拓扑一等化） | 5.0 | graph/node/edge on Guard 把编排从代码里升出来，是整个 Gauntlet 方法论成立的前提 |
| 静态严谨性 | 4.5 | S6 穷尽性 + G 规则在写作时**真的拦住我**（见 §3）；扣 0.5：别名通道曾有三处不一致（L-1/L-2） |
| 语法舒适度 | 3.8 | Rust 风格的显式性对 harness 场景是净收益，但 String::from/clone 的仪式感在字符串密集域略重 |
| 错误消息质量 | 4.5 | 中文 + 精确定位 + 错误码文化；match 臂的防御穷尽错误把我指向了正确的设计 |
| 工具链完备度 | 4.0 | check/run/emit/watch 齐全；缺：多轨道剧本、故障注入（本项目已补）、测试框架层（Gauntlet 即此） |
| 可测试性 | 5.0 | 事件总线 + 确定性剧本 = 我能对 17 条边逐一断言，这在 Python/TS harness 里做不到 |

---

## 1. 写作过程统计（诚实数据）

- **首版 check 通过率**：11 个模块 503 行主图，语法层只错 1 处（match-scrutinee 的结构体字面量，见 §4.1），修 1 次后 `check` 即 0 error / 0 warning。
- **到 15/15 场景全绿的迭代**：3 轮（fixture JSON 引号事故 ×1、f9 缺轨道 ×1、f11 故障序号错位 ×1——均为**用例侧**问题，非语言问题）。
- **抓到的工具链 bug**：2 个（L-1 别名构造失败、L-2 别名臂绕过穷尽性检查）+ 1 个设计缺口（多轨道剧本缺失）——全部已修复并附回归用例，上游 113/113 绿。

## 2. 语法舒适度实录

### 2.1 拓扑声明：体验最好的部分

```hsl
graph Vigil(mut state: SessionState) -> Result<RunReport, HarnessError> {
    node intake: AlertLog = AlertLog::new(state.inbox.clone())?;
    node mut budget: Budget = Budget::zero();
    edge budget -> router on BudgetSignal::Exhausted;
    edge ledger -> intake on AdvanceSignal::Committed;
```

- `node mut` 存在且好用（预算计数顶点）；
- `?` 在 node 初始化里可用——初始化失败即早退，语义干净；
- 边声明的**纯声明性**（不改变控制流）起初让我警惕「装饰性语法」，但变异测试证明它**是契约**：删任何一条边都会被拓扑签名差分抓住（M1 全杀）。声明和行为（match 臂）分离 + G-7 lint 静态对齐，是这套设计真正自洽的地方。

### 2.2 仪式感：Rust 基因的代价

- `String::from("...")` 与 `.clone()` 密度高：HSL 文本密集（协议串、提示词、格式化），一个 503 行主图里有 60+ 处 String::from/clone。**但**这个代价买来了「值语义直觉」——我在整个 Vigil 里没有遇到一处意外的别名/共享可变状态（对照：写 JS 版 dsh 风格代码时这种事故是常态）。对 harness 这种「状态机正确性高于开发速度」的域，这是正确的取舍。
- `for w in words { picked = w; break; }` 取首元素——`first()` 返回 Option 再 match 略啰嗦，循环+break 反而更顺（这是口味问题）。

### 2.3 失败即值：harness 域的关键甜点

工具层 `Result<ToolOutput, HarnessError>` 且 `ok=false` 携带错误语义（不抛异常），让降级路径成为**可 match 的枚举**（`Probe::EvidencePending/EvidenceFailed`）——「遥测挂了」从 try-catch 的栈展开变成拓扑上声明的转移。这是我为故障场景设计时最感激的语言决定。

## 3. 静态严谨性实录（铁律真的咬人）

写作中被检查器**实际拦截**的经历：

1. **S6 循环内禁 `_` 通配**：我在预算耗尽降级路径上想用 `_ => {}` 兜掉 Probe 的两个不可达臂——被拒。被迫写显式防御臂后意识到：这正是「新变体 = 编译期处决」哲学的代价与收益——**上游词汇演化时我的防御臂会立刻变成编译错误**。Vigil 的降级构造 match 三臂中两臂标了「防御穷尽（S6 纪律）」注释。
2. **G-2 端点先声明**：先写 edge 后写 node 的手误被精确指出行号。
3. **S7 未使用绑定**：早期草稿里 `covered_note` 只写不读——警告（诚实但可关）。
4. **S1 零隐式转换**：`"5".parse::<u32>()` 的显式 turbofish 让 Policy 装配的每处转换都有名字。

## 4. 发现的工具链 bug（全部已修 + 回归锁定）

### 4.1 [绕过] match-scrutinee 的结构体字面量需先绑定

`match Probe::EvidenceFailed { reason: ... } { ... }` 解析失败（「期望 => 得到 :」）。与 Rust 一致的表达式歧义：scrutinee 处的 struct 字面量与 match 体花括号冲突。**绕过**：`let degraded = ...; match degraded {...}`。建议文档化（指南未提）。

### 4.2 [L-1 已修复] import 别名：构造位与模式位解析不对称

`import { Triage as TV }` 后：`TV::Variant{}` 构造报「无法解析的结构体字面量」（evalStructExpr 按原名查注册表），而 match 模式 `TV::Variant` 却因族校验守卫跳过而**宽松通过**——**同一个名字在两个位置一个炸一个过**，这是最危险的不对称（静默错误比崩溃更坏）。修复：link 期别名注册进类型注册表 + 三处构造位族名归一 + 模式位族名经注册表解析。上游 +2 回归用例（113/113）。

### 4.3 [L-2 已修复] 别名臂完全绕过 S6 穷尽性

checker 的 `pathPatternInfos` 以首段查 enums 注册表，别名首段未注册 → 别名臂被穷尽性统计忽略——「漏写 S::Square 变体」不会报错。修复：checkProgram 构建 enumAlias 映射。

### 4.4 [设计缺口已补] 剧本单轨道

dsh 时代 fixture 只有 acts/reviews 两轨。Vigil 需要 4 轨（inbox/triage/synthesize/review）+ inbox 环境轨道 → 实现了 `$host.fixture.next(track)` 多轨道 + left()。**零破坏**（dsh 回归绿）。

### 4.5 [记录] 故障注入的序号脆性

`(target, nth)` 定位使注入点依赖内部调用次序（f11 实录：json.fields 第 1 次调用属 parse_alert_line 而非 parse_triage——打偏了）。已记录为已知局限；改进方向：按调用点命名（如 `json.fields@parse_triage`）。这本身是 Gauntlet 实测出来的方法论教训。

### 4.6 [观察] 边发射的变体名匹配口径

`traceEdgeFire` 按守卫**变体名**（路径末段）匹配 match 臂与边声明 → 同名变体会同时发射多条边（别名）。这不是 bug 而是实现口径，但直接催生 **G-8 唯一守卫纪律**（Vigil 17 边 17 个互异变体名）——语言实现细节反向塑造了写作纪律，这条链路值得写进论文。

## 5. 与直接写 Python/TS 的对照（主观但基于实录）

写 Vigil 的每一处「语言帮我拦住的错误」（S6 防御臂、G-2 次序、别名炸点显式化）在 Python 版 harness 里都会是**运行期才暴露**的静默行为差异。反过来，我在 Python 里 5 分钟能写的字符串拼接，HSL 要 8 分钟。**结论**：harness 是状态机正确性密集的域，值得用编译期纪律换运行期确定性——尤其当测试（Gauntlet）能在拓扑层建立判据时，显式性直接变现为可测性。

## 6. 给语言作者的改进清单（按优先级）

1. match-scrutinee struct 字面量：文档化（或自动包一层括号语义）；
2. 别名通道：继续审计 emit/sync/backends 是否存在第三处不对称（L-1 只修了 check/run 路径）；
3. 剧本轨道：把 inbox 这类「环境轨道」与「模型轨道」在文档上分层（Gauntlet 已实践：环境 = workspace 文件 + 环境轨道，模型 = 角色轨道）；
4. `first()`/`nth()` 等 Vec 便捷方法与 Option 的糖（`unwrap_or` 已很好用）；
5. 故障注入进 BNF 附录（宿主 ABI 的 fault 命名空间），避免方言化。

---

# 第二轮实测（hsl-fuzz 对抗战役 · 2026-09-05）

> 23 个对抗样本（Parser 7 / Checker 8 / Interp 8）+ 8 个精准追加样本，
> 每个疑点双编译器对拍 + rustc 真机验证。产出 4 个新修复（L-4/L-5/L-6/L-7）
> + 2 个设计观察。**全部锁定回归用例：dhv-ts 113→120，双编译器一致性 39→44。**

## 7. 第二轮确认的工具链 bug

### 7.1 [L-4 已修复 → S-13] 整型注解的字面量域完全不设防

`let x: i8 = 300` 的完整行为链（修复前）：

| 环节 | 行为 |
|---|---|
| dhv-ts check | 0 error 0 warning（放行） |
| dhv (Rust) check | 校验通过（放行） |
| interp run | 打印 `300`（注解完全失效） |
| emit rust → rustc | **error: literal out of range for `i8`**（拒绝） |
| emit python/js | 静默放行 |

这是**跨后端语义漂移**的教科书案例：同一份 HSL 源，38 后端的可用性不同，
且 emit 的启发式校验（"语法✓ heuristic:balanced"）完全没拦住。
`u8 = -1`（无符号接受负值）同理。

**修复**：S-13 规则——12 种整型注解（i8..i128/isize/u8..u128/usize）的字面量
域静态校验（let + const，含一元负号展开）。非字面量不判（`big + 1` 的
BigInt 任意精度是既定设计，见 guide 已知限制 #48；显式截断走 `as`）。
双端同步实现（checker.ts + typecheck.rs）。

### 7.2 [L-5 已修复] rust 后端 println 双重包裹——所有 println 生成物必炸

`println!("len={}", v.len())` 生成 `println!(format!("len={}", v.len()))`
—— rustc 对**所有含 println 的 HSL 源**都报 `format argument must be a
string literal`。emit 校验绿灯掩盖了这一点（启发式不覆盖宏调用形态）。
python/ts/go 的 print 家族接受任意表达式，所以只有 rust 后端炸——
**又一个只在单一后端显形的漂移**。修复：剥 `format!(` 外壳取宏内芯。

### 7.3 [L-6 已修复] rust 后端 main 签名违反 Termination 约束

HSL 入口约定 `fn main() -> i64`（R-1）投 rust 生成 `pub fn main() -> i64`
—— rustc 拒绝（main 只能返回实现 `Termination` 的类型：`() / bool / i32 /
u8-u32 / ExitCode / Result`）。修复：入口 fn 改名 `hsl_main` + 进程级
wrapper `fn main() { std::process::exit(hsl_main() as i32); }`。
修复后 e07 样本 emit rust → rustc 编译零错 → **真机运行输出与 interp 完全
一致**（`len=3 ok`）—— 38 后端"同一语义"承诺在 rust 端首次全链路成立。

### 7.4 [L-7 已修复 → G-8] 重复边声明静默通过

同一条 `edge a -> b on Ev::Tick;` 复制两遍 → 0 error 0 warning。对
Gauntlet 是直接威胁：拓扑统计（边数 = 覆盖率分母 = 变异基线）翻倍污染。
**修复**：G-8 规则——(from, to, 守卫语义指纹) 三元组判重。指纹实现有讲究：
- dhv-ts 手写递归序列化；dhv (Rust) **不能用 `{:?}`**（Ident 含 span，
  同语义不同位置的 pattern 指纹必不同——实现时踩过：双端一度不一致，
  conformance 对拍暴露）；
- expr 守卫用源码位置指纹（同位置 + 同端点 ≡ 复制粘贴）；
- 保守口径不误报 Vigil 惯用的「同向多守卫并行边」（如 router->ledger
  的 Parked/Escalated 两条）。

## 8. 第二轮设计观察（记录，非 bug）

1. **i64 算术溢出不环绕**：`i64::MAX + 1` 打印 `9223372036854775808`
   （BigInt 直通）。这是任意精度设计（guide #48 已记录 cpp 对拍差异），
   但与 Rust 语义不同——emit rust 的 `big + 1` 在 release 是环绕。
   归档为已知语义差异，建议 spec 显式声明。
2. **静态/运行时类型检查不对称**：`"abc" * 2`、`true + 1`、`"abc" > 1`
   check 全绿、运行期才干净报错。S1「零隐式转换」在二元运算符层
   不下沉。字面量常量折叠可静态判——列为 checker 强化候选（未修，
   留第三轮）。
3. **带守卫自环是合法拓扑**（Vigil 的 Retryable/EvidencePending 即是），
   G-3 只拦无条件环——口径正确，但值得在 guide 写明自环语义。
4. run 缺入口（无 export fn main）→ 干净报错 `入口文件没有 fn main()`
   ✓（早先疑点被 grep 过滤误导，实测推翻）。

## 9. 第二轮实测的元发现

- **emit 校验的"绿灯"不可信**：启发式 balanced 检查放行 rustc 必炸的
  生成物（L-5/L-6 都是）——**生成物合法性需要真机编译闭环**，这是
  Gauntlet"静态声明 vs 运行观测"方法学在工具链自身的镜像。
- **双编译器对拍是漂移放大器**：S-13 的价值一半来自 rustc 拒绝 +
  python/js 放行的三方对照。单一实现永远看不到这个面。
- **指纹类规则必须双端对拍**：G-8 在 dhv 的第一版实现用 Debug 序列化
  （含 span）→ 静默失效。conformance 套件（44 用例）当场暴露。

---

# 第三轮实测（静态类型下沉 · 2026-09-05 · cron 长程任务）

> 本轮由 15 分钟定时任务触发。QA 全绿（120/120 + 44/44 + watchdog GREEN +
> RED 注入实验通过）后主攻 S-14。产出：**四运行时真机对拍证据链（L-8）** +
> S-14 双编译器实现 + 12 个锁定用例。

## 10. 第三轮确认的 bug（L-8）

### 10.1 [L-8 已修复 → S-14] 二元运算符完全无静态类型检查

`let x = "abc" * 3` 的完整行为矩阵（修复前，同一份 HSL 源）：

| 运行时 | 行为 | 严重度 |
|---|---|---|
| HSL interp | 运行期干净报错 | ✓ 正确 |
| emit rust → rustc | **编译期拒绝** | ✓ 拒绝（好消息） |
| emit python → CPython | 打印 `abcabcabc` | **静默语义漂移** |
| emit typescript → bun | 打印 `NaN` | **静默垃圾值（最坏）** |

`true + 1`（js 静默真值化 → 2）、`"abc" > 1`（跨类比较错误结果）、
`1 + 0.5`（S1 零隐式转换在二元层不下沉）同属一类。

**修复：S-14** —— 保守字面量域静态检查：
- 可判对象：lit / 一元负号包裹 / 显式 cast 目标 / **单段 path 查作用域 lit_ty**
  （v2 关键升级：let 声明类型追踪——纯字面量口径拦不住 `let s = "abc"; s * 3`
  的变量中转，h01 样本实录）；
- 规则：算术仅数值同域（+ 允许 str+str）；比较同型；逻辑仅 bool；
- 动态值（调用/方法链/重赋值变量）保守放行——零误报优先。

### 10.2 [元发现] 双端实现顺序敏感性（conformance 第二课）

dhv 首版 `set_lit_ty` 在 `declare_binding` **之前**执行 → 按名查符号表
查无此名 → **静默失效**（dhv-ts 报而 dhv 不报的双端不一致）。与 G-8 的
`{:?}` 含 span 序列化并列成对：「跨编译器同构实现时，**符号表顺序操作与
序列化口径**是最脆的两处」——conformance 套件（现 49 用例）是唯一护栏。

## 11. 第三轮 QA 备忘

- **RED 注入实验**：破坏 n1 的 triage 剧本（decision→escalate）后偏差
  立即检出（committed 0≠1, parked 1≠0）——watchdog GREEN 判据真实可信，
  不是「永远绿灯」的假监控。
- 项目健康度：120/127 测试（第三轮 +7）、49/49 双编译器一致、
  Vigil 15 模块 0 误报、Gauntlet 全流水线 96.3% 不变。

## 12. 第四轮确认的 bug（L-9 / L-10 / L-11）—— 2026-09-05

### 12.1 L-9：i64 域算术溢出的四运行时漂移矩阵（真机对拍）

| 样本 | interp (BigInt) | rust (rustc) | python | js/ts (bun) |
|:---|:---|:---|:---|:---|
| `let x: i64 = i64::MAX; let y = x + 1;` | `9223372036854775808`（静默越域不环绕） | 环绕 `-9223372036854775808`（release）/ panic（debug） | `9223372036854775808`（与 interp 一致） | 字面量读入即舍入到 2^63，再 +1 |
| `let x = 9223372036854775806; let y = x + 5;`（无注解） | `…806` / `…811` 精确 | **check 绿 → rustc 编译拒绝**（裸字面量按 i32 推断：literal out of range） | `…806` / `…811` 精确 | **静默 `…800` / `…800`（值错 3）** |
| `let a: u8 = 250; let b = a + a;` | `500`（越域） | 环绕 `244` | `500` | `500` |

三个正交问题：
1. **注解域算术溢出**：interp 不环绕 vs rust 环绕 → **S-15 静态守门**（双编译器）；
2. **无注解大字面量 rust 投射裸化**（L-9b）：rustc 按 i32 推断必炸 → emit 自动补
   `i64`/`i128` 后缀，rustc 编译零错（真机闭环验证）；
3. **js/ts 大字面量精度静默丢失**（L-9c）：Number 安全域外读入即舍入 → emit 显式
   告警（manifest warnings），BigInt 全量投射因混算 TypeError 不做。

### 12.2 S-15：注解域整型算术的静态溢出检查（双编译器）

- 判定口径（零误报优先）：「两侧静态可折叠整数 + 至少一侧域已知」或
  「let 注解域 + 可折叠算术 init」；折叠用 BigInt（dhv-ts）/ i128 checked（dhv）；
- 覆盖面：`a + 1`（i64::MAX）、`a + a`（u8 250）、`let b: u8 = 250 + 250`（注解
  折叠）、`5 / 0`（静态可证除零）、`x = 300`（赋值域）、`a += 10`（复合赋值域）；
- **i64 语义 spec 化**：interp BigInt 任意精度不环绕 = **参考语义**（python 同构）；
  rust i64 环绕、js Number 精度为**已声明投射差异**；注解域内确定性由 S-15 静态
  保证。写入 HSL-GUIDE 已知限制 #64。

### 12.3 S-14 v3：重赋值类型中转（假阴性闭合）

`let mut x = 3; x = "abc"; let y = x * 2;` —— v2 的 litTy 记录在 let 声明处，
赋值不更新 → litTy 过期为 int → S-14 漏拦（interp 运行期才报）。v3：赋值语句
更新字面量事实（字面量 → 新事实；非字面量 → 清除保守放行；复合赋值 → 折叠
更新 + 域检查）。双端一致。

### 12.4 L-10：dhv parser 超容量字面量静默归零（值损坏 > 溢出）

`let y: i128 = 170141183460469231731687303715884105728;`（i128::MAX+1）：
- dhv：`i128::from_str_radix(...).unwrap_or_else(|_| 0)` → 值 = **0**，还落在
  i128 域内 → S-13 误放行（check 绿）；
- dhv-ts：BigInt 精确 → S-13 报错（check 红）；
- **双端分歧实锤**。修复：parser 记 `overflow` 标志；新规则 **S-16**——表达式
  位置的整数字面量必须 i128 可精确表示（双端一致拒绝；静态域分析以 i128 为
  容量上界）。写入已知限制 #64。

### 12.5 L-11：dhv 带后缀整数字面量一直解析为 0（比 L-10 更普遍的静默损坏）

pest 的 `integer_literal = @{ ... ~ integer_suffix? }` 把后缀一并捕获进文本 →
`i128::from_str_radix("300u8", 10)` 因非法字符 `u` **必失败** → 归零：
**dhv 所有带后缀整数字面量（`250u8`/`100i64`…）的值从来都是 0**。
dhv-ts lexer 剥离后缀无此问题（双端值漂移）。修复：先剥后缀再解析；
**S-13 v2** 新增后缀域字面量校验（`300u8` 报错、`250u8` 合法）。写入已知
限制 #65。

### 12.6 第四轮锁定与回归

- dhv-ts 测试套件 127 → **137 全绿**（+10：S-15 ×6 / S-14 v3 / S-13 后缀 /
  S-16 / 合法族零误报）；
- dhv fixtures +7（S15 ×3 / S14v3 / S16 / S13 后缀 / S15 合法族）→
  run_conformance.sh 49 → **56 全一致**；
- dhv cargo test 5/5；emit 后缀修复真机 rustc 闭环（prec.hsl 编译零错）；
- dsh（10 模块 check 绿 + 端到端 Ok）、nova、backends-demo、smoke 零误伤；
- **Vigil 15 模块 0 error 0 warning**（S-15/S-16/S-14v3 零误报）；
  Gauntlet 全流水线不变（15/15 场景、100% 边覆盖、96.3% 变异杀死率）。

### 12.7 [元发现] 第四课：值损坏 > 溢出 > 漂移（严重度阶梯）

L-11 是第四轮最有说服力的战利品：**不是报错、不是漂移，是静默值损坏**——
`250u8` 的值是 0，且没有任何诊断。它藏在 parser 的 `unwrap_or(0)` 兜底里
两轮都没被发现（第一/二轮的 fuzz 都聚焦 check/interp 语义，没做**双端值级
对拍**）。方法论升级：**conformance 只对拍「过/不过」结论是不够的，值级
对拍（同源程序双端运行输出比对）才能暴露 parse 层损坏**——这正好是
Gauntlet「静态声明 vs 运行观测」方法学在数值内核的镜像：静态检查全绿 ≠
值正确。

## 13. 第五轮：值级对拍自动化（L-11 教训的机器护栏）

### 13.1 动机

第四轮元发现：**conformance 只对拍「过/不过」结论，对 parse 层静默值损坏失明**
—— L-11（dhv 所有带后缀整数字面量解析为 0）存活两轮，check 双端全绿。
手工值级对拍暴露了它；本轮把该手法固化为机器护栏。

### 13.2 机制

- **dhv** 新增 `parse --dump-values`：按文件序 dump 全部整数字面量
  （`int\t<raw>\t<value>[u 后缀]`），AST 全形态遍历（fn/const/enum 判别式/
  graph node-init/edge 守卫/模式位/match 臂/宏 token 树）；
- **runner** `tests/run_value_conformance.ts`：dhv-ts 侧内嵌同序 AST 遍历，
  逐字面量比对「值 + 后缀域标记」；
- **语料** `fixtures/values/` 8 类 54 个字面量：十进制边界（i64::MIN/MAX）、
  进制族（0xFF/0o17/0b1010 + 下划线变体）、后缀族（L-11 锁）、表达式嵌套次序、
  模式位（match 臂/元组解构）、graph 拓扑位（node init/edge 守卫）、
  枚举判别式、浮点-整数判别（浮点不得混入 int dump）；
- **接线** run_conformance.sh 第 4 段（56 → 57：55 结论 + 1 值级块[8 文件]）。

### 13.3 RED 注入实验（护栏真实性实证）

模拟 L-11 复发（parser 恢复「后缀并入解析」旧 bug）→ 编译 → 立即：

```
✗ suffix_family.hsl: 字面量序列不一致
  dhv    (0): （无字面量）
  dhv-ts (7): 250→250 [u u8], 100→100 [u i64], ...
```

恢复修复 → 8/8。**值级对拍对归零/舍入/后缀吞字三类静默损坏全部敏感**。

### 13.4 第五轮回归

- run-all 137/137；conformance 56→**57 全一致（含值级）**；cargo test 5/5；
- dsh/nova/backends-demo/smoke 零误伤；Vigil 15 模块 0 error；
- Gauntlet 全流水线不变（15/15 场景、100% 边覆盖、96.3% 变异杀死率）；
- 已知限制 #66 记录机制与扩展口径（新字面量形态 → 加语料即可）。
