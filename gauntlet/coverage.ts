// ============================================================================
// gauntlet/coverage.ts — 声明拓扑 vs 触发事件 的覆盖率
// ----------------------------------------------------------------------------
// Edge coverage = 声明边中在事件总线上至少触发一次的占比。
// 关键输出：fault-only 边（仅故障场景可达）—— 拓扑级测试充分性的实证指标。
// ============================================================================

import type { CoverageReport, RunOutcome, ScenarioSpec, TopoEdge } from './types';

export function computeCoverage(topoEdges: TopoEdge[], outcomes: RunOutcome[], specs: ScenarioSpec[]): CoverageReport {
  const kindById = new Map(specs.map((s) => [s.id, s.kind]));
  const fired = new Map<string, string[]>();
  const perScenario: { id: string; guards: string[] }[] = [];
  for (const o of outcomes) {
    perScenario.push({ id: o.id, guards: o.edgeSet });
    for (const g of o.edgeSet) {
      if (!fired.has(g)) fired.set(g, []);
      fired.get(g)!.push(o.id);
    }
  }
  const neverFired = topoEdges.filter((e) => !fired.has(e.guard));
  const faultOnly = topoEdges.filter((e) => {
    const scenarios = fired.get(e.guard) ?? [];
    return scenarios.length > 0 && scenarios.every((id) => kindById.get(id) === 'fault');
  });
  const covered = topoEdges.length - neverFired.length;
  return {
    declaredEdges: topoEdges,
    fired,
    neverFired,
    faultOnly,
    perScenario,
    edgeCoverage: topoEdges.length === 0 ? 0 : covered / topoEdges.length,
  };
}

export function renderCoverage(r: CoverageReport): string {
  const lines: string[] = [];
  lines.push(`## Edge Coverage: ${Math.round(r.edgeCoverage * 1000) / 10}% (${r.declaredEdges.length - r.neverFired.length}/${r.declaredEdges.length} declared edges fired)`);
  lines.push('');
  lines.push('| edge | guard | fired by |');
  lines.push('|:---|:---|:---|');
  for (const e of r.declaredEdges) {
    const by = r.fired.get(e.guard) ?? [];
    lines.push(`| ${e.from} -> ${e.to} | \`${e.guard}\` | ${by.length > 0 ? by.join(', ') : '**NEVER**'} |`);
  }
  if (r.faultOnly.length > 0) {
    lines.push('');
    lines.push(`**Fault-only edges (${r.faultOnly.length})**: ${r.faultOnly.map((e) => `\`${e.guard}\``).join(', ')} —— 仅在故障注入场景下可达，nominal 套件结构性盲区。`);
  }
  return lines.join('\n');
}
