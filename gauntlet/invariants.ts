// ============================================================================
// gauntlet/invariants.ts — 轨迹不变式（时序性质，事件总线上的always/never/implies）
// ----------------------------------------------------------------------------
// 每条不变式都以「事件序列 + 案例产物」为证据面，可机械检查。
// 违反 = harness 行为偏离拓扑契约（比黄金对比更结构化的失败语义）。
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunOutcome } from './types';

export interface Invariant {
  id: string;
  statement: string;
  /** 返回违反说明列表（空 = 满足） */
  check: (o: RunOutcome, outDir: string) => string[];
}

const count = (seq: string[], g: string): number => seq.filter((x) => x === g).length;

function loadCases(outDir: string): { disposition: string; detail: string; alert_id: string }[] {
  try {
    return fs
      .readFileSync(path.join(outDir, 'cases.jsonl'), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { disposition: string; detail: string; alert_id: string });
  } catch {
    return [];
  }
}

function loadEvents(outDir: string): { name: string; data?: Record<string, unknown> }[] {
  try {
    return fs
      .readFileSync(path.join(outDir, 'events.jsonl'), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { name: string; data?: Record<string, unknown> });
  } catch {
    return [];
  }
}

export const INVARIANTS: Invariant[] = [
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

export function checkInvariants(outcome: RunOutcome, outDir: string): string[] {
  const violations: string[] = [];
  for (const inv of INVARIANTS) {
    for (const v of inv.check(outcome, outDir)) {
      violations.push(`${inv.id}: ${v}`);
    }
  }
  return violations;
}
