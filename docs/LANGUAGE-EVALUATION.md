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

# 第六轮实测（字符串/浮点值损坏 + cast 域折叠 · 2026-09-05 · cron 长程任务）

## 14. 第六轮确认的 bug（L-12 / L-13 / L-14）

### L-12：dhv unescape_string 的 `\u{...}` 收集越过 `}` 吞字（值损坏·三重形态）

**证据链**（Rust 单元测试直证根因）：

```rust
unescape_string(r"\u{41}bc") == "䆼"   // 期望 "Abc" —— hex 吞成 "41bc" → U+41BC
unescape_string(r"\u{41}x")  == ""      // 整串静默丢失 —— from_str_radix("41x") 失败
unescape_string(r"\u{41}1")  == "Б"     // hex="411" → U+0411 错值
unescape_string(r"\u{110000}") == ""    // 码点越域静默空
```

根因：收集循环 `for c2 in chars.by_ref() { if '{'|'}'=='_' continue; hex.push(c2); ... }`
**不知道在 `}` 处停止** —— 语法层（pest `escape` 规则）与值层（手写 unescape）
双重解析不同步：语法正确 ≠ 值正确。

**三重修复**（纵深防御）：
1. `unescape_string`：遇 `}` break（核心）；无效码点保留 `\u{...}` 原文（不丢内容）
   而非静默空；
2. **pest 码点域收紧**（语法层拒绝越域）：1-5 位 hex 任意；6 位时
   「首位 0 或（首位 1 且第二位 0）」精确表达 ≤ 0x10FFFF ——
   `\u{110000}`/`\u{999999}` 语法层直接报错，`\u{10FFFF}`/`\u{0FFFFF}` 合法；
3. ts 端 `\u` 严格化：去除下划线容忍（`\u{_4_1_}` 双端口径统一为拒绝）+ 显式
   码点上限报错（此前靠 fromCodePoint 的 RangeError 带出）。

### L-13：dhv 带后缀浮点字面量一直静默归零（每条必损坏！）

**值级对拍 float 扩展当场抓获**（第五轮护栏的第一次实战）：

```
float  1f32  7ff8000000000000  f32    ← dump 出 NaN 位模式
```

根因：后缀剥离用 `trim_end_matches(is_alphabetic)` —— `f32` 以数字 `2` 结尾，
**从尾部剥不动** → `parse("1f32")` 必失败 → `unwrap_or(0.0)` 静默归零。
即：**`1f32`/`2.5f64` 等所有带 f 后缀浮点在 dhv 的值此前一直是 0**，
check 双端全绿（check 不查值）。L-11 的完美镜像 —— 但这次不是手工发现的，
是机器护栏抓的：**第五轮的方法论投入在第六轮直接回本**。

修复：精确 `strip_suffix("f32"/"f64")` 剥离；parse 失败改 NaN（位模式可见、
值级对拍可抓）而非归零（L-10/L-11 教训：静默归零是最劣档）。

### L-14：dhv-ts lexer 把 `1f32` 分派为 int token（kind 漂移）

ts lexer 的 isFloat 判定只看 `.` 后有数字 / `e` 指数 —— 后缀路径
`1f32` 不触发 → int token + f32 后缀；而 dhv 的 pest `float_literal`
含 `dec_literal ~ float_suffix` 分支 → Float kind。双端字面量分类漂移
（值恰好都对、kind 不同 → 值级对拍 float 扩展必失配）。

修复：后缀 f32/f64 ⇒ 一律 float。附带：TokenTree（宏 token 树）此前丢弃
int 后缀 → 补齐（`format!("{}", 2u8)` 的宏字面量后缀进对拍口径）。

## 15. 第六轮实现：值级对拍三族扩展 + S-17

### 15.1 float：IEEE754 位模式对拍（16 hex）

字符串格式化双端不可比（Rust `"inf"` vs JS `"Infinity"`；大数指数形态
`"1e21"` vs `"1000000000000000000000"`）—— **位模式是唯一可靠等价判据**：
`f64::to_bits()`（Rust）/ `Float64Array→BigUint64Array`（JS），NaN payload、
符号位、下溢全保真。

### 15.2 string：统一转义 repr

`\\ \" \n \r \t \0` + 控制字符 `\xNN`（两位小写 hex）双端同规则；
raw 列同样转义（防真实 tab 切断 TSV 列）。

### 15.3 宏 token 树口径（本轮对齐实锤）

- 表达式位置宏（let init / match 臂 / 尾表达式）= `Expr::Macro` → dump
  token 树叶子字面量（int/float/string 三族）；
- **带分号语句位置宏** = `macro_invocation_semi` → Item 级 → 双端一致不 dump。
  （ts 端曾把语句宏也当表达式 → 三族扩展后 8 个语料全失配 → 对齐后全绿。）

### 15.4 S-17：cast 域折叠（truncation-aware）

第四轮遗留（`intValOf 不穿 cast`）：

```hsl
let a: u8 = 300 as u8 + 300;   // 环绕折叠 44+300=344 越域 —— 此前漏报，现报 S-15
let a: u8 = 300 as u8 + 200;   // 44+200=244 域内 —— 零误报通过
let b: i8 = 200 as i8 - 300;   // -56-300=-356 越域 —— 报 S-15
```

cast 到整型域 = 显式截断投射（环绕，与 interp castValue / rust `as` 同构，
BigInt/i128 精确实现）；cast 到 float/String/bool/char → 离开整数值域不折叠。
dhv-ts intValOf 与 dhv expr_int_val 双端同构。

### 15.5 语料 8→12 类 + RED 验证

新增：浮点族（1f32/2.5f64/1e10/2.5e-3/0.1/π/下划线）、字符串转义族
（\n/\t/\\/\0/\x41/引号/中文emoji）、unicode 边界族（`\u{41}bc` L-12 锁/
`\u{0}`/`\u{10FFFF}`/`\u{0FFFFF}`）、宏口径族（表达式宏 dump vs 语句宏不 dump）。

**RED 注入**（护栏真实性）：移除 `}` break 模拟 L-12 复发 →
`unicode_edge.hsl` 立即失配（dhv 值变 `\u{41}bc}` 垃圾）→ 恢复后 12/12 GREEN。

## 16. 第六轮元发现（第六课）

1. **「语法正确 ≠ 值正确」**：pest 语法层接受 `\u{41}bc`（escape 规则正确匹配
   `\u{41}`），但手写 unescape 拿原始文本重扫时越过 `}` —— 双重解析是
   值损坏的结构温床（L-12 根因）。**每条「语法层校验过的」路径都需要
   值层的独立对拍**。
2. **护栏的复利**：第五轮建的值级对拍在第六轮 float 扩展的第一天就抓到
   L-13（藏了至少五轮的「每条 f 后缀浮点必归零」）—— **对拍基础设施的
   覆盖面扩展本身就是 bug 发现引擎**（扩展到哪个族，哪个族的陈年损坏
   就会浮出水面）。
3. **kind 漂移是值级对拍的隐藏前提**：L-14（`1f32` int vs float kind）说明
   字面量分类必须在双端一致，否则「值一致」无从谈起 —— 对拍口径
   （kind + value + suffix）三件套缺一不可。
4. **cargo test 的 debug 栈限制**：`error_fixtures_must_fail_with_expected_code`
   深嵌套 fixture 在 debug profile 8MB 栈下溢出（SIGABRT）——
   `RUST_MIN_STACK=33554432` 下正常。CI/脚本需带环境变量（已记入 worklog）。

## 17. 第六轮回归（全部零误伤 + 修复锁定）

- run-all 137→**145 全绿**（+8：L-12×3 / L-13 / L-14 / S-17×3）；
- conformance 57→**61 全一致**（+2 check：S17 合法族 / L12 unicode 合法族；
  +2 errors：S17 越域 / L12 越域）；
- 值级对拍 **12 文件三族全一致**（含 4 新语料）；
- cargo test：lib 5→**9**（L-12 回归组 4 用例）+ conformance 5/5；
- dsh（10 模块）/ nova / backends-demo 双端零误伤；
- Vigil 15 模块 0 error 0 warning；Gauntlet 全流水线不变
  （15/15 场景、100% 边覆盖、96.3% 变异杀死率）；
- 已知限制 #67（三族值级对拍 + L-12/L-13/L-14 全记录）/ #68（S-17）入 HSL-GUIDE。

## 18. 第七轮确认的 bug（L-15 ~ L-21：emit 行为级七连发）

> 战场转移：前六轮深挖**编译器**（parse/check/interp 语义），第七轮把 Gauntlet
> 方法论对准**代码生成器**——emit 的「语法校验绿灯」掩盖的行为层缺陷。
> 一个探针（把 `fn main` 投射到 python/js 并真机运行）引出七连发。

### L-15：活体翻译后端投射 `fn main` 只生成定义、无入口调用（静默空转）

- **形态**：python 生成物 `def main(): ...`（翻译完全正确）但没有任何
  `if __name__ == '__main__'` 守卫；js 生成物 `export function main() {...}`
  同样无人调用。
- **结局**：`python3 main.py` / `bun main.js` 运行「成功」（exit 0）但**零输出
  零副作用** —— 比崩溃更危险（崩溃至少可观测）。emit 报告「N 个文件全部
  通过语法校验」绿灯，对行为为空完全失明。
- **对照**：rust 后端在第四轮 L-6 就修过同款（main→hsl_main + Termination
  wrapper，真机 rustc 实测）；三个「full 活体翻译」后端从未学到这一课。
- **修复**：入口形态（`fn main` 无参）在文件级追加入口守卫——python 用
  `if globals().get('__name__') == '__main__': raise SystemExit(main())`
  （`globals().get` 而非裸 `__name__`：既有语义级测试用 `exec(切片)` 消费
  生成物，exec 命名空间无该键，裸引用会 NameError）；js/ts 用
  `import.meta.url === pathToFileURL(realpathSync(argv[1])).href` 入口判别
  （ESM 无 `__main__` 惯例；被 import 时惰性）。退出码 = main 返回值
  （与 interp run 的进程级语义对齐；注意 interp run 自身恒 exit 0 是
  harness 级退出码，与生成物进程级退出码是两个契约层）。

### L-16：未投射依赖静默漏接（X-5 告警补角）

- `fn main` 引用 `add` 但 `add` 只投射到 python 时，js 的接线逻辑静默跳过
  （`fnLoc.get('javascript')` 无条目）→ 生成物运行期 `ReferenceError: add is
  not defined` 才暴露。诚实协议已有 X-1（类型未投射）/X-2（跨目录），
  函数/常量/变体的「本语言未投射」此前是唯一沉默角落。修复：X-5 告警
  （与 X 系口径对齐：emit 期即暴露，不留运行期惊喜）。

### L-17：python 整除 `//` 是 floor 语义 ≠ interp 截断（-7/2: -4 vs -3）

### L-18：js 整除 `/` 是浮点除（连正数都漂移：7/2 = 3.5 ≠ 3）

- 双修复：三端 prelude 注入 `_dhv_idiv/_dhv_imod/_dhv_div`（python，
  `q<0 and q*b!=a → q+=1` 精确截断）/ `_dhvIdiv/_dhvDiv`（js，
  `Math.trunc`）；body 分派：字面量/类型已知整型 → 截断助手；浮点 → 真除；
  **unknown（参数中转等）→ 运行期类型分流助手**（不再赌类型——此前 unknown
  静默真除，负数必漂移）。python `%` 是 floor 模（-7%2=1）也统一走
  `_dhv_imod`；js `%` 天然截断模 ✓。

### L-19：显示规范三端漂移（bool/浮点/枚举/struct/Vec）

- interp 的 display 是**明确规范**（values.ts：Rust-Debug 风格 + JS
  Number::toString）——python f-string 是另一套（`True`/`3.0`/
  `<level.Low object>`/`Pt(x=1, y=2)`/`[1, 2, 3]`）、js 模板串是第三套
  （`[object Object]`/`1,2,3`）。
- 修复：插值统一经显示层助手（python `_dhv_str` / js-ts `_dhvStr`）+
  投射侧烘焙（python 枚举/struct 类 `__str__`、js/ts struct 工厂
  `toString()`、js 枚举 kind-标签对象在 `_dhvStr` 内渲染）。python
  `_dhv_float_str` 完整复刻 ECMAScript Number::toString（整值浮点
  `3.0→'3'`、1e16..1e21 定点、`1e-07→'1e-7'`、Infinity/NaN 命名）——
  **显示一致性本身需要一个 spec**，这是跨后端生成的隐藏工作量。
- 残留（记录未修）：Option::Some 在生成端是透明值（`Some(5)` 显示为 `5`）
  ——包裹类改造影响全部生成模式，留待后续；emit 不做 check 前置门
  （check 错误的程序仍可投射，见 18 节末尾观察）。

### L-20：js 后端标识符约定连环错配（三连发）

- **L-20a**：structLit 用 `lowerFirst`（`pt(1, 2)`）而导出是大写工厂
  `Pt` → ReferenceError；snake 名（`agent_config`）还有第二重：导出是
  camel（`agentConfig`）→ 双重错配。修复：body 镜像投射侧 camel 约定。
- **L-20b**：js 的类型名 import 引用不存在的导出——枚举名/别名在 js 无
  值导出（`import { Dir } from './dir'` → 模块加载即 SyntaxError）；
  snake struct 的导入名也须镜像 camel。修复：按投射项 kind 过滤/映射。
- **L-20c**：单元变体只有 snakeUpper 导出（`LOW`/`MID` 常量），wiring 却
  import 原名（`Low`）→ SyntaxError。判据：variantOf 双注册（原名+
  snakeUpper），若 snakeUpper 孪生在引用集 → ts/js 跳过原名。

### L-21：整值浮点字面量发射丢失浮点身份（`3.0` → `3`）

- 根因是宿主语言渗漏：TS `String(3.0)` = `'3'` → 生成物把它当整数
  （rust i32 推断、`1.0/2.0 → 1/2` 整除 = 0）。修复：整值补 `.0`；
  显示层由 `_dhv_str` 统一 JS 风格（两层各司其职：**源码层保真类型身份，
  显示层统一显示规范**）。

### 附带观察（记录未修）

- **emit 不做 check 前置门**：S-4 错误（非 mut 赋值）的程序仍可投射——
  生成物 js 是 const 重赋值，`Bun.Transpiler` 会以「Parse error」抛出
  （报错文案误导但判定正确）。check+emit 组合是文档化工作流，门化与否
  是设计取舍，留第八轮。
- `Bun.Transpiler` 把 const 重赋值归类为 parse 错误（非运行期）——
  validator 的「语法✗」有时其实是语义错误，文案层小误导。

## 19. 第七轮实现：行为级对拍护栏（L-11 教训的运行行为层延伸）

第五轮值级对拍锁的是**解析值**；第七轮把同一方法论推进到**运行行为**：

- `tests/run_emit_conformance.ts`：interp run ↔ emit→python3/bun 真实运行，
  `emit::` 标记行（防横幅混入）逐行全等比对；语料自带 project{} 投射矩阵
  （`entry_bigint_py.hsl` 只投 python——js 的 >2^53 舍入是 L-9c **已声明
  投射差异**，不纳入对拍防「已知漂移」污染护栏判据）。
- 语料 6 类：arith（负数除模，参数中转覆盖 unknown 分流）/ values（字面量
  与显示族）/ enum（构造+分派+显示）/ struct（camel 镜像+显示）/ vec
  （集合显示无括号）/ bigint_py（大整数精度，python 单端）。
- **RED 注入实证**：模拟 L-15 复发（守卫失效）→ 8 组立即转红
  （`interp N vs python 0 行`——L-15 特征签名：运行成功但零输出）；
  恢复后 6/6 GREEN。护栏对「行为为空」「值漂移」「运行崩溃」三类缺陷
  全部敏感。
- conformance 第 5 段接线：**61→62**（+1 行为级块，11 个后端真实运行）。

## 20. 第七轮元发现（第七课：绿灯的层级）

1. **绿灯是有层级的**：语法绿灯（bun transpiler/python py_compile）<
   编译绿灯（rustc/javac/go build）< 行为绿灯（真实运行输出对拍）。L-15
   的生成物在前两层全绿、第三层为零——**每升一层绿灯，就消灭一类「合法
   但无行为」的假阳性**。前六轮的结论对拍（check 层）、值级对拍（parse
   层）、本轮行为级对拍（运行层）构成完整阶梯。
2. **静默成功是最危险的失败形态**：崩溃会举手，零输出零副作用的 exit 0
   不会。入口守卫缺失能存活六轮，恰恰因为「没人真正运行过生成物」。
3. **宿主语言渗漏**（L-21 `String(3.0)='3'`）提醒：生成器的每一层
   （parse/check/interp/emit/显示）都在借用宿主语义，每个借用点都是
   漂移候选。显示规范（L-19）证明**连「怎么打印」都需要显式 spec**。

## 21. 第七轮回归（全部零误伤 + 修复锁定）

- run-all 145→**149 全绿**（+4：L-15 守卫行为全等 / L-15 惰性 exec 形态 /
  L-17/L-18 负数除模三端全等 / L-20 js 枚举接线+camel 镜像真机运行）；
- conformance 61→**62 全一致**（+行为级块：6 语料 / 11 后端真实运行）；
- dsh fixture 端到端 Ok / nova 15 模块 / backends-demo 214 文件全绿；
- Vigil 15 模块 0 error 0 warning；Gauntlet 全流水线不变
  （15/15 场景、100% 边覆盖、96.3% 变异杀死率）；
- cargo test 9+5+1 全过（dhv 侧 emit 为 contract 级，不受本轮影响）；
- vendor 同步：dhv-ts 三后端文件 + emit 语料 + runner + conformance 脚本。

---

# 第八轮实测（第二 SUT 泛化实验 · 2026-09-05 · cron 长程任务）

> 本轮不修上游工具链（vendor 零改动），而是用第二份全 HSL SUT（Curator，
> 文档策展管线，8 节点 / 16 边 / 4 守卫环）实测 HSL 的**域泛化表达力**
> 与 Gauntlet 框架的 SUT 无关性。全部细节见 docs/GENERALIZATION.md。

## 22. 第八轮确认的问题（#L-22：native 值模型断层）

Curator 需要把抽取模型输出解析成 `Vec<Entity>`（struct 数组）。探针显示
native 块返回 plain object 数组后**字段读取可用**，于是首版直接返回结构体
数组 —— 运行期在 `entities.clone()` 处崩溃：

```
✗ 运行期错误：foreign 没有方法 "clone"
```

根因：native 返回的 plain object 不带运行时 `__struct` 标记 → 类型名
`foreign` → 字段读取走「foreign 直通」通道可用，但 clone/方法/S 规则全失效。
Vigil 六轮从未踩到，因为其 native 只返回 String/Map/number。

**修复取向**（Curator 侧落地）：native 退回 I/O 搬运（JSON → 拍平字符串
`"kind~value~conf|…"`），HSL 侧 `split_once` 逐字段重建 + `parse::<f64>()`
恢复置信度。N1 纪律（逻辑不进 native）的值模型版本。
**上游登记**：#L-22（native 块缺结构体构造通道 / checker 缺 foreign 返回值
告警）—— 建议提供 `$host.make("Entity", {...})` 类官方通道。

## 23. 第八轮语言层观察

- **首版 check**：15 模块 0 error / 0 warning —— 唯一语法差异是字符串
  字面量**不支持反斜杠续行**（Rust 有），改单行即过。
- **split_once 是 Vec 重建的唯一定式**：无内置 `split()`，循环 +
  `Option<Vec<String>>` 模式匹配（`Some(pair) => pair[0]/pair[1]`）成为
  拍平协议的标准重建写法 —— 可用，但每个解析器重复 12 行，值得 std 化。
- **f64 域在真实域数据上落地**：Entity.confidence 走 `parse::<f64>()` +
  阈值比较（S-14/S-15 链条首次被 SUT 数据面真实使用）。
- **`v[0]` 索引 + let 绑定**是安全写法（直接 `entities[0].clone().kind`
  链式调用未测，保守起见用绑定中转）。

## 24. 第八轮框架层结果（泛化主张成立）

- **框架 SUT 专属代码：0 行**。Vigil 场景/不变式/变异点（原 164 行）迁入
  `subject/vigil/binding.ts` —— 实验顺带发现它们本就是被误分类的 SUT 资产。
- Curator：15/15 场景 / 11/11 不变式 / 100% 边覆盖 / **100% 变异杀死率**
  （26/26）；聚合 2 SUT · 30 场景 · 53 变异体 · 98.1%。
- 顺带修复历史判据缺口：`cli.ts all` 此前不因场景偏差退出非零（RED 注入
  实证 + 修复：偏差/不变式违反/无效变异体 → 退出 1）。
- 不变式陈述过强教训复现：CINV-4 首版「EnrichmentComplete ≤ EntitiesValid」
  被发布返工回环证伪（同一校验过的实体可被多次富集）→ 修正为守恒形式
  「≤ EntitiesValid + PublicationRejected」。与 Vigil INV-3 同类：
  **修复回环是不变式陈述的主要证伪源**。

## 25. 第八轮元发现（第八课：判据出口也是被测对象）

RED 注入在「双 SUT 管线」上转红时，暴露 `all` 模式自初版就不传播场景偏差
到退出码 —— watchdog 的 GREEN 在该组合下可能是假绿。历轮 RED 注入恰好
都走了 runner 异常路径而没踩中。**教训：每新增一个判定出口（新 CLI 模式、
新聚合层、新管线组合），都要重新做 RED 注入** —— 护栏的可靠性不是护栏
的属性，是「护栏 × 出口矩阵」的属性。

---

# 第九轮实测（#L-22 上游修复 + 等价变异静态判定器 · 2026-09-05 · cron 长程任务）

> 本轮把第八轮的两个「登记未修」一次清账：(a) #L-22 native 值模型断层的
> 上游修复（$host.make 构造通道 + S-18 双端预警）；(b) M6-CRITIC 手工
> 等价归因固化为 triage 静态判定器（PAPER §5.3 / 路线图 #3 落地）。

## 26. #L-22 修复：$host.make 构造通道（native 的值模型闭合）

**断层回顾**：native 块返回的 plain object 不带运行时 `__struct` 标记 →
类型名 `foreign` → 字段读取走「foreign 直通」可用，但 `.clone()`/方法
派发/match 模式匹配全失效（Curator 首版实录运行期 panic）。此前唯一出路
是 N1 纪律的值模型版本：native 只拍平字符串（`"kind~value~conf|…"`），
HSL 侧 split_once 逐字段重建 —— Curator 为此付出 ~40 行协议代码 + 值不
得含 `~`/`|` 的协议保留字约束。

**修复形态**（interp.linkProgram 在类型注册表就绪后幂等注入 hostApi）：

```hsl
let es: Vec<Entity> = native typescript {
    const raw = $host.json.parse(payload);
    return raw.entities.map((e) =>
        $host.make("Entity", { kind: e.kind, value: e.value, confidence: e.confidence }));
};
let e0 = es[0].clone();   // ← 此前 panic 位，现在合法
```

- 结构体：字段完备性/多余性校验（与结构体字面量同规则），缺字段/未知
  类型/多余字段全部可观测报错（不静默）
- 命名字段变体：`$host.make("ExtractEvent::EntitiesExtracted", { entities })`
- 元组变体：数组 payload 按位（`$host.make("Carrier::Boxed", [8, 9])`）
- 单元变体：无 payload（`$host.make("Status::Ok")`）
- prelude 族：`Result::Ok/Err`、`Option::Some/None` 显式镜像（不入
  enums 注册表的内建构造器通道 —— $host.make 需同款值形态）

**SUT 侧收益实证**：Curator `parse_extract.hsl` 以 $host.make 重写（嵌套
构造 `Result::Ok[ExtractEvent::EntitiesExtracted{entities}]` 全族直构），
拍平协议与重建定式全删 —— **15/15 场景黄金输出逐字节等价**（行为不变、
代码 -40 行、协议保留字约束消失）。这就是第八轮预言的「上游登记 → 第
九轮修复」闭环。

## 27. S-18：native 值模型断层预警（双端同口径）

静态可判定的断层现场是**同现场 let**：`let <含 struct/enum 族名的注解> =
native <...>` 且 native 体无 `$host.make` → 警告（foreign 值：字段直通
可用，clone/方法/模式派发失效）。

- 只判 let 注解 + 初始化器同现场（fn 返回值经变量中转不判 —— S-14 v3
  的字面量追踪不覆盖运行期值标记，诚实边界）
- String/数值注解的合法拍平协议零触发（Curator write_artifacts 的
  `let x: String = native` 不告警）
- **双端实现踩坑实录**：dhv 端 `structs` 注册表首版只挂在
  `harvest_module`（依赖闭包，**不含根文件**）→ 根文件 struct 查无此名
  静默失效 —— 根因与第四轮 S-14 的 set_lit_ty 顺序坑同构：**收集点的
  覆盖域必须与检查域一致**（修复：collect_item 补 Item::Struct 注册）
- **conformance 第 6 段「预警对等」**：退出码对拍看不见警告是否产出
  （警告不改变结论）—— 本段直接比对双端 S-18 出现性：warn fixture 双端
  必须告警、legal fixture（$host.make 在体）双端必须零告警。dhv 渲染
  `S-S18` / dhv-ts 渲染 `S-18`，各 grep 各的形态（文件名含 S18 的
  假阳性排查实录：`rg -c "S18"` 把「校验通过: …/S18_xxx.hsl」也计入）。

## 28. 等价变异静态判定器（triage.ts —— 第八轮手工归因的机器化）

PAPER §5.3 的手工归因（M6-CRITIC 存活 = 探查计划门结构使阈值边界不可达）
本轮固化为 `gauntlet/triage.ts`：**构造位门分析**（constructor-site gate
analysis）识别「计划门不变式」模式：

证据链六步（每步失败即降级 needs-test，宁可沉默不可谎报）：
1. 变异点 = 同计数器阈值松动（find/replace 谓词差分 —— 复合谓词中排在
   前面的未变谓词会遮蔽真实变异点，covering 负控实录）
2. 计数器 = F 对参数按 kind 字段的循环计数（增量必须位于 kind 分支直接
   体内且路径上无嵌套 for —— 否则嵌套循环计数被误绑，**covering 负控
   实录：v1 松散匹配把 covering += 1（keywords 内层循环）绑到 metrics
   计数 → 误报等价，收紧后正确拒绝**）
3. F 全部调用点位于 match 臂 `Variant{...} =>` 之内（调用被变体门控）
4. Variant 构造位位于计数链 if/else-if 中（`count_kind(绑定名) == i`
   双形态识别 —— 首版只匹配内联调用，M6-CRITIC 实录立即踩空：链条件
   是 `metrics_count == 0` 而 count_kind 在 let 行）
5. 该 kind 块 push 位全局恰 N 处且均在计数链分支内（上界收紧）
6. 调用侧累计向量 Vec::new() 空初始化（起点闭合）

⇒ 不变式：F 每次求值恒有 count == N；判定 truth(N >= K) === truth(N >= K')。

**实测**：M6-CRITIC 自动归因 `equivalent-by-plan-gate`（六步证据链完整，
报告含文件:行级证据）—— **等价归因后有效杀死率 100.0%（原始 96.3% +
结构等价校正 +3.7%）**。负控实验（判定器可靠性）：
- `covering >= 1 → >= 0`（计数真实可变）→ needs-test ✓（不谎报）
- 未门控阈值 / 乘法上限（`max_drift * 2 → * 1`）→ unknown-pattern ✓
- `metrics_total >= 2 → >= 0` → equivalent ✓（count==2 下同真，数学正确）

**诚实边界**：判定器 v1 只认识计划门不变式一种模式；Curator（100% 杀死
率）无存活体可归因。第三模式（如 fan-in 汇聚计数）为后续扩展位。

## 29. 第九轮框架层与回归

- 上游：dhv-ts 测试 149→158（+9：$host.make 五形态 + S-18 触发/零误报）；
  conformance 62→66（+2 fixtures + S-18 预警对等 ×2）；dhv cargo 15/15；
  dsh/nova/backends-demo 零误伤；Vigil 0 error 0 warning
- Gauntlet：双 SUT 全流水线不变（30/30 场景 · 100%+100% 边覆盖 ·
  53 变异体 98.1%）；report.md 新增「结构性等价变异」分节（证据链渲染）
- Curator 简化（$host.make 直构版）黄金等价 = 泛化文档新增 delta 项

## 30. 第九轮元发现（第九课：判定器本身也要负控）

triage v1 的两次翻车都在负控实验里当场暴露：谓词差分缺失（复合谓词遮蔽
真变异点）→ 误报「covering 等价」；计数形态松散（嵌套 for 计数误绑
kind）→ 同样误报。**教训：任何「自动判等价」的判定器，其误报风险与
等价声明本身同级 —— 判定器交付必须携带负控样本集（真实可变计数 /
未门控谓词 / 模式外形态），且负控优先于正控写进用例**。这与第八课
（判据出口也是被测对象）同构：归因结论也是一种判据出口。

---

# 第十轮（SUT #3 Gatemaster —— 第三域泛化 + #L-23 空臂发射）

## 31. #L-23：空臂发射（empty-arm emission）—— 边事件的语义定性

**实测实录**：Gatemaster 黄金校准期，gf9（会话死线场景）出现不变式违反
`GINV-9: abandoned cases(1) != LadderExhausted+DeadlineAlarm edges(2)`。
排查发现修复环顶部的穷尽 match 里，`BudgetSignal::DeadlineAlarm => {}`
**空臂照样发射了 `budget -> ledger on DeadlineAlarm` 边事件** —— 该臂
体内没有任何向 ledger 的转移动作，事件却按声明边的名义发射了。

**语义定性**：HSL 的边事件（`interp.traceEdgeFire`）语义是
**「match 臂执行记录」而非「节点转移记录」**：

```
声明边 A -> B on V 的发射条件 = 某 match 命中变体 V 的臂被执行
                                  （与臂体是否真的向 B 转移无关）
```

**这不是 bug 而是设计属性**，但它对上层度量有三个直接推论：
1. **边覆盖度量的是「守卫可观测性」**：edge coverage = 100% 证明每条
   声明边的守卫都能被某条执行路径观测到 —— 但不证明「转移语义真发生了」。
2. **计数型守恒不变式必须按臂执行计数（含空臂）**：GINV-9 最初按
   「转移语义」陈述（abandoned == 放弃边数），在空臂发射下立即翻车；
   修正为「臂执行计数」口径后成立。不变式作者的直觉默认是转移语义，
   与事件总线的实际语义之间存在**默认错配** —— 这是可观测性纪律的
   又一个 G 规则候选（G-9：计数型不变式应声明计数口径）。
3. **空臂发射是可利用的**：把「案中死线」从空臂改造为有语义的动作臂
   （放弃当前构建收束）后，发射与语义重新对齐 —— 反向证明该现象的可
   观测面价值：它能暴露「声明了边但没做转移」的语义空洞。

**修复取向（SUT 侧）**：所有挂边变体的 match 臂要么执行与边目标一致
的转移，要么不写空臂（改用 if 守卫 + 单臂 match）。上游建议登记为
HSL-GUIDE #L-23（语义定性，非缺陷）。

## 32. 第十轮语言实测清单

- Gatemaster SUT 本体 15 模块 ~1050 行：**首版 check 即 0 error / 0
  warning** —— 第三域零语法摩擦（第八轮曾踩 1 处字符串续行差异、
  第九轮曾踩 #L-22 值模型断层；$host.make 直构通道 + S-18 预警在
  第三域直接零踩坑，语言修复的反哺度量 +1）
- 文法覆盖增量：第二 mut 节点声明（budget）/ 双漂移自环 / mode 字符串
  状态机（fix|rerun 分支重验）/ 阶梯 level 本地推进 / 三层嵌套 match
  （verify → escalate → 内联重验）
- 拓扑 Lint：G-7/G-8 三 SUT 全过（19 条新边全部可观测 + 守卫全局唯一）

## 33. 第十轮框架层与回归

- Gauntlet 三 SUT 管线：47/47 场景 · 33/33 不变式 · 100%+100%+100%
  边覆盖 · 82 变异体 98.8% 聚合杀死率（gatemaster 100% = 29/29）
- 框架改动 **0 行**（subject.ts 注册 +1 行；watchdog 超时 300s→480s
  为基础设施调优，非框架语义）
- run-all.sh：check 清单 +1 行（gatemaster.hsl）

## 34. 第十轮元发现（第十课：不变式的口径要与事件总线对齐）

GINV-1/2/6/9 四条不变式在校准期被 SUT 的真实行为证伪后逐条修正 ——
**证伪源全部是「陈述口径」而非「SUT 违规」**：聚合死线案例的守恒口径
（排除 (batch)）/ 放弃根因的前驱集口径（AttemptsExhausted ∨
LogTruncated）/ 空臂发射的计数口径。与第八轮 INV-3/CINV-4 的教训合并：
**不变式初稿的默认口径往往比事件总线的实际语义强 —— 修复回环与预算
收束是不变式证伪的两大高发区，而「口径证伪」（修正陈述）与「违规证伪」
（SUT 有 bug）必须显式分账，前者是不变式目录的进化，后者是 harness
的缺陷**。分账记录本身成为论文不变式章节的方法论素材。
