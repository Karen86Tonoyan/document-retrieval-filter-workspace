// packages/rule-engine — SHADOW MODE.
// A shadow rule analyses real traffic, records its hypothetical decision and is compared
// with the production decision. It never changes the production outcome.
import type { Decision, RuleMatch } from './types.ts';
import { DECISION_ORDER } from './types.ts';

export interface ShadowObservation {
  rule_key: string;
  rule_version: number;
  shadow_decision: Decision;
  production_decision: Decision;
  agreed: boolean;
  would_change: boolean;
  matched: string[];
}

/**
 * Builds shadow observations from rule matches flagged as shadow.
 * The production decision is passed in and returned untouched.
 */
export function observeShadow(
  matches: RuleMatch[],
  productionDecision: Decision,
  versions: Record<string, number> = {},
): ShadowObservation[] {
  return matches
    .filter((m) => m.shadow)
    .map((m) => {
      const shadow = m.action;
      const stricter = DECISION_ORDER.indexOf(shadow) > DECISION_ORDER.indexOf(productionDecision);
      const looser = DECISION_ORDER.indexOf(shadow) < DECISION_ORDER.indexOf(productionDecision);
      return {
        rule_key: m.rule_key,
        rule_version: versions[m.rule_key] ?? 1,
        shadow_decision: shadow,
        production_decision: productionDecision,
        agreed: shadow === productionDecision,
        would_change: stricter || looser,
        matched: m.matched,
      };
    });
}

/** Guarantee used by the tests: shadow observations never alter the production decision. */
export function applyShadowSafely(productionDecision: Decision, _observations: ShadowObservation[]): Decision {
  return productionDecision;
}

export interface ShadowSummary {
  rule_key: string;
  observations: number;
  agreements: number;
  disagreements: number;
  agreement_rate: number;
}

export function summariseShadow(rows: { rule_key: string; agreed: boolean }[]): ShadowSummary[] {
  const map = new Map<string, ShadowSummary>();
  for (const row of rows) {
    const entry = map.get(row.rule_key) ?? {
      rule_key: row.rule_key,
      observations: 0,
      agreements: 0,
      disagreements: 0,
      agreement_rate: 0,
    };
    entry.observations++;
    if (row.agreed) entry.agreements++;
    else entry.disagreements++;
    entry.agreement_rate = Number((entry.agreements / entry.observations).toFixed(4));
    map.set(row.rule_key, entry);
  }
  return Array.from(map.values());
}
