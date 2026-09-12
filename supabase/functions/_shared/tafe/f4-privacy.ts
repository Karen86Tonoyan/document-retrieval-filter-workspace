// F4 — DATA / PRIVACY: secret scanner + PII detection, runs BEFORE anything is logged.
import type { EvaluationRequest, Finding, FilterResult } from './types.ts';
import { combineRisk, fingerprint } from './util.ts';

export type DataAction = 'PASS' | 'MASK' | 'REDACT' | 'ENCRYPT' | 'HOLD' | 'BLOCK';

interface Detector {
  code: string;
  label: string;
  severity: Finding['severity'];
  weight: number;
  action: DataAction;
  pattern: RegExp;
}

export const DETECTORS: Detector[] = [
  { code: 'F4_JWT', label: 'JWT', severity: 'CRITICAL', weight: 0.95, action: 'REDACT', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { code: 'F4_API_KEY', label: 'API key', severity: 'CRITICAL', weight: 0.95, action: 'REDACT', pattern: /\b(sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,})\b/g },
  { code: 'F4_PASSWORD', label: 'Hasło', severity: 'HIGH', weight: 0.8, action: 'REDACT', pattern: /\b(has[łl]o|password|passwd|pwd)\s*[:=]\s*\S{4,}/gi },
  { code: 'F4_PRIVATE_KEY', label: 'Klucz prywatny', severity: 'CRITICAL', weight: 1, action: 'BLOCK', pattern: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { code: 'F4_COOKIE', label: 'Cookie sesyjne', severity: 'HIGH', weight: 0.7, action: 'REDACT', pattern: /\b(set-cookie|session(id)?|sid)\s*[:=]\s*[A-Za-z0-9%_-]{10,}/gi },
  { code: 'F4_EMAIL', label: 'E-mail', severity: 'MEDIUM', weight: 0.4, action: 'MASK', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { code: 'F4_PHONE_PL', label: 'Telefon', severity: 'MEDIUM', weight: 0.4, action: 'MASK', pattern: /\b(?:\+48\s?)?(?:\d{3}[\s-]?){2}\d{3}\b/g },
  { code: 'F4_PESEL', label: 'PESEL', severity: 'HIGH', weight: 0.8, action: 'REDACT', pattern: /\b\d{11}\b/g },
  { code: 'F4_NIP', label: 'NIP', severity: 'MEDIUM', weight: 0.5, action: 'MASK', pattern: /\b\d{3}-?\d{3}-?\d{2}-?\d{2}\b/g },
  { code: 'F4_IBAN', label: 'IBAN', severity: 'HIGH', weight: 0.8, action: 'REDACT', pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  { code: 'F4_CARD', label: 'Karta płatnicza', severity: 'CRITICAL', weight: 0.9, action: 'REDACT', pattern: /\b(?:\d{4}[ -]?){3}\d{4}\b/g },
  { code: 'F4_IP', label: 'Adres IP', severity: 'LOW', weight: 0.25, action: 'MASK', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { code: 'F4_DEVICE_ID', label: 'Identyfikator urządzenia', severity: 'MEDIUM', weight: 0.4, action: 'MASK', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { code: 'F4_INFRA_SECRET', label: 'Sekret infrastruktury', severity: 'CRITICAL', weight: 0.9, action: 'REDACT', pattern: /\b(SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|DB_PASSWORD|SECRET_KEY|PRIVATE_TOKEN)\s*[:=]\s*\S+/gi },
];

const ACTION_ORDER: DataAction[] = ['PASS', 'MASK', 'REDACT', 'ENCRYPT', 'HOLD', 'BLOCK'];

function strongest(a: DataAction, b: DataAction): DataAction {
  return ACTION_ORDER.indexOf(a) >= ACTION_ORDER.indexOf(b) ? a : b;
}

function maskValue(value: string): string {
  if (value.length <= 4) return '*'.repeat(value.length);
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(3, value.length - 4))}${value.slice(-2)}`;
}

/** Sanitises text so it is safe to store in logs and audit evidence. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const d of DETECTORS) {
    out = out.replace(new RegExp(d.pattern.source, d.pattern.flags), (m) =>
      d.action === 'MASK' ? maskValue(m) : `[${d.label.toUpperCase()}_REDACTED]`,
    );
  }
  return out;
}

export async function runF4(req: EvaluationRequest): Promise<FilterResult> {
  const content = req.content ?? '';
  const findings: Finding[] = [];
  let action: DataAction = 'PASS';
  let redacted = content;

  for (const d of DETECTORS) {
    const re = new RegExp(d.pattern.source, d.pattern.flags);
    const matches = content.match(re);
    if (!matches?.length) continue;
    action = strongest(action, d.action);
    redacted = redacted.replace(new RegExp(d.pattern.source, d.pattern.flags), (m) =>
      d.action === 'MASK' ? maskValue(m) : `[${d.label.toUpperCase()}_REDACTED]`,
    );
    findings.push({
      code: d.code,
      filter: 'F4',
      severity: d.severity,
      message: `${d.label}: ${matches.length} wystąpień → ${d.action}.`,
      weight: d.weight,
      // Evidence never carries the raw secret.
      evidence: maskValue(matches[0]),
      fingerprint: await fingerprint(`${d.code}:${matches.length}`),
    });
  }

  const risk = combineRisk(findings.map((f) => f.weight));
  let decision: FilterResult['decision'] = 'ALLOW';
  if (action === 'BLOCK') decision = 'BLOCK';
  else if (action === 'HOLD') decision = 'HOLD';
  else if (action === 'REDACT' || action === 'ENCRYPT') decision = req.kind === 'output' ? 'WARN' : 'HOLD';
  else if (action === 'MASK') decision = 'WARN';

  return { filter: 'F4', risk, decision, findings, meta: { action, redacted } };
}
