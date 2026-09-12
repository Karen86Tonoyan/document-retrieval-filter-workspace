// F6 — DRIFT / BEHAVIOR: per-agent behavioural baseline and anomaly detection.
import type { AgentProfile, EvaluationRequest, Finding, FilterResult } from './types.ts';
import { clamp01, combineRisk, fingerprint } from './util.ts';
import { normalizeTool } from './f3-permissions.ts';

export interface DriftInput {
  profile: AgentProfile | null;
  /** Decisions of the agent's recent requests, newest first. */
  recentDecisions: string[];
  /** Tool names used recently by this agent. */
  recentTools: string[];
  /** Identical request fingerprints seen in the current window. */
  repeatCount: number;
}

export async function runF6(req: EvaluationRequest, input: DriftInput): Promise<FilterResult> {
  const findings: Finding[] = [];
  const push = async (code: string, severity: Finding['severity'], message: string, weight: number) => {
    findings.push({ code, filter: 'F6', severity, message, weight, fingerprint: await fingerprint(`${code}:${req.agent}`) });
  };

  const recent = input.recentDecisions.slice(0, 20);
  const blockRate = recent.length ? recent.filter((d) => d === 'BLOCK').length / recent.length : 0;
  const baselineBlockRate = clamp01(Number(input.profile?.baseline?.block_rate ?? 0.05));

  if (recent.length >= 5 && blockRate > baselineBlockRate + 0.25) {
    await push(
      'F6_BLOCK_RATE_SPIKE',
      'HIGH',
      `Wzrost blokad: ${(blockRate * 100).toFixed(0)}% vs baseline ${(baselineBlockRate * 100).toFixed(0)}%.`,
      0.7,
    );
  }
  if (input.repeatCount >= 3) {
    await push('F6_LOOP_DETECTED', 'MEDIUM', `Zapętlenie: ${input.repeatCount} identycznych żądań w oknie.`, 0.55);
  }
  if (input.repeatCount >= 6) {
    await push('F6_EXCESSIVE_RETRY', 'HIGH', 'Nadmierna liczba ponowień tego samego żądania.', 0.75);
  }

  const tool = normalizeTool(req.tool);
  if (tool && input.recentTools.length >= 5 && !input.recentTools.includes(tool.name)) {
    await push('F6_UNUSUAL_TOOL', 'MEDIUM', `Narzędzie "${tool.name}" spoza dotychczasowego profilu agenta.`, 0.45);
  }
  if (recent.slice(0, 5).filter((d) => d === 'BLOCK' || d === 'HOLD').length >= 2 && input.repeatCount >= 2) {
    await push('F6_DECISION_CIRCUMVENTION', 'CRITICAL', 'Próba obejścia wcześniejszej decyzji filtra.', 0.9);
  }

  const baselineRisk = Number(input.profile?.baseline?.avg_risk ?? 0.1);
  const windowRisk = Number(input.profile?.window_stats?.avg_risk ?? baselineRisk);
  if (windowRisk > baselineRisk + 0.3) {
    await push('F6_BEHAVIOR_SHIFT', 'HIGH', 'Zmiana wzorca zachowania względem baseline.', 0.65);
  }

  const risk = combineRisk(findings.map((f) => f.weight));
  const decision = risk >= 0.8 ? 'BLOCK' : risk >= 0.55 ? 'HUMAN_REVIEW' : risk >= 0.3 ? 'HOLD' : risk > 0 ? 'WARN' : 'ALLOW';

  return {
    filter: 'F6',
    risk,
    decision,
    findings,
    meta: { block_rate: blockRate, baseline_block_rate: baselineBlockRate, repeat_count: input.repeatCount },
  };
}
