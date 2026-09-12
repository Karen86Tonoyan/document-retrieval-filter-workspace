// TONOYAN ADAPTIVE FILTER ENGINE — Integration API.
// POST /evaluate/input | /evaluate/output | /evaluate/tool | /evaluate/action
// POST /patterns/candidate | /patterns/verify | /patterns/promote
// GET  /rules | /incidents | /audit
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3';
import { evaluate } from '../_shared/tafe/engine.ts';
import { serviceClient } from '../_shared/tafe/store.ts';
import { canTransition, HUMAN_ONLY_TRANSITIONS } from '../_shared/tafe/rule-engine.ts';
import { GOLDSET, passesRegression, runRegression } from '../_shared/tafe/regression.ts';
import {
  ATTACK_FAMILIES,
  BENCHMARK_MATRIX,
  BENCHMARK_REGISTRY_VERSION,
  BENCHMARKS,
  DEFENSE_FAMILIES,
} from '../_shared/tafe/benchmarks.ts';
import { GOLDSETS, goldsetSignature } from '../_shared/tafe/goldsets.ts';
import { ENGINE_VERSION, runCandidateSuite } from '../_shared/tafe/suite.ts';
import { applyBrainRecommendation, buildBrainPayload, localBrainRecommendation } from '../_shared/tafe/brain.ts';
import { summariseShadow } from '../_shared/tafe/shadow.ts';
import { sha256 } from '../_shared/tafe/util.ts';
import type { EvaluationKind, Rule } from '../_shared/tafe/types.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ToolSchema = z.union([
  z.string().max(120),
  z.object({
    name: z.string().min(1).max(120),
    operation: z.enum(['read', 'write', 'delete', 'execute', 'external']).optional(),
    resource: z.string().max(300).optional(),
    scope: z.array(z.string().max(120)).max(50).optional(),
    args: z.record(z.unknown()).optional(),
  }),
]);

const EvaluateSchema = z.object({
  agent: z.string().min(1).max(120).default('default'),
  model: z.string().min(1).max(120).default('unknown'),
  content: z.string().max(200000).default(''),
  tool: ToolSchema.optional(),
  session_id: z.string().max(120).optional(),
  request_id: z.string().max(120).optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z
    .array(
      z.object({
        claim: z.string().max(2000),
        kind: z.enum(['FACT', 'INFERENCE', 'ASSUMPTION', 'MODEL_GUESS']),
        source: z.string().max(500).optional(),
      }),
    )
    .max(200)
    .optional(),
  context: z.record(z.unknown()).optional(),
  dry_run: z.boolean().optional(),
});

const PatternSchema = z.object({
  pattern_id: z.string().min(4).max(128),
  status: z.enum(['CANDIDATE', 'SHADOW_TEST', 'REGRESSION_TEST', 'VERIFIED', 'NEEDS_REVIEW', 'PROMOTED', 'ACTIVE', 'REJECTED', 'RETIRED', 'INVALIDATED']),
});

const RuleTransitionSchema = z.object({
  rule_key: z.string().min(1).max(120),
  to: z.enum(['CANDIDATE', 'SHADOW_TEST', 'REGRESSION_TEST', 'VERIFIED', 'NEEDS_REVIEW', 'PROMOTED', 'ACTIVE', 'REJECTED', 'RETIRED', 'INVALIDATED']),
});

const EMPTY_AUTH = { user: null, isAdmin: false, isProvider: false, roles: [] as string[] };

async function authenticate(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return EMPTY_AUTH;
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return EMPTY_AUTH;
  const db = serviceClient();
  const { data: roleRows } = await db.from('user_roles').select('role').eq('user_id', data.user.id);
  const roles = (roleRows ?? []).map((r) => String(r.role));
  return {
    user: data.user,
    isAdmin: roles.includes('admin'),
    // PROVIDER: may run tests and submit materials/proposals — never promote or activate.
    isProvider: roles.includes('provider'),
    roles,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/tafe/, '').replace(/\/+$/, '') || '/';

  try {
    const { user, isAdmin, isProvider, roles } = await authenticate(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const db = serviceClient();

    // ---- IDENTITY / ROLES ----
    if (path === '/me' && req.method === 'GET') {
      return json({
        user_id: user.id,
        roles,
        is_admin: isAdmin,
        is_provider: isProvider,
        // Everyone authenticated may read; guests get nothing beyond reads.
        capabilities: {
          read: true,
          run_tests: isAdmin || isProvider,
          propose: isAdmin || isProvider,
          submit_materials: isAdmin || isProvider,
          lifecycle: isAdmin,
          promote: isAdmin,
        },
      });
    }

    // ---- PROVIDER: propose a rule (always CANDIDATE + disabled) ----
    if (path === '/propose/rule' && req.method === 'POST') {
      if (!isAdmin && !isProvider) return json({ error: 'Admin or provider role required' }, 403);
      const parsed = z
        .object({
          rule_key: z.string().min(3).max(120).regex(/^[a-z0-9_.-]+$/),
          name: z.string().min(3).max(200),
          description: z.string().max(2000).default(''),
          filter: z.enum(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7']),
          severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
          action: z.enum(['ALLOW', 'WARN', 'HOLD', 'HUMAN_REVIEW', 'BLOCK']).default('WARN'),
          conditions: z
            .array(z.object({ field: z.string().max(60), op: z.string().max(20), value: z.string().max(500) }))
            .min(1)
            .max(20),
        })
        .safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const { data: existing } = await db
        .from('tafe_rules')
        .select('version')
        .eq('rule_key', parsed.data.rule_key)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: inserted, error } = await db
        .from('tafe_rules')
        .insert({
          ...parsed.data,
          version: (existing?.version ?? 0) + 1,
          status: 'CANDIDATE',
          enabled: false,
          created_by: user.id,
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ rule: inserted, note: 'Proposal stored as CANDIDATE. Activation requires an admin.' }, 201);
    }

    // ---- PROVIDER: submit test material (goldset cases) ----
    if (path === '/materials/goldset' && req.method === 'POST') {
      if (!isAdmin && !isProvider) return json({ error: 'Admin or provider role required' }, 403);
      const parsed = z
        .object({
          cases: z
            .array(
              z.object({
                case_id: z.string().min(3).max(120),
                goldset: z.enum(['benign', 'malicious', 'ambiguous', 'tool', 'privacy', 'factuality', 'drift', 'adaptive']),
                filter: z.enum(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7']),
                attack_family: z.string().max(80).default('unknown'),
                input: z.string().min(1).max(8000),
                context: z.record(z.unknown()).default({}),
                expected_decision: z.enum(['ALLOW', 'WARN', 'HOLD', 'HUMAN_REVIEW', 'BLOCK']),
                expected_findings: z.array(z.string().max(120)).default([]),
                severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
                tags: z.array(z.string().max(40)).max(20).default([]),
              }),
            )
            .min(1)
            .max(200),
        })
        .safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const { error, count } = await db
        .from('tafe_goldset_cases')
        .upsert(
          parsed.data.cases.map((c) => ({ ...c, source: isAdmin ? 'admin' : `provider:${user.id}` })),
          { onConflict: 'case_id', count: 'exact' },
        );
      if (error) return json({ error: error.message }, 400);
      return json({ stored: count ?? parsed.data.cases.length }, 201);
    }

    if (path === '/materials/goldset' && req.method === 'GET') {
      const { data } = await db.from('tafe_goldset_cases').select('*').order('created_at', { ascending: false }).limit(500);
      return json({ cases: data ?? [] });
    }

    // ---- EVALUATION ENDPOINTS ----
    const evalMatch = path.match(/^\/evaluate\/(input|output|tool|action)$/);
    if (evalMatch && req.method === 'POST') {
      const parsed = EvaluateSchema.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const { dry_run, ...body } = parsed.data;
      const result = await evaluate(
        { ...body, kind: evalMatch[1] as EvaluationKind },
        { db, actor: user.id, dryRun: dry_run === true },
      );
      return json(result);
    }

    // ---- PATTERN LIFECYCLE ----
    if (path === '/patterns/candidate' && req.method === 'POST') {
      if (!isAdmin) return json({ error: 'Admin role required' }, 403);
      const parsed = PatternSchema.pick({ pattern_id: true }).safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const { data: pattern } = await db.from('tafe_patterns').select('*').eq('pattern_id', parsed.data.pattern_id).maybeSingle();
      if (!pattern) return json({ error: 'Pattern not found' }, 404);
      if (!canTransition(String(pattern.status), 'CANDIDATE')) {
        return json({ error: `Transition ${pattern.status} → CANDIDATE not allowed` }, 409);
      }
      await db.from('tafe_patterns').update({ status: 'CANDIDATE' }).eq('pattern_id', parsed.data.pattern_id);
      return json({ pattern_id: parsed.data.pattern_id, status: 'CANDIDATE' });
    }

    if ((path === '/patterns/verify' || path === '/patterns/promote') && req.method === 'POST') {
      if (!isAdmin) return json({ error: 'Admin role required' }, 403);
      const parsed = PatternSchema.pick({ pattern_id: true }).safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const target = path === '/patterns/verify' ? 'VERIFIED' : 'PROMOTED';
      const { data: pattern } = await db.from('tafe_patterns').select('*').eq('pattern_id', parsed.data.pattern_id).maybeSingle();
      if (!pattern) return json({ error: 'Pattern not found' }, 404);
      const from = String(pattern.status);
      const viaRegression = target === 'VERIFIED' && from === 'SHADOW_TEST';
      if (!canTransition(from, target) && !(viaRegression && canTransition(from, 'REGRESSION_TEST'))) {
        return json({ error: `Transition ${from} → ${target} not allowed` }, 409);
      }
      await db.from('tafe_patterns').update({ status: target }).eq('pattern_id', parsed.data.pattern_id);
      return json({ pattern_id: parsed.data.pattern_id, status: target });
    }

    // ---- RULE LIFECYCLE (human-gated) ----
    if (path === '/rules/transition' && req.method === 'POST') {
      if (!isAdmin) return json({ error: 'Admin role required' }, 403);
      const parsed = RuleTransitionSchema.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const { data: rule } = await db
        .from('tafe_rules')
        .select('*')
        .eq('rule_key', parsed.data.rule_key)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!rule) return json({ error: 'Rule not found' }, 404);
      const from = String(rule.status);
      if (!canTransition(from, parsed.data.to)) {
        return json({ error: `Transition ${from} → ${parsed.data.to} not allowed` }, 409);
      }
      if (HUMAN_ONLY_TRANSITIONS.has(parsed.data.to)) {
        const { data: runs } = await db
          .from('tafe_regression_runs')
          .select('passed, f1')
          .eq('rule_key', rule.rule_key)
          .eq('rule_version', rule.version)
          .order('created_at', { ascending: false })
          .limit(1);
        if (!runs?.length || !runs[0].passed) {
          return json({ error: 'Promotion requires a passing regression run for this rule version' }, 409);
        }
      }
      await db
        .from('tafe_rules')
        .update({
          status: parsed.data.to,
          enabled: parsed.data.to === 'ACTIVE',
          previous_version: { status: from, enabled: rule.enabled, version: rule.version },
        })
        .eq('id', rule.id);
      return json({ rule_key: rule.rule_key, status: parsed.data.to });
    }

    if (path === '/rules/regression' && req.method === 'POST') {
      if (!isAdmin && !isProvider) return json({ error: 'Admin or provider role required' }, 403);
      const parsed = z.object({ rule_key: z.string().min(1).max(120) }).safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const { data: rule } = await db
        .from('tafe_rules')
        .select('*')
        .eq('rule_key', parsed.data.rule_key)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!rule) return json({ error: 'Rule not found' }, 404);

      const { data: baselineRow } = await db
        .from('tafe_regression_runs')
        .select('f1')
        .eq('rule_key', rule.rule_key)
        .eq('passed', true)
        .order('f1', { ascending: false })
        .limit(1)
        .maybeSingle();
      const baselineF1 = Number(baselineRow?.f1 ?? 0);

      const metrics = runRegression(rule as unknown as Rule, GOLDSET);
      const passed = passesRegression(metrics, baselineF1);
      await db.from('tafe_regression_runs').insert({
        rule_key: rule.rule_key,
        rule_version: rule.version,
        goldset: 'default',
        tp: metrics.tp,
        tn: metrics.tn,
        fp: metrics.fp,
        fn: metrics.fn,
        precision: Number(metrics.precision.toFixed(4)),
        recall: Number(metrics.recall.toFixed(4)),
        f1: Number(metrics.f1.toFixed(4)),
        baseline_f1: baselineF1,
        passed,
        details: metrics.details,
      });
      if (passed && canTransition(String(rule.status), 'REGRESSION_TEST')) {
        await db.from('tafe_rules').update({ status: 'REGRESSION_TEST' }).eq('id', rule.id);
      }
      return json({ rule_key: rule.rule_key, passed, baseline_f1: baselineF1, ...metrics });
    }

    // ================= PHASE 2: BENCHMARKS, GOLDSETS, ADAPTIVE, GATE, BRAIN =================

    if (path === '/benchmarks' && req.method === 'GET') {
      const { data } = await db.from('tafe_benchmarks').select('*').order('name');
      const rows = data ?? [];
      return json({
        registry_version: BENCHMARK_REGISTRY_VERSION,
        benchmarks: rows.length ? rows : BENCHMARKS,
        matrix: BENCHMARK_MATRIX,
        attack_families: ATTACK_FAMILIES,
        defense_families: DEFENSE_FAMILIES,
      });
    }

    /** Seeds/refreshes the benchmark registry rows from the deterministic catalogue. */
    if (path === '/benchmarks/sync' && req.method === 'POST') {
      if (!isAdmin && !isProvider) return json({ error: 'Admin or provider role required' }, 403);
      const datasetHash = await sha256(goldsetSignature());
      const rows = BENCHMARKS.map((b) => ({
        benchmark_id: b.id,
        name: b.name,
        version: b.version,
        source: b.source,
        filter: b.filter,
        attack_family: b.attack_family,
        runner: b.runner,
        scorer: b.scorer,
        status: b.status,
        dataset_hash: b.runner === 'none' ? '' : datasetHash.slice(0, 32),
        notes: b.notes,
      }));
      const { error } = await db.from('tafe_benchmarks').upsert(rows, { onConflict: 'benchmark_id' });
      if (error) throw error;
      return json({ synced: rows.length, dataset_hash: datasetHash.slice(0, 32) });
    }

    if (path === '/goldsets' && req.method === 'GET') {
      return json({
        dataset_hash: (await sha256(goldsetSignature())).slice(0, 32),
        cases: GOLDSETS.map((c) => ({
          id: c.id,
          goldset: c.goldset,
          filter: c.filter,
          attack_family: c.attack_family,
          input: c.input.slice(0, 300),
          expected_decision: c.expected_decision,
          expected_findings: c.expected_findings,
          severity: c.severity,
          source: c.source,
          tags: c.tags,
          version: c.version,
          tool: c.tool?.name ?? null,
        })),
      });
    }

    if (path === '/shadow' && req.method === 'GET') {
      const { data } = await db
        .from('tafe_shadow_evaluations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
      return json({
        observations: data ?? [],
        summary: summariseShadow((data ?? []).map((r) => ({ rule_key: r.rule_key, agreed: r.agreed }))),
      });
    }

    /** Full evaluation suite for one candidate: goldsets + metrics + 7 adaptive rounds + gate. */
    if (path === '/rules/suite' && req.method === 'POST') {
      if (!isAdmin && !isProvider) return json({ error: 'Admin or provider role required' }, 403);
      const parsed = z.object({ rule_key: z.string().min(1).max(120) }).safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const { data: rule } = await db
        .from('tafe_rules')
        .select('*')
        .eq('rule_key', parsed.data.rule_key)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!rule) return json({ error: 'Rule not found' }, 404);

      const suite = await runCandidateSuite(rule as unknown as Rule);
      const runId = crypto.randomUUID();
      const datasetHash = (await sha256(goldsetSignature())).slice(0, 32);

      await db.from('tafe_regression_runs').insert({
        run_id: runId,
        rule_key: rule.rule_key,
        rule_version: rule.version,
        goldset: 'phase2',
        dataset_hash: datasetHash,
        tp: suite.metrics.tp,
        tn: suite.metrics.tn,
        fp: suite.metrics.fp,
        fn: suite.metrics.fn,
        precision: suite.metrics.precision,
        recall: suite.metrics.recall,
        f1: suite.metrics.f1,
        baseline_f1: suite.baseline.f1,
        passed: suite.regression_passed,
        specificity: suite.metrics.specificity,
        false_positive_rate: suite.metrics.false_positive_rate,
        false_negative_rate: suite.metrics.false_negative_rate,
        attack_success_rate: suite.metrics.attack_success_rate,
        adaptive_attack_success_rate: suite.metrics.adaptive_attack_success_rate,
        task_utility: suite.metrics.task_utility,
        latency_ms: suite.metrics.latency_ms,
        coverage: suite.metrics.coverage,
        security_score: suite.metrics.security_score,
        utility_score: suite.metrics.utility_score,
        stability_score: suite.metrics.stability_score,
        regression_score: suite.metrics.regression_score,
        details: suite.outcomes.slice(0, 200),
      });

      for (const round of suite.adaptive.rounds) {
        await db.from('tafe_adaptive_runs').insert({
          run_id: runId,
          rule_key: rule.rule_key,
          rule_version: rule.version,
          round: round.round,
          round_name: round.round_name,
          variants: round.variants,
          blocked: round.blocked,
          attack_success_rate: round.attack_success_rate,
          passed: round.passed,
          details: round.details.slice(0, 100),
        });
      }

      await db.from('tafe_promotions').insert({
        run_id: runId,
        rule_key: rule.rule_key,
        candidate_version: rule.version,
        engine_version: ENGINE_VERSION,
        ruleset_hash: (await sha256(JSON.stringify(rule.conditions))).slice(0, 32),
        dataset_hash: datasetHash,
        benchmark_version: BENCHMARK_REGISTRY_VERSION,
        checks: suite.gate.checks,
        metrics: suite.metrics,
        passed: suite.gate.passed,
        reason: suite.gate.reason,
        rollback_id: suite.rollbackId,
        actor: user.id,
      });

      if (suite.regression_passed && canTransition(String(rule.status), 'REGRESSION_TEST')) {
        await db.from('tafe_rules').update({ status: 'REGRESSION_TEST' }).eq('id', rule.id);
      }

      return json({ run_id: runId, dataset_hash: datasetHash, ...suite });
    }

    /** ALFA Brain: receives aggregates only, may at most produce NEEDS_REVIEW. */
    if (path === '/brain/evaluate' && req.method === 'POST') {
      if (!isAdmin && !isProvider) return json({ error: 'Admin or provider role required' }, 403);
      const parsed = z.object({ rule_key: z.string().min(1).max(120) }).safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
      const { data: rule } = await db
        .from('tafe_rules')
        .select('*')
        .eq('rule_key', parsed.data.rule_key)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!rule) return json({ error: 'Rule not found' }, 404);

      const suite = await runCandidateSuite(rule as unknown as Rule);
      const payload = buildBrainPayload(rule.rule_key, rule.version, suite.metrics, suite.baseline);

      let recommendation = localBrainRecommendation(suite.gate);
      const brainUrl = Deno.env.get('ALFA_BRAIN_URL');
      if (brainUrl) {
        try {
          const brainRes = await fetch(`${brainUrl.replace(/\/$/, '')}/evaluate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(Deno.env.get('ALFA_BRAIN_TOKEN')
                ? { Authorization: `Bearer ${Deno.env.get('ALFA_BRAIN_TOKEN')}` }
                : {}),
            },
            body: JSON.stringify(payload),
          });
          if (brainRes.ok) {
            const body = await brainRes.json();
            const rec = String(body?.recommendation ?? '').toUpperCase();
            if (['APPROVE', 'REJECT', 'HOLD'].includes(rec)) {
              recommendation = { recommendation: rec as 'APPROVE' | 'REJECT' | 'HOLD', rationale: String(body?.rationale ?? 'ALFA Brain').slice(0, 1000) };
            }
          }
        } catch (e) {
          console.error('brain unreachable', e instanceof Error ? e.message : e);
        }
      }

      const decision = applyBrainRecommendation(recommendation.recommendation, recommendation.rationale, {
        candidate: suite.metrics,
        baseline: suite.baseline,
        regression_passed: suite.regression_passed,
        adaptive_passed: suite.adaptive.passed,
        rollback_id: suite.rollbackId,
      });

      await db.from('tafe_brain_evaluations').insert({
        candidate_id: rule.rule_key,
        candidate_version: rule.version,
        payload,
        recommendation: decision.recommendation,
        rationale: decision.rationale,
        resulting_status: decision.resulting_status,
      });

      // Brain verdicts are recorded against the pattern registry, never as ACTIVE.
      if (decision.recommendation === 'APPROVE') {
        await db
          .from('tafe_patterns')
          .update({ verified_count: 1, rule_version: rule.version })
          .eq('status', 'CANDIDATE')
          .eq('filter', rule.filter);
      }

      if (decision.resulting_status !== rule.status && decision.resulting_status !== 'PROMOTED' && decision.resulting_status !== 'ACTIVE') {
        await db.from('tafe_rules').update({ status: decision.resulting_status }).eq('id', rule.id);
      }

      return json({ ...decision, payload, brain_connected: Boolean(brainUrl) });
    }

    if (path === '/dashboard' && req.method === 'GET') {
      const [rulesRes, runsRes, patternsRes, promoRes] = await Promise.all([
        db.from('tafe_rules').select('status'),
        db.from('tafe_regression_runs').select('*').order('created_at', { ascending: false }).limit(50),
        db.from('tafe_patterns').select('status, decision'),
        db.from('tafe_promotions').select('passed').order('created_at', { ascending: false }).limit(50),
      ]);
      const latest = (runsRes.data ?? [])[0];
      return json({
        security_score: Number(latest?.security_score ?? 0),
        utility_score: Number(latest?.utility_score ?? 0),
        adaptive_asr: Number(latest?.adaptive_attack_success_rate ?? 0),
        fp_rate: Number(latest?.false_positive_rate ?? 0),
        active_rules: (rulesRes.data ?? []).filter((r) => r.status === 'ACTIVE').length,
        candidates: (rulesRes.data ?? []).filter((r) => r.status !== 'ACTIVE' && r.status !== 'RETIRED').length,
        open_regressions: (runsRes.data ?? []).filter((r) => !r.passed).map((r) => ({
          rule_key: r.rule_key,
          f1: Number(r.f1),
          fpr: Number(r.false_positive_rate ?? 0),
          created_at: r.created_at,
        })),
        patterns_blocked: (patternsRes.data ?? []).filter((p) => p.decision === 'BLOCK').length,
        promotions_passed: (promoRes.data ?? []).filter((p) => p.passed).length,
      });
    }

    // ---- READ ENDPOINTS ----
    if (path === '/rules' && req.method === 'GET') {
      const { data, error } = await db.from('tafe_rules').select('*').order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      return json({ rules: data });
    }
    if (path === '/incidents' && req.method === 'GET') {
      const { data, error } = await db.from('tafe_incidents').select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return json({ incidents: data });
    }
    if (path === '/audit' && req.method === 'GET') {
      const { data, error } = await db.from('tafe_audit_log').select('*').order('ts', { ascending: false }).limit(500);
      if (error) throw error;
      return json({ audit: data });
    }
    if (path === '/goldset' && req.method === 'GET') {
      return json({ cases: GOLDSET.map((c) => ({ id: c.id, label: c.label, group: c.group, content: c.request.content })) });
    }

    return json({ error: `Unknown route ${req.method} ${path}` }, 404);
  } catch (err) {
    console.error('tafe error', err instanceof Error ? err.message : err);
    return json({ error: 'Internal engine error' }, 500);
  }
});
