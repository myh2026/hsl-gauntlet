// ============================================================================
// gauntlet/invariants.ts — 轨迹不变式（时序性质，事件总线上的 always/never/implies）
// ----------------------------------------------------------------------------
// 每条不变式都以「事件序列 + 案例产物」为证据面，可机械检查。
// 违反 = harness 行为偏离拓扑契约（比黄金对比更结构化的失败语义）。
// 多 SUT 泛化（第八轮）：不变式目录从框架硬编码迁移到 subject/<id>/binding.ts；
// 框架只保留 Invariant 接口 + 检查器（列表经 SubjectSpec 注入）。
// ============================================================================

import type { RunOutcome } from './types';

export interface Invariant {
  id: string;
  statement: string;
  /** 返回违反说明列表（空 = 满足） */
  check: (o: RunOutcome, outDir: string) => string[];
}

/** 对给定不变式目录检查一次运行的观测（violations 带 invariant id 前缀） */
export function checkInvariants(invariants: Invariant[], outcome: RunOutcome, outDir: string): string[] {
  const violations: string[] = [];
  for (const inv of invariants) {
    for (const v of inv.check(outcome, outDir)) {
      violations.push(`${inv.id}: ${v}`);
    }
  }
  return violations;
}
