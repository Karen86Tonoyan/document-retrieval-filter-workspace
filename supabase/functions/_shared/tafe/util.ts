// Deterministic helpers shared by every filter (packages/filter-core).

const encoder = new TextEncoder();

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Normalized form used for pattern identity: casing, whitespace, punctuation and digits collapsed. */
export function canonicalize(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' <url> ')
    .replace(/\d+/g, '0')
    .replace(/[^\p{L}\p{N}\s<>]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

export async function fingerprint(input: string): Promise<string> {
  return (await sha256(canonicalize(input))).slice(0, 32);
}

export async function contextHash(context: Record<string, unknown> | undefined): Promise<string> {
  const keys = Object.keys(context ?? {}).sort();
  const stable = keys.map((k) => `${k}=${String((context ?? {})[k])}`).join('&');
  return (await sha256(stable)).slice(0, 16);
}

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Combine independent risk signals without ever exceeding 1 (noisy-OR). */
export function combineRisk(weights: number[]): number {
  let inverse = 1;
  for (const w of weights) inverse *= 1 - clamp01(w);
  return clamp01(1 - inverse);
}

export function severityWeight(severity: string): number {
  switch (severity) {
    case 'CRITICAL':
      return 1;
    case 'HIGH':
      return 0.8;
    case 'MEDIUM':
      return 0.5;
    case 'LOW':
      return 0.25;
    default:
      return 0.1;
  }
}

export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const c of counts.values()) {
    const p = c / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function safeRegex(source: string, flags = 'i'): RegExp | null {
  if (source.length > 500) return null;
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}
