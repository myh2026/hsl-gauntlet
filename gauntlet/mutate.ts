// ============================================================================
// gauntlet/mutate.ts — 拓扑级变异测试（harness mutation operators）
// ----------------------------------------------------------------------------
// 首组面向 Agent harness 声明拓扑的变异算子：
//   M1 EDGE_DEL      —— 删除一条边声明（拓扑契约变异：事件流缺边）
//   M2 EDGE_REDIRECT —— 改写边端点（拓扑签名变异：from/to 变化）
//   M3 GUARD_SWAP    —— 改写边守卫（触发条件变异）
//   M4 BUDGET_OFF    —— 预算边界 off-by-one（>= -> >）
//   M5 ROUTE_FLIP    —— 路由分流条件翻转（critical -> warning）
//   M6 CRITIC_THRESH —— 审查闸门阈值松动（>=2 -> >=1）
//   M7 DRIFT_CAP     —— 漂移硬上限提升（*2 -> *3）
//   M8 COMMIT_DROP   —— 提交路径丢弃案例落盘
// 杀死判据（双重）：黄金预期偏差（行为契约） ∨ 与基线的差分（拓扑签名）
//                  ∨ 不变式违反（结构性质）
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MutantResult, MutantSpec, RunOutcome, ScenarioSpec } from './types';
import { conformanceDeviations, runScenario } from './runner';
import { checkInvariants } from './invariants';

/** 变异算子清单（对 subject/vigil 的源文本做精确单点替换） */
export function mutantSpecs(): MutantSpec[] {
  const specs: MutantSpec[] = [];

  // M1：17 条边逐一删除（拓扑契约变异）
  const edgeLines: [string, string][] = [
    ['vigil.hsl', '    edge intake -> triager on IntakeEvent::AlertReceived;'],
    ['vigil.hsl', '    edge triager -> investigator on Triage::Investigate;'],
    ['vigil.hsl', '    edge triager -> router on Triage::Escalate;'],
    ['vigil.hsl', '    edge triager -> triager on Triage::Retryable;'],
    ['vigil.hsl', '    edge investigator -> investigator on Probe::EvidencePending;'],
    ['vigil.hsl', '    edge investigator -> critic on Probe::EvidenceReady;'],
    ['vigil.hsl', '    edge investigator -> router on Probe::EvidenceFailed;'],
    ['vigil.hsl', '    edge critic -> synthesizer on Critique::Sound;'],
    ['vigil.hsl', '    edge critic -> investigator on Critique::Insufficient;'],
    ['vigil.hsl', '    edge synthesizer -> reviewer on Draft::Submitted;'],
    ['vigil.hsl', '    edge reviewer -> ledger on Verdict::Accepted;'],
    ['vigil.hsl', '    edge reviewer -> synthesizer on Verdict::Rejected;'],
    ['vigil.hsl', '    edge router -> ledger on Route::Parked;'],
    ['vigil.hsl', '    edge router -> ledger on Route::Escalated;'],
    ['vigil.hsl', '    edge budget -> router on BudgetSignal::Exhausted;'],
    ['vigil.hsl', '    edge budget -> triager on BudgetSignal::DriftWarn;'],
    ['vigil.hsl', '    edge ledger -> intake on AdvanceSignal::Committed;'],
  ];
  for (let i = 0; i < edgeLines.length; i++) {
    const [file, line] = edgeLines[i]!;
    specs.push({
      id: `M1-E${i + 1}`,
      operator: 'M1 EDGE_DEL',
      description: `删除边声明: ${line.trim()}`,
      file,
      find: line + '\n',
      replace: '',
    });
  }

  // M2：边端点改写（拓扑签名变异）
  specs.push({
    id: 'M2-R1', operator: 'M2 EDGE_REDIRECT', description: 'investigator->critic 改为 investigator->router（EvidenceReady）',
    file: 'vigil.hsl',
    find: 'edge investigator -> critic on Probe::EvidenceReady;',
    replace: 'edge investigator -> router on Probe::EvidenceReady;',
  });
  specs.push({
    id: 'M2-R2', operator: 'M2 EDGE_REDIRECT', description: 'reviewer->ledger 改为 reviewer->synthesizer（Accepted）',
    file: 'vigil.hsl',
    find: 'edge reviewer -> ledger on Verdict::Accepted;',
    replace: 'edge reviewer -> synthesizer on Verdict::Accepted;',
  });
  specs.push({
    id: 'M2-R3', operator: 'M2 EDGE_REDIRECT', description: 'ledger->intake 改为 ledger->triager（Committed）',
    file: 'vigil.hsl',
    find: 'edge ledger -> intake on AdvanceSignal::Committed;',
    replace: 'edge ledger -> triager on AdvanceSignal::Committed;',
  });

  // M3：守卫改写（触发条件变异）
  specs.push({
    id: 'M3-G1', operator: 'M3 GUARD_SWAP', description: 'triager->router 守卫 Escalate 换成 Retryable（G-8 违规预期）',
    file: 'vigil.hsl',
    find: 'edge triager -> router on Triage::Escalate;',
    replace: 'edge triager -> router on Triage::Retryable;',
  });
  specs.push({
    id: 'M3-G2', operator: 'M3 GUARD_SWAP', description: 'budget->router 守卫 Exhausted 换成 Within（守卫语义漂移）',
    file: 'vigil.hsl',
    find: 'edge budget -> router on BudgetSignal::Exhausted;',
    replace: 'edge budget -> router on BudgetSignal::Within;',
  });

  // M4-M8：行为/预算/闸门变异
  specs.push({
    id: 'M4-BUDGET', operator: 'M4 BUDGET_OFF', description: '轮预算边界 off-by-one（>= -> >）',
    file: 'types/state.hsl',
    find: 'if self.turns_used >= policy.max_turns {',
    replace: 'if self.turns_used > policy.max_turns {',
  });
  specs.push({
    id: 'M5-ROUTE', operator: 'M5 ROUTE_FLIP', description: '路由分流条件翻转（critical -> warning）',
    file: 'agents/router.hsl',
    find: 'if alert.severity == String::from("critical") {',
    replace: 'if alert.severity == String::from("warning") {',
  });
  specs.push({
    id: 'M6-CRITIC', operator: 'M6 CRITIC_THRESH', description: '审查闸门阈值松动（metrics_total >= 2 -> >= 1）',
    file: 'agents/critic.hsl',
    find: 'if metrics_total >= 2 && covering >= 1 {',
    replace: 'if metrics_total >= 1 && covering >= 1 {',
  });
  specs.push({
    id: 'M7-DRIFT', operator: 'M7 DRIFT_CAP', description: '漂移硬上限提升（*2 -> *3）',
    file: 'vigil.hsl',
    find: 'if budget.drift_count >= state.policy.max_drift * 2 {',
    replace: 'if budget.drift_count >= state.policy.max_drift * 3 {',
  });
  specs.push({
    id: 'M8-COMMIT', operator: 'M8 COMMIT_DROP', description: '提交路径丢弃案例落盘（cases.push 删除）',
    file: 'vigil.hsl',
    find: '                                        cases.push(record);\n',
    replace: '',
  });

  return specs;
}

/** 观测向量的差分签名（与基线不同 = 行为/拓扑变化） */
function signature(o: RunOutcome): string {
  return JSON.stringify([
    o.exitCode, o.ok, o.verdict, o.dispositions, o.faultEvents, o.deniedEvents, o.edgeFull,
  ]);
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

export async function runMutationTesting(
  specs: ScenarioSpec[],
  outRoot: string,
  onProgress?: (msg: string) => void,
): Promise<MutationRunResult> {
  const t0 = Date.now();
  const allMutants = mutantSpecs();
  const subjectDir = path.resolve('subject/vigil');

  // ---- 基线 ----
  onProgress?.('== 基线运行（pristine subject） ==');
  const baseline: RunOutcome[] = [];
  for (const spec of specs) {
    const outDir = path.join(outRoot, 'baseline', spec.id);
    const o = await runScenario(spec, outDir);
    o.conformanceDeviations = conformanceDeviations(spec, o);
    o.invariantViolations = checkInvariants(o, outDir);
    baseline.push(o);
    if (o.conformanceDeviations.length > 0) {
      onProgress?.(`  ⚠ 基线偏差 ${spec.id}: ${o.conformanceDeviations.join('; ')}`);
    }
  }
  const baseSig = new Map(baseline.map((o) => [o.id, signature(o)]));
  const baseInv = new Map(baseline.map((o) => [o.id, o.invariantViolations]));

  // ---- 变异体 ----
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

    // 全场景运行 + 双判据
    const killedBy: { scenario: string; deviations: string[] }[] = [];
    let runError: string | undefined;
    for (const spec of specs) {
      const outDir = path.join(mutantDir, 'runs', spec.id);
      let o: RunOutcome;
      try {
        o = await runScenario(spec, outDir, target);
      } catch (e) {
        runError = (e as Error).message;
        killedBy.push({ scenario: spec.id, deviations: [`runner error: ${runError}`] });
        break;
      }
      const dev = conformanceDeviations(spec, o);
      if (dev.length > 0) {
        killedBy.push({ scenario: spec.id, deviations: dev });
        continue;
      }
      const inv = checkInvariants(o, outDir);
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
