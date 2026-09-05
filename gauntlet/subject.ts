// ============================================================================
// gauntlet/subject.ts — SUT 注册表（多 SUT 泛化层）
// ----------------------------------------------------------------------------
// 泛化实验（第八轮）的核心抽象：一个 SUT = 一份 SubjectSpec。
// 框架层（topo/lint/runner/coverage/invariants/mutate/report）只依赖本接口，
// 不包含任何 SUT 专属知识 —— 接入新 SUT = 新增 subject/<id>/ 目录 + 一份
// binding 文件 + 在此注册一行，框架代码零改动。
// ============================================================================

import type { ScenarioSpec, MutantSpec } from './types';
import type { Invariant } from './invariants';
import { vigilScenarios, vigilMutants, VIGIL_INVARIANTS } from '../subject/vigil/binding';
import { curatorScenarios, curatorMutants, CURATOR_INVARIANTS } from '../subject/curator/binding';
import { gatemasterScenarios, gatemasterMutants, GATEMASTER_INVARIANTS } from '../subject/gatemaster/binding';

export interface SubjectSpec {
  /** 短 id（CLI --subject 过滤用） */
  id: string;
  /** 展示名 */
  name: string;
  /** 领域描述（论文对照实验的分组标签） */
  domain: string;
  /** 入口 .hsl（仓库根相对路径） */
  entry: string;
  /** SUT 目录（变异体拷贝的根） */
  subjectDir: string;
  /** 入口文件名（变异体目录内解析入口用） */
  entryFile: string;
  /** 处置词汇（报告表头 + 黄金预期键序） */
  dispositions: readonly string[];
  /** 场景目录 */
  scenarios(): ScenarioSpec[];
  /** 轨迹不变式目录 */
  invariants: Invariant[];
  /** 变异算子目录 */
  mutants(): MutantSpec[];
  /** 拓扑摘要（对比实验自变量） */
  topoNote: string;
}

export const SUBJECTS: SubjectSpec[] = [
  {
    id: 'vigil',
    name: 'Vigil',
    domain: 'SRE 告警分诊（incident triage）',
    entry: 'subject/vigil/vigil.hsl',
    subjectDir: 'subject/vigil',
    entryFile: 'vigil.hsl',
    dispositions: ['committed', 'parked', 'escalated'],
    scenarios: vigilScenarios,
    invariants: VIGIL_INVARIANTS,
    mutants: vigilMutants,
    topoNote: '9 节点 / 17 边 / 5 守卫环 / fan-out router 三路处置',
  },
  {
    id: 'curator',
    name: 'Curator',
    domain: '文档策展管线（document curation pipeline）',
    entry: 'subject/curator/curator.hsl',
    subjectDir: 'subject/curator',
    entryFile: 'curator.hsl',
    dispositions: ['published', 'quarantined', 'deferred'],
    scenarios: curatorScenarios,
    invariants: CURATOR_INVARIANTS,
    mutants: curatorMutants,
    topoNote: '8 节点 / 16 边 / 4 守卫环 / fan-in quarantine 五路汇聚',
  },
  {
    id: 'gatemaster',
    name: 'Gatemaster',
    domain: 'CI 失败分诊（CI failure triage）',
    entry: 'subject/gatemaster/gatemaster.hsl',
    subjectDir: 'subject/gatemaster',
    entryFile: 'gatemaster.hsl',
    dispositions: ['fixed', 'escalated', 'abandoned'],
    scenarios: gatemasterScenarios,
    invariants: GATEMASTER_INVARIANTS,
    mutants: gatemasterMutants,
    topoNote: '8 节点 / 19 边 / 6 守卫环 / escalation ladder 阶梯升级（L1 重跑→L2 bisect→L3 paging）',
  },
];

export function subjectById(id: string): SubjectSpec | undefined {
  return SUBJECTS.find((s) => s.id === id);
}
