// ============================================================================
// gauntlet/types.ts — 共享类型
// ============================================================================
// Gauntlet：Topology-Grounded Conformance Testing & Mutation Analysis
// for LLM Agent Harnesses（HSL 工具链之上的测试框架层）
// ============================================================================

/** 静态拓扑（从 .hsl 源码提取的 ground truth） */
export interface TopoEdge {
  from: string;
  to: string;
  /** Guard 变体名（path 最后一段，与事件总线 edge.on 对齐） */
  guard: string;
  file: string;
  line: number;
}

export interface TopoNode {
  name: string;
  mut: boolean;
  ty: string;
}

export interface TopoGraph {
  name: string;
  file: string;
  nodes: TopoNode[];
  edges: TopoEdge[];
}

/** 场景规格（fixture + workspace + CLI 参数 + 黄金预期） */
export interface ScenarioSpec {
  id: string;
  kind: 'nominal' | 'fault';
  workspace: string;
  fixture: string;
  args: string[];
  title: string;
  /** 故障分类学条目（fault 场景必填） */
  faultClass?: string;
  expect: GoldenExpectation;
}

export interface GoldenExpectation {
  exit: number;
  ok: boolean;
  verdict: string;
  /** 处置计数（键为各 SUT 自定义的处置词汇，如 committed/parked/escalated
   *  或 published/quarantined/deferred —— 多 SUT 泛化：框架不再硬编码三元组） */
  dispositions: Record<string, number>;
  /** 期望触发的故障注入事件数（fault 场景） */
  faultEvents: number;
  /** 期望 capability_denied 事件数 */
  deniedEvents: number;
}

/** 一次运行的完整观测（conformance 比较向量） */
export interface RunOutcome {
  id: string;
  exitCode: number;
  ok: boolean;
  verdict: string;
  /** 处置计数（动态键 —— 与黄金预期同构比对） */
  dispositions: Record<string, number>;
  /** edge 事件守卫序列（有序 multiset） */
  edgeSeq: string[];
  /** edge 事件全身份序列 from->to:on（拓扑签名） */
  edgeFull: string[];
  /** 触发的不同守卫集合 */
  edgeSet: string[];
  faultEvents: number;
  deniedEvents: number;
  invariantViolations: string[];
  conformanceDeviations: string[];
  elapsedMs: number;
}

/** 变异测试 */
export interface MutantSpec {
  id: string;
  operator: string;
  description: string;
  /** 相对 subjectDir 的目标文件（如 "vigil.hsl" / "agents/router.hsl"） */
  file: string;
  find: string;
  replace: string;
}

export interface MutantResult {
  id: string;
  operator: string;
  description: string;
  killed: boolean;
  /** 杀死该变异体的场景 id 与偏差描述 */
  killedBy: { scenario: string; deviations: string[] }[];
  error?: string;
  /** 变异点定位（triage 静态归因用） */
  file?: string;
  find?: string;
  replace?: string;
  /** 存活体静态归因（仅存活体携带） */
  triage?: import('./triage').TriageVerdict;
}

export interface CoverageReport {
  declaredEdges: TopoEdge[];
  fired: Map<string, string[]>; // guard -> scenario ids
  neverFired: TopoEdge[];
  faultOnly: TopoEdge[]; // 仅在 fault 场景中触发的边
  perScenario: { id: string; guards: string[] }[];
  edgeCoverage: number;
}
