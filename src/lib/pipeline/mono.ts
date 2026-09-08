/**
 * MONO Gateway — controlled security sanitization layer
 * Sits between CERBER/GUARDIAN and the LLM.
 * Detects and normalizes sensitive data so the model never receives
 * raw PII, credentials, or confirmed attack payloads.
 */
import type {
  LasuchResult,
  CerberResult,
  GuardianResult,
  MonoGatewayResult,
  MonoDecodeResult,
  MonoTransformation,
  LasuchFlag,
} from '@/types/tonoyan-filters';

// ─── DLP rule set ────────────────────────────────────────────────────────────

interface DlpRule {
  name: string;
  pattern: RegExp;
  placeholder: string;
}

const DLP_RULES: DlpRule[] = [
  {
    name: 'email',
    pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
    placeholder: '[EMAIL_REDACTED]',
  },
  {
    name: 'pl_phone',
    pattern: /\b(\+48|0048)?[\s\-]?\d{3}[\s\-]?\d{3}[\s\-]?\d{3}\b/g,
    placeholder: '[PHONE_REDACTED]',
  },
  {
    name: 'pesel',
    pattern: /\b\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{5}\b/g,
    placeholder: '[PESEL_REDACTED]',
  },
  {
    name: 'credit_card',
    pattern: /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g,
    placeholder: '[CARD_REDACTED]',
  },
  {
    name: 'api_key',
    pattern: /\b(?:sk-|pk_|api_|key-)[a-zA-Z0-9_\-]{16,64}\b/gi,
    placeholder: '[API_KEY_REDACTED]',
  },
  {
    name: 'jwt',
    pattern: /eyJ[a-zA-Z0-9_\-]+\.eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+/g,
    placeholder: '[JWT_REDACTED]',
  },
  {
    name: 'nip',
    pattern: /\b\d{3}-\d{3}-\d{2}-\d{2}\b/g,
    placeholder: '[NIP_REDACTED]',
  },
  {
    name: 'password_in_text',
    pattern: /\b(?:password|hasło|passwd|pwd)\s*[=:]\s*\S+/gi,
    placeholder: '[PASSWORD_REDACTED]',
  },
];

// Flags whose confirmed presence warrants blocking the raw payload from the model
const BLOCK_ON_FLAGS: LasuchFlag[] = [
  'prompt_injection',
  'jailbreak',
  'context_poisoning',
  'hidden_commands',
  'multi_layer_bypass',
  'dlp_violation',
  'safety_bypass_open_model',
];

// ─── gateway ─────────────────────────────────────────────────────────────────

export function runMonoGateway(
  input: string,
  lasuch: LasuchResult,
  cerber: CerberResult,
  _guardian: GuardianResult,
): MonoGatewayResult {
  const start = performance.now();
  const policy_applied: string[] = [];
  const transformations: MonoTransformation[] = [];
  let mono_payload = input;

  // 1. Critical attack: CERBER confirmed severity — replace entire payload
  if (cerber.impact_simulation.severity === 'critical') {
    mono_payload = '[CRITICAL_ATTACK_PAYLOAD_BLOCKED — not forwarded to model]';
    policy_applied.push('mono:critical_block');
    return {
      raw_payload: input,
      mono_payload,
      transformations: [],
      sensitive_data_found: false,
      attack_payload_blocked: true,
      is_sanitized: true,
      raw_size_bytes: byteLen(input),
      mono_size_bytes: byteLen(mono_payload),
      policy_applied,
      processing_time_ms: elapsed(start),
    };
  }

  // 2. LASUCH-confirmed attack flags (only when CERBER status is FAILED)
  let attack_payload_blocked = false;
  if (cerber.survival_status === 'FAILED') {
    const attackFlags = lasuch.flags.filter(f => BLOCK_ON_FLAGS.includes(f));
    if (attackFlags.length > 0) {
      attack_payload_blocked = true;
      attackFlags.forEach(f => policy_applied.push(`mono:attack:${f}`));
    }
  }

  // 3. DLP scan — always runs, even if no attack detected
  for (const rule of DLP_RULES) {
    const rx = new RegExp(rule.pattern.source, rule.pattern.flags);
    const matches = [...mono_payload.matchAll(rx)];
    if (matches.length > 0) {
      const first = matches[0][0];
      transformations.push({
        pattern_name: rule.name,
        original_preview: first.slice(0, 4) + (first.length > 4 ? '…' : ''),
        placeholder: rule.placeholder,
        count: matches.length,
      });
      mono_payload = mono_payload.replace(
        new RegExp(rule.pattern.source, rule.pattern.flags),
        rule.placeholder,
      );
      policy_applied.push(`dlp:${rule.name}`);
    }
  }

  const sensitive_data_found = transformations.length > 0 || lasuch.flags.includes('dlp_violation');
  const is_sanitized = transformations.length > 0 || attack_payload_blocked;

  return {
    raw_payload: input,
    mono_payload,
    transformations,
    sensitive_data_found,
    attack_payload_blocked,
    is_sanitized,
    raw_size_bytes: byteLen(input),
    mono_size_bytes: byteLen(mono_payload),
    policy_applied,
    processing_time_ms: elapsed(start),
  };
}

// ─── decode (post-model) ──────────────────────────────────────────────────────

export function runMonoDecode(model_response: string | undefined): MonoDecodeResult {
  const start = performance.now();

  if (!model_response) {
    return { response_clean: '', leaked_data_detected: false, leak_patterns: [], processing_time_ms: elapsed(start) };
  }

  const leak_patterns: string[] = [];
  for (const rule of DLP_RULES) {
    const rx = new RegExp(rule.pattern.source, rule.pattern.flags);
    if (rx.test(model_response)) {
      leak_patterns.push(rule.name);
    }
  }

  return {
    response_clean: model_response,
    leaked_data_detected: leak_patterns.length > 0,
    leak_patterns,
    processing_time_ms: elapsed(start),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}
