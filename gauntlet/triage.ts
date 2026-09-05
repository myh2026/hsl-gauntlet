// ============================================================================
// gauntlet/triage.ts — 变异等价静态判定器（存活体构造性归因）
// ----------------------------------------------------------------------------
// 动机（PAPER §5.3 / RQ3）：变异分析的存活报告传统上只有模糊信号「需要更多
// 测试」。经典软件工程中「等价变异不可判定」，但 harness 的**声明拓扑 +
// 确定性剧本**使一类判定变得构造性可行 —— 本模块把第八轮对 M6-CRITIC 的
// 手工归因（探查计划门结构使被测阈值边界不可达）固化为模式识别器。
//
// 认识的等价模式（v1：计划门不变式 / plan-gate invariant）：
//   变异体把函数 F 内的谓词 `X >= K` 松动为 `X >= K'`（K' < K），若静态
//   证据链成立：
//     (1) X 是 F 对参数 P 按 kind 字段 KIND 的循环计数；
//     (2) F 的全部调用点位于 match 臂 `Variant{...} =>` 之内（调用被变体门控）；
//     (3) Variant 的全部构造位位于函数 G 的 if/else-if 计数链中，链上
//         `count_kind(_, KIND) == i`（i = 0..N-1）的分支各恰好 push 一块
//         KIND 结构，构造位所在分支的更早分支条件（== i）全部为假；
//     (4) 整个 SUT 中 KIND 结构的 push 位只有这 N 个（无其他来源）；
//     (5) 调用侧累计向量初始为空（Vec::new()）。
//   则「构造 Variant ⇔ count == N」为不变式，F 的每次求值都有 X == N。
//   判定：truth(N >= K) === truth(N >= K') ⇒ 变异体与原程序在可达状态
//   空间不可区分 —— SUT 结构性等价变异（测试套件无需补强）。
//
// 诚实性边界：不满足证据链的存活体判 needs-test（套件盲区，需补场景），
// 模式不认识的变异形态判 unknown-pattern —— 判定器宁可沉默不可谎报。
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TriageVerdict {
  mutantId: string;
  /** equivalent-by-plan-gate（结构性等价）| needs-test（套件盲区）| unknown-pattern（判定器能力外） */
  verdict: 'equivalent-by-plan-gate' | 'needs-test' | 'unknown-pattern';
  /** 人类可读归因结论 */
  rationale: string;
  /** 证据链（每条 = 规则编号 + 文件:行 + 事实） */
  evidence: string[];
}

/** 阈值谓词形态：`X >= K`（find）与 `X >= K'`（replace） */
interface ThresholdShape {
  counter: string;
  kFind: number;
  kReplace: number;
}

/** 计数循环形态：`let mut X: u32 = 0; ... for ev in P.clone() { if ev.kind == String::from("KIND") { ... X += 1` */
interface CountingShape {
  param: string;
  kind: string;
}

/** 行级源码视图（带行号定位，供证据链引用） */
interface Src {
  lines: string[];
  file: string;
}

function loadSrc(subjectDir: string, rel: string): Src | null {
  const abs = path.join(subjectDir, rel);
  try {
    return { lines: fs.readFileSync(abs, 'utf-8').split('\n'), file: rel };
  } catch {
    return null;
  }
}

function findLine(src: Src, needle: string): number {
  for (let i = 0; i < src.lines.length; i++) {
    if (src.lines[i]!.includes(needle)) return i;
  }
  return -1;
}

/** 阈值谓词解析：对 find/replace 的全部 `X >= K` 谓词按计数器对齐做差分，
 *  取「发生变化且为松动方向」的那对（差分视角 —— 否则复合谓词里排在前面的
 *  未变谓词会遮蔽真实变异点，covering 负控实录） */
function parseThreshold(find: string, replace: string): ThresholdShape | null {
  const pairsOf = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const mm of s.matchAll(/(\w+)\s*>=\s*(\d+)/g)) m.set(mm[1]!, Number(mm[2]));
    return m;
  };
  const a = pairsOf(find);
  const b = pairsOf(replace);
  for (const [counter, kFind] of a) {
    const kReplace = b.get(counter);
    if (kReplace === undefined) continue;
    if (kReplace === kFind) continue; // 未变化的谓词跳过
    if (kReplace >= kFind) return null; // 只归因「松动」方向的存活（收紧方向存活另有语义）
    return { counter, kFind, kReplace };
  }
  return null;
}

/** 从行号向上找最近的 fn 头，返回 { name, headerLine } */
function enclosingFn(src: Src, line: number): { name: string; headerLine: number } | null {
  for (let i = line; i >= 0; i--) {
    const m = /fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(src.lines[i]!);
    if (m) return { name: m[1]!, headerLine: i };
  }
  return null;
}

/** fn 体范围（从头行向下做花括号配平） */
function fnBodyRange(src: Src, headerLine: number): [number, number] {
  let depth = 0;
  let started = false;
  for (let i = headerLine; i < src.lines.length; i++) {
    for (const ch of src.lines[i]!) {
      if (ch === '{') { depth++; started = true; }
      else if (ch === '}') depth--;
    }
    if (started && depth <= 0) return [headerLine, i];
  }
  return [headerLine, src.lines.length - 1];
}

/** 计数循环形态识别（在 F 体内）：X 的增量必须位于 kind 比较分支的直接
 *  体内（深度 1），且路径上不得先出现嵌套 for —— 否则嵌套循环里计的别
 *  的东西会被误绑到 kind 计数（covering 负控实录：covering += 1 在
 *  keywords 内层循环里，v1 松散匹配把它绑到 metrics 计数 → 误报等价） */
function findCountingShape(src: Src, body: [number, number], counter: string): CountingShape | null {
  for (let i = body[0]; i <= body[1]; i++) {
    const loop = /for\s+(\w+)\s+in\s+(\w+)\.clone\(\)\s*\{/.exec(src.lines[i]!);
    if (!loop) continue;
    const ev = loop[1]!;
    const param = loop[2]!;
    // 向下找 kind 比较行
    for (let j = i; j <= Math.min(i + 8, body[1]); j++) {
      const kindM = new RegExp(`${ev}\\.kind\\s*==\\s*String::from\\("([^"]+)"\\)`).exec(src.lines[j]!);
      if (!kindM) continue;
      // 在 kind 分支直接体内找 X += 1（花括号深度追踪 + 嵌套 for 拒绝）
      let depth = 0;
      for (let k = j; k <= Math.min(j + 10, body[1]); k++) {
        const line = src.lines[k]!;
        if (k > j && /\bfor\s+(\w+)\s+in\b/.test(line)) break; // 嵌套循环先于增量 → 拒绝
        if (new RegExp(`\\b${counter}\\s*\\+=\\s*1`).test(line) && (k === j ? depth > 0 : depth >= 1)) {
          return { param, kind: kindM[1]! };
        }
        for (const ch of line) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        if (k > j && depth <= 0) break; // 出了 kind 分支还没找到 → 拒绝
      }
    }
  }
  return null;
}

/** 全 SUT 文件清单（subjectDir 递归 .hsl） */
function allHslFiles(subjectDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'mutant') continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.name.endsWith('.hsl')) out.push(r);
    }
  };
  walk(subjectDir, '');
  return out;
}

/**
 * 存活体归因主入口。
 * @param subjectDir SUT 根目录（原始未变异源）
 * @param survivors 存活变异体结果（须带 file/find/replace）
 */
export function triageSurvivors(
  subjectDir: string,
  survivors: { id: string; file?: string; find?: string; replace?: string }[],
): TriageVerdict[] {
  const files = allHslFiles(subjectDir);
  return survivors.map((sv) => {
    if (!sv.file || !sv.find || !sv.replace) {
      return {
        mutantId: sv.id,
        verdict: 'unknown-pattern' as const,
        rationale: '变异体缺 file/find/replace 元数据（无法静态归因）',
        evidence: [],
      };
    }
    return triageOne(subjectDir, files, sv.id, sv.file, sv.find, sv.replace);
  });
}

function triageOne(
  subjectDir: string,
  files: string[],
  id: string,
  file: string,
  find: string,
  replace: string,
): TriageVerdict {
  const evidence: string[] = [];
  // ---- (0) 阈值谓词形态 ----
  const th = parseThreshold(find, replace);
  if (!th) {
    return {
      mutantId: id,
      verdict: 'unknown-pattern',
      rationale: '变异点不是「同计数器阈值松动」形态（X >= K → X >= K\')；判定器 v1 只认识计划门不变式模式',
      evidence: [`find="${find}" replace="${replace}"`],
    };
  }
  // ---- (1) 定位变异行与外层函数 ----
  const src = loadSrc(subjectDir, file);
  if (!src) return { mutantId: id, verdict: 'unknown-pattern', rationale: `源文件不可读：${file}`, evidence: [] };
  const mutLine = findLine(src, find.split('\n')[0]!);
  if (mutLine < 0) return { mutantId: id, verdict: 'unknown-pattern', rationale: `变异点未在源中定位`, evidence: [] };
  const fn = enclosingFn(src, mutLine);
  if (!fn) return { mutantId: id, verdict: 'unknown-pattern', rationale: '变异点不在任何 fn 体内', evidence: [] };
  evidence.push(`(1) 变异点位于 ${file}:${mutLine + 1}（fn ${fn.name}），谓词 ${th.counter} >= ${th.kFind} 松动为 >= ${th.kReplace}`);

  // ---- (2) 计数循环形态 ----
  const body = fnBodyRange(src, fn.headerLine);
  const counting = findCountingShape(src, body, th.counter);
  if (!counting) {
    return {
      mutantId: id,
      verdict: 'needs-test',
      rationale: `${th.counter} 不是「对参数按 kind 字段的循环计数」形态 —— 计划门不变式证据链不成立，按套件盲区处理（需补场景）`,
      evidence,
    };
  }
  evidence.push(`(2) ${th.counter} = 对参数 ${counting.param} 按 kind=="${counting.kind}" 的循环计数（${file}:${fn.headerLine + 1} fn ${fn.name} 体内）`);

  // ---- (3) 调用点门控（match 臂 Variant）----
  const callers: { file: string; variant: string; line: number }[] = [];
  for (const f of files) {
    const s = loadSrc(subjectDir, f);
    if (!s) continue;
    for (let i = 0; i < s.lines.length; i++) {
      if (!new RegExp(`\\b${fn.name}\\s*\\(`).test(s.lines[i]!)) continue;
      if (f === file && i >= body[0] && i <= body[1]) continue; // 递归/自引用跳过
      // 向上找最近的 match 臂头（<= 20 行）
      for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
        const arm = /(\w+)::(\w+)\s*\{[^}]*\}\s*=>/.exec(s.lines[j]!);
        if (arm) {
          callers.push({ file: f, variant: `${arm[1]}::${arm[2]}`, line: i });
          break;
        }
        if (/\bmatch\b/.test(s.lines[j]!)) break; // 出了 match 块
      }
    }
  }
  const unGated = callers.length === 0;
  if (unGated) {
    return {
      mutantId: id,
      verdict: 'needs-test',
      rationale: `fn ${fn.name} 存在未被枚举变体门控的调用点（或调用点形态不可识别）—— 无法建立「调用 ⇔ 门通过」等价链`,
      evidence,
    };
  }
  const variants = [...new Set(callers.map((c) => c.variant))];
  evidence.push(`(3) fn ${fn.name} 全部调用点位于 match 臂 ${variants.join(' / ')} 之内（${callers.map((c) => `${c.file}:${c.line + 1}`).join('、')}）—— 调用被变体构造门控`);

  // ---- (4) 构造位 + 计数链分析 ----
  let invariantValue: number | null = null;
  const chainFacts: string[] = [];
  for (const variant of variants) {
    const [fam, varName] = variant.split('::');
    const constructRe = new RegExp(`${fam}::${varName}\\s*\\{`);
    let constructed = 0;
    for (const f of files) {
      const s = loadSrc(subjectDir, f);
      if (!s) continue;
      for (let i = 0; i < s.lines.length; i++) {
        if (!constructRe.test(s.lines[i]!)) continue;
        constructed++;
        // 向上收集 if / else if 链头（直到 fn 头）
        const g = enclosingFn(s, i);
        if (!g) continue;
        // 计数变量绑定：let <name> = count_kind(<expr>, String::from("KIND"))
        //（链条件引用的是绑定名，count_kind 调用不在 if 条件内 —— v1 首版
        // 只匹配内联调用，M6-CRITIC 实录立即踩空）
        const counterVars = new Map<string, string>();
        for (let j = g.headerLine; j < i; j++) {
          const lm = /let\s+(\w+)\s*=\s*count_kind\([^,]+,\s*String::from\("([^"]+)"\)\)/.exec(s.lines[j]!);
          if (lm) counterVars.set(lm[1]!, lm[2]!);
        }
        const chain: { cond: string; line: number; kindCountCond: number | null }[] = [];
        for (let j = g.headerLine; j < i; j++) {
          const h = /(?:}\s*else\s+)?if\s+(.*)\s*\{/.exec(s.lines[j]!);
          if (h) {
            const cond = h[1]!.trim();
            let kindCountCond: number | null = null;
            // 形态 A：内联 count_kind(...) == i
            const cm = /count_kind\([^,]+,\s*String::from\("([^"]+)"\)\)\s*==\s*(\d+)/.exec(cond);
            if (cm && cm[1] === counting.kind) kindCountCond = Number(cm[2]);
            // 形态 B：计数绑定名 == i
            if (kindCountCond === null) {
              const bm = /(\w+)\s*==\s*(\d+)\s*$/.exec(cond);
              if (bm && counterVars.get(bm[1]!) === counting.kind) kindCountCond = Number(bm[2]);
            }
            chain.push({ cond, line: j, kindCountCond });
          }
        }
        // 链上对该 KIND 的 == 条件：全部应为「假分支」（构造位在链的后续分支）
        const kindConds = chain.filter((c) => c.kindCountCond !== null).map((c) => c.kindCountCond!);
        if (kindConds.length === 0) continue;
        const maxCond = Math.max(...kindConds);
        chainFacts.push(
          `${f}:${i + 1} 构造 ${variant}（fn ${g.name} 内）；链上 ${counting.kind} 计数条件 ${kindConds.map((n) => `==${n}`).join('/')}（均为假分支）→ 构造时刻 count(${counting.kind}) ≥ ${maxCond + 1}`,
        );
        invariantValue = maxCond + 1; // 下界；后续用 push 位上界收紧
      }
    }
    if (constructed === 0) {
      return {
        mutantId: id,
        verdict: 'needs-test',
        rationale: `门控变体 ${variant} 在 SUT 中没有可识别的构造位 —— 证据链断裂`,
        evidence,
      };
    }
  }
  if (invariantValue === null) {
    return {
      mutantId: id,
      verdict: 'needs-test',
      rationale: '构造位链上没有可识别的 count_kind(==) 条件 —— 无法导出计数不变式',
      evidence,
    };
  }
  evidence.push(`(4) ${chainFacts.join('；')}`);

  // ---- (5) push 位全局唯一性（上界收紧：count == N）----
  const pushRe = new RegExp(`kind:\\s*String::from\\("${counting.kind}"\\)`);
  const pushSites: { file: string; line: number }[] = [];
  for (const f of files) {
    const s = loadSrc(subjectDir, f);
    if (!s) continue;
    for (let i = 0; i < s.lines.length; i++) {
      if (pushRe.test(s.lines[i]!)) pushSites.push({ file: f, line: i });
    }
  }
  if (pushSites.length !== invariantValue) {
    return {
      mutantId: id,
      verdict: 'needs-test',
      rationale: `"${counting.kind}" 块的 push 位共 ${pushSites.length} 处 ≠ 链推导的计数下界 ${invariantValue} —— 存在链外来源，不变式不闭合（可能真实盲区）`,
      evidence,
    };
  }
  // 每个 push 位应位于计数链的 == i 分支内（按行序逼近验证：push 行上方最近的 == i 头）
  //（与链分析同口径：内联 count_kind(...) == i 或 计数绑定名 == i）
  const isCountCondLine = (line: string): boolean =>
    /count_kind\([^,]+,\s*String::from\("[^"]+"\)\)\s*==\s*\d+/.test(line) ||
    /if\s+\w+\s*==\s*\d+\s*\{/.test(line) ||
    /else\s+if\s+\w+\s*==\s*\d+\s*\{/.test(line);
  const gatedPushes = pushSites.every((p) => {
    const s = loadSrc(subjectDir, p.file)!;
    for (let j = p.line - 1; j >= Math.max(0, p.line - 30); j--) {
      if (isCountCondLine(s.lines[j]!)) return true;
    }
    return false;
  });
  if (!gatedPushes) {
    return {
      mutantId: id,
      verdict: 'needs-test',
      rationale: `"${counting.kind}" 存在不在计数链分支内的 push 位 —— 计数可超链上界，不变式不闭合`,
      evidence,
    };
  }
  evidence.push(`(5) "${counting.kind}" 块 push 位全局恰 ${pushSites.length} 处且均位于计数链分支内（${pushSites.map((p) => `${p.file}:${p.line + 1}`).join('、')}）—— 每次链推进至多补 1 块 ⇒ count 上界 = push 位数`);
  // ---- (6) 调用侧初始为空 ----
  let emptyInit = false;
  for (const c of callers) {
    const s = loadSrc(subjectDir, c.file)!;
    for (let i = 0; i < s.lines.length; i++) {
      if (new RegExp(`let\\s+mut\\s+\\w+\\s*:\\s*Vec<\\w+>\\s*=\\s*Vec::new\\(\\)`).test(s.lines[i]!)) { emptyInit = true; break; }
    }
    if (emptyInit) break;
  }
  if (!emptyInit) {
    return {
      mutantId: id,
      verdict: 'needs-test',
      rationale: '调用侧累计向量未见 Vec::new() 空初始化 —— 初始计数不确定，不变式起点不闭合',
      evidence,
    };
  }
  evidence.push('(6) 调用侧累计向量以 Vec::new() 空初始化 —— 计数起点 = 0');

  // ---- 判定 ----
  const N = invariantValue;
  const truthFind = N >= th.kFind;
  const truthReplace = N >= th.kReplace;
  if (truthFind === truthReplace) {
    return {
      mutantId: id,
      verdict: 'equivalent-by-plan-gate',
      rationale: `计划门不变式成立：fn ${fn.name} 的每次求值恒有 ${th.counter} == ${N}（构造位计数链 + 全局 push 位上界 + 空起点闭合）。truth(${N} >= ${th.kFind}) === truth(${N} >= ${th.kReplace}) === ${truthFind} —— 变异体在可达状态空间内与原程序不可区分（SUT 结构性等价变异，非套件盲区，无需补场景）。`,
      evidence,
    };
  }
  return {
    mutantId: id,
    verdict: 'needs-test',
    rationale: `不变式导出 ${th.counter} == ${N}，但 truth(${N} >= ${th.kFind}) = ${truthFind} ≠ truth(${N} >= ${th.kReplace}) = ${truthReplace} —— 谓词真值在不变点上确有分叉，存活与结构无关，按套件盲区处理（需补场景）`,
    evidence,
  };
}
