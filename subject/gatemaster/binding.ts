// ============================================================================
// subject/gatemaster/binding.ts — Gatemaster SUT 的 Gauntlet 绑定（SUT #3）
// ----------------------------------------------------------------------------
// 泛化实验（第十轮）：第三域 SUT —— CI 失败分诊（escalation ladder 阶梯拓扑）。
// 场景 / 不变式 / 变异目录全部在本文件声明，验证 Gauntlet 框架层的 SUT 无关性
// （拓扑家族：router / sink / staircase 三种结构签名的对照实验）。
// ============================================================================

import * as fs from 'node:fs';
import type { ScenarioSpec, MutantSpec } from '../../gauntlet/types';
import type { Invariant } from '../../gauntlet/invariants';

export const GATEMASTER_DISPOSITIONS = ['fixed', 'escalated', 'abandoned'] as const;

// ---------------------------------------------------------------------------
// 场景注册表（黄金预期经实测校准的 17 个场景：4 nominal + 13 fault）
// ---------------------------------------------------------------------------
export function gatemasterScenarios(): ScenarioSpec[] {
  return [
    {
      id: 'gn1', kind: 'nominal', title: '单构建快乐路径（日志闸→分类→提案→验证→落账）',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/nominal/gn1.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 1, escalated: 0, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gn2', kind: 'nominal', title: '双构建批次（compile + dependency 各自修复落账）',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/nominal/gn2.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 2, escalated: 0, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gn3', kind: 'nominal', title: 'flaky 抖动自愈（L1 清洁重跑容忍重验）',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/nominal/gn3.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 1, escalated: 0, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gn4', kind: 'nominal', title: '空批次边界（零构建）',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/nominal/gn4.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 0, escalated: 0, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gf1', kind: 'fault', title: 'GF1 分类协议漂移→恢复', faultClass: 'model-protocol-drift',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/faults/gf1-classify-drift-recover.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 1, escalated: 0, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gf2', kind: 'fault', title: 'GF2 分类协议漂移→硬上限（会话漂移预算耗尽）', faultClass: 'model-protocol-drift',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/faults/gf2-classify-drift-exhaust.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 0, escalated: 1, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gf3', kind: 'fault', title: 'GF3 词表外类别（无法分类→直接 paging）', faultClass: 'model-vocab-drift',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/faults/gf3-unclassifiable.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 0, escalated: 1, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gf4', kind: 'fault', title: 'GF4 模型显式放弃（NoFixPossible→直接 paging）', faultClass: 'model-give-up',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/faults/gf4-give-up.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 0, escalated: 1, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gf5', kind: 'fault', title: 'GF5 签名词料缺失（全阶梯走完→paging）', faultClass: 'tool-absence',
      workspace: 'scenarios/gatemaster/faults/ws-gf5', fixture: 'scenarios/gatemaster/faults/gf5-signatures-absent.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 0, escalated: 1, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gf6', kind: 'fault', title: 'GF6 签名词料读取损坏（fs.read 成功但 JSON 非法）', faultClass: 'tool-corrupt',
      workspace: 'scenarios/gatemaster/faults/ws-gf6', fixture: 'scenarios/gatemaster/faults/gf6-signatures-corrupt.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 0, escalated: 1, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gf7', kind: 'fault', title: 'GF7 签名词料读取权限拒绝（capability 撤销）', faultClass: 'tool-deny',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/faults/gf7-signatures-deny.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 0, escalated: 1, abandoned: 0 }, faultEvents: 1, deniedEvents: 1 },
    },
    {
      id: 'gf8', kind: 'fault', title: 'GF8 修复回环耗尽（补丁太薄×2→强制下梯→放弃）', faultClass: 'budget-exhausted',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/faults/gf8-repair-exhaust.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 0, escalated: 0, abandoned: 1 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gf9', kind: 'fault', title: 'GF9 会话死线（--max-turns 1→剩余批次放弃收束）', faultClass: 'budget-exhausted',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/faults/gf9-deadline.json', args: ['--max-turns', '1'],
      expect: { exit: 0, ok: true, verdict: 'deadline-break', dispositions: { fixed: 0, escalated: 0, abandoned: 2 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gf10', kind: 'fault', title: 'GF10 日志截断→重取恢复', faultClass: 'tool-corrupt',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/faults/gf10-log-trunc-recover.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 1, escalated: 0, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gf11', kind: 'fault', title: 'GF11 日志截断→重取耗尽（放弃收束）', faultClass: 'tool-absence',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/faults/gf11-log-trunc-exhaust.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 0, escalated: 0, abandoned: 1 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gf12', kind: 'fault', title: 'GF12 签名词料字段形状损坏（软降级→内建集→修复成立）', faultClass: 'tool-corrupt',
      workspace: 'scenarios/gatemaster/faults/ws-gf12', fixture: 'scenarios/gatemaster/faults/gf12-signatures-soft.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 1, escalated: 0, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'gf13', kind: 'fault', title: 'GF13 修复协议漂移→恢复', faultClass: 'model-protocol-drift',
      workspace: 'scenarios/gatemaster/nominal/ws-gn1', fixture: 'scenarios/gatemaster/faults/gf13-fix-drift-recover.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { fixed: 1, escalated: 0, abandoned: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
  ];
}

// ---------------------------------------------------------------------------
// 轨迹不变式目录（Gatemaster 域：阶梯单调性 / 守恒 / 修复环时序）
// ---------------------------------------------------------------------------
const count = (seq: string[], g: string): number => seq.filter((x) => x === g).length;

function loadCases(outDir: string): { disposition: string; detail: string; build_id: string }[] {
  try {
    return fs
      .readFileSync(`${outDir}/cases.jsonl`, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { disposition: string; detail: string; build_id: string });
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
      .map((l) => JSON.parse(l) as { name: string; data?: Record<string, unknown> });
  } catch {
    return [];
  }
}

export const GATEMASTER_INVARIANTS: Invariant[] = [
  {
    id: 'GINV-1',
    statement: 'every CaseDispatched edge is followed by BuildReceived, DeadlineAlarm, AttemptsExhausted, or end-of-events（落账必然终结当前构建周期）',
    check: (o) => {
      const v: string[] = [];
      const edges = o.edgeSeq;
      for (let i = 0; i < edges.length; i++) {
        if (edges[i] === 'CaseDispatched') {
          const next = edges[i + 1];
          if (next !== undefined && next !== 'BuildReceived' && next !== 'DeadlineAlarm' && next !== 'AttemptsExhausted') {
            v.push(`CaseDispatched at #${i} followed by ${next} (not BuildReceived/DeadlineAlarm/AttemptsExhausted/EOF)`);
          }
        }
      }
      return v;
    },
  },
  {
    id: 'GINV-2',
    statement: 'fixed + escalated + non-aggregate abandoned cases <= BuildReceived count（处置必然源于已接收构建；聚合死线案例除外）',
    check: (o, outDir) => {
      const cases = loadCases(outDir);
      const total = cases.filter((c) => c.disposition === 'fixed' || c.disposition === 'escalated' || (c.disposition === 'abandoned' && c.build_id !== '(batch)')).length;
      const r = count(o.edgeSeq, 'BuildReceived');
      return total > r ? [`cases(${total}) > BuildReceived(${r})`] : [];
    },
  },
  {
    id: 'GINV-3',
    statement: 'every FixVerified edge is preceded somewhere by a FixProposed edge（验证必然源于提案）',
    check: (o) => {
      const v: string[] = [];
      const edges = o.edgeSeq;
      for (let i = 0; i < edges.length; i++) {
        if (edges[i] === 'FixVerified' && !edges.slice(0, i).includes('FixProposed')) {
          v.push(`FixVerified at #${i} with no prior FixProposed`);
        }
      }
      return v;
    },
  },
  {
    id: 'GINV-4',
    statement: 'every L2Bisect edge is preceded somewhere by an L1CleanRerun edge（阶梯单调性：L2 必然在 L1 之后）',
    check: (o) => {
      const v: string[] = [];
      const edges = o.edgeSeq;
      for (let i = 0; i < edges.length; i++) {
        if (edges[i] === 'L2Bisect' && !edges.slice(0, i).includes('L1CleanRerun')) {
          v.push(`L2Bisect at #${i} with no prior L1CleanRerun`);
        }
      }
      return v;
    },
  },
  {
    id: 'GINV-5',
    statement: 'every L3Paged edge is preceded somewhere by L2Bisect, Unclassifiable, NoFixPossible, or ClassifyDrift（paging 必然有升级源）',
    check: (o) => {
      const v: string[] = [];
      const edges = o.edgeSeq;
      const sources = ['L2Bisect', 'Unclassifiable', 'NoFixPossible', 'ClassifyDrift', 'FixDrift'];
      for (let i = 0; i < edges.length; i++) {
        if (edges[i] === 'L3Paged' && !edges.slice(0, i).some((x) => sources.includes(x))) {
          v.push(`L3Paged at #${i} with no escalation source among ${sources.join('/')}`);
        }
      }
      return v;
    },
  },
  {
    id: 'GINV-6',
    statement: 'every LadderExhausted edge is preceded somewhere by AttemptsExhausted or LogTruncated（放弃必然有预算或语料根因）',
    check: (o) => {
      const v: string[] = [];
      const edges = o.edgeSeq;
      for (let i = 0; i < edges.length; i++) {
        if (edges[i] === 'LadderExhausted') {
          const prior = edges.slice(0, i);
          if (!prior.includes('AttemptsExhausted') && !prior.some((x) => x === 'LogTruncated')) {
            v.push(`LadderExhausted at #${i} with no prior AttemptsExhausted/LogTruncated`);
          }
        }
      }
      return v;
    },
  },
  {
    id: 'GINV-7',
    statement: 'L1CleanRerun count <= StillFailing count（清洁重跑必然源于验证失败）',
    check: (o) => {
      const l1 = count(o.edgeSeq, 'L1CleanRerun');
      const sf = count(o.edgeSeq, 'StillFailing');
      return l1 > sf ? [`L1CleanRerun(${l1}) > StillFailing(${sf})`] : [];
    },
  },
  {
    id: 'GINV-8',
    statement: 'fixed cases == FixVerified edge count（案例产物与拓扑事件一致）',
    check: (o, outDir) => {
      const cases = loadCases(outDir).filter((c) => c.disposition === 'fixed').length;
      const p = count(o.edgeSeq, 'FixVerified');
      return cases !== p ? [`fixed cases(${cases}) != FixVerified edges(${p})`] : [];
    },
  },
  {
    id: 'GINV-9',
    statement: 'escalated cases == L3Paged edge count ∧ abandoned cases == LadderExhausted + DeadlineAlarm edge count（阶梯终态守恒）',
    check: (o, outDir) => {
      const cases = loadCases(outDir);
      const esc = cases.filter((c) => c.disposition === 'escalated').length;
      const ab = cases.filter((c) => c.disposition === 'abandoned').length;
      const paged = count(o.edgeSeq, 'L3Paged');
      const exhaust = count(o.edgeSeq, 'LadderExhausted') + count(o.edgeSeq, 'DeadlineAlarm');
      const v: string[] = [];
      if (esc !== paged) v.push(`escalated cases(${esc}) != L3Paged edges(${paged})`);
      if (ab !== exhaust) v.push(`abandoned cases(${ab}) != LadderExhausted+DeadlineAlarm edges(${exhaust})`);
      return v;
    },
  },
  {
    id: 'GINV-10',
    statement: 'no run_panic event in any completed scenario（韧性：harness 不panic）',
    check: (_o, outDir) => {
      const events = loadEvents(outDir);
      return events.some((e) => e.name === 'run_panic') ? ['run_panic present'] : [];
    },
  },
  {
    id: 'GINV-11',
    statement: 'fault_injected implies no later run_panic（故障下不崩溃 —— 故障注入韧性）',
    check: (_o, outDir) => {
      const events = loadEvents(outDir);
      const fi = events.findIndex((e) => e.name === 'fault_injected');
      if (fi < 0) return [];
      const panic = events.findIndex((e) => e.name === 'run_panic');
      return panic >= 0 && panic > fi ? ['run_panic after fault_injected'] : [];
    },
  },
];

// ---------------------------------------------------------------------------
// 变异算子目录（对 subject/gatemaster 的源文本做精确单点替换）
// ---------------------------------------------------------------------------
export function gatemasterMutants(): MutantSpec[] {
  const specs: MutantSpec[] = [];

  // M1：19 条边逐一删除（拓扑契约变异）
  const edgeLines: [string, string][] = [
    ['gatemaster.hsl', '    edge intake -> log_gate on BuildEvent::BuildReceived;'],
    ['gatemaster.hsl', '    edge log_gate -> intake on LogEvent::LogTruncated;'],
    ['gatemaster.hsl', '    edge log_gate -> classifier on LogEvent::LogComplete;'],
    ['gatemaster.hsl', '    edge classifier -> classifier on ClassifyEvent::ClassifyDrift;'],
    ['gatemaster.hsl', '    edge classifier -> fixer on ClassifyEvent::FailureClassified;'],
    ['gatemaster.hsl', '    edge classifier -> escalator on ClassifyEvent::Unclassifiable;'],
    ['gatemaster.hsl', '    edge fixer -> verifier on FixEvent::FixProposed;'],
    ['gatemaster.hsl', '    edge fixer -> fixer on FixEvent::FixDrift;'],
    ['gatemaster.hsl', '    edge fixer -> escalator on FixEvent::NoFixPossible;'],
    ['gatemaster.hsl', '    edge verifier -> ledger on VerifyEvent::FixVerified;'],
    ['gatemaster.hsl', '    edge verifier -> fixer on VerifyEvent::FixRejected;'],
    ['gatemaster.hsl', '    edge verifier -> escalator on VerifyEvent::StillFailing;'],
    ['gatemaster.hsl', '    edge escalator -> verifier on EscalateEvent::L1CleanRerun;'],
    ['gatemaster.hsl', '    edge escalator -> fixer on EscalateEvent::L2Bisect;'],
    ['gatemaster.hsl', '    edge escalator -> ledger on EscalateEvent::L3Paged;'],
    ['gatemaster.hsl', '    edge escalator -> ledger on EscalateEvent::LadderExhausted;'],
    ['gatemaster.hsl', '    edge budget -> escalator on BudgetSignal::AttemptsExhausted;'],
    ['gatemaster.hsl', '    edge budget -> ledger on BudgetSignal::DeadlineAlarm;'],
    ['gatemaster.hsl', '    edge ledger -> intake on LedgerEvent::CaseDispatched;'],
  ];
  for (let i = 0; i < edgeLines.length; i++) {
    const [file, line] = edgeLines[i]!;
    specs.push({
      id: `M1-G${i + 1}`,
      operator: 'M1 EDGE_DEL',
      description: `删除边声明: ${line.trim()}`,
      file,
      find: line + '\n',
      replace: '',
    });
  }

  // M2：边端点改写（拓扑签名变异 —— 阶梯结构的重定向）
  specs.push({
    id: 'M2-G1', operator: 'M2 EDGE_REDIRECT', description: 'fixer->verifier 改为 fixer->escalator（提案跳过验证直达升梯）',
    file: 'gatemaster.hsl',
    find: 'edge fixer -> verifier on FixEvent::FixProposed;',
    replace: 'edge fixer -> escalator on FixEvent::FixProposed;',
  });
  specs.push({
    id: 'M2-G2', operator: 'M2 EDGE_REDIRECT', description: 'escalator->verifier 改为 escalator->ledger（L1 重跑直达落账）',
    file: 'gatemaster.hsl',
    find: 'edge escalator -> verifier on EscalateEvent::L1CleanRerun;',
    replace: 'edge escalator -> ledger on EscalateEvent::L1CleanRerun;',
  });
  specs.push({
    id: 'M2-G3', operator: 'M2 EDGE_REDIRECT', description: 'verifier->ledger 改为 verifier->escalator（验证成立进升梯）',
    file: 'gatemaster.hsl',
    find: 'edge verifier -> ledger on VerifyEvent::FixVerified;',
    replace: 'edge verifier -> escalator on VerifyEvent::FixVerified;',
  });

  // M3：守卫改写（触发条件变异）
  specs.push({
    id: 'M3-G1', operator: 'M3 GUARD_SWAP', description: 'classifier->fixer 守卫 FailureClassified 换成 ClassifyDrift（守卫别名预期）',
    file: 'gatemaster.hsl',
    find: 'edge classifier -> fixer on ClassifyEvent::FailureClassified;',
    replace: 'edge classifier -> fixer on ClassifyEvent::ClassifyDrift;',
  });
  specs.push({
    id: 'M3-G2', operator: 'M3 GUARD_SWAP', description: 'budget->ledger 守卫 DeadlineAlarm 换成 Within（守卫语义漂移）',
    file: 'gatemaster.hsl',
    find: 'edge budget -> ledger on BudgetSignal::DeadlineAlarm;',
    replace: 'edge budget -> ledger on BudgetSignal::Within;',
  });

  // M4-M8：行为/预算/闸门变异（Gatemaster 域版本）
  specs.push({
    id: 'M4-BUDGET', operator: 'M4 BUDGET_OFF', description: '死线预算边界 off-by-one（>= -> >）',
    file: 'types/state.hsl',
    find: 'if self.builds_seen >= policy.max_turns {',
    replace: 'if self.builds_seen > policy.max_turns {',
  });
  specs.push({
    id: 'M5-LOGGATE', operator: 'M5 GATE_FLIP', description: '日志闸最小长度 40 → 0（截断永不触发）',
    file: 'agents/log_gate.hsl',
    find: 'LogGate { min_log: 40 }',
    replace: 'LogGate { min_log: 0 }',
  });
  specs.push({
    id: 'M6-FLAKY', operator: 'M6 VERIFY_THRESH', description: 'flaky 容忍闸松动（flaky_pass 门移除 → 抖动首验即过）',
    file: 'agents/verifier.hsl',
    find: 'if flaky_pass && kind == String::from("flaky") {',
    replace: 'if kind == String::from("flaky") {',
  });
  specs.push({
    id: 'M7-DRIFT-CAP', operator: 'M7 DRIFT_CAP', description: '分类漂移硬上限提升（*2 -> *3）',
    file: 'gatemaster.hsl',
    find: 'if budget.drift_count >= state.policy.max_drift * 2 {\n                                    class_dead = format!("classify protocol drift exhausted: {}", note);',
    replace: 'if budget.drift_count >= state.policy.max_drift * 3 {\n                                    class_dead = format!("classify protocol drift exhausted: {}", note);',
  });
  specs.push({
    id: 'M8-DISPATCH-DROP', operator: 'M8 DISPATCH_DROP', description: 'fix 模式 fixed 落账路径丢弃案例落盘（保留重跑路径）',
    file: 'gatemaster.hsl',
    find: '                                                cases.push(CaseRecord { build_id: case.build_id.clone(), disposition: case.disposition.clone(), detail: receipt });\n                                                bump!(state.stats.fixed, 1);\n                                                terminal = true;',
    replace: '                                                bump!(state.stats.fixed, 1);\n                                                terminal = true;',
  });

  return specs;
}
