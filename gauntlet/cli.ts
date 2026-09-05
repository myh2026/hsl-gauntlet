#!/usr/bin/env bun
// ============================================================================
// gauntlet/cli.ts — Gauntlet 命令行入口（多 SUT）
// ----------------------------------------------------------------------------
// 用法：
//   bun gauntlet/cli.ts subjects              列出已注册 SUT
//   bun gauntlet/cli.ts topo [--subject ID]   打印静态拓扑
//   bun gauntlet/cli.ts lint [--subject ID]   G-7/G-8/G-9 拓扑级 lint
//   bun gauntlet/cli.ts invariants [--subject ID]  不变式目录
//   bun gauntlet/cli.ts run [--subject ID]    场景一致性 + 不变式 + 覆盖率
//   bun gauntlet/cli.ts mutate [--subject ID] 变异测试（含基线）
//   bun gauntlet/cli.ts all [--subject ID]    全流水线（默认全部 SUT）
// ============================================================================

import * as path from 'node:path';
import { extractTopo, renderTopo } from './topo';
import { lintTopology } from './lint';
import { conformanceDeviations, runScenario } from './runner';
import { computeCoverage, renderCoverage } from './coverage';
import { checkInvariants } from './invariants';
import { runMutationTesting } from './mutate';
import type { MutantResult } from './types';
import { renderInvariantCatalog, writeReports } from './report';
import { SUBJECTS, subjectById, type SubjectSpec } from './subject';
import type { SubjectReport } from './report';

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'all';
const subjFlag = argv.indexOf('--subject');
const filterId = subjFlag >= 0 ? argv[subjFlag + 1] : undefined;
const active: SubjectSpec[] = filterId
  ? [subjectById(filterId) ?? (() => { console.error(`未知 SUT: ${filterId}（已注册：${SUBJECTS.map((s) => s.id).join(', ')}）`); process.exit(2); })()]
  : SUBJECTS;

const outRoot = path.resolve('results/runs');

async function runSubjectPipeline(subject: SubjectSpec, mode: 'run' | 'all' | 'mutate'): Promise<SubjectReport> {
  const topo = extractTopo(subject.entry);
  console.log(`[gauntlet:${subject.id}] 拓扑提取：${topo.map((g) => `${g.name}(${g.nodes.length}n/${g.edges.length}e)`).join(', ')}`);

  const lints = lintTopology(subject.entry, topo);
  console.log(`[gauntlet:${subject.id}] lint G-7/G-8/G-9：${lints.length === 0 ? '通过' : lints.length + ' 项诊断'}`);

  const specs = subject.scenarios();
  const outcomes = [];
  for (const spec of specs) {
    const outDir = path.join(outRoot, subject.id, 'suite', spec.id);
    const o = await runScenario(subject, spec, outDir);
    o.conformanceDeviations = conformanceDeviations(spec, o);
    o.invariantViolations = checkInvariants(subject.invariants, o, outDir);
    outcomes.push(o);
    const status = o.conformanceDeviations.length === 0 && o.invariantViolations.length === 0 ? '✓' : '✗';
    const disp = subject.dispositions.map((d) => o.dispositions[d] ?? 0).join('/');
    console.log(`  ${status} ${spec.id} (${spec.kind}) exit=${o.exitCode} ok=${o.ok} verdict=${o.verdict} [${disp}] ${o.edgeSet.length} edges ${o.elapsedMs}ms${o.conformanceDeviations.length ? ' dev=' + o.conformanceDeviations.join(';') : ''}${o.invariantViolations.length ? ' inv=' + o.invariantViolations.join(';') : ''}`);
  }
  const devCount = outcomes.filter((o) => o.conformanceDeviations.length > 0).length;
  const invCount = outcomes.filter((o) => o.invariantViolations.length > 0).length;
  console.log(`[gauntlet:${subject.id}] 场景套件：${outcomes.length} 个，conformance 偏差 ${devCount}，不变式违反 ${invCount}`);

  const coverage = computeCoverage(topo[0]?.edges ?? [], outcomes, specs);
  console.log(renderCoverage(coverage));

  let mutation = {
    baseline: outcomes,
    results: [] as never[],
    score: 0,
    killed: 0,
    total: 0,
    survivors: [] as never[],
    elapsedMs: 0,
  };
  if (mode === 'mutate' || mode === 'all') {
    console.log(`[gauntlet:${subject.id}] 变异测试开始（基线 + ${subject.mutants().length} 变异体 × ${specs.length} 场景，池深 4）…`);
    mutation = await runMutationTesting(subject, path.join(outRoot, subject.id), (m) => console.log(`  ${m}`)) as typeof mutation;
    console.log(`[gauntlet:${subject.id}] 变异杀死率：${(mutation.score * 100).toFixed(1)}%（${mutation.killed}/${mutation.total}，${(mutation.elapsedMs / 1000).toFixed(1)}s）`);
    const equiv = (mutation.survivors as MutantResult[]).filter((s) => s.triage?.verdict === 'equivalent-by-plan-gate');
    const blind = (mutation.survivors as MutantResult[]).filter((s) => !s.triage || s.triage.verdict !== 'equivalent-by-plan-gate');
    if (mutation.survivors.length > 0) {
      const adj = mutation.score * 100;
      const adjScore = ((mutation.killed + equiv.length) / mutation.total) * 100;
      console.log(`  存活变异体（${mutation.survivors.length}）：`);
      for (const s of equiv) console.log(`    ◇ ${s.id} ${s.operator}: ${s.description} —— 【结构性等价】${s.triage!.rationale.split('。')[1] ?? ''}`);
      for (const s of blind) console.log(`    - ${s.id} ${s.operator}: ${s.description}${s.triage ? ` —— 归因：${s.triage.rationale.split('。')[0]}` : ''}`);
      if (equiv.length > 0) {
        console.log(`  等价归因后有效杀死率：${adjScore.toFixed(1)}%（原始 ${adj.toFixed(1)}% + 结构等价校正 +${((equiv.length / mutation.total) * 100).toFixed(1)}%）`);
      }
    }
  }
  return { subject, topo, lints, specs, outcomes, coverage, mutation };
}

async function main(): Promise<number> {
  if (cmd === 'subjects') {
    for (const s of SUBJECTS) console.log(`${s.id}\t${s.name}\t${s.domain}\t${s.topoNote}\t${s.dispositions.join('/')}`);
    return 0;
  }
  if (cmd === 'topo') {
    for (const subject of active) {
      console.log(`== ${subject.name} ==`);
      for (const g of extractTopo(subject.entry)) console.log(renderTopo(g));
    }
    return 0;
  }
  if (cmd === 'lint') {
    let bad = 0;
    for (const subject of active) {
      console.log(`== ${subject.name} ==`);
      const topo = extractTopo(subject.entry);
      const diags = lintTopology(subject.entry, topo);
      if (diags.length === 0) {
        console.log('✓ G-7 可观测性 / G-8 唯一守卫 / G-9 无空臂发射：全部通过');
      } else {
        for (const d of diags) console.log(`${d.rule} ${d.severity}: ${d.message}`);
        if (diags.some((d) => d.severity === 'error')) bad++;
      }
    }
    return bad > 0 ? 1 : 0;
  }
  if (cmd === 'invariants') {
    for (const subject of active) {
      console.log(`== ${subject.name} ==`);
      console.log(renderInvariantCatalog(subject.invariants));
    }
    return 0;
  }
  if (cmd === 'run' || cmd === 'all' || cmd === 'mutate') {
    const t0 = Date.now();
    const reports: SubjectReport[] = [];
    for (const subject of active) {
      console.log(`\n========== SUT: ${subject.name}（${subject.domain}） ==========`);
      reports.push(await runSubjectPipeline(subject, cmd as 'run' | 'all' | 'mutate'));
    }

    // 聚合摘要（watchdog 抓取行：场景套件 / Edge Coverage / 变异杀死率 均在各 subject 输出中）
    if (cmd === 'run') {
      writeReports({ subjects: reports }, 'results');
      console.log('[gauntlet] 报告已写入 results/report.md');
      return reports.reduce((n, r) => n + r.outcomes.filter((o) => o.conformanceDeviations.length > 0 || o.invariantViolations.length > 0).length, 0) > 0 ? 1 : 0;
    }

    const totSpecs = reports.reduce((n, r) => n + r.specs.length, 0);
    const totMut = reports.reduce((n, r) => n + r.mutation.total, 0);
    const totKilled = reports.reduce((n, r) => n + r.mutation.killed, 0);
    const aggScore = totMut === 0 ? 0 : (totKilled / totMut) * 100;
    console.log(`[gauntlet] 聚合：${reports.length} SUT · ${totSpecs} 场景 · ${totMut} 变异体（杀死 ${totKilled}，聚合杀死率 ${aggScore.toFixed(1)}%）`);
    writeReports({ subjects: reports }, 'results');
    console.log(`[gauntlet] 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s；报告已写入 results/report.md + results/gauntlet.json`);
    // 判据（双保险）：任何场景偏差/不变式违反/无效变异体 → 非零退出（watchdog GREEN 依据）
    const devCount = reports.reduce((n, r) => n + r.outcomes.filter((o) => o.conformanceDeviations.length > 0 || o.invariantViolations.length > 0).length, 0);
    const invalidMutants = reports.reduce((n, r) => n + r.mutation.results.filter((m) => (m as { error?: string }).error).length, 0);
    if (devCount > 0 || invalidMutants > 0) {
      console.error(`[gauntlet] 判据失败：${devCount} 个场景偏差/不变式违反，${invalidMutants} 个无效变异体`);
      return 1;
    }
    return 0;
  }
  console.log('用法: bun gauntlet/cli.ts subjects|topo|lint|invariants|run|mutate|all [--subject ID]');
  return 2;
}

process.exit(await main());
