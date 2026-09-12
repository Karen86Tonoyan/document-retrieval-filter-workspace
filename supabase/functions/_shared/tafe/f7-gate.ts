// F7 — FINAL ACTION GATE: highest priority, aggregates F1–F6. Nothing bypasses it.
import type { Decision, FilterResult, Finding, RuleMatch } from './types.ts';
import { combineRisk, maxDecision, severityWeight } from './util.ts';

export interface GateInput {
  filters: FilterResult[];
  ruleMatches: RuleMatch[];
  /** F3 permission level of the requested action. */
  level?: string;
  evidenceScore: number;
}

export interface GateOutput {
  decision: Decision;
  risk: number;
  reason: string;
  findings: Finding[];
  requires_human: boolean;
}

export function runF7(input: GateInput): GateOutput {
  const { filters, ruleMatches } = input;
  const findings: Finding[] = [];
  const reasons: string[] = [];

  const risk = combineRisk(filters.map((f) => f.risk * (f.filter === 'F5' ? 0.8 : 1)));

  // 1. Deterministic escalation from each filter's own verdict.
  let decision: Decision = 'ALLOW';
  for (const f of filters) {
    if (f.decision !== 'ALLOW') {
      decision = maxDecision(decision, f.decision);
      reasons.push(`${f.filter}=${f.decision} (risk ${f.risk.toFixed(2)})`);
    }
  }

  // 2. Active (non-shadow) rule actions.
  for (const m of ruleMatches) {
    if (m.shadow) continue;
    decision = maxDecision(decision, m.action);
    reasons.push(`rule ${m.rule_key}=${m.action}`);
  }

  // 3. Aggregate thresholds — independent of any single filter.
  const criticals = filters.flatMap((f) => f.findings).filter((f) => f.severity === 'CRITICAL');
  if (criticals.length > 0) {
    decision = 'BLOCK';
    reasons.push(`${criticals.length} krytycznych ustaleń`);
  }
  const highs = filters.flatMap((f) => f.findings).filter((f) => f.severity === 'HIGH');
  if (highs.length >= 2 && decision !== 'BLOCK') {
    decision = maxDecision(decision, 'HUMAN_REVIEW');
    reasons.push('co najmniej 2 ustalenia o wysokiej wadze');
  }
  if (risk >= 0.85) {
    decision = 'BLOCK';
    reasons.push(`łączne ryzyko ${risk.toFixed(2)} ≥ 0.85`);
  } else if (risk >= 0.65) {
    decision = maxDecision(decision, 'HOLD');
  }

  // 4. Destructive actions without evidence are never auto-allowed.
  if (input.level === 'L4' && decision === 'ALLOW') {
    decision = 'HUMAN_REVIEW';
    reasons.push('akcja L4 zawsze wymaga potwierdzenia człowieka');
  }
  if (input.level === 'L3' && input.evidenceScore < 0.2 && decision === 'ALLOW') {
    decision = 'WARN';
    reasons.push('akcja L3 przy niskim pokryciu dowodowym');
  }

  const severityScore = combineRisk(filters.flatMap((f) => f.findings).map((f) => severityWeight(f.severity) * 0.6));
  if (severityScore > 0.9 && decision !== 'BLOCK') {
    decision = maxDecision(decision, 'HOLD');
    reasons.push('kumulacja ustaleń o wysokiej wadze');
  }

  findings.push({
    code: 'F7_GATE_DECISION',
    filter: 'F7',
    severity: decision === 'BLOCK' ? 'CRITICAL' : decision === 'ALLOW' ? 'INFO' : 'MEDIUM',
    message: `Final Action Gate: ${decision}`,
    weight: risk,
    evidence: reasons.join('; ') || 'brak sygnałów ryzyka',
  });

  return {
    decision,
    risk,
    reason: reasons.join('; ') || 'Brak sygnałów ryzyka — wszystkie filtry PASS.',
    findings,
    requires_human: decision === 'HUMAN_REVIEW' || decision === 'HOLD',
  };
}
