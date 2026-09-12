// packages/pattern-registry — DEAD PATTERN REGISTRY helpers (pure, testable).
import type { Decision, FilterId, Lifecycle, Severity } from './types.ts';

export interface PatternRecord {
  pattern_id: string;
  canonical_form: string;
  fingerprint: string;
  attack_family: string;
  filter: FilterId | null;
  severity: Severity;
  status: Lifecycle;
  context_signature: string;
  first_seen: string;
  last_seen: string;
  hit_count: number;
  verified_count: number;
  false_positive_count: number;
  rule_version: number;
  decision: Decision | null;
}

export const FAST_PATH_STATUSES: Lifecycle[] = ['VERIFIED', 'PROMOTED', 'ACTIVE'];

/**
 * A verified pattern may skip the full expensive evaluation only while its
 * context signature is unchanged. Any change invalidates the fast path.
 */
export function isFastPathValid(
  pattern: Pick<PatternRecord, 'status' | 'context_signature' | 'decision'>,
  currentSignature: string,
): boolean {
  if (!pattern.decision) return false;
  if (!FAST_PATH_STATUSES.includes(pattern.status)) return false;
  return pattern.context_signature === currentSignature;
}

/** Status a pattern must fall back to when its context signature changed. */
export function invalidateOnContextChange(
  pattern: Pick<PatternRecord, 'status' | 'context_signature'>,
  currentSignature: string,
): Lifecycle {
  if (pattern.context_signature === currentSignature) return pattern.status;
  return FAST_PATH_STATUSES.includes(pattern.status) ? 'INVALIDATED' : pattern.status;
}

export function contextSignature(contextHash: string, filter: string, source: string): string {
  return `${contextHash}:${filter}:${source}`;
}
