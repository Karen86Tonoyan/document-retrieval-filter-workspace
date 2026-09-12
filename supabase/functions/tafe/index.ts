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
  status: z.enum(['CANDIDATE', 'SHADOW_TEST', 'REGRESSION_TEST', 'VERIFIED', 'PROMOTED', 'ACTIVE', 'REJECTED', 'RETIRED']),
});

const RuleTransitionSchema = z.object({
  rule_key: z.string().min(1).max(120),
  to: z.enum(['CANDIDATE', 'SHADOW_TEST', 'REGRESSION_TEST', 'VERIFIED', 'PROMOTED', 'ACTIVE', 'REJECTED', 'RETIRED']),
});

async function authenticate(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return { user: null, isAdmin: false };
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) return { user: null, isAdmin: false };
  const db = serviceClient();
  const { data: roles } = await db.from('user_roles').select('role').eq('user_id', data.user.id);
  const isAdmin = (roles ?? []).some((r) => r.role === 'admin');
  return { user: data.user, isAdmin };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/tafe/, '').replace(/\/+$/, '') || '/';

  try {
    const { user, isAdmin } = await authenticate(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);
    const db = serviceClient();

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
      if (!isAdmin) return json({ error: 'Admin role required' }, 403);
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
