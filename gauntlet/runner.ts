// ============================================================================
// gauntlet/runner.ts — 场景运行器（子进程契约：dhv-ts run + 产物收集）
// ----------------------------------------------------------------------------
// 每个场景 = 一次干净的解释器子进程运行（隔离 + 与 CLI 用户一致的行为）。
// 观测面：run.json（exit/ok/panic）+ events.jsonl（edge/fault/denied 事件）
//        + cases.jsonl（处置案例）+ report.md（verdict 行）。
// 多 SUT 泛化（第八轮）：entry/场景清单经 SubjectSpec 注入；处置计数动态键
// （不再硬编码 committed/parked/escalated 三元组）。
// ============================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { $ } from 'bun';
import type { RunOutcome, ScenarioSpec } from './types';
import type { SubjectSpec } from './subject';

export const INTERP = 'vendor/dhv-ts/src/main.ts';

/** 运行单个场景（mutantSubjectDir 允许指向变异体副本目录） */
export async function runScenario(subject: SubjectSpec, spec: ScenarioSpec, outDir: string, mutantSubjectDir?: string): Promise<RunOutcome> {
  const entry = mutantSubjectDir ? path.join(mutantSubjectDir, subject.entryFile) : subject.entry;
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

/** 从产物目录解析观测向量（处置键动态计数 —— 任意 SUT 的处置词汇） */
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

  // cases.jsonl（处置键动态计数）
  const dispositions: Record<string, number> = {};
  try {
    const lines = fs.readFileSync(path.join(outDir, 'cases.jsonl'), 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      const c = JSON.parse(line) as { disposition?: string };
      if (c.disposition) dispositions[c.disposition] = (dispositions[c.disposition] ?? 0) + 1;
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

/** 黄金预期 vs 实际观测 → conformance 偏差列表（处置键并集同构比对） */
export function conformanceDeviations(spec: ScenarioSpec, outcome: RunOutcome): string[] {
  const d: string[] = [];
  const e = spec.expect;
  if (outcome.exitCode !== e.exit) d.push(`exit ${outcome.exitCode} != ${e.exit}`);
  if (outcome.ok !== e.ok) d.push(`ok ${outcome.ok} != ${e.ok}`);
  if (outcome.verdict !== e.verdict) d.push(`verdict ${outcome.verdict} != ${e.verdict}`);
  const keys = new Set([...Object.keys(e.dispositions), ...Object.keys(outcome.dispositions)]);
  for (const k of keys) {
    const want = e.dispositions[k] ?? 0;
    const got = outcome.dispositions[k] ?? 0;
    if (want !== got) d.push(`${k} ${got} != ${want}`);
  }
  if (outcome.faultEvents !== e.faultEvents) d.push(`fault_events ${outcome.faultEvents} != ${e.faultEvents}`);
  if (outcome.deniedEvents !== e.deniedEvents) d.push(`denied_events ${outcome.deniedEvents} != ${e.deniedEvents}`);
  return d;
}
