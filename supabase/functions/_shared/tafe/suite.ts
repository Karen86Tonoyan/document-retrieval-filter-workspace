// packages/rule-engine — candidate evaluation suite: goldsets → metrics → adaptive rounds → gate.
import type { EvaluationRequest, Rule } from './types.ts';
import { evaluateRule } from './rule-engine.ts';
import { GOLDSETS, isMalicious, toRequest } from './goldsets.ts';
import { computeMetrics, type CaseOutcome, type FullMetrics } from './metrics.ts';
import { runAdaptiveSuite, type AdaptiveSuiteResult } from './adaptive.ts';
import { evaluatePromotionGate, type GateResult } from './promotion-gate.ts';

export const ENGINE_VERSION = '2.0.0';

export interface CandidateSuiteResult {
  metrics: FullMetrics;
  baseline: FullMetrics;
  outcomes: CaseOutcome[];
  adaptive: AdaptiveSuiteResult;
  gate: GateResult;
  regression_passed: boolean;
  rollbackId: string;
}

function detector(rule: Rule): (req: EvaluationRequest) => boolean {
  return (req) => evaluateRule(req, rule, 0) !== null;
}

export function runGoldsets(rule: Rule): CaseOutcome[] {
  const detect = detector(rule);
  return GOLDSETS.map((kase) => {
    const started = performance.now();
    const flagged = detect(toRequest(kase));
    const latency = performance.now() - started;
    const malicious = isMalicious(kase);
    return {
      case_id: kase.id,
      goldset: kase.goldset,
      filter: kase.filter,
      attack_family: kase.attack_family,
      malicious,
      flagged,
      // Utility survives when a benign case is not flagged.
      utility_ok: malicious ? true : !flagged,
      latency_ms: Number(latency.toFixed(3)),
    };
  });
}

/** Baseline = the same goldsets with no candidate rule applied. */
export function baselineMetrics(): FullMetrics {
  const outcomes = GOLDSETS.map((kase) => ({
    case_id: kase.id,
    goldset: kase.goldset,
    filter: kase.filter,
    attack_family: kase.attack_family,
    malicious: isMalicious(kase),
    flagged: false,
    utility_ok: true,
    latency_ms: 0,
  }));
  return computeMetrics(outcomes, { adaptiveAsr: 1, roundAsrs: [1, 1, 1, 1, 1, 1, 1] });
}

export async function runCandidateSuite(rule: Rule): Promise<CandidateSuiteResult> {
  const outcomes = runGoldsets(rule);
  const adaptive = await runAdaptiveSuite(detector(rule));
  const metrics = computeMetrics(outcomes, {
    adaptiveAsr: adaptive.adaptive_attack_success_rate,
    roundAsrs: adaptive.round_asrs,
  });
  const baseline = baselineMetrics();

  // Regression bar: never worse than baseline F1 and no false positive on benign traffic.
  const benignFp = outcomes.filter((o) => !o.malicious && o.flagged).length;
  const regression_passed = metrics.f1 >= baseline.f1 && benignFp === 0 && metrics.recall > 0;

  const rollbackId = `${rule.rule_key}@v${rule.version}:${rule.status}`;

  const gate = evaluatePromotionGate({
    candidate: metrics,
    baseline,
    regression_passed,
    adaptive_passed: adaptive.passed,
    rollback_id: rollbackId,
  });

  return { metrics, baseline, outcomes, adaptive, gate, regression_passed, rollbackId };
}
