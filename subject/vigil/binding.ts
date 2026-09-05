// ============================================================================
// subject/vigil/binding.ts — Vigil SUT 的 Gauntlet 绑定
// ----------------------------------------------------------------------------
// 泛化实验（第八轮）：场景目录 / 不变式目录 / 变异算子目录从框架硬编码
// 迁移到 SUT 目录内 —— 框架层不再包含任何 Vigil 专属知识。
// ============================================================================

import * as fs from 'node:fs';
import type { ScenarioSpec, MutantSpec } from '../../gauntlet/types';
import type { Invariant } from '../../gauntlet/invariants';

export const VIGIL_DISPOSITIONS = ['committed', 'parked', 'escalated'] as const;

// ---------------------------------------------------------------------------
// 场景注册表（黄金预期来自实测验证的 15 个场景）
// ---------------------------------------------------------------------------
export function vigilScenarios(): ScenarioSpec[] {
  return [
    {
      id: 'n1', kind: 'nominal', title: '单告警快乐路径（分诊→探查→审查→综合→审计→提交）',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/nominal/n1.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 1, parked: 0, escalated: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'n2', kind: 'nominal', title: '分诊即升级（critical → pager）',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/nominal/n2.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 0, parked: 0, escalated: 1 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'n3', kind: 'nominal', title: '多告警混合处置（提交 + 停靠）',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/nominal/n3.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 1, parked: 1, escalated: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'n4', kind: 'nominal', title: '空收件箱边界（零告警）',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/nominal/n4.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 0, parked: 0, escalated: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'f1', kind: 'fault', title: 'F1 协议漂移→恢复', faultClass: 'model-protocol-drift',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/faults/f1-drift-recover.json', args: ['--max-turns', '8'],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 1, parked: 0, escalated: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'f2', kind: 'fault', title: 'F2 协议漂移→硬上限放弃', faultClass: 'model-protocol-drift',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/faults/f2-drift-exhaust.json', args: ['--max-turns', '8'],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 0, parked: 1, escalated: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'f3', kind: 'fault', title: 'F3 遥测端宕机（metrics.json 缺失）', faultClass: 'tool-absence',
      workspace: 'scenarios/faults/ws-f3', fixture: 'scenarios/faults/f3-telemetry-absent.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 0, parked: 1, escalated: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'f4', kind: 'fault', title: 'F4 遥测数据损坏（fs.read 截断）', faultClass: 'tool-corrupt',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/faults/f4-telemetry-corrupt.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 0, parked: 1, escalated: 0 }, faultEvents: 1, deniedEvents: 0 },
    },
    {
      id: 'f5', kind: 'fault', title: 'F5 工具权限拒绝（capability 撤销）', faultClass: 'tool-deny',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/faults/f5-tool-deny.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 0, parked: 1, escalated: 0 }, faultEvents: 1, deniedEvents: 1 },
    },
    {
      id: 'f6', kind: 'fault', title: 'F6 证据不足回环（指标与假设无关）', faultClass: 'evidence-insufficient',
      workspace: 'scenarios/faults/ws-f6', fixture: 'scenarios/faults/f6-insufficient-evidence.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 0, parked: 1, escalated: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'f7', kind: 'fault', title: 'F7 审稿驳回→返工→通过', faultClass: 'review-reject-recover',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/faults/f7-review-reject-recover.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 1, parked: 0, escalated: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'f8', kind: 'fault', title: 'F8 审稿驳回→预算耗尽→升级', faultClass: 'review-reject-exhaust',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/faults/f8-review-exhaust.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 0, parked: 0, escalated: 1 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'f9', kind: 'fault', title: 'F9 会话轮预算耗尽（停靠收束）', faultClass: 'budget-exhausted',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/faults/f9-turn-budget.json', args: ['--max-turns', '1'],
      expect: { exit: 0, ok: true, verdict: 'budget-exhausted', dispositions: { committed: 1, parked: 1, escalated: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'f10', kind: 'fault', title: 'F10 草稿协议漂移→纠错→通过', faultClass: 'model-protocol-drift',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/faults/f10-draft-drift.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 1, parked: 0, escalated: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'f11', kind: 'fault', title: 'F11 协议字段损坏→软漂移→恢复', faultClass: 'tool-corrupt',
      workspace: 'scenarios/nominal/ws-n1', fixture: 'scenarios/faults/f11-fields-corrupt.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'inbox-drained', dispositions: { committed: 1, parked: 0, escalated: 0 }, faultEvents: 1, deniedEvents: 0 },
    },
  ];
}

// ---------------------------------------------------------------------------
// 轨迹不变式目录（时序性质，事件总线上的 always/never/implies）
// ---------------------------------------------------------------------------
const count = (seq: string[], g: string): number => seq.filter((x) => x === g).length;

function loadCases(outDir: string): { disposition: string; detail: string; alert_id: string }[] {
  try {
    return fs
      .readFileSync(`${outDir}/cases.jsonl`, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l: string) => JSON.parse(l) as { disposition: string; detail: string; alert_id: string });
  } catch {
    return [];
  }
}

function loadEvents(outDir: string): { name: string; data?: Record<string, unknown> }[] {
  try {
    return fs
      .readFileSync(`${outDir}/events.jsonl`, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l: string) => JSON.parse(l) as { name: string; data?: Record<string, unknown> });
  } catch {
    return [];
  }
}

export const VIGIL_INVARIANTS: Invariant[] = [
  {
    id: 'INV-1',
    statement: 'every Accepted edge is immediately followed by a Committed edge（审计通过必然提交）',
    check: (o) => {
      const v: string[] = [];
      const edges = o.edgeSeq;
      for (let i = 0; i < edges.length; i++) {
        if (edges[i] === 'Accepted' && (i + 1 >= edges.length || edges[i + 1] !== 'Committed')) {
          v.push(`Accepted at #${i} not followed by Committed (next=${edges[i + 1] ?? 'EOF'})`);
        }
      }
      return v;
    },
  },
  {
    id: 'INV-2',
    statement: 'accepted + rejected edge count <= submitted count（每次裁决前必有草稿）',
    check: (o) => {
      const n = count(o.edgeSeq, 'Accepted') + count(o.edgeSeq, 'Rejected');
      const s = count(o.edgeSeq, 'Submitted');
      return n > s ? [`accepted(${count(o.edgeSeq, 'Accepted')}) + rejected(${count(o.edgeSeq, 'Rejected')}) > submitted(${s})`] : [];
    },
  },
  {
    id: 'INV-3',
    statement: 'every Submitted edge is preceded somewhere by a Sound edge（草稿提交前证据审查必然至少通过一次）',
    check: (o) => {
      const v: string[] = [];
      const edges = o.edgeSeq;
      for (let i = 0; i < edges.length; i++) {
        if (edges[i] === 'Submitted' && !edges.slice(0, i).includes('Sound')) {
          v.push(`Submitted at #${i} with no prior Sound`);
        }
      }
      return v;
    },
  },
  {
    id: 'INV-4',
    statement: 'sound count <= evidence-ready count（审查通过前证据必然齐备）',
    check: (o) => {
      const c = count(o.edgeSeq, 'Sound');
      const r = count(o.edgeSeq, 'EvidenceReady');
      return c > r ? [`sound(${c}) > evidence-ready(${r})`] : [];
    },
  },
  {
    id: 'INV-5',
    statement: 'DriftWarn implies >= 2 prior Retryable edges（漂移告警必然源于真实漂移）',
    check: (o) => {
      const v: string[] = [];
      const edges = o.edgeSeq;
      for (let i = 0; i < edges.length; i++) {
        if (edges[i] === 'DriftWarn') {
          const prior = edges.slice(0, i).filter((x) => x === 'Retryable').length;
          if (prior < 2) v.push(`DriftWarn at #${i} with only ${prior} prior Retryable`);
        }
      }
      return v;
    },
  },
  {
    id: 'INV-6',
    statement: 'Exhausted edge implies verdict = budget-exhausted（预算耗尽边与会话裁决一致）',
    check: (o) => {
      const has = count(o.edgeSeq, 'Exhausted') > 0;
      if (has && o.verdict !== 'budget-exhausted') return [`Exhausted fired but verdict=${o.verdict}`];
      if (!has && o.verdict === 'budget-exhausted') return [`verdict=budget-exhausted but no Exhausted edge`];
      return [];
    },
  },
  {
    id: 'INV-7',
    statement: 'committed cases == Accepted edge count（案例产物与拓扑事件一致）',
    check: (o, outDir) => {
      const cases = loadCases(outDir).filter((c) => c.disposition === 'committed').length;
      const a = count(o.edgeSeq, 'Accepted');
      return cases !== a ? [`committed cases(${cases}) != Accepted edges(${a})`] : [];
    },
  },
  {
    id: 'INV-8',
    statement: 'parked cases == Parked edge count; escalated cases == Escalated edge count',
    check: (o, outDir) => {
      const cases = loadCases(outDir);
      const p = cases.filter((c) => c.disposition === 'parked').length;
      const e = cases.filter((c) => c.disposition === 'escalated').length;
      const v: string[] = [];
      if (p !== count(o.edgeSeq, 'Parked')) v.push(`parked cases(${p}) != Parked edges(${count(o.edgeSeq, 'Parked')})`);
      if (e !== count(o.edgeSeq, 'Escalated')) v.push(`escalated cases(${e}) != Escalated edges(${count(o.edgeSeq, 'Escalated')})`);
      return v;
    },
  },
  {
    id: 'INV-9',
    statement: 'no run_panic event in any completed scenario（韧性：harness 不panic）',
    check: (_o, outDir) => {
      const events = loadEvents(outDir);
      return events.some((e) => e.name === 'run_panic') ? ['run_panic present'] : [];
    },
  },
  {
    id: 'INV-10',
    statement: 'fault_injected implies no later run_panic（故障下不崩溃 —— 故障注入韧性）',
    check: (_o, outDir) => {
      const events = loadEvents(outDir);
      const fi = events.findIndex((e) => e.name === 'fault_injected');
      if (fi < 0) return [];
      const panic = events.findIndex((e) => e.name === 'run_panic');
      return panic >= 0 && panic > fi ? ['run_panic after fault_injected'] : [];
    },
  },
  {
    id: 'INV-11',
    statement: 'every committed case has non-empty postmortem detail（提交质量闸门）',
    check: (_o, outDir) => {
      const cases = loadCases(outDir);
      const bad = cases.filter((c) => c.disposition === 'committed' && (!c.detail || c.detail.trim().length === 0));
      return bad.length > 0 ? [`${bad.length} committed case(s) with empty detail`] : [];
    },
  },
];

// ---------------------------------------------------------------------------
// 变异算子目录（对 subject/vigil 的源文本做精确单点替换）
// ---------------------------------------------------------------------------
export function vigilMutants(): MutantSpec[] {
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
