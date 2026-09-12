-- PROVIDER: może proponować reguły wyłącznie jako CANDIDATE i wyłączone
CREATE POLICY "providers propose candidate rules"
ON public.tafe_rules FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'provider')
  AND status = 'CANDIDATE'
  AND enabled = false
);

-- PROVIDER: dostarcza materiały testowe
CREATE POLICY "providers insert goldset"
ON public.tafe_goldset_cases FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'provider'));

CREATE POLICY "providers insert benchmarks"
ON public.tafe_benchmarks FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'provider') AND status = 'REFERENCED');

-- PROVIDER: może zapisywać wyniki testów regresji
CREATE POLICY "providers insert regression"
ON public.tafe_regression_runs FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'provider'));

-- PROVIDER: zgłasza wzorce jako kandydatów
CREATE POLICY "providers insert patterns"
ON public.tafe_patterns FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'provider') AND status IN ('DETECTED','CANDIDATE'));