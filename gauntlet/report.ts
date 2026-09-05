// ============================================================================
// gauntlet/report.ts — 报告渲染（results/report.md + 机器可读 JSON）
// ----------------------------------------------------------------------------
// 多 SUT 泛化（第八轮）：per-subject 分节 + 跨 SUT 聚合对比
//（泛化实验的核心数据面：两个域的覆盖率/变异率/不变式并排呈现）。
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CoverageReport, MutantResult, RunOutcome, ScenarioSpec, TopoGraph } from './types';
import type { LintDiagnostic } from './lint';
import type { MutationRunResult } from './mutate';
import type { Invariant } from './invariants';
import type { SubjectSpec } from './subject';

export interface SubjectReport {
  subject: SubjectSpec;
  topo: TopoGraph[];
  lints: LintDiagnostic[];
  specs: ScenarioSpec[];
  outcomes: RunOutcome[];
  coverage: CoverageReport;
  mutation: MutationRunResult;
}

export interface GauntletReportInput {
  subjects: SubjectReport[];
}

export function renderReport(input: GauntletReportInput): string {
  const out: string[] = [];
  const subs = input.subjects;

  out.push(`# Gauntlet Conformance Report — ${subs.map((s) => s.subject.name).join(' + ')} (HSL)`);
  out.push('');
  out.push(`> 生成时间：${new Date().toISOString()}`);
  out.push(`> SUT：${subs.length} 个（${subs.map((s) => `${s.subject.name} · ${s.subject.domain}`).join('；')}）`);
  out.push('');

  // ---- 0. 跨 SUT 聚总 ----
  out.push('## 0. 跨 SUT 聚合（泛化实验总览）');
  out.push('');
  out.push('| SUT | 域 | 拓扑 | 场景 | conformance | 不变式 | Edge Coverage | fault-only 边 | 变异杀死率 |');
  out.push('|:---|:---|:---|:---|:---|:---|:---|:---|:---|');
  for (const s of subs) {
    const allConform = s.outcomes.every((o) => o.conformanceDeviations.length === 0);
    const allInvariant = s.outcomes.every((o) => o.invariantViolations.length === 0);
    out.push(
      `| ${s.subject.name} | ${s.subject.domain} | ${s.subject.topoNote} | ${s.specs.length} | ` +
        `${allConform ? '✓' : 'DEVIATIONS'} | ${allInvariant ? '✓' : 'VIOLATIONS'} | ` +
        `${Math.round(s.coverage.edgeCoverage * 1000) / 10}% | ${s.coverage.faultOnly.length} 条（${Math.round((s.coverage.faultOnly.length / s.coverage.declaredEdges.length) * 100)}%）| ` +
        `${(s.mutation.score * 100).toFixed(1)}%（${s.mutation.killed}/${s.mutation.total}）|`,
    );
  }
  out.push('');
  const totSpecs = subs.reduce((n, s) => n + s.specs.length, 0);
  const totMut = subs.reduce((n, s) => n + s.mutation.total, 0);
  const totKilled = subs.reduce((n, s) => n + s.mutation.killed, 0);
  out.push(`**聚合：${totSpecs} 场景 · ${totMut} 变异体（杀死 ${totKilled}，聚合杀死率 ${(totMut === 0 ? 0 : (totKilled / totMut) * 100).toFixed(1)}%）· 框架层 SUT 专属代码 0 行**`);
  out.push('');

  // ---- 各 SUT 分节 ----
  for (const s of subs) {
    const { subject, topo, lints, specs, outcomes, coverage, mutation } = s;
    const specById = new Map(specs.map((sp) => [sp.id, sp]));

    out.push(`---`);
    out.push('');
    out.push(`# ${subject.name}（${subject.domain}）`);
    out.push('');

    // 1. 拓扑
    out.push('## 1. 声明拓扑（ground truth）');
    out.push('');
    for (const g of topo) {
      out.push('```');
      out.push(`nodes: ${g.nodes.length}   edges: ${g.edges.length}`);
      for (const e of g.edges) out.push(`  ${e.from} -> ${e.to} on ${e.guard}`);
      out.push('```');
    }
    out.push('');

    // 2. Lint
    out.push('## 2. 拓扑级 Lint（G-7 可观测性 / G-8 唯一守卫）');
    out.push('');
    if (lints.length === 0) {
      out.push(`全部通过 —— ${topo[0]?.edges.length ?? 0} 条边守卫均可观测且唯一。`);
    } else {
      for (const l of lints) out.push(`- **${l.rule}** ${l.severity}: ${l.message}`);
    }
    out.push('');

    // 3. 场景
    out.push('## 3. 场景一致性（nominal + fault）');
    out.push('');
    const dispHeader = subject.dispositions.join('/');
    out.push(`| 场景 | 类别 | 故障分类 | exit | ok | verdict | ${dispHeader} | 偏差 | 不变式违反 |`);
    out.push(`|:---|:---|:---|:---|:---|:---|:---|:---|:---|`);
    for (const o of outcomes) {
      const sp = specById.get(o.id)!;
      const disp = subject.dispositions.map((d) => o.dispositions[d] ?? 0).join('/');
      out.push(
        `| ${o.id} | ${sp.kind} | ${sp.faultClass ?? '-'} | ${o.exitCode} | ${o.ok} | ${o.verdict} | ` +
          `${disp} | ` +
          `${o.conformanceDeviations.length === 0 ? '✓' : o.conformanceDeviations.join('; ')} | ` +
          `${o.invariantViolations.length === 0 ? '✓' : o.invariantViolations.join('; ')} |`,
      );
    }
    const allConform = outcomes.every((o) => o.conformanceDeviations.length === 0);
    const allInvariant = outcomes.every((o) => o.invariantViolations.length === 0);
    out.push('');
    out.push(`**Conformance: ${allConform ? 'ALL GREEN' : 'DEVIATIONS PRESENT'} · Invariants: ${allInvariant ? 'ALL GREEN' : 'VIOLATIONS PRESENT'}**`);
    out.push('');

    // 4. 覆盖率
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

    // 5. 变异
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
      const survivors = mutation.survivors as MutantResult[];
      const equiv = survivors.filter((s) => s.triage?.verdict === 'equivalent-by-plan-gate');
      const blind = survivors.filter((s) => !s.triage || s.triage.verdict !== 'equivalent-by-plan-gate');
      if (equiv.length > 0) {
        out.push(`**结构性等价变异（${equiv.length}）—— triage 静态归因成立，非套件盲区（无需补场景）：**`);
        for (const sv of equiv) {
          out.push(`- ◇ ${sv.id} ${sv.operator}: ${sv.description}`);
          const t = sv.triage!;
          out.push(`  - 归因：${t.rationale}`);
          for (const e of t.evidence) out.push(`    - ${e}`);
        }
        const adjScore = ((mutation.killed + equiv.length) / mutation.total) * 100;
        out.push(`- 等价归因后有效杀死率：${adjScore.toFixed(1)}%（原始 ${(mutation.score * 100).toFixed(1)}%，结构等价校正 +${((equiv.length / mutation.total) * 100).toFixed(1)}%）`);
      }
      if (blind.length > 0) {
        out.push('');
        out.push(`**存活变异体（${blind.length}）——测试套件盲区，需补场景：**`);
        for (const sv of blind) {
          out.push(`- ${sv.id} ${sv.operator}: ${sv.description}`);
          if (sv.triage) out.push(`  - triage 归因：${sv.triage.rationale}`);
        }
      }
    }
    out.push('');

    // 6. 汇总
    out.push('## 6. 结论摘要');
    out.push('');
    out.push(`- SUT：${subject.name} —— ${topo[0]?.nodes.length ?? 0} 节点 / ${topo[0]?.edges.length ?? 0} 边（${subject.topoNote}），全 HSL`);
    out.push(`- 场景：${specs.length} 个（${specs.filter((sp) => sp.kind === 'nominal').length} nominal + ${specs.filter((sp) => sp.kind === 'fault').length} fault），全部确定性可复现`);
    out.push(`- Edge coverage：${Math.round(coverage.edgeCoverage * 1000) / 10}%，其中 ${coverage.faultOnly.length} 条边仅故障场景可达`);
    out.push(`- 轨迹不变式：${allInvariant ? '全部满足' : '存在违反'}；变异杀死率：${(mutation.score * 100).toFixed(1)}%（${mutation.killed}/${mutation.total}）`);
    out.push('');
  }

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
        subjects: input.subjects.map((s) => ({
          subject: {
            id: s.subject.id,
            name: s.subject.name,
            domain: s.subject.domain,
            entry: s.subject.entry,
            dispositions: s.subject.dispositions,
            topoNote: s.subject.topoNote,
          },
          topo: s.topo,
          lints: s.lints,
          scenarios: s.specs,
          outcomes: s.outcomes,
          coverage: {
            edgeCoverage: s.coverage.edgeCoverage,
            declared: s.coverage.declaredEdges,
            neverFired: s.coverage.neverFired.map((e) => e.guard),
            faultOnly: s.coverage.faultOnly.map((e) => e.guard),
            fired: Object.fromEntries([...s.coverage.fired.entries()].map(([k, v]) => [k, v])),
          },
          mutation: {
            score: s.mutation.score,
            killed: s.mutation.killed,
            total: s.mutation.total,
            results: s.mutation.results,
          },
        })),
        aggregate: {
          subjectCount: input.subjects.length,
          scenarios: input.subjects.reduce((n, s) => n + s.specs.length, 0),
          mutants: input.subjects.reduce((n, s) => n + s.mutation.total, 0),
          killed: input.subjects.reduce((n, s) => n + s.mutation.killed, 0),
          edgeCoverageAvg: input.subjects.length === 0
            ? 0
            : input.subjects.reduce((n, s) => n + s.coverage.edgeCoverage, 0) / input.subjects.length,
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
