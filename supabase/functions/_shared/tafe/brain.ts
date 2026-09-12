// packages/rule-engine — ALFA BRAIN bridge.
// Brain receives AGGREGATES ONLY. Never raw prompts, secrets, API keys, full incidents or PII.
import type { FullMetrics } from './metrics.ts';
import { clampAutomatedStatus, evaluatePromotionGate, type GateInput, type GateResult } from './promotion-gate.ts';
import type { Lifecycle } from './types.ts';

export interface BrainPayload {
  candidate_id: string;
  candidate_version: number;
  baseline: Pick<FullMetrics, 'precision' | 'recall' | 'f1' | 'false_positive_rate' | 'adaptive_attack_success_rate' | 'security_score' | 'utility_score'>;
  candidate: BrainPayload['baseline'];
  benchmark_delta: Record<string, number>;
  security_score: number;
  utility_score: number;
  recommendation_request: 'promote_review';
}

const AGG_KEYS = [
  'precision',
  'recall',
  'f1',
  'false_positive_rate',
  'adaptive_attack_success_rate',
  'security_score',
  'utility_score',
] as const;

function aggregates(m: FullMetrics): BrainPayload['baseline'] {
  const out = {} as Record<string, number>;
  for (const k of AGG_KEYS) out[k] = Number(m[k] ?? 0);
  return out as BrainPayload['baseline'];
}

/** Patterns that must never leave the system, even by accident, in a Brain payload. */
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/,
  /bearer\s+[A-Za-z0-9._-]{10,}/i,
  /api[_-]?key/i,
  /password/i,
  /\b\d{11}\b/,
];

export function containsSecret(value: unknown): boolean {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return SECRET_PATTERNS.some((re) => re.test(text));
}

export function buildBrainPayload(
  candidateId: string,
  candidateVersion: number,
  candidate: FullMetrics,
  baseline: FullMetrics,
): BrainPayload {
  const c = aggregates(candidate);
  const b = aggregates(baseline);
  const benchmark_delta: Record<string, number> = {};
  for (const k of AGG_KEYS) benchmark_delta[k] = Number((c[k] - b[k]).toFixed(4));

  const payload: BrainPayload = {
    candidate_id: candidateId,
    candidate_version: candidateVersion,
    baseline: b,
    candidate: c,
    benchmark_delta,
    security_score: c.security_score,
    utility_score: c.utility_score,
    recommendation_request: 'promote_review',
  };

  if (containsSecret(payload)) {
    throw new Error('Brain payload rejected: aggregate payload contained a secret-like value');
  }
  return payload;
}

export type BrainRecommendation = 'APPROVE' | 'REJECT' | 'HOLD';

export interface BrainDecision {
  recommendation: BrainRecommendation;
  rationale: string;
  resulting_status: Lifecycle;
  gate: GateResult;
}

/**
 * Applies a Brain recommendation. APPROVE can only ever produce NEEDS_REVIEW —
 * the deterministic promotion gate plus a human admin decide ACTIVE.
 */
export function applyBrainRecommendation(
  recommendation: BrainRecommendation,
  rationale: string,
  gateInput: GateInput,
): BrainDecision {
  const gate = evaluatePromotionGate(gateInput);
  let status: Lifecycle;
  if (recommendation === 'REJECT') status = 'REJECTED';
  else if (recommendation === 'APPROVE') status = clampAutomatedStatus('NEEDS_REVIEW');
  else status = 'SHADOW_TEST';

  return {
    recommendation,
    rationale: rationale.slice(0, 1000),
    resulting_status: status,
    gate,
  };
}

/** Deterministic local recommendation used when no external Brain endpoint is configured. */
export function localBrainRecommendation(gate: GateResult): { recommendation: BrainRecommendation; rationale: string } {
  if (gate.passed) return { recommendation: 'APPROVE', rationale: 'All deterministic gate conditions satisfied.' };
  const failed = gate.checks.filter((c) => !c.passed).map((c) => c.id);
  if (failed.includes('regression') || failed.includes('rollback')) {
    return { recommendation: 'REJECT', rationale: `Hard blockers: ${failed.join(', ')}` };
  }
  return { recommendation: 'HOLD', rationale: `Needs more shadow traffic: ${failed.join(', ')}` };
}
