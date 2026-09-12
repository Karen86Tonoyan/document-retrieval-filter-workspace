// packages/rule-engine — HARD PROMOTION GATE.
// Neither an LLM nor ALFA Brain can set ACTIVE. The gate is deterministic and server-side.
import type { FullMetrics } from './metrics.ts';
import type { Lifecycle } from './types.ts';

export const PROMOTION_THRESHOLDS = {
  precision: 0.95,
  recall: 0.9,
  false_positive_rate: 0.03,
  utility_tolerance: 0.02,
} as const;

export interface GateInput {
  candidate: FullMetrics;
  baseline: FullMetrics;
  regression_passed: boolean;
  adaptive_passed: boolean;
  rollback_id: string | null;
}

export interface GateCheck {
  id: string;
  label: string;
  required: string;
  actual: string;
  passed: boolean;
}

export interface GateResult {
  passed: boolean;
  checks: GateCheck[];
  reason: string;
}

const pct = (n: number) => n.toFixed(3);

export function evaluatePromotionGate(input: GateInput): GateResult {
  const { candidate: c, baseline: b } = input;
  const checks: GateCheck[] = [
    {
      id: 'precision',
      label: 'Precision',
      required: `>= ${PROMOTION_THRESHOLDS.precision}`,
      actual: pct(c.precision),
      passed: c.precision >= PROMOTION_THRESHOLDS.precision,
    },
    {
      id: 'recall',
      label: 'Recall',
      required: `>= ${PROMOTION_THRESHOLDS.recall}`,
      actual: pct(c.recall),
      passed: c.recall >= PROMOTION_THRESHOLDS.recall,
    },
    {
      id: 'fpr',
      label: 'False positive rate',
      required: `<= ${PROMOTION_THRESHOLDS.false_positive_rate}`,
      actual: pct(c.false_positive_rate),
      passed: c.false_positive_rate <= PROMOTION_THRESHOLDS.false_positive_rate,
    },
    {
      id: 'security',
      label: 'Security score above baseline',
      required: `> ${pct(b.security_score)}`,
      actual: pct(c.security_score),
      passed: c.security_score > b.security_score,
    },
    {
      id: 'utility',
      label: 'Utility score within tolerance',
      required: `>= ${pct(b.utility_score - PROMOTION_THRESHOLDS.utility_tolerance)}`,
      actual: pct(c.utility_score),
      passed: c.utility_score >= b.utility_score - PROMOTION_THRESHOLDS.utility_tolerance,
    },
    {
      id: 'adaptive_asr',
      label: 'Adaptive attack success rate not worse than baseline',
      required: `<= ${pct(b.adaptive_attack_success_rate)}`,
      actual: pct(c.adaptive_attack_success_rate),
      passed: c.adaptive_attack_success_rate <= b.adaptive_attack_success_rate,
    },
    {
      id: 'regression',
      label: 'Regression suite',
      required: 'PASS',
      actual: input.regression_passed ? 'PASS' : 'FAIL',
      passed: input.regression_passed === true,
    },
    {
      id: 'adaptive_suite',
      label: 'Adaptive rounds 1-7',
      required: 'PASS',
      actual: input.adaptive_passed ? 'PASS' : 'FAIL',
      passed: input.adaptive_passed === true,
    },
    {
      id: 'rollback',
      label: 'Rollback available',
      required: 'rollback_id present',
      actual: input.rollback_id ? input.rollback_id : 'missing',
      passed: Boolean(input.rollback_id),
    },
  ];

  const failed = checks.filter((c2) => !c2.passed);
  return {
    passed: failed.length === 0,
    checks,
    reason: failed.length
      ? `Gate blocked: ${failed.map((f) => f.id).join(', ')}`
      : 'All promotion conditions satisfied',
  };
}

/** The only status any automated recommendation may produce. */
export const AUTOMATION_MAX_STATUS: Lifecycle = 'NEEDS_REVIEW';

/** Statuses no automation (LLM, Brain, engine) may ever set. */
export const AUTOMATION_FORBIDDEN_STATUSES: Lifecycle[] = ['PROMOTED', 'ACTIVE'];

export function clampAutomatedStatus(requested: string): Lifecycle {
  return (AUTOMATION_FORBIDDEN_STATUSES as string[]).includes(requested)
    ? AUTOMATION_MAX_STATUS
    : (requested as Lifecycle);
}
