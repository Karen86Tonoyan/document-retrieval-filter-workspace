// F3 — TOOL & PERMISSION CONTROL (packages/permissions)
// Every tool-call is authorised on its own. A model can never raise its own level.
import type { EvaluationRequest, Finding, FilterResult, RiskLevel, ToolRequest } from './types.ts';
import { combineRisk, fingerprint } from './util.ts';

export const RISK_LEVEL_ORDER: RiskLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4'];

export interface AgentGrant {
  agent: string;
  max_level: RiskLevel;
  allowed_tools: string[]; // '*' allows any tool name
  denied_resources: string[];
  requires_confirmation_from: RiskLevel;
}

/** Deterministic, server-side grant table. Never derived from model output. */
export const DEFAULT_GRANTS: AgentGrant[] = [
  {
    agent: 'default',
    max_level: 'L1',
    allowed_tools: ['search', 'read_file', 'fetch_url', 'summarize'],
    denied_resources: ['secrets', 'auth', 'billing'],
    requires_confirmation_from: 'L1',
  },
  {
    agent: 'analyst',
    max_level: 'L2',
    allowed_tools: ['search', 'read_file', 'fetch_url', 'summarize', 'write_note', 'db_read'],
    denied_resources: ['secrets', 'auth'],
    requires_confirmation_from: 'L2',
  },
  {
    agent: 'operator',
    max_level: 'L3',
    allowed_tools: ['*'],
    denied_resources: ['secrets'],
    requires_confirmation_from: 'L2',
  },
];

const OPERATION_LEVEL: Record<string, RiskLevel> = {
  read: 'L0',
  write: 'L1',
  delete: 'L4',
  execute: 'L3',
  external: 'L4',
};

const SENSITIVE_RESOURCE = /\b(secret|credential|key|token|auth|user|payment|billing|prod|production)\b/i;
const DESTRUCTIVE_TOOL = /\b(delete|drop|purge|wipe|destroy|deploy|transfer|payout|email_send|shell|exec)\b/i;
const ESCALATION = /\b(grant|elevate|sudo|admin rights|escalate|podnie[śs] uprawnienia|nadaj uprawnienia)\b/i;

export function normalizeTool(tool: EvaluationRequest['tool']): ToolRequest | null {
  if (!tool) return null;
  if (typeof tool === 'string') return { name: tool };
  return tool;
}

export function classifyLevel(tool: ToolRequest): RiskLevel {
  let level: RiskLevel = tool.operation ? OPERATION_LEVEL[tool.operation] ?? 'L1' : 'L0';
  if (DESTRUCTIVE_TOOL.test(tool.name)) level = 'L4';
  if (tool.resource && SENSITIVE_RESOURCE.test(tool.resource) && RISK_LEVEL_ORDER.indexOf(level) < 2) {
    level = 'L2';
  }
  return level;
}

function gte(a: RiskLevel, b: RiskLevel): boolean {
  return RISK_LEVEL_ORDER.indexOf(a) >= RISK_LEVEL_ORDER.indexOf(b);
}

export async function runF3(req: EvaluationRequest, grants: AgentGrant[] = DEFAULT_GRANTS): Promise<FilterResult> {
  const findings: Finding[] = [];
  const tool = normalizeTool(req.tool);
  const grant = grants.find((g) => g.agent === req.agent) ?? grants.find((g) => g.agent === 'default')!;

  const push = async (code: string, severity: Finding['severity'], message: string, weight: number) => {
    findings.push({
      code,
      filter: 'F3',
      severity,
      message,
      weight,
      fingerprint: await fingerprint(`${code}:${req.agent}:${tool?.name ?? '-'}`),
    });
  };

  if (ESCALATION.test(req.content ?? '')) {
    await push('F3_SELF_ESCALATION', 'CRITICAL', 'Próba samodzielnego podniesienia uprawnień przez agenta.', 0.95);
  }

  if (!tool) {
    const risk = combineRisk(findings.map((f) => f.weight));
    return {
      filter: 'F3',
      risk,
      decision: risk >= 0.7 ? 'BLOCK' : risk > 0 ? 'WARN' : 'ALLOW',
      findings,
      meta: { level: 'L0', grant: grant.agent, requires_confirmation: false },
    };
  }

  const level = classifyLevel(tool);
  const allowedTool = grant.allowed_tools.includes('*') || grant.allowed_tools.includes(tool.name);
  const deniedResource = tool.resource
    ? grant.denied_resources.some((r) => tool.resource!.toLowerCase().includes(r))
    : false;

  if (!allowedTool) {
    await push('F3_TOOL_NOT_GRANTED', 'HIGH', `Narzędzie "${tool.name}" nie jest przyznane agentowi "${grant.agent}".`, 0.85);
  }
  if (deniedResource) {
    await push('F3_RESOURCE_DENIED', 'CRITICAL', `Zasób "${tool.resource}" jest zabroniony dla tego agenta.`, 0.95);
  }
  if (!gte(grant.max_level, level)) {
    await push(
      'F3_LEVEL_EXCEEDED',
      'CRITICAL',
      `Akcja na poziomie ${level} przekracza limit agenta (${grant.max_level}).`,
      0.95,
    );
  }
  if (level === 'L4') {
    await push('F3_DESTRUCTIVE_ACTION', 'HIGH', 'Akcja destrukcyjna lub zewnętrzna (L4).', 0.7);
  }

  const requiresConfirmation = gte(level, grant.requires_confirmation_from);
  const userConfirmed = req.context?.user_confirmed === true;
  if (requiresConfirmation && !userConfirmed) {
    await push('F3_CONFIRMATION_REQUIRED', 'MEDIUM', `Poziom ${level} wymaga potwierdzenia użytkownika.`, 0.55);
  }

  const risk = combineRisk(findings.map((f) => f.weight));
  let decision: FilterResult['decision'] = 'ALLOW';
  if (findings.some((f) => f.severity === 'CRITICAL')) decision = 'BLOCK';
  else if (requiresConfirmation && !userConfirmed) decision = 'HUMAN_REVIEW';
  else if (risk >= 0.6) decision = 'HOLD';
  else if (risk > 0) decision = 'WARN';

  return {
    filter: 'F3',
    risk,
    decision,
    findings,
    meta: { level, grant: grant.agent, requires_confirmation: requiresConfirmation, tool: tool.name },
  };
}
