// packages/rule-engine — deterministic evaluation of versioned rules.
// Rules in any status other than ACTIVE are evaluated in SHADOW mode: recorded, never enforced.
import type { EvaluationRequest, Rule, RuleCondition, RuleMatch } from './types.ts';
import { safeRegex } from './util.ts';
import { normalizeTool } from './f3-permissions.ts';

function fieldValue(req: EvaluationRequest, field: RuleCondition['field'], risk: number): string {
  const tool = normalizeTool(req.tool);
  switch (field) {
    case 'content':
      return req.content ?? '';
    case 'tool':
      return tool?.name ?? '';
    case 'resource':
      return tool?.resource ?? '';
    case 'agent':
      return req.agent ?? '';
    case 'model':
      return req.model ?? '';
    case 'risk':
      return String(risk);
  }
}

export function evaluateCondition(
  req: EvaluationRequest,
  condition: RuleCondition,
  risk: number,
): string | null {
  const value = fieldValue(req, condition.field, risk);
  switch (condition.op) {
    case 'regex': {
      const re = safeRegex(condition.value, condition.flags ?? 'i');
      const m = re ? value.match(re) : null;
      return m ? m[0].slice(0, 200) : null;
    }
    case 'contains':
      return value.toLowerCase().includes(condition.value.toLowerCase()) ? condition.value : null;
    case 'equals':
      return value === condition.value ? condition.value : null;
    case 'gt':
      return Number(value) > Number(condition.value) ? `${value} > ${condition.value}` : null;
    case 'lt':
      return Number(value) < Number(condition.value) ? `${value} < ${condition.value}` : null;
    default:
      return null;
  }
}

/** A rule matches only when ALL of its conditions match (AND semantics). */
export function evaluateRule(req: EvaluationRequest, rule: Rule, risk: number): RuleMatch | null {
  if (!rule.conditions.length) return null;
  const matched: string[] = [];
  for (const condition of rule.conditions) {
    const hit = evaluateCondition(req, condition, risk);
    if (!hit) return null;
    matched.push(`${condition.field} ${condition.op} → ${hit}`);
  }
  const enforcing = rule.status === 'ACTIVE' && rule.enabled;
  return {
    rule_key: rule.rule_key,
    rule_id: rule.id,
    filter: rule.filter,
    severity: rule.severity,
    action: rule.action,
    shadow: !enforcing,
    matched,
  };
}

export function evaluateRules(req: EvaluationRequest, rules: Rule[], risk: number): RuleMatch[] {
  const matches: RuleMatch[] = [];
  for (const rule of rules) {
    if (rule.status === 'REJECTED' || rule.status === 'RETIRED') continue;
    const match = evaluateRule(req, rule, risk);
    if (match) matches.push(match);
  }
  return matches;
}

/** Lifecycle transitions the engine is allowed to perform. Promotion to ACTIVE is human-only. */
export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DETECTED: ['CANDIDATE', 'REJECTED'],
  CANDIDATE: ['SHADOW_TEST', 'REJECTED'],
  SHADOW_TEST: ['REGRESSION_TEST', 'REJECTED'],
  REGRESSION_TEST: ['VERIFIED', 'REJECTED'],
  VERIFIED: ['PROMOTED', 'REJECTED'],
  PROMOTED: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['RETIRED', 'SHADOW_TEST'],
  REJECTED: ['CANDIDATE'],
  RETIRED: ['CANDIDATE'],
};

export function canTransition(from: string, to: string): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Only a human (admin) can move a rule into PROMOTED/ACTIVE, and only after a passing regression run. */
export const HUMAN_ONLY_TRANSITIONS = new Set(['PROMOTED', 'ACTIVE']);
