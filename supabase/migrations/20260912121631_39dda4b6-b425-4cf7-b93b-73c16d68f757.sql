-- ENUMS
CREATE TYPE public.tafe_filter AS ENUM ('F1','F2','F3','F4','F5','F6','F7');
CREATE TYPE public.tafe_decision AS ENUM ('ALLOW','WARN','HOLD','HUMAN_REVIEW','BLOCK');
CREATE TYPE public.tafe_severity AS ENUM ('INFO','LOW','MEDIUM','HIGH','CRITICAL');
CREATE TYPE public.tafe_lifecycle AS ENUM ('DETECTED','CANDIDATE','SHADOW_TEST','REGRESSION_TEST','VERIFIED','PROMOTED','ACTIVE','REJECTED','RETIRED');

-- RULES
CREATE TABLE public.tafe_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  filter public.tafe_filter NOT NULL,
  severity public.tafe_severity NOT NULL DEFAULT 'MEDIUM',
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  action public.tafe_decision NOT NULL DEFAULT 'WARN',
  confidence_threshold numeric NOT NULL DEFAULT 0.6,
  enabled boolean NOT NULL DEFAULT false,
  status public.tafe_lifecycle NOT NULL DEFAULT 'CANDIDATE',
  version integer NOT NULL DEFAULT 1,
  previous_version jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_key, version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tafe_rules TO authenticated;
GRANT ALL ON public.tafe_rules TO service_role;
ALTER TABLE public.tafe_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rules readable by authenticated" ON public.tafe_rules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins insert rules" ON public.tafe_rules
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update rules" ON public.tafe_rules
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete rules" ON public.tafe_rules
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- PATTERN REGISTRY (incl. dead patterns via status RETIRED/REJECTED)
CREATE TABLE public.tafe_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id text NOT NULL UNIQUE,
  canonical_form text NOT NULL,
  fingerprint text NOT NULL,
  source text NOT NULL DEFAULT 'runtime',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  context_hash text NOT NULL DEFAULT '',
  risk numeric NOT NULL DEFAULT 0,
  decision public.tafe_decision,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  hit_count integer NOT NULL DEFAULT 1,
  false_positive_count integer NOT NULL DEFAULT 0,
  status public.tafe_lifecycle NOT NULL DEFAULT 'DETECTED',
  version integer NOT NULL DEFAULT 1
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tafe_patterns TO authenticated;
GRANT ALL ON public.tafe_patterns TO service_role;
ALTER TABLE public.tafe_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "patterns readable by authenticated" ON public.tafe_patterns
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins insert patterns" ON public.tafe_patterns
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update patterns" ON public.tafe_patterns
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete patterns" ON public.tafe_patterns
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX tafe_patterns_fingerprint_idx ON public.tafe_patterns (fingerprint);
CREATE INDEX tafe_patterns_status_idx ON public.tafe_patterns (status);

-- REGRESSION RUNS
CREATE TABLE public.tafe_regression_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL,
  rule_version integer NOT NULL DEFAULT 1,
  goldset text NOT NULL DEFAULT 'default',
  tp integer NOT NULL DEFAULT 0,
  tn integer NOT NULL DEFAULT 0,
  fp integer NOT NULL DEFAULT 0,
  fn integer NOT NULL DEFAULT 0,
  precision numeric NOT NULL DEFAULT 0,
  recall numeric NOT NULL DEFAULT 0,
  f1 numeric NOT NULL DEFAULT 0,
  baseline_f1 numeric NOT NULL DEFAULT 0,
  passed boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.tafe_regression_runs TO authenticated;
GRANT ALL ON public.tafe_regression_runs TO service_role;
ALTER TABLE public.tafe_regression_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "regression readable by authenticated" ON public.tafe_regression_runs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins insert regression" ON public.tafe_regression_runs
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- INCIDENTS
CREATE TABLE public.tafe_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  agent_id text NOT NULL DEFAULT 'unknown',
  model text NOT NULL DEFAULT 'unknown',
  filter public.tafe_filter NOT NULL,
  severity public.tafe_severity NOT NULL DEFAULT 'MEDIUM',
  decision public.tafe_decision NOT NULL,
  reason text NOT NULL DEFAULT '',
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.tafe_incidents TO authenticated;
GRANT ALL ON public.tafe_incidents TO service_role;
ALTER TABLE public.tafe_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "incidents readable by authenticated" ON public.tafe_incidents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins insert incidents" ON public.tafe_incidents
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update incidents" ON public.tafe_incidents
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- AGENT BEHAVIOR PROFILES
CREATE TABLE public.tafe_agent_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL UNIQUE,
  model text NOT NULL DEFAULT 'unknown',
  baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  window_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  requests integer NOT NULL DEFAULT 0,
  blocks integer NOT NULL DEFAULT 0,
  retries integer NOT NULL DEFAULT 0,
  anomaly_score numeric NOT NULL DEFAULT 0,
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tafe_agent_profiles TO authenticated;
GRANT ALL ON public.tafe_agent_profiles TO service_role;
ALTER TABLE public.tafe_agent_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agent profiles readable by authenticated" ON public.tafe_agent_profiles
  FOR SELECT TO authenticated USING (true);

-- APPEND-ONLY AUDIT LOG
CREATE TABLE public.tafe_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  session_id text NOT NULL DEFAULT '',
  agent_id text NOT NULL DEFAULT 'unknown',
  model text NOT NULL DEFAULT 'unknown',
  filter public.tafe_filter,
  rule_id text,
  risk_score numeric NOT NULL DEFAULT 0,
  decision public.tafe_decision NOT NULL,
  reason text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool text,
  resource text,
  before_hash text,
  after_hash text,
  actor uuid
);

GRANT SELECT ON public.tafe_audit_log TO authenticated;
GRANT SELECT, INSERT ON public.tafe_audit_log TO service_role;
ALTER TABLE public.tafe_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit readable by authenticated" ON public.tafe_audit_log
  FOR SELECT TO authenticated USING (true);

CREATE INDEX tafe_audit_ts_idx ON public.tafe_audit_log (ts DESC);
CREATE INDEX tafe_audit_request_idx ON public.tafe_audit_log (request_id);

-- Hard append-only guarantee: no updates or deletes, for any role.
CREATE OR REPLACE FUNCTION public.tafe_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'tafe_audit_log is append-only';
END;
$$;

CREATE TRIGGER tafe_audit_no_update
  BEFORE UPDATE OR DELETE ON public.tafe_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.tafe_audit_append_only();

-- updated_at maintenance for rules
CREATE OR REPLACE FUNCTION public.tafe_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tafe_rules_touch
  BEFORE UPDATE ON public.tafe_rules
  FOR EACH ROW EXECUTE FUNCTION public.tafe_touch_updated_at();