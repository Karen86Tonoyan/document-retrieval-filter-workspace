// packages/audit + packages/pattern-registry — persistence adapters over Lovable Cloud.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { AgentProfile, Decision, EvaluationRequest, EvaluationResponse, Rule } from './types.ts';
import { contextHash, fingerprint } from './util.ts';
import { scrubSecrets } from './f4-privacy.ts';

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

export async function loadRules(db: SupabaseClient): Promise<Rule[]> {
  const { data, error } = await db
    .from('tafe_rules')
    .select('*')
    .not('status', 'in', '("REJECTED","RETIRED")')
    .order('version', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Rule[];
}

export interface DriftContext {
  profile: AgentProfile | null;
  recentDecisions: string[];
  recentTools: string[];
  repeatCount: number;
}

export async function loadDriftContext(
  db: SupabaseClient,
  agent: string,
  requestFingerprint: string,
): Promise<DriftContext> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [profileRes, auditRes] = await Promise.all([
    db.from('tafe_agent_profiles').select('*').eq('agent_id', agent).maybeSingle(),
    db.from('tafe_audit_log').select('decision, tool, evidence').eq('agent_id', agent).gte('ts', since).order('ts', { ascending: false }).limit(50),
  ]);

  const rows = auditRes.data ?? [];
  const repeatCount = rows.filter((r) => {
    const ev = r.evidence as unknown;
    return Array.isArray(ev) && ev.some((e) => (e as { fingerprint?: string })?.fingerprint === requestFingerprint);
  }).length;

  return {
    profile: (profileRes.data as unknown as AgentProfile) ?? null,
    recentDecisions: rows.map((r) => String(r.decision)),
    recentTools: rows.map((r) => String(r.tool ?? '')).filter(Boolean),
    repeatCount,
  };
}

export async function recordAudit(
  db: SupabaseClient,
  req: EvaluationRequest,
  res: EvaluationResponse,
  requestFingerprint: string,
  actor: string | null,
): Promise<void> {
  const tool = typeof req.tool === 'string' ? req.tool : req.tool?.name ?? null;
  const resource = typeof req.tool === 'string' ? null : req.tool?.resource ?? null;
  const rows = res.filters.map((f) => ({
    request_id: res.request_id,
    session_id: req.session_id ?? '',
    agent_id: req.agent,
    model: req.model,
    filter: f.filter,
    rule_id: res.rule_matches.find((m) => m.filter === f.filter)?.rule_key ?? null,
    risk_score: Number(f.risk.toFixed(4)),
    decision: f.decision as Decision,
    reason: scrubSecrets(f.findings.map((x) => x.message).join(' | ')).slice(0, 2000),
    evidence: f.findings.map((x) => ({
      code: x.code,
      severity: x.severity,
      fingerprint: x.fingerprint,
      evidence: x.evidence ? scrubSecrets(x.evidence).slice(0, 300) : undefined,
    })),
    tool,
    resource,
    before_hash: requestFingerprint,
    after_hash: null,
    actor,
  }));

  rows.push({
    request_id: res.request_id,
    session_id: req.session_id ?? '',
    agent_id: req.agent,
    model: req.model,
    filter: 'F7',
    rule_id: null,
    risk_score: Number(res.risk.toFixed(4)),
    decision: res.decision,
    reason: scrubSecrets(res.reason).slice(0, 2000),
    evidence: [{ code: 'F7_GATE_DECISION', severity: 'INFO', fingerprint: requestFingerprint, evidence: undefined }],
    tool,
    resource,
    before_hash: requestFingerprint,
    after_hash: await fingerprint(`${res.decision}:${res.risk}`),
    actor,
  });

  const { error } = await db.from('tafe_audit_log').insert(rows);
  if (error) throw error;
}

export interface PatternMeta {
  filter?: string;
  severity?: string;
  attack_family?: string;
}

/** Dead Pattern Registry: verified patterns short-circuit the expensive path while the context is unchanged. */
export async function upsertPattern(
  db: SupabaseClient,
  canonical: string,
  fp: string,
  risk: number,
  decision: Decision,
  context: Record<string, unknown> | undefined,
  source: string,
  meta: PatternMeta = {},
): Promise<void> {
  const ctxHash = await contextHash(context);
  const signature = `${ctxHash}:${meta.filter ?? 'F7'}:${source}`;
  const { data } = await db.from('tafe_patterns').select('*').eq('pattern_id', fp).maybeSingle();
  if (!data) {
    await db.from('tafe_patterns').insert({
      pattern_id: fp,
      canonical_form: scrubSecrets(canonical).slice(0, 1000),
      fingerprint: fp,
      source,
      context: context ?? {},
      context_hash: ctxHash,
      context_signature: signature,
      filter: meta.filter ?? null,
      severity: meta.severity ?? 'MEDIUM',
      attack_family: meta.attack_family ?? 'unknown',
      risk,
      decision,
      status: 'DETECTED',
    });
    return;
  }
  const contextChanged = data.context_hash !== ctxHash || data.context_signature !== signature;
  await db
    .from('tafe_patterns')
    .update({
      hit_count: (data.hit_count ?? 0) + 1,
      last_seen: new Date().toISOString(),
      risk,
      decision,
      context_hash: ctxHash,
      context_signature: signature,
      filter: meta.filter ?? data.filter,
      severity: meta.severity ?? data.severity,
      attack_family: meta.attack_family ?? data.attack_family,
      // Context change invalidates a verified pattern — it must be re-verified.
      status: contextChanged && ['VERIFIED', 'PROMOTED', 'ACTIVE'].includes(data.status) ? 'INVALIDATED' : data.status,
      version: contextChanged ? (data.version ?? 1) + 1 : data.version ?? 1,
    })
    .eq('pattern_id', fp);
}

/** SHADOW MODE: store the hypothetical decision of non-enforcing rules for later comparison. */
export async function recordShadowObservations(
  db: SupabaseClient,
  requestId: string,
  observations: {
    rule_key: string;
    rule_version: number;
    shadow_decision: Decision;
    production_decision: Decision;
    agreed: boolean;
    would_change: boolean;
    matched: string[];
  }[],
): Promise<void> {
  if (!observations.length) return;
  await db.from('tafe_shadow_evaluations').insert(
    observations.map((o) => ({
      request_id: requestId,
      rule_key: o.rule_key,
      rule_version: o.rule_version,
      shadow_decision: o.shadow_decision,
      production_decision: o.production_decision,
      agreed: o.agreed,
      would_change: o.would_change,
      matched: o.matched.map((m) => scrubSecrets(m).slice(0, 300)),
    })),
  );
}

export async function lookupVerifiedPattern(
  db: SupabaseClient,
  fp: string,
  context: Record<string, unknown> | undefined,
): Promise<{ decision: Decision; risk: number } | null> {
  const ctxHash = await contextHash(context);
  const { data } = await db
    .from('tafe_patterns')
    .select('decision, risk, status, context_hash')
    .eq('pattern_id', fp)
    .maybeSingle();
  if (!data || !data.decision) return null;
  if (!['VERIFIED', 'PROMOTED', 'ACTIVE'].includes(String(data.status))) return null;
  if (data.context_hash !== ctxHash) return null;
  return { decision: data.decision as Decision, risk: Number(data.risk) };
}

/**
 * Every tool-call / action is recorded with its full F1–F7 decision trace (`force`),
 * even when the gate allowed it — Brain evaluates real traffic, not only blocks.
 */
export async function recordIncident(
  db: SupabaseClient,
  req: EvaluationRequest,
  res: EvaluationResponse,
  force = false,
): Promise<void> {
  if (!force && (res.decision === 'ALLOW' || res.decision === 'WARN')) return;
  const worst = res.findings.find((f) => f.severity === 'CRITICAL') ?? res.findings[0];
  const tool = typeof req.tool === 'string' ? req.tool : req.tool?.name ?? null;
  const resource = typeof req.tool === 'string' ? null : req.tool?.resource ?? null;
  await db.from('tafe_incidents').insert({
    request_id: res.request_id,
    agent_id: req.agent,
    model: req.model,
    filter: worst?.filter ?? 'F7',
    severity: worst?.severity ?? (res.decision === 'ALLOW' ? 'INFO' : 'MEDIUM'),
    decision: res.decision,
    reason: scrubSecrets(res.reason).slice(0, 2000),
    findings: {
      kind: req.kind,
      tool,
      resource,
      risk: Number(res.risk.toFixed(4)),
      requires_human: res.requires_human,
      // Full F1–F7 decision trace for this call.
      filters: res.filters.map((f) => ({
        filter: f.filter,
        decision: f.decision,
        risk: Number(f.risk.toFixed(4)),
        findings: f.findings.map((x) => x.code),
      })),
      items: res.findings.map((f) => ({ code: f.code, filter: f.filter, severity: f.severity, message: scrubSecrets(f.message).slice(0, 300) })),
    },
  });
}

export async function updateAgentProfile(
  db: SupabaseClient,
  req: EvaluationRequest,
  res: EvaluationResponse,
): Promise<void> {
  const { data } = await db.from('tafe_agent_profiles').select('*').eq('agent_id', req.agent).maybeSingle();
  const requests = (data?.requests ?? 0) + 1;
  const blocks = (data?.blocks ?? 0) + (res.decision === 'BLOCK' ? 1 : 0);
  const prevAvg = Number(data?.window_stats?.avg_risk ?? res.risk);
  const avgRisk = prevAvg + (res.risk - prevAvg) / Math.min(requests, 50);

  const payload = {
    agent_id: req.agent,
    model: req.model,
    requests,
    blocks,
    retries: data?.retries ?? 0,
    anomaly_score: Number(Math.min(1, blocks / Math.max(1, requests)).toFixed(4)),
    window_stats: { avg_risk: Number(avgRisk.toFixed(4)), block_rate: Number((blocks / requests).toFixed(4)) },
    baseline: data?.baseline ?? { avg_risk: Number(res.risk.toFixed(4)), block_rate: 0.05 },
    last_seen: new Date().toISOString(),
  };

  if (data) await db.from('tafe_agent_profiles').update(payload).eq('agent_id', req.agent);
  else await db.from('tafe_agent_profiles').insert(payload);
}
