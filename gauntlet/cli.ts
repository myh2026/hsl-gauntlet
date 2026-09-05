#!/usr/bin/env bun
// ============================================================================
// gauntlet/cli.ts — Gauntlet 命令行入口
// ----------------------------------------------------------------------------
// 用法：
//   bun gauntlet/cli.ts topo                 打印静态拓扑
//   bun gauntlet/cli.ts lint                 G-7/G-8 拓扑级 lint
//   bun gauntlet/cli.ts run                  运行 15 场景（一致性 + 不变式 + 覆盖率）
//   bun gauntlet/cli.ts mutate               变异测试（含基线运行）
//   bun gauntlet/cli.ts all                  全流水线：topo + lint + run + mutate + 报告
// ============================================================================

import * as path from 'node:path';
import { extractTopo, renderTopo } from './topo';
import { lintTopology } from './lint';
import { conformanceDeviations, runScenario, scenarios, SUBJECT } from './runner';
import { computeCoverage, renderCoverage } from './coverage';
import { checkInvariants, INVARIANTS } from './invariants';
import { runMutationTesting } from './mutate';
import { renderInvariantCatalog, writeReports } from './report';

const cmd = process.argv[2] ?? 'all';
const outRoot = path.resolve('results/runs');

async function main(): Promise<number> {
  if (cmd === 'topo') {
    for (const g of extractTopo(SUBJECT)) console.log(renderTopo(g));
    return 0;
  }
  if (cmd === 'lint') {
    const topo = extractTopo(SUBJECT);
    const diags = lintTopology(SUBJECT, topo);
    if (diags.length === 0) {
      console.log('✓ G-7 可观测性 / G-8 唯一守卫：全部通过');
    } else {
      for (const d of diags) console.log(`${d.rule} ${d.severity}: ${d.message}`);
    }
    return diags.some((d) => d.severity === 'error') ? 1 : 0;
  }
  if (cmd === 'invariants') {
    console.log(renderInvariantCatalog(INVARIANTS));
    return 0;
  }
  if (cmd === 'run' || cmd === 'all' || cmd === 'mutate') {
    const t0 = Date.now();
    const topo = extractTopo(SUBJECT);
    console.log(`[gauntlet] 拓扑提取：${topo.map((g) => `${g.name}(${g.nodes.length}n/${g.edges.length}e)`).join(', ')}`);

    const lints = lintTopology(SUBJECT, topo);
    console.log(`[gauntlet] lint G-7/G-8：${lints.length === 0 ? '通过' : lints.length + ' 项诊断'}`);

    const specs = scenarios();
    const outcomes = [];
    for (const spec of specs) {
      const outDir = path.join(outRoot, 'suite', spec.id);
      const o = await runScenario(spec, outDir);
      o.conformanceDeviations = conformanceDeviations(spec, o);
      o.invariantViolations = checkInvariants(o, outDir);
      outcomes.push(o);
      const status = o.conformanceDeviations.length === 0 && o.invariantViolations.length === 0 ? '✓' : '✗';
      console.log(`  ${status} ${spec.id} (${spec.kind}) exit=${o.exitCode} ok=${o.ok} verdict=${o.verdict} [${o.dispositions.committed}/${o.dispositions.parked}/${o.dispositions.escalated}] ${o.edgeSet.length} edges ${o.elapsedMs}ms${o.conformanceDeviations.length ? ' dev=' + o.conformanceDeviations.join(';') : ''}${o.invariantViolations.length ? ' inv=' + o.invariantViolations.join(';') : ''}`);
    }
    const devCount = outcomes.filter((o) => o.conformanceDeviations.length > 0).length;
    const invCount = outcomes.filter((o) => o.invariantViolations.length > 0).length;
    console.log(`[gauntlet] 场景套件：${outcomes.length} 个，conformance 偏差 ${devCount}，不变式违反 ${invCount}`);

    const coverage = computeCoverage(topo[0]?.edges ?? [], outcomes, specs);
    console.log(renderCoverage(coverage));

    if (cmd === 'run') {
      writeReports({ topo, lints, specs, outcomes, coverage, mutation: { baseline: outcomes, results: [], score: 0, killed: 0, total: 0, survivors: [], elapsedMs: 0 } }, 'results');
      console.log('[gauntlet] 报告已写入 results/report.md');
      return devCount + invCount > 0 ? 1 : 0;
    }

    // ---- 变异测试 ----
    console.log('[gauntlet] 变异测试开始（基线 + 25+ 变异体 × 15 场景）…');
    const mutation = await runMutationTesting(specs, outRoot, (m) => console.log(`  ${m}`));
    console.log(`[gauntlet] 变异杀死率：${(mutation.score * 100).toFixed(1)}%（${mutation.killed}/${mutation.total}，${(mutation.elapsedMs / 1000).toFixed(1)}s）`);
    if (mutation.survivors.length > 0) {
      console.log('  存活变异体（测试盲区）：');
      for (const s of mutation.survivors) console.log(`    - ${s.id} ${s.operator}: ${s.description}`);
    }

    writeReports({ topo, lints, specs, outcomes, coverage, mutation }, 'results');
    console.log(`[gauntlet] 总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s；报告已写入 results/report.md + results/gauntlet.json`);
    return 0;
  }
  console.log('用法: bun gauntlet/cli.ts topo|lint|invariants|run|mutate|all');
  return 2;
}

process.exit(await main());
