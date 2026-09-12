// F2 — INJECTION / MANIPULATION: direct and indirect prompt injection, jailbreaks, policy attacks.
import type { EvaluationRequest, Finding, FilterResult } from './types.ts';
import { combineRisk, fingerprint } from './util.ts';

interface Signature {
  code: string;
  severity: Finding['severity'];
  weight: number;
  message: string;
  pattern: RegExp;
}

const SIGNATURES: Signature[] = [
  {
    code: 'F2_INSTRUCTION_OVERRIDE',
    severity: 'HIGH',
    weight: 0.8,
    message: 'Próba nadpisania instrukcji systemowych.',
    pattern:
      /\b(ignore|disregard|forget|zignoruj|pomiń|zapomnij)\b[\s\S]{0,40}\b(previous|prior|above|all|system|wszystkie|poprzednie|powyższe)\b[\s\S]{0,40}\b(instructions?|rules?|prompt|polecenia|zasady|regu[łl]y)\b/i,
  },
  {
    code: 'F2_JAILBREAK',
    severity: 'HIGH',
    weight: 0.85,
    message: 'Znany wzorzec jailbreak (DAN / tryb bez ograniczeń).',
    pattern:
      /\b(dan mode|do anything now|developer mode|jailbreak|unfiltered|bez ogranicze[ńn]|tryb deweloperski|no restrictions|unrestricted mode)\b/i,
  },
  {
    code: 'F2_ROLE_MANIPULATION',
    severity: 'HIGH',
    weight: 0.7,
    message: 'Próba zmiany roli lub tożsamości modelu.',
    pattern:
      /\b(you are now|from now on you|act as|pretend to be|udawaj|od teraz jeste[śs]|wciel się w|zachowuj się jak)\b[\s\S]{0,60}\b(admin|root|system|developer|no rules|bez zasad|nieograniczony)\b/i,
  },
  {
    code: 'F2_SYSTEM_PROMPT_EXFIL',
    severity: 'CRITICAL',
    weight: 0.9,
    message: 'Próba wydobycia lub zmiany system prompt / polityki.',
    pattern:
      /\b(system prompt|twoje instrukcje|your instructions|initial prompt|policy|polityk[ęa])\b[\s\S]{0,40}\b(reveal|print|show|repeat|change|disable|poka[żz]|wypisz|wy[łl][ąa]cz|zmie[ńn])\b/i,
  },
  {
    code: 'F2_INDIRECT_INJECTION',
    severity: 'CRITICAL',
    weight: 0.85,
    message: 'Instrukcje osadzone w pobranej treści (strona/plik/dokument).',
    pattern:
      /\b(when you read this|if you are an ai|assistant:\s|ai agent[,:]|instructions for the (ai|assistant|model))\b/i,
  },
  {
    code: 'F2_CONTEXT_POISONING',
    severity: 'HIGH',
    weight: 0.7,
    message: 'Fałszowanie historii rozmowy lub wcześniejszych ustaleń.',
    pattern:
      /\b(earlier you (said|agreed|approved)|as we agreed|ju[żz] się zgodzi[łl]e[śs]|wcze[śs]niej powiedzia[łl]e[śs]|previously you allowed)\b/i,
  },
  {
    code: 'F2_POLICY_BYPASS',
    severity: 'CRITICAL',
    weight: 0.9,
    message: 'Żądanie wyłączenia lub obejścia filtrów bezpieczeństwa.',
    pattern:
      /\b(disable|bypass|turn off|skip|wy[łl][ąa]cz|obejd[źz]|pomi[ńn])\b[\s\S]{0,40}\b(filter|guardrail|safety|security|moderation|filtr|zabezpieczeni|kontrol)\w*/i,
  },
  {
    code: 'F2_MALICIOUS_PAYLOAD',
    severity: 'HIGH',
    weight: 0.75,
    message: 'Złośliwe instrukcje wykonawcze w treści.',
    pattern:
      /\b(curl\s+[^|]*\|\s*(sh|bash)|rm\s+-rf\s+\/|drop\s+table|;\s*shutdown|powershell\s+-enc|eval\(atob)/i,
  },
  {
    code: 'F2_ENCODED_INSTRUCTION',
    severity: 'MEDIUM',
    weight: 0.55,
    message: 'Instrukcja ukryta w kodowaniu (rot13/base64/leet).',
    pattern: /\b(rot13|base64 decode|zdekoduj|decode this and (do|follow|execute))\b/i,
  },
];

export async function runF2(req: EvaluationRequest): Promise<FilterResult> {
  const content = req.content ?? '';
  const findings: Finding[] = [];

  for (const sig of SIGNATURES) {
    const match = content.match(sig.pattern);
    if (!match) continue;
    findings.push({
      code: sig.code,
      filter: 'F2',
      severity: sig.severity,
      message: sig.message,
      weight: sig.weight,
      evidence: match[0].slice(0, 200),
      fingerprint: await fingerprint(`${sig.code}:${match[0]}`),
    });
  }

  // Multi-signal amplifier: several independent injection families at once.
  if (findings.length >= 3) {
    findings.push({
      code: 'F2_MULTI_VECTOR',
      filter: 'F2',
      severity: 'CRITICAL',
      message: `Wykryto ${findings.length} niezależnych wektorów manipulacji w jednym wejściu.`,
      weight: 0.9,
      fingerprint: await fingerprint(`F2_MULTI_VECTOR:${findings.map((f) => f.code).join(',')}`),
    });
  }

  const risk = combineRisk(findings.map((f) => f.weight));
  const decision = risk >= 0.7 ? 'BLOCK' : risk >= 0.45 ? 'HOLD' : risk > 0 ? 'WARN' : 'ALLOW';
  return { filter: 'F2', risk, decision, findings };
}
