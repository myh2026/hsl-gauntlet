// ============================================================================
// gauntlet/report.ts — 报告渲染（results/report.md + 机器可读 JSON）
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CoverageReport, MutantResult, RunOutcome, ScenarioSpec, TopoGraph } from './types';
import type { LintDiagnostic } from './lint';
import type { MutationRunResult } from './mutate';
import type { Invariant } from './invariants';

export interface GauntletReportInput {
  topo: TopoGraph[];
  lints: LintDiagnostic[];
  specs: ScenarioSpec[];
  outcomes: RunOutcome[];
  coverage: CoverageReport;
  mutation: MutationRunResult;
}

export function renderReport(input: GauntletReportInput): string {
  const { topo, lints, specs, outcomes, coverage, mutation } = input;
  const specById = new Map(specs.map((s) => [s.id, s]));
  const out: string[] = [];

  out.push('# Gauntlet Conformance Report — Vigil (HSL)');
  out.push('');
  out.push(`> 生成时间：${new Date().toISOString()}`);
  out.push('');

  // ---- 1. 拓扑 ----
  out.push('## 1. 声明拓扑（ground truth）');
  out.push('');
  for (const g of topo) {
    out.push('```');
    out.push(`nodes: ${g.nodes.length}   edges: ${g.edges.length}`);
    for (const e of g.edges) out.push(`  ${e.from} -> ${e.to} on ${e.guard}`);
    out.push('```');
  }
  out.push('');

  // ---- 2. Lint ----
  out.push('## 2. 拓扑级 Lint（G-7 可观测性 / G-8 唯一守卫）');
  out.push('');
  if (lints.length === 0) {
    out.push('全部通过 —— 17 条边守卫均可观测且唯一。');
  } else {
    for (const l of lints) out.push(`- **${l.rule}** ${l.severity}: ${l.message}`);
  }
  out.push('');

  // ---- 3. 场景 conformance ----
  out.push('## 3. 场景一致性（nominal + fault）');
  out.push('');
  out.push('| 场景 | 类别 | 故障分类 | exit | ok | verdict | committed/parked/escalated | 偏差 | 不变式违反 |');
  out.push('|:---|:---|:---|:---|:---|:---|:---|:---|:---|');
  for (const o of outcomes) {
    const s = specById.get(o.id)!;
    out.push(
      `| ${o.id} | ${s.kind} | ${s.faultClass ?? '-'} | ${o.exitCode} | ${o.ok} | ${o.verdict} | ` +
        `${o.dispositions.committed}/${o.dispositions.parked}/${o.dispositions.escalated} | ` +
        `${o.conformanceDeviations.length === 0 ? '✓' : o.conformanceDeviations.join('; ')} | ` +
        `${o.invariantViolations.length === 0 ? '✓' : o.invariantViolations.join('; ')} |`,
    );
  }
  const allConform = outcomes.every((o) => o.conformanceDeviations.length === 0);
  const allInvariant = outcomes.every((o) => o.invariantViolations.length === 0);
  out.push('');
  out.push(`**Conformance: ${allConform ? 'ALL GREEN' : 'DEVIATIONS PRESENT'} · Invariants: ${allInvariant ? 'ALL GREEN' : 'VIOLATIONS PRESENT'}**`);
  out.push('');

  // ---- 4. 覆盖率 ----
  out.push('## 4. Edge Coverage（声明拓扑 vs 事件总线观测）');
  out.push('');
  out.push(`**${Math.round(coverage.edgeCoverage * 1000) / 10}%**（${coverage.declaredEdges.length - coverage.neverFired.length}/${coverage.declaredEdges.length} 边触发）`);
  out.push('');
  out.push('| edge | guard | fired by |');
  out.push('|:---|:---|:---|');
  for (const e of coverage.declaredEdges) {
    const by = coverage.fired.get(e.guard) ?? [];
    out.push(`| ${e.from} -> ${e.to} | \`${e.guard}\` | ${by.length > 0 ? by.join(', ') : '**NEVER**'} |`);
  }
  out.push('');
  if (coverage.faultOnly.length > 0) {
    out.push(`**Fault-only 边（${coverage.faultOnly.length} 条，占 ${(coverage.faultOnly.length / coverage.declaredEdges.length * 100).toFixed(0)}%）：** ` +
      coverage.faultOnly.map((e) => `\`${e.guard}\` (${e.from}->${e.to})`).join(' · '));
    out.push('');
    out.push('> 这些边在 nominal 套件中结构性不可达 —— 故障注入不是可选项，而是拓扑覆盖的必要条件。');
    out.push('');
  }

  // ---- 5. 变异 ----
  out.push('## 5. 变异测试（harness mutation operators）');
  out.push('');
  out.push(`**Mutation Score: ${(mutation.score * 100).toFixed(1)}%（${mutation.killed}/${mutation.total} killed，${(mutation.elapsedMs / 1000).toFixed(1)}s）**`);
  out.push('');
  out.push('| 变异体 | 算子 | 描述 | 结果 | 杀手场景 |');
  out.push('|:---|:---|:---|:---|:---|');
  for (const r of mutation.results as MutantResult[]) {
    out.push(`| ${r.id} | ${r.operator} | ${r.description} | ${r.killed ? '☠ killed' : '**SURVIVED**'} | ${r.killedBy.map((k) => k.scenario).join(', ') || (r.error ? `invalid: ${r.error}` : '-') } |`);
  }
  if (mutation.survivors.length > 0) {
    out.push('');
    out.push(`**存活变异体（${mutation.survivors.length}）——测试套件盲区，需补场景：**`);
    for (const s of mutation.survivors) out.push(`- ${s.id} ${s.operator}: ${s.description}`);
  }
  out.push('');

  // ---- 6. 汇总 ----
  out.push('## 6. 结论摘要');
  out.push('');
  out.push(`- SUT：Vigil —— ${topo[0]?.nodes.length ?? 0} 节点 / ${topo[0]?.edges.length ?? 0} 边 / 5 守卫环的 SRE 告警分诊 harness（全 HSL）`);
  out.push(`- 场景：${specs.length} 个（${specs.filter((s) => s.kind === 'nominal').length} nominal + ${specs.filter((s) => s.kind === 'fault').length} fault），全部确定性可复现`);
  out.push(`- Edge coverage：${Math.round(coverage.edgeCoverage * 1000) / 10}%，其中 ${coverage.faultOnly.length} 条边仅故障场景可达`);
  out.push(`- 轨迹不变式：${Object.fromEntries([...new Set(outcomes.flatMap((o) => o.invariantViolations.map((v) => v.split(':')[0])))]) ? '' : ''}${allInvariant ? '全部满足' : '存在违反'}`);
  out.push(`- 变异杀死率：${(mutation.score * 100).toFixed(1)}%（${mutation.killed}/${mutation.total}）`);
  out.push('');

  return out.join('\n');
}

export function writeReports(input: GauntletReportInput, resultsDir: string): void {
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(path.join(resultsDir, 'report.md'), renderReport(input), 'utf-8');
  fs.writeFileSync(
    path.join(resultsDir, 'gauntlet.json'),
    JSON.stringify(
      {
        ts: new Date().toISOString(),
        topo: input.topo,
        lints: input.lints,
        scenarios: input.specs,
        outcomes: input.outcomes,
        coverage: {
          edgeCoverage: input.coverage.edgeCoverage,
          declared: input.coverage.declaredEdges,
          neverFired: input.coverage.neverFired.map((e) => e.guard),
          faultOnly: input.coverage.faultOnly.map((e) => e.guard),
          fired: Object.fromEntries([...input.coverage.fired.entries()].map(([k, v]) => [k, v])),
        },
        mutation: {
          score: input.mutation.score,
          killed: input.mutation.killed,
          total: input.mutation.total,
          results: input.mutation.results,
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
}

export function renderInvariantCatalog(invariants: Invariant[]): string {
  return invariants.map((i) => `- **${i.id}**: ${i.statement}`).join('\n');
}
