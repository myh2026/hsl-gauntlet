// ============================================================================
// subject/curator/binding.ts — Curator SUT 的 Gauntlet 绑定（SUT #2）
// ----------------------------------------------------------------------------
// 泛化实验（第八轮）：零框架改动的第二仨 SUT 绑定 —— 场景 / 不变式 / 变异
// 目录全部在本文件声明，验证 Gauntlet 框架层的 SUT 无关性。
// ============================================================================

import * as fs from 'node:fs';
import type { ScenarioSpec, MutantSpec } from '../../gauntlet/types';
import type { Invariant } from '../../gauntlet/invariants';

export const CURATOR_DISPOSITIONS = ['published', 'quarantined', 'deferred'] as const;

// ---------------------------------------------------------------------------
// 场景注册表（黄金预期经实测校准的 15 个场景：4 nominal + 11 fault）
// ---------------------------------------------------------------------------
export function curatorScenarios(): ScenarioSpec[] {
  return [
    {
      id: 'cn1', kind: 'nominal', title: '单文档快乐路径（模式闸→抽取→校验→富集→发布）',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/nominal/cn1.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 1, quarantined: 0, deferred: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'cn2', kind: 'nominal', title: '混合批次（发布 + 模式闸拦截）',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/nominal/cn2.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 1, quarantined: 1, deferred: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'cn3', kind: 'nominal', title: '校验修复回环（首轮单实体→重抽取→通过→发布）',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/nominal/cn3.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 1, quarantined: 0, deferred: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'cn4', kind: 'nominal', title: '空批次边界（零文档）',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/nominal/cn4.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 0, quarantined: 0, deferred: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'cf1', kind: 'fault', title: 'CF1 抽取协议漂移→恢复', faultClass: 'model-protocol-drift',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/faults/cf1-drift-recover.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 1, quarantined: 0, deferred: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'cf2', kind: 'fault', title: 'CF2 抽取协议漂移→硬上限隔离', faultClass: 'model-protocol-drift',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/faults/cf2-drift-exhaust.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 0, quarantined: 1, deferred: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'cf3', kind: 'fault', title: 'CF3 领域语料缺失（corpus.json 缺失）', faultClass: 'tool-absence',
      workspace: 'scenarios/curator/faults/ws-cf3', fixture: 'scenarios/curator/faults/cf3-corpus-absent.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 0, quarantined: 1, deferred: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'cf4', kind: 'fault', title: 'CF4 领域语料读取损坏（fs.read 截断）', faultClass: 'tool-corrupt',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/faults/cf4-corpus-corrupt.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 0, quarantined: 1, deferred: 0 }, faultEvents: 1, deniedEvents: 0 },
    },
    {
      id: 'cf5', kind: 'fault', title: 'CF5 语料读取权限拒绝（capability 撤销）', faultClass: 'tool-deny',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/faults/cf5-corpus-deny.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 0, quarantined: 1, deferred: 0 }, faultEvents: 1, deniedEvents: 1 },
    },
    {
      id: 'cf6', kind: 'fault', title: 'CF6 校验修复回环耗尽（低置信实体 ×3）', faultClass: 'validation-repair-exhausted',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/faults/cf6-validation-exhaust.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 0, quarantined: 1, deferred: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'cf7', kind: 'fault', title: 'CF7 发布驳回→返工→通过', faultClass: 'review-reject-recover',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/faults/cf7-publish-reject-recover.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 1, quarantined: 0, deferred: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'cf8', kind: 'fault', title: 'CF8 富集协议硬失败→隔离', faultClass: 'model-protocol-drift',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/faults/cf8-enrich-fail.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 0, quarantined: 1, deferred: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'cf9', kind: 'fault', title: 'CF9 会话轮预算耗尽（递延收束）', faultClass: 'budget-exhausted',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/faults/cf9-turn-budget.json', args: ['--max-turns', '1'],
      expect: { exit: 0, ok: true, verdict: 'budget-exhausted', dispositions: { published: 1, quarantined: 0, deferred: 1 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'cf10', kind: 'fault', title: 'CF10 富集部分完成→重试→发布', faultClass: 'enrichment-partial',
      workspace: 'scenarios/curator/nominal/ws-cn1', fixture: 'scenarios/curator/faults/cf10-partial-recover.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 1, quarantined: 0, deferred: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
    {
      id: 'cf11', kind: 'fault', title: 'CF11 语料字段形状损坏→软降级→恢复', faultClass: 'tool-corrupt',
      workspace: 'scenarios/curator/faults/ws-cf11', fixture: 'scenarios/curator/faults/cf11-corpus-soft.json', args: [],
      expect: { exit: 0, ok: true, verdict: 'batch-drained', dispositions: { published: 1, quarantined: 0, deferred: 0 }, faultEvents: 0, deniedEvents: 0 },
    },
  ];
}

// ---------------------------------------------------------------------------
// 轨迹不变式目录（Curator 域：fan-in 收敛 / 守恒 / 修复回环时序）
// ---------------------------------------------------------------------------
const count = (seq: string[], g: string): number => seq.filter((x) => x === g).length;

function loadCases(outDir: string): { disposition: string; detail: string; doc_id: string }[] {
  try {
    return fs
      .readFileSync(`${outDir}/cases.jsonl`, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { disposition: string; detail: string; doc_id: string });
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

export const CURATOR_INVARIANTS: Invariant[] = [
  {
    id: 'CINV-1',
    statement: 'every Published edge is followed by DocumentReceived, TurnExhausted, or end-of-events（发布必然终结当前文档周期）',
    check: (o) => {
      const v: string[] = [];
      const edges = o.edgeSeq;
      for (let i = 0; i < edges.length; i++) {
        if (edges[i] === 'Published') {
          const next = edges[i + 1];
          if (next !== undefined && next !== 'DocumentReceived' && next !== 'TurnExhausted') {
            v.push(`Published at #${i} followed by ${next} (not DocumentReceived/TurnExhausted/EOF)`);
          }
        }
      }
      return v;
    },
  },
  {
    id: 'CINV-2',
    statement: 'published + quarantined cases <= DocumentReceived count（处置必然源于已接收文档）',
    check: (o, outDir) => {
      const cases = loadCases(outDir);
      const p = cases.filter((c) => c.disposition === 'published').length;
      const q = cases.filter((c) => c.disposition === 'quarantined').length;
      const r = count(o.edgeSeq, 'DocumentReceived');
      return p + q > r ? [`published(${p}) + quarantined(${q}) > DocumentReceived(${r})`] : [];
    },
  },
  {
    id: 'CINV-3',
    statement: 'every EnrichmentComplete edge is preceded somewhere by an EntitiesValid edge（富集前校验必然通过）',
    check: (o) => {
      const v: string[] = [];
      const edges = o.edgeSeq;
      for (let i = 0; i < edges.length; i++) {
        if (edges[i] === 'EnrichmentComplete' && !edges.slice(0, i).includes('EntitiesValid')) {
          v.push(`EnrichmentComplete at #${i} with no prior EntitiesValid`);
        }
      }
      return v;
    },
  },
  {
    id: 'CINV-4',
    statement: 'EnrichmentComplete count <= EntitiesValid count + PublicationRejected count（富集守恒：每次再富集必有新校验或发布驳回背书）',
    check: (o) => {
      const c = count(o.edgeSeq, 'EnrichmentComplete');
      const r = count(o.edgeSeq, 'EntitiesValid');
      const rej = count(o.edgeSeq, 'PublicationRejected');
      return c > r + rej ? [`enrichment-complete(${c}) > entities-valid(${r}) + rejected(${rej})`] : [];
    },
  },
  {
    id: 'CINV-5',
    statement: 'DriftAlarm implies >= 2 prior Malformed edges（漂移告警必然源于真实漂移）',
    check: (o) => {
      const v: string[] = [];
      const edges = o.edgeSeq;
      for (let i = 0; i < edges.length; i++) {
        if (edges[i] === 'DriftAlarm') {
          const prior = edges.slice(0, i).filter((x) => x === 'Malformed').length;
          if (prior < 2) v.push(`DriftAlarm at #${i} with only ${prior} prior Malformed`);
        }
      }
      return v;
    },
  },
  {
    id: 'CINV-6',
    statement: 'TurnExhausted edge iff verdict = budget-exhausted（预算耗尽边与会话裁决一致）',
    check: (o) => {
      const has = count(o.edgeSeq, 'TurnExhausted') > 0;
      if (has && o.verdict !== 'budget-exhausted') return [`TurnExhausted fired but verdict=${o.verdict}`];
      if (!has && o.verdict === 'budget-exhausted') return [`verdict=budget-exhausted but no TurnExhausted edge`];
      return [];
    },
  },
  {
    id: 'CINV-7',
    statement: 'published cases == Published edge count（案例产物与拓扑事件一致）',
    check: (o, outDir) => {
      const cases = loadCases(outDir).filter((c) => c.disposition === 'published').length;
      const p = count(o.edgeSeq, 'Published');
      return cases !== p ? [`published cases(${cases}) != Published edges(${p})`] : [];
    },
  },
  {
    id: 'CINV-8',
    statement: 'quarantined cases == SchemaFailed + ExtractAbandoned + EnrichmentFailed + ValidationExhausted edge count（fan-in 收敛：五路隔离边与案例守恒）',
    check: (o, outDir) => {
      const cases = loadCases(outDir).filter((c) => c.disposition === 'quarantined').length;
      const inbound =
        count(o.edgeSeq, 'SchemaFailed') +
        count(o.edgeSeq, 'ExtractAbandoned') +
        count(o.edgeSeq, 'EnrichmentFailed') +
        count(o.edgeSeq, 'ValidationExhausted');
      return cases !== inbound ? [`quarantined cases(${cases}) != fan-in edges(${inbound})`] : [];
    },
  },
  {
    id: 'CINV-9',
    statement: 'no run_panic event in any completed scenario（韧性：harness 不panic）',
    check: (_o, outDir) => {
      const events = loadEvents(outDir);
      return events.some((e) => e.name === 'run_panic') ? ['run_panic present'] : [];
    },
  },
  {
    id: 'CINV-10',
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
    id: 'CINV-11',
    statement: 'every published case has non-empty summary detail（发布质量闸门）',
    check: (_o, outDir) => {
      const cases = loadCases(outDir);
      const bad = cases.filter((c) => c.disposition === 'published' && (!c.detail || c.detail.trim().length === 0));
      return bad.length > 0 ? [`${bad.length} published case(s) with empty detail`] : [];
    },
  },
];

// ---------------------------------------------------------------------------
// 变异算子目录（对 subject/curator 的源文本做精确单点替换）
// ---------------------------------------------------------------------------
export function curatorMutants(): MutantSpec[] {
  const specs: MutantSpec[] = [];

  // M1：16 条边逐一删除（拓扑契约变异）
  const edgeLines: [string, string][] = [
    ['curator.hsl', '    edge intake -> schema_gate on DocEvent::DocumentReceived;'],
    ['curator.hsl', '    edge schema_gate -> extractor on SchemaEvent::SchemaPassed;'],
    ['curator.hsl', '    edge schema_gate -> quarantine on SchemaEvent::SchemaFailed;'],
    ['curator.hsl', '    edge extractor -> extractor on ExtractEvent::Malformed;'],
    ['curator.hsl', '    edge extractor -> validator on ExtractEvent::EntitiesExtracted;'],
    ['curator.hsl', '    edge extractor -> quarantine on ExtractEvent::ExtractAbandoned;'],
    ['curator.hsl', '    edge validator -> enricher on ValidateEvent::EntitiesValid;'],
    ['curator.hsl', '    edge validator -> extractor on ValidateEvent::EntitiesInvalid;'],
    ['curator.hsl', '    edge validator -> quarantine on ValidateEvent::ValidationExhausted;'],
    ['curator.hsl', '    edge enricher -> publisher on EnrichEvent::EnrichmentComplete;'],
    ['curator.hsl', '    edge enricher -> enricher on EnrichEvent::EnrichmentPartial;'],
    ['curator.hsl', '    edge enricher -> quarantine on EnrichEvent::EnrichmentFailed;'],
    ['curator.hsl', '    edge publisher -> intake on PublishEvent::Published;'],
    ['curator.hsl', '    edge publisher -> enricher on PublishEvent::PublicationRejected;'],
    ['curator.hsl', '    edge budget -> quarantine on BudgetSignal::TurnExhausted;'],
    ['curator.hsl', '    edge budget -> extractor on BudgetSignal::DriftAlarm;'],
  ];
  for (let i = 0; i < edgeLines.length; i++) {
    const [file, line] = edgeLines[i]!;
    specs.push({
      id: `M1-C${i + 1}`,
      operator: 'M1 EDGE_DEL',
      description: `删除边声明: ${line.trim()}`,
      file,
      find: line + '\n',
      replace: '',
    });
  }

  // M2：边端点改写（拓扑签名变异 —— fan-in 结构的重定向）
  specs.push({
    id: 'M2-C1', operator: 'M2 EDGE_REDIRECT', description: 'validator->enricher 改为 validator->quarantine（EntitiesValid 直达隔离）',
    file: 'curator.hsl',
    find: 'edge validator -> enricher on ValidateEvent::EntitiesValid;',
    replace: 'edge validator -> quarantine on ValidateEvent::EntitiesValid;',
  });
  specs.push({
    id: 'M2-C2', operator: 'M2 EDGE_REDIRECT', description: 'publisher->intake 改为 publisher->quarantine（Published 汇入隔离）',
    file: 'curator.hsl',
    find: 'edge publisher -> intake on PublishEvent::Published;',
    replace: 'edge publisher -> quarantine on PublishEvent::Published;',
  });
  specs.push({
    id: 'M2-C3', operator: 'M2 EDGE_REDIRECT', description: 'schema_gate->extractor 改为 schema_gate->validator（SchemaPassed 跳过抽取）',
    file: 'curator.hsl',
    find: 'edge schema_gate -> extractor on SchemaEvent::SchemaPassed;',
    replace: 'edge schema_gate -> validator on SchemaEvent::SchemaPassed;',
  });

  // M3：守卫改写（触发条件变异）
  specs.push({
    id: 'M3-C1', operator: 'M3 GUARD_SWAP', description: 'extractor->validator 守卫 EntitiesExtracted 换成 Malformed（G-8 违规预期）',
    file: 'curator.hsl',
    find: 'edge extractor -> validator on ExtractEvent::EntitiesExtracted;',
    replace: 'edge extractor -> validator on ExtractEvent::Malformed;',
  });
  specs.push({
    id: 'M3-C2', operator: 'M3 GUARD_SWAP', description: 'budget->quarantine 守卫 TurnExhausted 换成 Within（守卫语义漂移）',
    file: 'curator.hsl',
    find: 'edge budget -> quarantine on BudgetSignal::TurnExhausted;',
    replace: 'edge budget -> quarantine on BudgetSignal::Within;',
  });

  // M4-M8：行为/预算/闸门变异（Curator 域版本）
  specs.push({
    id: 'M4-BUDGET', operator: 'M4 BUDGET_OFF', description: '轮预算边界 off-by-one（>= -> >）',
    file: 'types/state.hsl',
    find: 'if self.turns_used >= policy.max_turns {',
    replace: 'if self.turns_used > policy.max_turns {',
  });
  specs.push({
    id: 'M5-SCHEMA', operator: 'M5 SCHEMA_FLIP', description: '模式闸最小体长阈值翻转（30 -> 300：快乐路径文档被拦截）',
    file: 'agents/schema_gate.hsl',
    find: 'SchemaGate { min_body: 30 }',
    replace: 'SchemaGate { min_body: 300 }',
  });
  specs.push({
    id: 'M6-VALIDATE', operator: 'M6 VALIDATE_THRESH', description: '校验闸门阈值松动（min_entities 2 -> 1）',
    file: 'agents/validator.hsl',
    find: 'EntityValidator { gate, min_entities: 2, min_confidence: 0.5 }',
    replace: 'EntityValidator { gate, min_entities: 1, min_confidence: 0.5 }',
  });
  specs.push({
    id: 'M7-DRIFT', operator: 'M7 DRIFT_CAP', description: '漂移硬上限提升（*2 -> *3）',
    file: 'curator.hsl',
    find: 'if budget.drift_count >= state.policy.max_drift * 2 {',
    replace: 'if budget.drift_count >= state.policy.max_drift * 3 {',
  });
  specs.push({
    id: 'M8-PUBLISH', operator: 'M8 PUBLISH_DROP', description: '发布路径丢弃案例落盘（cases.push 删除）',
    file: 'curator.hsl',
    find: '                                cases.push(record);\n',
    replace: '',
  });

  return specs;
}
