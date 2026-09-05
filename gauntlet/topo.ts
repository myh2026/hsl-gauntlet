// ============================================================================
// gauntlet/topo.ts — 静态拓扑提取器
// ----------------------------------------------------------------------------
// 从 HSL 源码（经 vendor dhv-ts 解析器）提取 graph 声明的节点/边/守卫，
// 作为覆盖率与一致性测试的 ground truth（声明拓扑 = 可测试契约）。
// ============================================================================

import * as path from 'node:path';
import { loadProgram } from '../vendor/dhv-ts/src/linker';
import * as A from '../vendor/dhv-ts/src/ast';
import type { TopoEdge, TopoGraph, TopoNode } from './types';

/** Guard 变体名：path 模式的最后一段（与 interp.traceEdgeFire 的匹配口径一致） */
function guardVariantOf(pat: A.Pattern | undefined): string | null {
  if (!pat) return null;
  if (pat.kind === 'path') {
    const segs = pat.segs;
    if (segs.length >= 1) return segs[segs.length - 1]!;
    return null;
  }
  if (pat.kind === 'binding' && pat.sub) return guardVariantOf(pat.sub);
  return null;
}

/** 类型显示名（粗粒度：path 拼接） */
function tyName(ty: A.HType | undefined): string {
  if (!ty) return '?';
  if (ty.kind === 'path') return ty.segs.join('::');
  return ty.kind;
}

/** 提取一个入口文件的全部 graph 静态拓扑 */
export function extractTopo(entry: string): TopoGraph[] {
  const program = loadProgram(path.resolve(entry));
  const graphs: TopoGraph[] = [];
  for (const [file, ast] of program.files) {
    for (const item of ast.items) {
      if (item.kind !== 'graph') continue;
      const g = item.graph;
      const nodes: TopoNode[] = [];
      const edges: TopoEdge[] = [];
      for (const gs of g.body) {
        if (gs.t === 'node') {
          nodes.push({ name: gs.decl.name, mut: gs.decl.mut, ty: tyName(gs.decl.ty) });
        } else if (gs.t === 'edge') {
          const guard = guardVariantOf(gs.decl.guardPattern);
          if (!guard) continue; // 表达式守卫（本框架 v1 只处理变体守卫）
          for (let i = 0; i + 1 < gs.decl.endpoints.length; i++) {
            edges.push({
              from: gs.decl.endpoints[i]!,
              to: gs.decl.endpoints[i + 1]!,
              guard,
              file: path.relative(process.cwd(), file),
              line: gs.decl.span.line,
            });
          }
        }
      }
      graphs.push({ name: g.name, file: path.relative(process.cwd(), file), nodes, edges });
    }
  }
  return graphs;
}

/** 渲染拓扑 ASCII（报告用） */
export function renderTopo(g: TopoGraph): string {
  const lines: string[] = [];
  lines.push(`graph ${g.name} (${g.file})`);
  lines.push(`  nodes (${g.nodes.length}): ${g.nodes.map((n) => (n.mut ? `mut ${n.name}: ${n.ty}` : `${n.name}: ${n.ty}`)).join(', ')}`);
  lines.push(`  edges (${g.edges.length}):`);
  for (const e of g.edges) lines.push(`    ${e.from} -> ${e.to} on ${e.guard}   (${e.file}:${e.line})`);
  return lines.join('\n');
}
