// F5 — EVIDENCE / TRUTH (packages/evidence-engine)
// Separates FACT / INFERENCE / ASSUMPTION / MODEL_GUESS and scores evidence support.
import type { EvaluationRequest, EvidenceItem, Finding, FilterResult } from './types.ts';
import { clamp01, combineRisk, fingerprint } from './util.ts';

const CERTAINTY = /\b(na pewno|zdecydowanie|bez w[ąa]tpienia|definitely|certainly|guaranteed|100%|always works)\b/i;
const HEDGE = /\b(chyba|prawdopodobnie|wydaje mi si[ęe]|probably|might|may|i think|possibly)\b/i;
const SOURCE = /\b(https?:\/\/\S+|wed[łl]ug \S+|according to|source:|źród[łl]o:|doc(ument)?:|rfc\s?\d+)\b/i;
const FABRICATION = /\b(as (documented|specified) in|zgodnie z dokumentacj[ąa])\b/i;
const NUMERIC_CLAIM = /\b\d+([.,]\d+)?\s?(%|percent|ms|s|x|razy)\b/i;
const HIGH_STAKES = /\b(medical|legal|financial|security|prawn|medyczn|finansow|bezpiecze[ńn]stw|diagnoz|inwestycj)\w*/i;

export function classifyClaims(text: string): EvidenceItem[] {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
    .slice(0, 40);

  return sentences.map((claim) => {
    if (SOURCE.test(claim)) return { claim, kind: 'FACT' as const, source: claim.match(SOURCE)?.[0] };
    if (HEDGE.test(claim)) return { claim, kind: 'ASSUMPTION' as const };
    if (/\b(therefore|so |zatem|wi[ęe]c|wynika z tego)\b/i.test(claim)) return { claim, kind: 'INFERENCE' as const };
    return { claim, kind: 'MODEL_GUESS' as const };
  });
}

export async function runF5(req: EvaluationRequest): Promise<FilterResult> {
  const content = req.content ?? '';
  const findings: Finding[] = [];
  const provided = req.evidence ?? [];
  const items = provided.length ? provided : classifyClaims(content);

  const facts = items.filter((i) => i.kind === 'FACT').length;
  const guesses = items.filter((i) => i.kind === 'MODEL_GUESS').length;
  const total = Math.max(1, items.length);
  const evidenceScore = clamp01(facts / total);
  const declared = typeof req.confidence === 'number' ? clamp01(req.confidence) : CERTAINTY.test(content) ? 0.95 : 0.6;
  const confidenceScore = clamp01(declared * (0.4 + 0.6 * evidenceScore));

  const push = async (code: string, severity: Finding['severity'], message: string, weight: number) => {
    findings.push({ code, filter: 'F5', severity, message, weight, fingerprint: await fingerprint(`${code}:${message}`) });
  };

  if (CERTAINTY.test(content) && evidenceScore < 0.2) {
    await push('F5_OVERCONFIDENT', 'HIGH', 'Bardzo wysoka pewność bez żadnego źródła.', 0.75);
  }
  if (!SOURCE.test(content) && NUMERIC_CLAIM.test(content)) {
    await push('F5_UNSOURCED_NUMBER', 'MEDIUM', 'Twarde dane liczbowe bez źródła.', 0.5);
  }
  if (FABRICATION.test(content) && !SOURCE.test(content)) {
    await push('F5_HALLUCINATION_RISK', 'HIGH', 'Powołanie się na dokumentację, której nie wskazano.', 0.7);
  }
  if (HIGH_STAKES.test(content) && evidenceScore < 0.35) {
    await push('F5_HIGH_STAKES_NO_EVIDENCE', 'HIGH', 'Decyzja wysokiego ryzyka bez wystarczających dowodów.', 0.75);
  }
  if (guesses / total > 0.7 && items.length >= 3) {
    await push('F5_MOSTLY_GUESS', 'MEDIUM', `${guesses}/${items.length} twierdzeń to niepotwierdzone domysły modelu.`, 0.5);
  }

  const agentResults = Array.isArray(req.context?.agent_results) ? (req.context!.agent_results as string[]) : [];
  if (agentResults.length >= 2) {
    const unique = new Set(agentResults.map((r) => r.trim().toLowerCase()));
    if (unique.size > 1) {
      await push('F5_AGENT_CONFLICT', 'HIGH', `Sprzeczne wyniki agentów (${unique.size} różnych odpowiedzi).`, 0.7);
    }
  }

  const risk = combineRisk(findings.map((f) => f.weight));
  const decision =
    risk >= 0.75 ? 'HOLD' : risk >= 0.5 ? 'HUMAN_REVIEW' : risk > 0 ? 'WARN' : 'ALLOW';

  return {
    filter: 'F5',
    risk,
    decision,
    findings,
    meta: { confidence_score: confidenceScore, evidence_score: evidenceScore, items },
  };
}
