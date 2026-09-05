// ============================================================================
// gauntlet/lint.ts — 拓扑级 lint：G-7 可观测性纪律 + G-8 唯一守卫纪律
// ----------------------------------------------------------------------------
// G-7（可观测性）：每条边的 Guard 变体必须出现在某个 match 臂的模式中
//   —— 否则该边在事件总线上结构性不可观测（dsh 的 executor->model on
//   Event::Observed 实录盲区，本框架的立项动机）。
// G-8（唯一守卫）：同一 graph 内 Guard 变体不得被多条边共用
//   —— interp.traceEdgeFire 按变体名匹配 match 臂与 edge 声明，重名守卫
//   会同时发射所有匹配边（边发射别名），使 edge 覆盖率不可判定。
// ============================================================================

import * as path from 'node:path';
import { loadProgram } from '../vendor/dhv-ts/src/linker';
import * as A from '../vendor/dhv-ts/src/ast';
import type { TopoGraph } from './types';

export interface LintDiagnostic {
  rule: 'G-7' | 'G-8';
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
  }
  return diags;
}
