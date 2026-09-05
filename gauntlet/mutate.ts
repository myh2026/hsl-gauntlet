// ============================================================================
// gauntlet/mutate.ts — 拓扑级变异测试（harness mutation operators）
// ----------------------------------------------------------------------------
// 首组面向 Agent harness 声明拓扑的变异算子（算子族对 SUT 通用，具体变异点
// 由各 SUT 的 binding 目录声明）：
//   M1 EDGE_DEL      —— 删除一条边声明（拓扑契约变异：事件流缺边）
//   M2 EDGE_REDIRECT —— 改写边端点（拓扑签名变异：from/to 变化）
//   M3 GUARD_SWAP    —— 改写边守卫（触发条件变异）
//   M4 BUDGET_OFF    —— 预算边界 off-by-one（>= -> >）
//   M5 ROUTE/SCHEMA_FLIP —— 路由/闸门条件翻转
//   M6 CRITIC/VALIDATE_THRESH —— 审查/校验闸门阈值松动
//   M7 DRIFT_CAP     —— 漂移硬上限提升（*2 -> *3）
//   M8 COMMIT/PUBLISH_DROP —— 提交/发布路径丢弃案例落盘
// 杀死判据（三重）：黄金预期偏差（行为契约） ∨ 新增不变式违反（结构性质）
//                ∨ 与基线的差分（拓扑/行为签名）
// 多 SUT 泛化（第八轮）：subjectDir/mutant 目录经 SubjectSpec 注入；
// 变异体场景运行并行化（池深 4）—— 双 SUT 全矩阵仍 < 2 分钟。
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MutantResult, MutantSpec, RunOutcome, ScenarioSpec } from './types';
import { conformanceDeviations, runScenario } from './runner';
import { checkInvariants } from './invariants';
import type { SubjectSpec } from './subject';

/** 观测向量的差分签名（与基线不同 = 行为/拓扑变化） */
function signature(o: RunOutcome): string {
  return JSON.stringify([
    o.exitCode, o.ok, o.verdict, o.dispositions, o.faultEvents, o.deniedEvents, o.edgeFull,
  ]);
}

/** 并行池：并发度受限的 Promise 映射（确定性 —— 结果按下标对位回收） */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface MutationRunResult {
  baseline: RunOutcome[];
  results: MutantResult[];
  score: number;
  killed: number;
  total: number;
  survivors: MutantResult[];
  elapsedMs: number;
}

const POOL = 4;

export async function runMutationTesting(
  subject: SubjectSpec,
  outRoot: string,
  onProgress?: (msg: string) => void,
): Promise<MutationRunResult> {
  const t0 = Date.now();
  const allMutants = subject.mutants();
  const specs = subject.scenarios();
  const subjectDir = path.resolve(subject.subjectDir);

  // ---- 基线（顺序运行 —— 日志可读性优先）----
  onProgress?.('== 基线运行（pristine subject） ==');
  const baseline: RunOutcome[] = [];
  for (const spec of specs) {
    const outDir = path.join(outRoot, 'baseline', spec.id);
    const o = await runScenario(subject, spec, outDir);
    o.conformanceDeviations = conformanceDeviations(spec, o);
    o.invariantViolations = checkInvariants(subject.invariants, o, outDir);
    baseline.push(o);
    if (o.conformanceDeviations.length > 0) {
      onProgress?.(`  ⚠ 基线偏差 ${spec.id}: ${o.conformanceDeviations.join('; ')}`);
    }
  }
  const baseSig = new Map(baseline.map((o) => [o.id, signature(o)]));
  const baseInv = new Map(baseline.map((o) => [o.id, o.invariantViolations]));

  // ---- 变异体（场景级并行池）----
  const results: MutantResult[] = [];
  fs.rmSync(path.join(outRoot, 'mutants'), { recursive: true, force: true });
  for (const m of allMutants) {
    onProgress?.(`== ${m.id} ${m.operator}: ${m.description}`);
    const mutantDir = path.join(outRoot, 'mutants', m.id);
    fs.mkdirSync(mutantDir, { recursive: true });
    // 拷贝 subject 并应用单点替换
    const target = path.join(mutantDir, 'subject');
    fs.cpSync(subjectDir, target, { recursive: true });
    const fileAbs = path.join(target, m.file);
    let src: string;
    try {
      src = fs.readFileSync(fileAbs, 'utf-8');
    } catch (e) {
      results.push({ id: m.id, operator: m.operator, description: m.description, killed: true, killedBy: [], error: `读源失败: ${(e as Error).message}` });
      continue;
    }
    const hits = src.split(m.find).length - 1;
    if (hits !== 1) {
      results.push({ id: m.id, operator: m.operator, description: m.description, killed: true, killedBy: [], error: `替换点命中 ${hits} 次（期望 1）—— 变异体无效` });
      continue;
    }
    fs.writeFileSync(fileAbs, src.replace(m.find, m.replace), 'utf-8');

    // 全场景运行（并行池）+ 三重判据
    const killedBy: { scenario: string; deviations: string[] }[] = [];
    let runError: string | undefined;
    const outcomes = await pooled(specs, POOL, async (spec) => {
      const outDir = path.join(mutantDir, 'runs', spec.id);
      try {
        return { spec, o: await runScenario(subject, spec, outDir, target) };
      } catch (e) {
        runError = (e as Error).message;
        return { spec, o: null };
      }
    });
    for (const { spec, o } of outcomes) {
      if (!o) {
        killedBy.push({ scenario: spec.id, deviations: [`runner error: ${runError}`] });
        continue;
      }
      const dev = conformanceDeviations(spec, o);
      if (dev.length > 0) {
        killedBy.push({ scenario: spec.id, deviations: dev });
        continue;
      }
      const inv = checkInvariants(subject.invariants, o, path.join(mutantDir, 'runs', spec.id));
      const baseInvList = baseInv.get(spec.id) ?? [];
      const newInv = inv.filter((x) => !baseInvList.includes(x));
      if (newInv.length > 0) {
        killedBy.push({ scenario: spec.id, deviations: newInv });
        continue;
      }
      if (signature(o) !== baseSig.get(spec.id)) {
        killedBy.push({ scenario: spec.id, deviations: ['differential: topological/behavioral signature changed'] });
      }
    }
    results.push({ id: m.id, operator: m.operator, description: m.description, killed: killedBy.length > 0, killedBy, error: runError });
  }

  const killed = results.filter((r) => r.killed).length;
  const total = results.length;
  return {
    baseline,
    results,
    score: total === 0 ? 0 : killed / total,
    killed,
    total,
    survivors: results.filter((r) => !r.killed),
    elapsedMs: Date.now() - t0,
  };
}
