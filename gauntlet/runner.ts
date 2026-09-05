// ============================================================================
// gauntlet/runner.ts — 场景运行器（子进程契约：dhv-ts run + 产物收集）
// ----------------------------------------------------------------------------
// 每个场景 = 一次干净的解释器子进程运行（隔离 + 与 CLI 用户一致的行为）。
// 观测面：run.json（exit/ok/panic）+ events.jsonl（edge/fault/denied 事件）
//        + cases.jsonl（处置案例）+ report.md（verdict 行）。
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { $ } from 'bun';
import type { RunOutcome, ScenarioSpec } from './types';

export const SUBJECT = 'subject/vigil/vigil.hsl';
export const INTERP = 'vendor/dhv-ts/src/main.ts';

/** 场景注册表（黄金预期来自实测验证的 15 个场景） */
export function scenarios(): ScenarioSpec[] {
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

/** 运行单个场景（subjectDir 允许指向变异体副本） */
export async function runScenario(spec: ScenarioSpec, outDir: string, subjectDir?: string): Promise<RunOutcome> {
  const entry = subjectDir ? path.join(subjectDir, 'vigil.hsl') : SUBJECT;
  const fixture = path.resolve(spec.fixture);
  const workspace = path.resolve(spec.workspace);
  fs.mkdirSync(outDir, { recursive: true });

  const cmd = ['run', entry, '--workspace', workspace, '--task', `gauntlet:${spec.id}`, '--model', 'scripted', '--fixture', fixture, '--out', outDir, '--quiet', ...spec.args];
  const t0 = Date.now();
  const proc = await $`bun ${INTERP} ${cmd}`.quiet().nothrow();
  const elapsedMs = Date.now() - t0;

  return {
    id: spec.id,
    exitCode: proc.exitCode,
    ...(await parseOutcomeDir(outDir, spec.id)),
    elapsedMs,
  } as RunOutcome;
}

/** 从产物目录解析观测向量 */
export async function parseOutcomeDir(outDir: string, id: string): Promise<Partial<RunOutcome>> {
  // run.json
  let ok = false;
  try {
    const runJson = JSON.parse(fs.readFileSync(path.join(outDir, 'run.json'), 'utf-8')) as { ok?: boolean };
    ok = !!runJson.ok;
  } catch { /* panic 或产物缺失 → ok=false */ }

  // events.jsonl
  const edgeSeq: string[] = [];
  const edgeFull: string[] = [];
  let faultEvents = 0;
  let deniedEvents = 0;
  try {
    const lines = fs.readFileSync(path.join(outDir, 'events.jsonl'), 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      const e = JSON.parse(line) as { name: string; data?: { on?: string; from?: string; to?: string } };
      if (e.name === 'edge' && e.data?.on) {
        edgeSeq.push(e.data.on);
        edgeFull.push(`${e.data.from}->${e.data.to}:${e.data.on}`);
      }
      if (e.name === 'fault_injected') faultEvents++;
      if (e.name === 'capability_denied') deniedEvents++;
    }
  } catch { /* 无事件文件 */ }

  // cases.jsonl
  const dispositions = { committed: 0, parked: 0, escalated: 0 };
  try {
    const lines = fs.readFileSync(path.join(outDir, 'cases.jsonl'), 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      const c = JSON.parse(line) as { disposition?: string };
      if (c.disposition === 'committed') dispositions.committed++;
      else if (c.disposition === 'parked') dispositions.parked++;
      else if (c.disposition === 'escalated') dispositions.escalated++;
    }
  } catch { /* 无案例文件 */ }

  // report.md 的 verdict 行
  let verdict = '(missing)';
  try {
    const md = fs.readFileSync(path.join(outDir, 'report.md'), 'utf-8');
    const m = md.match(/- verdict: (\S+)/);
    if (m) verdict = m[1]!;
  } catch { /* 无报告 */ }

  return { id, ok, verdict, dispositions, edgeSeq, edgeFull, edgeSet: [...new Set(edgeSeq)], faultEvents, deniedEvents };
}

/** 黄金预期 vs 实际观测 → conformance 偏差列表 */
export function conformanceDeviations(spec: ScenarioSpec, outcome: RunOutcome): string[] {
  const d: string[] = [];
  const e = spec.expect;
  if (outcome.exitCode !== e.exit) d.push(`exit ${outcome.exitCode} != ${e.exit}`);
  if (outcome.ok !== e.ok) d.push(`ok ${outcome.ok} != ${e.ok}`);
  if (outcome.verdict !== e.verdict) d.push(`verdict ${outcome.verdict} != ${e.verdict}`);
  if (outcome.dispositions.committed !== e.dispositions.committed) d.push(`committed ${outcome.dispositions.committed} != ${e.dispositions.committed}`);
  if (outcome.dispositions.parked !== e.dispositions.parked) d.push(`parked ${outcome.dispositions.parked} != ${e.dispositions.parked}`);
  if (outcome.dispositions.escalated !== e.dispositions.escalated) d.push(`escalated ${outcome.dispositions.escalated} != ${e.dispositions.escalated}`);
  if (outcome.faultEvents !== e.faultEvents) d.push(`fault_events ${outcome.faultEvents} != ${e.faultEvents}`);
  if (outcome.deniedEvents !== e.deniedEvents) d.push(`denied_events ${outcome.deniedEvents} != ${e.deniedEvents}`);
  return d;
}
