// F1 — INPUT INTEGRITY: quality and trustworthiness of the incoming payload.
import type { EvaluationRequest, Finding, FilterResult } from './types.ts';
import { combineRisk, fingerprint, shannonEntropy } from './util.ts';

const MAX_PAYLOAD = 20000;
const CONTRADICTION_PAIRS: [RegExp, RegExp][] = [
  [/\bdo not\b|\bnie wolno\b|\bnever\b/i, /\byou must\b|\bmusisz\b|\balways\b/i],
  [/\bkeep secret\b|\bnie ujawniaj\b/i, /\breveal\b|\bujawnij\b|\bprint\b/i],
];

const HIDDEN_INSTRUCTION = /<!--[\s\S]{0,400}?(ignore|system|instruction|prompt)[\s\S]{0,400}?-->/i;
const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\uFEFF]/;
const BASE64_BLOB = /\b[A-Za-z0-9+/]{120,}={0,2}\b/;
const HEX_BLOB = /\b(?:[0-9a-fA-F]{2}\s?){60,}\b/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

export async function runF1(req: EvaluationRequest): Promise<FilterResult> {
  const findings: Finding[] = [];
  const content = req.content ?? '';
  const add = async (
    code: string,
    severity: Finding['severity'],
    message: string,
    weight: number,
    evidence?: string,
  ) => {
    findings.push({
      code,
      filter: 'F1',
      severity,
      message,
      weight,
      evidence,
      fingerprint: await fingerprint(`${code}:${evidence ?? message}`),
    });
  };

  if (!content.trim()) {
    await add('F1_EMPTY_PAYLOAD', 'LOW', 'Puste wejście / empty payload.', 0.15);
  }
  if (content.length > MAX_PAYLOAD) {
    await add(
      'F1_OVERSIZED_PAYLOAD',
      'MEDIUM',
      `Payload ${content.length} znaków przekracza limit ${MAX_PAYLOAD}.`,
      0.45,
    );
  }
  if (CONTROL_CHARS.test(content)) {
    await add('F1_CORRUPTED_DATA', 'MEDIUM', 'Znaki kontrolne — dane prawdopodobnie uszkodzone.', 0.4);
  }
  if (ZERO_WIDTH.test(content)) {
    await add('F1_HIDDEN_CHARS', 'HIGH', 'Ukryte znaki zero-width / bidi w treści.', 0.7);
  }
  if (HIDDEN_INSTRUCTION.test(content)) {
    await add('F1_HIDDEN_INSTRUCTION', 'HIGH', 'Ukryta instrukcja w komentarzu HTML.', 0.75);
  }
  if (BASE64_BLOB.test(content) || HEX_BLOB.test(content)) {
    await add('F1_SUSPICIOUS_ENCODING', 'MEDIUM', 'Długi blok zakodowanych danych (base64/hex).', 0.5);
  }
  for (const [a, b] of CONTRADICTION_PAIRS) {
    if (a.test(content) && b.test(content)) {
      await add('F1_CONTRADICTORY_INSTRUCTIONS', 'MEDIUM', 'Sprzeczne instrukcje w jednym wejściu.', 0.45);
      break;
    }
  }
  const entropy = shannonEntropy(content.slice(0, 4000));
  if (content.length > 200 && entropy > 5.5) {
    await add('F1_STRUCTURAL_ANOMALY', 'LOW', `Nietypowo wysoka entropia treści (${entropy.toFixed(2)}).`, 0.3);
  }
  const declaredSource = String(req.context?.source ?? '');
  const declaredOrigin = String(req.context?.origin ?? '');
  if (declaredSource && declaredOrigin && !declaredOrigin.includes(declaredSource)) {
    await add(
      'F1_SOURCE_SPOOFING',
      'HIGH',
      `Deklarowane źródło "${declaredSource}" nie zgadza się z origin "${declaredOrigin}".`,
      0.7,
    );
  }
  const markupRatio = (content.match(/[<>{}[\]]/g)?.length ?? 0) / Math.max(1, content.length);
  if (content.length > 300 && markupRatio > 0.15) {
    await add('F1_UNUSUAL_FORMATTING', 'LOW', 'Nietypowe formatowanie: dominacja znaczników.', 0.25);
  }

  const risk = combineRisk(findings.map((f) => f.weight));
  const decision = risk >= 0.75 ? 'BLOCK' : risk >= 0.5 ? 'HOLD' : risk >= 0.25 ? 'WARN' : 'ALLOW';
  return { filter: 'F1', risk, decision, findings, meta: { length: content.length, entropy } };
}
