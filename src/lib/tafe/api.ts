// Client for the TONOYAN ADAPTIVE FILTER ENGINE integration API.
import { supabase } from '@/integrations/supabase/client';

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

export interface Finding {
  code: string;
  filter: FilterId;
  severity: Severity;
  message: string;
  evidence?: string;
  fingerprint?: string;
  weight: number;
}

export interface FilterResult {
  filter: FilterId;
  risk: number;
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
  evidence: {
    confidence_score: number;
    evidence_score: number;
    items: { claim: string; kind: string; source?: string }[];
  };
  reason: string;
}

export interface EvaluatePayload {
  agent: string;
  model: string;
  content: string;
  tool?: { name: string; operation?: string; resource?: string } | string;
  session_id?: string;
  confidence?: number;
  context?: Record<string, unknown>;
  dry_run?: boolean;
}

const FUNCTION_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/tafe`;

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Zaloguj się, aby korzystać z silnika TAFE.');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${FUNCTION_BASE}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body?.error === 'string' ? body.error : `Błąd ${res.status}`);
  return body as T;
}

export const tafeApi = {
  evaluate: (kind: 'input' | 'output' | 'tool' | 'action', payload: EvaluatePayload) =>
    call<EvaluationResponse>(`/evaluate/${kind}`, { method: 'POST', body: JSON.stringify(payload) }),
  rules: () => call<{ rules: RuleRow[] }>('/rules'),
  incidents: () => call<{ incidents: IncidentRow[] }>('/incidents'),
  audit: () => call<{ audit: AuditRow[] }>('/audit'),
  goldset: () => call<{ cases: { id: string; label: string; group: string; content: string }[] }>('/goldset'),
  runRegression: (rule_key: string) =>
    call<RegressionResult>('/rules/regression', { method: 'POST', body: JSON.stringify({ rule_key }) }),
  transitionRule: (rule_key: string, to: Lifecycle) =>
    call<{ rule_key: string; status: Lifecycle }>('/rules/transition', {
      method: 'POST',
      body: JSON.stringify({ rule_key, to }),
    }),
  patternAction: (action: 'candidate' | 'verify' | 'promote', pattern_id: string) =>
    call<{ pattern_id: string; status: Lifecycle }>(`/patterns/${action}`, {
      method: 'POST',
      body: JSON.stringify({ pattern_id }),
    }),
};

export interface RuleRow {
  id: string;
  rule_key: string;
  name: string;
  description: string;
  filter: FilterId;
  severity: Severity;
  conditions: { field: string; op: string; value: string }[];
  action: Decision;
  confidence_threshold: number;
  enabled: boolean;
  status: Lifecycle;
  version: number;
  created_at: string;
}

export interface PatternRow {
  id: string;
  pattern_id: string;
  canonical_form: string;
  fingerprint: string;
  source: string;
  context_hash: string;
  risk: number;
  decision: Decision | null;
  first_seen: string;
  last_seen: string;
  hit_count: number;
  false_positive_count: number;
  status: Lifecycle;
  version: number;
}

export interface IncidentRow {
  id: string;
  request_id: string;
  agent_id: string;
  model: string;
  filter: FilterId;
  severity: Severity;
  decision: Decision;
  reason: string;
  resolved: boolean;
  created_at: string;
}

export interface AuditRow {
  id: string;
  ts: string;
  request_id: string;
  session_id: string;
  agent_id: string;
  model: string;
  filter: FilterId | null;
  rule_id: string | null;
  risk_score: number;
  decision: Decision;
  reason: string;
  tool: string | null;
  resource: string | null;
  before_hash: string | null;
  after_hash: string | null;
}

export interface AgentProfileRow {
  id: string;
  agent_id: string;
  model: string;
  requests: number;
  blocks: number;
  retries: number;
  anomaly_score: number;
  last_seen: string;
}

export interface RegressionRunRow {
  id: string;
  rule_key: string;
  rule_version: number;
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  baseline_f1: number;
  passed: boolean;
  created_at: string;
}

export type RegressionResult = RegressionRunRow & { passed: boolean };

export const FILTER_TITLES: Record<FilterId, { pl: string; en: string; desc_pl: string; desc_en: string }> = {
  F1: {
    pl: 'Integralność wejścia',
    en: 'Input integrity',
    desc_pl: 'Uszkodzone dane, sprzeczne instrukcje, ukryte znaki, podejrzane kodowanie, spoofing źródła.',
    desc_en: 'Corrupted data, contradictory instructions, hidden characters, suspicious encoding, source spoofing.',
  },
  F2: {
    pl: 'Injection / manipulacja',
    en: 'Injection / manipulation',
    desc_pl: 'Prompt injection (także pośredni), jailbreak, zmiana roli, zatruwanie kontekstu, obejście polityki.',
    desc_en: 'Direct and indirect prompt injection, jailbreaks, role manipulation, context poisoning, policy bypass.',
  },
  F3: {
    pl: 'Narzędzia i uprawnienia',
    en: 'Tools & permissions',
    desc_pl: 'Osobna autoryzacja każdego tool-calla, poziomy L0–L4, zakaz samodzielnej eskalacji uprawnień.',
    desc_en: 'Per-call authorisation, L0–L4 risk ladder, no self-escalation of privileges.',
  },
  F4: {
    pl: 'Dane i prywatność',
    en: 'Data & privacy',
    desc_pl: 'Skaner sekretów przed logowaniem: PII, tokeny, klucze, JWT, hasła, cookies, IP, sekrety infrastruktury.',
    desc_en: 'Secret scanner before logging: PII, tokens, keys, JWT, passwords, cookies, IPs, infrastructure secrets.',
  },
  F5: {
    pl: 'Dowody i prawda',
    en: 'Evidence & truth',
    desc_pl: 'Rozdziela FACT / INFERENCE / ASSUMPTION / MODEL_GUESS, liczy confidence i evidence score.',
    desc_en: 'Separates FACT / INFERENCE / ASSUMPTION / MODEL_GUESS, scores confidence and evidence.',
  },
  F6: {
    pl: 'Dryf i zachowanie',
    en: 'Drift & behaviour',
    desc_pl: 'Profil agenta, wzrost blokad, zapętlenia, nietypowe narzędzia, próby obejścia decyzji.',
    desc_en: 'Agent profile, block-rate spikes, loops, unusual tools, attempts to circumvent earlier decisions.',
  },
  F7: {
    pl: 'Final Action Gate',
    en: 'Final Action Gate',
    desc_pl: 'Agreguje F1–F6, ma najwyższy priorytet. Żaden agent ani model go nie omija.',
    desc_en: 'Aggregates F1–F6 with top priority. No agent or model can bypass it.',
  },
};

export const DECISION_STYLES: Record<Decision, string> = {
  ALLOW: 'border-success/40 text-success bg-success/10',
  WARN: 'border-warning/40 text-warning bg-warning/10',
  HOLD: 'border-info/40 text-info bg-info/10',
  HUMAN_REVIEW: 'border-primary/40 text-primary bg-primary/10',
  BLOCK: 'border-destructive/40 text-destructive bg-destructive/10',
};
