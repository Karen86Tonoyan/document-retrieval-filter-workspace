-- Phase 2 lifecycle states
ALTER TYPE public.tafe_lifecycle ADD VALUE IF NOT EXISTS 'NEEDS_REVIEW';
ALTER TYPE public.tafe_lifecycle ADD VALUE IF NOT EXISTS 'INVALIDATED';

DO $$ BEGIN
  CREATE TYPE public.tafe_benchmark_status AS ENUM ('REFERENCED','INTEGRATED','VERIFIED','BROKEN','DEPRECATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- BENCHMARK REGISTRY ----------
CREATE TABLE IF NOT EXISTS public.tafe_benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_id text NOT NULL UNIQUE,
  name text NOT NULL,
  version text NOT NULL DEFAULT '0',
  source text NOT NULL DEFAULT '',
  filter public.tafe_filter,
  attack_family text NOT NULL DEFAULT 'unknown',
  runner text NOT NULL DEFAULT 'none',
  scorer text NOT NULL DEFAULT 'none',
  status public.tafe_benchmark_status NOT NULL DEFAULT 'REFERENCED',
  dataset_hash text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tafe_benchmarks TO authenticated;
GRANT ALL ON public.tafe_benchmarks TO service_role;
ALTER TABLE public.tafe_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "benchmarks readable by authenticated" ON public.tafe_benchmarks FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins insert benchmarks" ON public.tafe_benchmarks FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins update benchmarks" ON public.tafe_benchmarks FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins delete benchmarks" ON public.tafe_benchmarks FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER tafe_benchmarks_touch BEFORE UPDATE ON public.tafe_benchmarks FOR EACH ROW EXECUTE FUNCTION public.tafe_touch_updated_at();

-- ---------- GOLDSET ENGINE ----------
CREATE TABLE IF NOT EXISTS public.tafe_goldset_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text NOT NULL UNIQUE,
  goldset text NOT NULL DEFAULT 'benign',
  filter public.tafe_filter NOT NULL,
  attack_family text NOT NULL DEFAULT 'none',
  input text NOT NULL DEFAULT '',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_decision public.tafe_decision NOT NULL DEFAULT 'ALLOW',
  expected_findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity public.tafe_severity NOT NULL DEFAULT 'LOW',
  source text NOT NULL DEFAULT 'internal',
  tags text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tafe_goldset_cases TO authenticated;
GRANT ALL ON public.tafe_goldset_cases TO service_role;
ALTER TABLE public.tafe_goldset_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "goldset readable by authenticated" ON public.tafe_goldset_cases FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins insert goldset" ON public.tafe_goldset_cases FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins update goldset" ON public.tafe_goldset_cases FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins delete goldset" ON public.tafe_goldset_cases FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER tafe_goldset_touch BEFORE UPDATE ON public.tafe_goldset_cases FOR EACH ROW EXECUTE FUNCTION public.tafe_touch_updated_at();

-- ---------- SHADOW MODE OBSERVATIONS ----------
CREATE TABLE IF NOT EXISTS public.tafe_shadow_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  rule_key text NOT NULL,
  rule_version integer NOT NULL DEFAULT 1,
  shadow_decision public.tafe_decision NOT NULL,
  production_decision public.tafe_decision NOT NULL,
  agreed boolean NOT NULL DEFAULT false,
  would_change boolean NOT NULL DEFAULT false,
  matched jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tafe_shadow_evaluations TO authenticated;
GRANT ALL ON public.tafe_shadow_evaluations TO service_role;
ALTER TABLE public.tafe_shadow_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shadow readable by authenticated" ON public.tafe_shadow_evaluations FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS tafe_shadow_rule_idx ON public.tafe_shadow_evaluations (rule_key, created_at DESC);

-- ---------- ADAPTIVE ATTACK TESTS ----------
CREATE TABLE IF NOT EXISTS public.tafe_adaptive_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  rule_key text NOT NULL,
  rule_version integer NOT NULL DEFAULT 1,
  round integer NOT NULL,
  round_name text NOT NULL,
  variants integer NOT NULL DEFAULT 0,
  blocked integer NOT NULL DEFAULT 0,
  attack_success_rate numeric NOT NULL DEFAULT 0,
  passed boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tafe_adaptive_runs TO authenticated;
GRANT ALL ON public.tafe_adaptive_runs TO service_role;
ALTER TABLE public.tafe_adaptive_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "adaptive readable by authenticated" ON public.tafe_adaptive_runs FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS tafe_adaptive_rule_idx ON public.tafe_adaptive_runs (rule_key, created_at DESC);

-- ---------- ALFA BRAIN EVALUATIONS (aggregates only) ----------
CREATE TABLE IF NOT EXISTS public.tafe_brain_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id text NOT NULL,
  candidate_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendation text NOT NULL DEFAULT 'HOLD',
  rationale text NOT NULL DEFAULT '',
  resulting_status public.tafe_lifecycle NOT NULL DEFAULT 'CANDIDATE',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tafe_brain_evaluations TO authenticated;
GRANT ALL ON public.tafe_brain_evaluations TO service_role;
ALTER TABLE public.tafe_brain_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "brain evals readable by authenticated" ON public.tafe_brain_evaluations FOR SELECT TO authenticated USING (true);

-- ---------- HARD PROMOTION GATE ----------
CREATE TABLE IF NOT EXISTS public.tafe_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id text NOT NULL,
  rule_key text NOT NULL,
  candidate_version integer NOT NULL DEFAULT 1,
  engine_version text NOT NULL DEFAULT '2.0.0',
  ruleset_hash text NOT NULL DEFAULT '',
  dataset_hash text NOT NULL DEFAULT '',
  benchmark_version text NOT NULL DEFAULT '',
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  passed boolean NOT NULL DEFAULT false,
  reason text NOT NULL DEFAULT '',
  rollback_id text,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tafe_promotions TO authenticated;
GRANT ALL ON public.tafe_promotions TO service_role;
ALTER TABLE public.tafe_promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "promotions readable by authenticated" ON public.tafe_promotions FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS tafe_promotions_rule_idx ON public.tafe_promotions (rule_key, created_at DESC);

-- ---------- DEAD PATTERN REGISTRY EXTENSIONS ----------
ALTER TABLE public.tafe_patterns
  ADD COLUMN IF NOT EXISTS attack_family text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS filter public.tafe_filter,
  ADD COLUMN IF NOT EXISTS severity public.tafe_severity NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS context_signature text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS verified_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rule_version integer NOT NULL DEFAULT 1;

-- ---------- REGRESSION METRIC EXTENSIONS ----------
ALTER TABLE public.tafe_regression_runs
  ADD COLUMN IF NOT EXISTS specificity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS false_positive_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS false_negative_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attack_success_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adaptive_attack_success_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS task_utility numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS latency_ms numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coverage numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS security_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS utility_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stability_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS regression_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dataset_hash text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS run_id text NOT NULL DEFAULT '';

-- ---------- AUDIT EXTENSIONS ----------
ALTER TABLE public.tafe_audit_log
  ADD COLUMN IF NOT EXISTS run_id text,
  ADD COLUMN IF NOT EXISTS engine_version text NOT NULL DEFAULT '2.0.0',
  ADD COLUMN IF NOT EXISTS ruleset_hash text,
  ADD COLUMN IF NOT EXISTS dataset_hash text,
  ADD COLUMN IF NOT EXISTS candidate_version integer,
  ADD COLUMN IF NOT EXISTS benchmark_version text,
  ADD COLUMN IF NOT EXISTS rollback_id text;