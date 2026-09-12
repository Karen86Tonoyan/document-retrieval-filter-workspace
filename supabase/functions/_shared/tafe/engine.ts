// TAFE pipeline orchestrator: INPUT → F1 → F2 → F3 → F4 → F5 → F6 → F7 → decision.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { EvaluationRequest, EvaluationResponse, FilterResult, Rule } from './types.ts';
import { canonicalize, fingerprint } from './util.ts';
import { runF1 } from './f1-input-integrity.ts';
import { runF2 } from './f2-injection.ts';
import { runF3 } from './f3-permissions.ts';
import { runF4 } from './f4-privacy.ts';
import { runF5 } from './f5-evidence.ts';
import { runF6 } from './f6-drift.ts';
import { runF7 } from './f7-gate.ts';
import { evaluateRules } from './rule-engine.ts';
import {
  loadDriftContext,
  loadRules,
  lookupVerifiedPattern,
  recordAudit,
  recordIncident,
  recordShadowObservations,
  updateAgentProfile,
  upsertPattern,
} from './store.ts';
import { applyShadowSafely, observeShadow } from './shadow.ts';

export interface EvaluateOptions {
  db: SupabaseClient;
  actor: string | null;
  /** Skip drift/audit persistence — used by the UI sandbox. */
  dryRun?: boolean;
}

export async function evaluate(
  request: EvaluationRequest,
  options: EvaluateOptions,
): Promise<EvaluationResponse> {
  const { db, actor, dryRun } = options;
  const requestId = request.request_id ?? crypto.randomUUID();
  const canonical = canonicalize(request.content ?? '');
  const fp = await fingerprint(`${request.kind}:${request.content ?? ''}`);

  let rules: Rule[] = [];
  try {
    rules = await loadRules(db);
  } catch {
    rules = [];
  }

  // Dead Pattern Registry fast path — only for verified patterns in an unchanged context.
  const known = dryRun ? null : await lookupVerifiedPattern(db, fp, request.context).catch(() => null);

  const f1 = await runF1(request);
  const f2 = await runF2(request);
  const f3 = await runF3(request);
  const f4 = await runF4(request);
  const f5 = await runF5(request);

  const drift = dryRun
    ? { profile: null, recentDecisions: [], recentTools: [], repeatCount: 0 }
    : await loadDriftContext(db, request.agent, fp).catch(() => ({
        profile: null,
        recentDecisions: [],
        recentTools: [],
        repeatCount: 0,
      }));
  const f6 = await runF6(request, drift);

  const filters: FilterResult[] = [f1, f2, f3, f4, f5, f6];
  const preRisk = Math.max(...filters.map((f) => f.risk));
  const ruleMatches = evaluateRules(request, rules, preRisk);

  const evidenceScore = Number(f5.meta?.evidence_score ?? 0);
  const gate = runF7({
    filters,
    ruleMatches,
    level: String(f3.meta?.level ?? 'L0'),
    evidenceScore,
  });

  const f7: FilterResult = {
    filter: 'F7',
    risk: gate.risk,
    decision: gate.decision,
    findings: gate.findings,
    meta: { reason: gate.reason, known_pattern: known?.decision ?? null },
  };

  const response: EvaluationResponse = {
    decision: gate.decision,
    risk: Number(gate.risk.toFixed(4)),
    request_id: requestId,
    filters: [...filters, f7],
    findings: [...filters.flatMap((f) => f.findings), ...gate.findings],
    rule_matches: ruleMatches,
    requires_human: gate.requires_human,
    redacted_content: String(f4.meta?.redacted ?? request.content ?? ''),
    evidence: {
      confidence_score: Number(f5.meta?.confidence_score ?? 0),
      evidence_score: evidenceScore,
      items: (f5.meta?.items as EvaluationResponse['evidence']['items']) ?? [],
    },
    reason: known
      ? `${gate.reason} (znany zweryfikowany wzorzec: ${known.decision})`
      : gate.reason,
  };

  // SHADOW MODE: non-enforcing rules record what they would have decided.
  const ruleVersions = Object.fromEntries(rules.map((r) => [r.rule_key, r.version]));
  const shadowObservations = observeShadow(ruleMatches, response.decision, ruleVersions);
  // Guarantee: shadow observations never change the production decision.
  response.decision = applyShadowSafely(response.decision, shadowObservations);

  const worst = response.findings.find((f) => f.severity === 'CRITICAL') ?? response.findings[0];

  if (!dryRun) {
    await Promise.all([
      recordAudit(db, request, response, fp, actor).catch(() => undefined),
      recordIncident(db, request, response).catch(() => undefined),
      updateAgentProfile(db, request, response).catch(() => undefined),
      recordShadowObservations(db, response.request_id, shadowObservations).catch(() => undefined),
      response.decision !== 'ALLOW'
        ? upsertPattern(db, canonical, fp, response.risk, response.decision, request.context, request.kind, {
            filter: worst?.filter ?? 'F7',
            severity: worst?.severity ?? 'MEDIUM',
            attack_family: (worst?.code ?? 'unknown').toLowerCase(),
          }).catch(() => undefined)
        : Promise.resolve(),
    ]);
  }

  return { ...response, shadow: shadowObservations } as EvaluationResponse & { shadow: typeof shadowObservations };
}
