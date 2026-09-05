// ============================================================================
// gauntlet/lint.ts — 拓扑级 lint：G-7 / G-8 / G-9 三条可观测性纪律
// ----------------------------------------------------------------------------
// G-7（可观测性）：每条边的 Guard 变体必须出现在某个 match 臂的模式中
//   —— 否则该边在事件总线上结构性不可观测（dsh 的 executor->model on
//   Event::Observed 实录盲区，本框架的立项动机）。
// G-8（唯一守卫）：同一 graph 内 Guard 变体不得被多条边共用
//   —— interp.traceEdgeFire 按变体名匹配 match 臂与 edge 声明，重名守卫
//   会同时发射所有匹配边（边发射别名），使 edge 覆盖率不可判定。
// G-9（空臂发射，第十轮 #L-23）：挂边守卫变体的 match 臂若体为空，该臂
//   执行时边事件仍会发射 —— 事件「可观测但无转移语义」。判定为
//   scrutinee 定向（避免把穷尽性填充臂误报为违规）：
//   - 静态可达变体集可解析（构造器直绑 / 被调函数体内构造集）且臂变体
//     ∉ 可达集 → 穷尽性填充（不可达），不报；
//   - 臂变体 ∈ 可达集 → error（#L-23 原始形态：空臂真执行）；
//   - 可达集不可判定 → warning（保守提示，宁报不漏）。
// ============================================================================

import * as path from 'node:path';
import { loadProgram } from '../vendor/dhv-ts/src/linker';
import * as A from '../vendor/dhv-ts/src/ast';
import type { TopoGraph } from './types';

export interface LintDiagnostic {
  rule: 'G-7' | 'G-8' | 'G-9';
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
}

/** 深度遍历任意 AST 值，收集所有 match 臂模式中的 path 变体名 */
function collectMatchedVariants(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 400 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const x of node) collectMatchedVariants(x, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.kind === 'match' && Array.isArray(o.arms)) {
    for (const arm of o.arms as Record<string, unknown>[]) {
      collectPatternVariants(arm.pattern, out);
    }
  }
  for (const v of Object.values(o)) collectMatchedVariants(v, out, depth + 1);
}

/** 模式树内的变体名（path 两段路径 = 枚举变体；struct 模式自带 segs = 带负载变体） */
function collectPatternVariants(pat: unknown, out: Set<string>, depth = 0): void {
  if (depth > 100 || pat === null || pat === undefined) return;
  if (Array.isArray(pat)) {
    for (const x of pat) collectPatternVariants(x, out, depth + 1);
    return;
  }
  if (typeof pat !== 'object') return;
  const o = pat as Record<string, unknown>;
  if ((o.kind === 'path' || o.kind === 'struct') && Array.isArray(o.segs) && (o.segs as string[]).length >= 1) {
    const segs = o.segs as string[];
    out.add(segs[segs.length - 1]!);
  }
  for (const v of Object.values(o)) collectPatternVariants(v, out, depth + 1);
}

// ---------------------------------------------------------------------------
// G-9 辅助：空臂判定 / 构造位变体收集 / fn 名 → 体内构造集 / scrutinee 定向
// ---------------------------------------------------------------------------

/** 臂体是否为空（无语句 block / 全空语句 / unit 字面量） */
function armBodyIsEmpty(body: unknown): boolean {
  if (body === null || body === undefined || typeof body !== 'object') return false;
  const o = body as Record<string, unknown>;
  if (o.kind === 'unit') return true;
  if (o.kind === 'block' && Array.isArray(o.stmts)) {
    return (o.stmts as Record<string, unknown>[]).every((s) => s.kind === 'empty');
  }
  return false;
}

/**
 * 收集表达式树中「构造位」的变体名（表达式位 struct 字面量 / call(path) /
 * 两段 path）。跳过 pattern / pat 键 —— 模式位的同名形态是匹配不是构造。
 * 非变体构造（Vec::new / String::from / 结构体字面量）也会被收进集合，
 * 但它们不会是边守卫名，对本判据无影响。
 */
function collectConstructedVariants(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 400 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const x of node) collectConstructedVariants(x, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.kind === 'struct' && Array.isArray(o.segs) && (o.segs as string[]).length >= 1) {
    const segs = o.segs as string[];
    out.add(segs[segs.length - 1]!);
  }
  if (o.kind === 'path' && Array.isArray(o.segs) && (o.segs as string[]).length === 2) {
    out.add((o.segs as string[])[1]!); // Enum::UnitVariant（表达式位两段 path = 单元变体构造）
  }
  if (o.kind === 'call' && (o.callee as Record<string, unknown> | undefined)?.kind === 'path') {
    const segs = (o.callee as { segs?: string[] }).segs ?? [];
    if (segs.length >= 1) out.add(segs[segs.length - 1]!); // Enum::TupleVariant(args)
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'pattern' || k === 'pat') continue;
    collectConstructedVariants(v, out, depth + 1);
  }
}

interface LetBinding {
  name: string;
  init: A.Expr;
  line: number;
}

/** 深度遍历收集全部 let 绑定（标识符模式 + 初始化表达式 + 行号） */
function collectLetBindings(node: unknown, out: LetBinding[], depth = 0): void {
  if (depth > 400 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const x of node) collectLetBindings(x, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.kind === 'let' && o.pat && o.init) {
    const pat = o.pat as Record<string, unknown>;
    if (pat.kind === 'binding' && typeof pat.name === 'string') {
      out.push({ name: pat.name, init: o.init as A.Expr, line: (o.span as A.Span | undefined)?.line ?? 0 });
    }
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'pattern' || k === 'pat') continue;
    collectLetBindings(v, out, depth + 1);
  }
}

/** fn 名 → 体内构造位变体并集（全程序；trait 声明无体跳过；同名并集保守）。
 *  构造位三源：AST 表达式位 + native 块内 $host.make("...", ...) 正则扫描
 *  （第九轮直构纪律后模型输出解析全部走 $host.make —— 不扫 native 会漏整类构造）。 */
function buildFnVariantMap(program: { files: Map<string, { items: A.Item[] }> }): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const addFn = (fn: A.FnDef): void => {
    if (!fn.body) return;
    const set = map.get(fn.name) ?? new Set<string>();
    collectConstructedVariants(fn.body, set);
    scanNativeMakes(fn.body, set);
    map.set(fn.name, set);
  };
  for (const [, ast] of program.files) {
    for (const item of ast.items) {
      if (item.kind === 'fn') addFn(item.fn);
      else if (item.kind === 'impl') for (const m of item.methods) addFn(m);
    }
  }
  return map;
}

/** fn 名 → Result::Ok 载荷变体集（「Ok(e) => e」臂的载荷流解析用） */
function buildFnOkPayloadMap(program: { files: Map<string, { items: A.Item[] }> }): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const addFn = (fn: A.FnDef): void => {
    if (!fn.body) return;
    const set = map.get(fn.name) ?? new Set<string>();
    // AST 位：call Result::Ok(ctor, ...) —— 首参构造器
    scanOkPayloadAst(fn.body, set);
    // native 位：$host.make("Result::Ok", [ $host.make("V", ...) ...
    scanNativeOkPayload(fn.body, set);
    map.set(fn.name, set);
  };
  for (const [, ast] of program.files) {
    for (const item of ast.items) {
      if (item.kind === 'fn') addFn(item.fn);
      else if (item.kind === 'impl') for (const m of item.methods) addFn(m);
    }
  }
  return map;
}

/** 深度遍历找 native 块，正则提取 $host.make("Name", ...) 的末段变体名 */
function scanNativeMakes(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 400 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const x of node) scanNativeMakes(x, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.kind === 'native' && typeof o.body === 'string') {
    for (const m of (o.body as string).matchAll(/\$host\.make\(\s*["']([^"']+)["']/g)) {
      const name = m[1]!.split('::').pop()!;
      out.add(name);
    }
  }
  for (const v of Object.values(o)) scanNativeMakes(v, out, depth + 1);
}

/** AST 位 Ok 载荷：call Result::Ok(<ctor>, ...) 首参的构造器变体名 */
function scanOkPayloadAst(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 400 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const x of node) scanOkPayloadAst(x, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.kind === 'call' && (o.callee as Record<string, unknown> | undefined)?.kind === 'path') {
    const segs = ((o.callee as { segs?: string[] }).segs ?? []);
    const last = segs[segs.length - 1] ?? '';
    if (last === 'Ok' && Array.isArray(o.args) && (o.args as unknown[]).length >= 1) {
      const v = constructorVariantOf((o.args as A.Expr[])[0]!);
      if (v) out.add(v);
    }
  }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'pattern' || k === 'pat') continue;
    scanOkPayloadAst(v, out, depth + 1);
  }
}

/** native 位 Ok 载荷：$host.make("Result::Ok", [ $host.make("V" —— 提取 V */
function scanNativeOkPayload(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 400 || node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const x of node) scanNativeOkPayload(x, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.kind === 'native' && typeof o.body === 'string') {
    for (const m of (o.body as string).matchAll(/\$host\.make\(\s*["']Result::Ok["']\s*,\s*\[\s*\$host\.make\(\s*["']([^"']+)["']/g)) {
      out.add(m[1]!.split('::').pop()!);
    }
  }
  for (const v of Object.values(o)) scanNativeOkPayload(v, out, depth + 1);
}

/** 构造器形态的变体名（struct 两段 segs / path 两段 / call(path callee)） */
function constructorVariantOf(e: A.Expr): string | null {
  if (e.kind === 'struct' && e.segs.length === 2) return e.segs[1] ?? null;
  if (e.kind === 'path' && e.segs.length === 2) return e.segs[1] ?? null;
  if (e.kind === 'call' && e.callee.kind === 'path' && e.callee.segs.length === 2) return e.callee.segs[1] ?? null;
  return null;
}

/** 剥壳 try / await */
function unwrap(e: A.Expr): A.Expr {
  let cur = e;
  while (cur.kind === 'try' || cur.kind === 'await') cur = (cur as { expr: A.Expr }).expr;
  return cur;
}

interface LiveResolution {
  live: Set<string> | null; // null = 不可判定
  why: string;
}

/** scrutinee 定向解析静态可达变体集（let 回溯 + fn/method 名解析 + match 初始化并集 + Ok 载荷流） */
function resolveLiveVariants(
  scrutinee: A.Expr,
  matchLine: number,
  letsInFile: LetBinding[],
  fnVariants: Map<string, Set<string>>,
  fnOkPayload: Map<string, Set<string>> = new Map(),
  depth = 0,
): LiveResolution {
  if (depth > 4) return { live: null, why: '回溯深度超限' };
  const e = unwrap(scrutinee);
  // 直接构造器 scrutinee：live = {该变体}
  const ctor = constructorVariantOf(e);
  if (ctor) return { live: new Set([ctor]), why: 'scrutinee 即构造器' };
  // 方法调用：fn 名解析
  if (e.kind === 'method') {
    const set = fnVariants.get(e.name);
    return set ? { live: set, why: `方法 ${e.name} 体内构造集` } : { live: null, why: `方法 ${e.name} 未解析（无同名函数体）` };
  }
  // 函数调用：fn 名解析（取路径末段）
  if (e.kind === 'call' && e.callee.kind === 'path') {
    const name = e.callee.segs[e.callee.segs.length - 1] ?? '';
    const set = fnVariants.get(name);
    return set ? { live: set, why: `函数 ${name} 体内构造集` } : { live: null, why: `函数 ${name} 未解析` };
  }
  // match 初始化：各臂体并集（Ok(e) => e 臂取被调函数的 Ok 载荷变体集）
  if (e.kind === 'match' && Array.isArray(e.arms)) {
    const inner = unwrap(e.expr as A.Expr);
    const calleeName =
      inner.kind === 'method' ? inner.name :
      inner.kind === 'call' && inner.callee.kind === 'path' ? (inner.callee.segs[inner.callee.segs.length - 1] ?? '') : null;
    const live = new Set<string>();
    let resolved = true;
    let unresolvedWhy = 'match 初始化臂体不可全解析';
    for (const arm of e.arms as A.MatchArm[]) {
      // Ok(e) => e 载荷流
      const okPayload = okArmPayloadVariant(arm);
      if (okPayload && calleeName) {
        const payload = fnOkPayload.get(calleeName);
        if (payload && payload.size > 0) {
          for (const v of payload) live.add(v);
          continue;
        }
      }
      const armLine = arm.span?.line ?? matchLine;
      const bodyRes = resolveLiveVariants(arm.body, armLine, letsInFile, fnVariants, fnOkPayload, depth + 1);
      if (bodyRes.live) {
        for (const v of bodyRes.live) live.add(v);
      } else {
        resolved = false;
        unresolvedWhy = `match 初始化：${bodyRes.why}`;
      }
    }
    return resolved
      ? { live, why: `match 初始化并集（${calleeName ?? '匿名'}）` }
      : { live: null, why: unresolvedWhy };
  }
  // 标识符：同文件行号回溯最近 let 绑定
  if (e.kind === 'path' && e.segs.length === 1) {
    const name = e.segs[0]!;
    const cands = letsInFile.filter((b) => b.name === name && b.line > 0 && b.line < matchLine);
    if (cands.length === 0) return { live: null, why: `变量 ${name} 的 let 绑定未找到` };
    const binding = cands[cands.length - 1]!;
    return resolveLiveVariants(binding.init, binding.line, letsInFile, fnVariants, fnOkPayload, depth + 1);
  }
  return { live: null, why: '复杂 scrutinee 表达式' };
}

/** 「Ok(e) => e」形态识别：返回臂绑定名（载荷流解析用），非该形态返回 null */
function okArmPayloadVariant(arm: A.MatchArm): string | null {
  const body = arm.body;
  if (!(body.kind === 'path' && body.segs.length === 1)) return null;
  const pat = arm.pattern;
  if (pat.kind !== 'path') return null;
  const segs = pat.segs ?? [];
  const last = segs[segs.length - 1] ?? '';
  if (last !== 'Ok') return null;
  const sub = (pat as { sub?: { kind?: string; items?: A.Pattern[] } }).sub;
  if (!sub || sub.kind !== 'tuple' || !Array.isArray(sub.items) || sub.items.length < 1) return null;
  const first = sub.items[0]!;
  if (first.kind === 'binding' && first.name === body.segs[0]) return first.name;
  return null;
}

export function lintTopology(entry: string, topo: TopoGraph[]): LintDiagnostic[] {
  const diags: LintDiagnostic[] = [];
  const program = loadProgram(path.resolve(entry));

  // 全程序（所有模块文件）的 match 臂变体集合 —— traceEdgeFire 的动态作用域
  // 覆盖 graph 调用链上的所有函数，故 lint 范围取全程序。
  const matched = new Set<string>();
  for (const [, ast] of program.files) {
    collectMatchedVariants(ast.items, matched);
  }

  for (const g of topo) {
    // G-8：唯一守卫纪律
    const byGuard = new Map<string, TopoGraph['edges']>();
    for (const e of g.edges) {
      if (!byGuard.has(e.guard)) byGuard.set(e.guard, []);
      byGuard.get(e.guard)!.push(e as never);
    }
    for (const [guard, edges] of byGuard) {
      if (edges.length > 1) {
        diags.push({
          rule: 'G-8',
          severity: 'error',
          message: `graph ${g.name}: 守卫变体 "${guard}" 被 ${edges.length} 条边共用（${edges
            .map((e) => `${e.from}->${e.to}`)
            .join(' / ')}）—— 边发射别名，edge 覆盖率不可判定`,
        });
      }
    }
    // G-7：可观测性纪律
    for (const e of g.edges) {
      if (!matched.has(e.guard)) {
        diags.push({
          rule: 'G-7',
          severity: 'error',
          message: `graph ${g.name}: 边 ${e.from} -> ${e.to} on ${e.guard} 的守卫变体从未出现在任何 match 臂中 —— 结构性不可观测（${e.file}:${e.line}）`,
          file: e.file,
          line: e.line,
        });
      }
    }
    // G-9：空臂发射纪律（scrutinee 定向 —— 见文件头注释）
    const fnVariants = buildFnVariantMap(program);
    const fnOkPayload = buildFnOkPayloadMap(program);
    const guardEdges = new Map<string, string[]>();
    for (const e of g.edges) {
      const list = guardEdges.get(e.guard) ?? [];
      list.push(`${e.from} -> ${e.to}`);
      guardEdges.set(e.guard, list);
    }
    for (const [file, ast] of program.files) {
      const letsInFile: LetBinding[] = [];
      collectLetBindings(ast.items, letsInFile);
      // 深度遍历找全部 match 节点
      const walkMatch = (node: unknown, depth: number): void => {
        if (depth > 400 || node === null || node === undefined) return;
        if (Array.isArray(node)) {
          for (const x of node) walkMatch(x, depth + 1);
          return;
        }
        if (typeof node !== 'object') return;
        const o = node as Record<string, unknown>;
        if (o.kind === 'match' && Array.isArray(o.arms) && o.expr) {
          const matchLine = (o.span as A.Span | undefined)?.line ?? 0;
          const res = resolveLiveVariants(o.expr as A.Expr, matchLine, letsInFile, fnVariants, fnOkPayload);
          for (const arm of o.arms as Record<string, unknown>[]) {
            if (!armBodyIsEmpty(arm.body)) continue;
            const armVariants = new Set<string>();
            collectPatternVariants(arm.pattern, armVariants);
            const armLine = (arm.span as A.Span | undefined)?.line ?? 0;
            for (const v of armVariants) {
              if (!guardEdges.has(v)) continue; // 非挂边守卫的空臂（如 Within）不在本规则域
              const inLive = res.live?.has(v) ?? false;
              if (res.live !== null && !inLive) continue; // 穷尽性填充（不可达）—— 不报
              diags.push({
                rule: 'G-9',
                severity: res.live === null ? 'warning' : 'error',
                message: `graph ${g.name}: 守卫变体 ${v}（边 ${guardEdges.get(v)!.join(' / ')}）出现在空臂中（${file}:${armLine}）—— 该臂执行时边事件将发射但无转移语义（#L-23 空臂发射；scrutinee 可达集${res.live === null ? '不可判定：' + res.why : '：' + res.why}）`,
                file,
                line: armLine,
              });
            }
          }
        }
        for (const [k, v] of Object.entries(o)) {
          if (k === 'pattern' || k === 'pat') continue;
          walkMatch(v, depth + 1);
        }
      };
      walkMatch(ast.items, 0);
    }
  }
  return diags;
}
