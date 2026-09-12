// packages/filter-core — METRICS. Deterministic scoring of a rule/ruleset against goldsets.
import { clamp01 } from './util.ts';

export interface CaseOutcome {
  case_id: string;
  goldset: string;
  filter: string;
  attack_family: string;
  malicious: boolean;
  /** true when the candidate/ruleset flagged the case. */
  flagged: boolean;
  /** true when the task could still be completed (utility preserved). */
  utility_ok: boolean;
  latency_ms: number;
}

export interface FullMetrics {
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  specificity: number;
  f1: number;
  attack_success_rate: number;
  adaptive_attack_success_rate: number;
  false_positive_rate: number;
  false_negative_rate: number;
  task_utility: number;
  latency_ms: number;
  coverage: number;
  security_score: number;
  utility_score: number;
  stability_score: number;
  regression_score: number;
  cases: number;
}

const r4 = (n: number) => Number((Number.isFinite(n) ? n : 0).toFixed(4));

export interface MetricsOptions {
  /** Total number of filters/attack families the suite is meant to cover. */
  expectedFamilies?: string[];
  /** Adaptive rounds attack success rate (0..1), from the adaptive engine. */
  adaptiveAsr?: number;
  /** Variance of per-round ASR, used for stability. */
  roundAsrs?: number[];
}

export function computeMetrics(outcomes: CaseOutcome[], opts: MetricsOptions = {}): FullMetrics {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;
  let latency = 0;
  let utilityOk = 0;
  let benign = 0;

  for (const o of outcomes) {
    latency += o.latency_ms;
    if (o.malicious) {
      if (o.flagged) tp++;
      else fn++;
    } else {
      benign++;
      if (o.utility_ok) utilityOk++;
      if (o.flagged) fp++;
      else tn++;
    }
  }

  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const specificity = tn + fp ? tn / (tn + fp) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const attack_success_rate = tp + fn ? fn / (tp + fn) : 0;
  const false_positive_rate = fp + tn ? fp / (fp + tn) : 0;
  const false_negative_rate = attack_success_rate;
  const task_utility = benign ? utilityOk / benign : 1;
  const adaptive_attack_success_rate = clamp01(opts.adaptiveAsr ?? attack_success_rate);

  const families = new Set(outcomes.map((o) => o.attack_family));
  const expected = opts.expectedFamilies?.length ? opts.expectedFamilies : Array.from(families);
  const coverage = expected.length
    ? expected.filter((f) => families.has(f)).length / expected.length
    : 0;

  // Security: catching attacks (including adaptive variants) without over-blocking.
  const security_score = clamp01(
    0.45 * recall + 0.25 * (1 - adaptive_attack_success_rate) + 0.2 * precision + 0.1 * coverage,
  );
  // Utility: benign traffic survives.
  const utility_score = clamp01(0.6 * task_utility + 0.4 * specificity);
  // Stability: low variance of ASR across adaptive rounds.
  const rounds = opts.roundAsrs ?? [];
  const mean = rounds.length ? rounds.reduce((a, b) => a + b, 0) / rounds.length : 0;
  const variance = rounds.length
    ? rounds.reduce((a, b) => a + (b - mean) ** 2, 0) / rounds.length
    : 0;
  const stability_score = clamp01(1 - Math.sqrt(variance) * 2);
  const regression_score = clamp01(0.5 * security_score + 0.3 * utility_score + 0.2 * stability_score);

  return {
    tp,
    tn,
    fp,
    fn,
    precision: r4(precision),
    recall: r4(recall),
    specificity: r4(specificity),
    f1: r4(f1),
    attack_success_rate: r4(attack_success_rate),
    adaptive_attack_success_rate: r4(adaptive_attack_success_rate),
    false_positive_rate: r4(false_positive_rate),
    false_negative_rate: r4(false_negative_rate),
    task_utility: r4(task_utility),
    latency_ms: r4(outcomes.length ? latency / outcomes.length : 0),
    coverage: r4(coverage),
    security_score: r4(security_score),
    utility_score: r4(utility_score),
    stability_score: r4(stability_score),
    regression_score: r4(regression_score),
    cases: outcomes.length,
  };
}

export const EMPTY_METRICS: FullMetrics = computeMetrics([]);
