// TONOYAN ADAPTIVE FILTER ENGINE — shared domain model (packages/filter-core)

export type FilterId = 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7';
export type Decision = 'ALLOW' | 'WARN' | 'HOLD' | 'HUMAN_REVIEW' | 'BLOCK';
export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Lifecycle =
  | 'DETECTED'
  | 'CANDIDATE'
  | 'SHADOW_TEST'
  | 'REGRESSION_TEST'
  | 'VERIFIED'
  | 'PROMOTED'
  | 'ACTIVE'
  | 'REJECTED'
  | 'RETIRED';

export type EvaluationKind = 'input' | 'output' | 'tool' | 'action';

/** F3 permission ladder. */
export type RiskLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';

export const DECISION_ORDER: Decision[] = ['ALLOW', 'WARN', 'HOLD', 'HUMAN_REVIEW', 'BLOCK'];

export function maxDecision(a: Decision, b: Decision): Decision {
  return DECISION_ORDER.indexOf(a) >= DECISION_ORDER.indexOf(b) ? a : b;
}

export interface Finding {
  code: string;
  filter: FilterId;
  severity: Severity;
  message: string;
  evidence?: string;
  fingerprint?: string;
  /** 0..1 contribution to the filter risk score. */
  weight: number;
}

export interface EvidenceItem {
  claim: string;
  kind: 'FACT' | 'INFERENCE' | 'ASSUMPTION' | 'MODEL_GUESS';
  source?: string;
}

export interface ToolRequest {
  name: string;
  operation?: 'read' | 'write' | 'delete' | 'execute' | 'external';
  resource?: string;
  scope?: string[];
  args?: Record<string, unknown>;
}

export interface EvaluationRequest {
  kind: EvaluationKind;
  agent: string;
  model: string;
  content: string;
  tool?: ToolRequest | string;
  session_id?: string;
  request_id?: string;
  /** Declared claim confidence from the caller/model, 0..1. */
  confidence?: number;
  evidence?: EvidenceItem[];
  context?: Record<string, unknown>;
}

export interface FilterResult {
  filter: FilterId;
  risk: number; // 0..1
  decision: Decision;
  findings: Finding[];
  meta?: Record<string, unknown>;
}

export interface RuleMatch {
  rule_key: string;
  rule_id: string;
  filter: FilterId;
  severity: Severity;
  action: Decision;
  shadow: boolean;
  matched: string[];
}

export interface EvaluationResponse {
  decision: Decision;
  risk: number;
  request_id: string;
  filters: FilterResult[];
  findings: Finding[];
  rule_matches: RuleMatch[];
  requires_human: boolean;
  redacted_content?: string;
  evidence: { confidence_score: number; evidence_score: number; items: EvidenceItem[] };
  reason: string;
}

export interface AgentProfile {
  agent_id: string;
  model: string;
  requests: number;
  blocks: number;
  retries: number;
  anomaly_score: number;
  baseline: Record<string, number>;
  window_stats: Record<string, number>;
}

export interface RuleCondition {
  /** Where the condition looks: the raw content or a named signal. */
  field: 'content' | 'tool' | 'resource' | 'risk' | 'agent' | 'model';
  op: 'regex' | 'contains' | 'equals' | 'gt' | 'lt';
  value: string;
  flags?: string;
}

export interface Rule {
  id: string;
  rule_key: string;
  name: string;
  description: string;
  filter: FilterId;
  severity: Severity;
  conditions: RuleCondition[];
  action: Decision;
  confidence_threshold: number;
  enabled: boolean;
  status: Lifecycle;
  version: number;
}
