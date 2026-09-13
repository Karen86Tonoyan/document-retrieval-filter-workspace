// ALFA Brain — LIVE TRAFFIC channel.
// Brain receives AGGREGATES ONLY: counts of F1–F7 decisions from real tool-calls.
// No prompts, no tool arguments, no secrets, no PII ever leave this module.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { containsSecret } from './brain.ts';

export interface TrafficPayload {
  candidate_id: 'live_traffic';
  window_hours: number;
  calls: number;
  decisions: Record<string, number>;
  filters: Record<string, { calls: number; blocked: number; held: number; avg_risk: number }>;
  agents: number;
  block_rate: number;
  human_review_rate: number;
  top_codes: { code: string; count: number }[];
  recommendation_request: 'traffic_review';
}

interface IncidentRow {
  agent_id: string;
  decision: string;
  findings: unknown;
  created_at: string;
}

const DECISIONS = ['ALLOW', 'WARN', 'HOLD', 'HUMAN_REVIEW', 'BLOCK'];
const FILTERS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'];

export function buildTrafficPayload(rows: IncidentRow[], windowHours: number): TrafficPayload {
  const decisions: Record<string, number> = Object.fromEntries(DECISIONS.map((d) => [d, 0]));
  const filters: Record<string, { calls: number; blocked: number; held: number; risk: number }> = Object.fromEntries(
    FILTERS.map((f) => [f, { calls: 0, blocked: 0, held: 0, risk: 0 }]),
  );
  const codes = new Map<string, number>();
  const agents = new Set<string>();

  for (const row of rows) {
    agents.add(row.agent_id);
    if (decisions[row.decision] !== undefined) decisions[row.decision] += 1;
    const f = row.findings as { filters?: { filter: string; decision: string; risk: number; findings?: string[] }[] } | null;
    for (const entry of f?.filters ?? []) {
      const bucket = filters[entry.filter];
      if (!bucket) continue;
      bucket.calls += 1;
      bucket.risk += Number(entry.risk ?? 0);
      if (entry.decision === 'BLOCK') bucket.blocked += 1;
      if (entry.decision === 'HOLD' || entry.decision === 'HUMAN_REVIEW') bucket.held += 1;
      for (const code of entry.findings ?? []) codes.set(code, (codes.get(code) ?? 0) + 1);
    }
  }

  const calls = rows.length;
  const payload: TrafficPayload = {
    candidate_id: 'live_traffic',
    window_hours: windowHours,
    calls,
    decisions,
    filters: Object.fromEntries(
      FILTERS.map((k) => [
        k,
        {
          calls: filters[k].calls,
          blocked: filters[k].blocked,
          held: filters[k].held,
          avg_risk: Number((filters[k].calls ? filters[k].risk / filters[k].calls : 0).toFixed(4)),
        },
      ]),
    ),
    agents: agents.size,
    block_rate: Number((calls ? decisions.BLOCK / calls : 0).toFixed(4)),
    human_review_rate: Number((calls ? (decisions.HUMAN_REVIEW + decisions.HOLD) / calls : 0).toFixed(4)),
    top_codes: [...codes.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([code, count]) => ({ code, count })),
    recommendation_request: 'traffic_review',
  };

  if (containsSecret(payload)) {
    throw new Error('Brain traffic payload rejected: aggregate payload contained a secret-like value');
  }
  return payload;
}

export interface TrafficVerdict {
  recommendation: 'APPROVE' | 'REJECT' | 'HOLD';
  rationale: string;
  brain_connected: boolean;
  payload: TrafficPayload;
  calls: number;
}

/** Deterministic local read of live traffic, used when no Brain endpoint is configured. */
export function localTrafficVerdict(p: TrafficPayload): { recommendation: 'APPROVE' | 'REJECT' | 'HOLD'; rationale: string } {
  if (p.calls === 0) return { recommendation: 'HOLD', rationale: 'Brak ruchu w oknie obserwacji.' };
  if (p.block_rate > 0.4) {
    return { recommendation: 'REJECT', rationale: `Wysoki udział BLOCK (${(p.block_rate * 100).toFixed(1)}%) — ruch wymaga przeglądu operatora.` };
  }
  if (p.human_review_rate > 0.25) {
    return { recommendation: 'HOLD', rationale: `Dużo decyzji HOLD/HUMAN_REVIEW (${(p.human_review_rate * 100).toFixed(1)}%).` };
  }
  return { recommendation: 'APPROVE', rationale: 'Rozkład decyzji F1–F7 w normie dla obserwowanego ruchu.' };
}

/**
 * Aggregates recent tool/action incidents and forwards them to ALFA Brain.
 * Never promotes anything — the verdict is recorded for human review only.
 */
export async function forwardTrafficToBrain(
  db: SupabaseClient,
  windowHours = 24,
  limit = 1000,
): Promise<TrafficVerdict> {
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString();
  const { data } = await db
    .from('tafe_incidents')
    .select('agent_id, decision, findings, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = ((data ?? []) as IncidentRow[]).filter((r) => {
    const kind = (r.findings as { kind?: string } | null)?.kind;
    return kind === 'tool' || kind === 'action';
  });

  const payload = buildTrafficPayload(rows, windowHours);
  let verdict = localTrafficVerdict(payload);
  const brainUrl = Deno.env.get('ALFA_BRAIN_URL');
  const token = Deno.env.get('ALFA_BRAIN_TOKEN');

  if (brainUrl) {
    try {
      const res = await fetch(`${brainUrl.replace(/\/$/, '')}/evaluate/traffic`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        const rec = String(body?.recommendation ?? '').toUpperCase();
        if (['APPROVE', 'REJECT', 'HOLD'].includes(rec)) {
          verdict = {
            recommendation: rec as 'APPROVE' | 'REJECT' | 'HOLD',
            rationale: String(body?.rationale ?? 'ALFA Brain').slice(0, 1000),
          };
        }
      } else {
        console.error('brain traffic rejected', res.status);
      }
    } catch (e) {
      console.error('brain traffic unreachable', e instanceof Error ? e.message : e);
    }
  }

  await db.from('tafe_brain_evaluations').insert({
    candidate_id: 'live_traffic',
    candidate_version: payload.calls,
    payload,
    recommendation: verdict.recommendation,
    rationale: verdict.rationale,
    // Live traffic never changes a rule lifecycle on its own.
    resulting_status: 'DETECTED',
  });

  return { ...verdict, brain_connected: Boolean(brainUrl), payload, calls: payload.calls };
}

/** Throttled background forwarding triggered by real tool-call traffic. */
export async function maybeForwardTraffic(db: SupabaseClient, minMinutes = 10): Promise<void> {
  const { data } = await db
    .from('tafe_brain_evaluations')
    .select('created_at')
    .eq('candidate_id', 'live_traffic')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.created_at && Date.now() - new Date(data.created_at).getTime() < minMinutes * 60_000) return;
  await forwardTrafficToBrain(db).catch((e) => console.error('traffic forward failed', e instanceof Error ? e.message : e));
}
