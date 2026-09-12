// packages/filter-core — BENCHMARK REGISTRY + BENCHMARK MATRIX.
// REFERENCED means the benchmark is catalogued as a research reference only.
// It does NOT mean the official dataset, runner or scorer has been executed here.
import type { FilterId } from './types.ts';

export type BenchmarkStatus = 'REFERENCED' | 'INTEGRATED' | 'VERIFIED' | 'BROKEN' | 'DEPRECATED';

export interface BenchmarkEntry {
  id: string;
  name: string;
  version: string;
  source: string;
  filter: FilterId;
  attack_family: string;
  runner: string;
  scorer: string;
  status: BenchmarkStatus;
  dataset_hash: string;
  last_verified_at: string | null;
  notes: string;
}

export const BENCHMARK_REGISTRY_VERSION = '2026.09.1';

export const BENCHMARKS: BenchmarkEntry[] = [
  {
    id: 'longpibench',
    name: 'LongPIBench',
    version: '2026.08',
    source: 'https://arxiv.org/abs/2608.28411',
    filter: 'F2',
    attack_family: 'indirect_prompt_injection_long_context',
    runner: 'none',
    scorer: 'none',
    status: 'REFERENCED',
    dataset_hash: '',
    last_verified_at: null,
    notes: 'Injection position/volume sensitivity in long contexts. Official runner not wired.',
  },
  {
    id: 'agentdojo',
    name: 'AgentDojo',
    version: '1.x',
    source: 'https://github.com/ethz-spylab/agentdojo',
    filter: 'F2',
    attack_family: 'indirect_prompt_injection_agentic',
    runner: 'none',
    scorer: 'none',
    status: 'REFERENCED',
    dataset_hash: '',
    last_verified_at: null,
    notes: 'Utility vs. security under injection. Requires external environment harness.',
  },
  {
    id: 'injecagent',
    name: 'InjecAgent',
    version: '1.0',
    source: 'https://arxiv.org/abs/2403.02691',
    filter: 'F2',
    attack_family: 'tool_output_injection',
    runner: 'none',
    scorer: 'none',
    status: 'REFERENCED',
    dataset_hash: '',
    last_verified_at: null,
    notes: 'Instructions embedded in tool outputs, exfiltration and harmful tool use.',
  },
  {
    id: 'jailbreakbench',
    name: 'JailbreakBench',
    version: '1.0',
    source: 'https://github.com/JailbreakBench/jailbreakbench',
    filter: 'F2',
    attack_family: 'jailbreak',
    runner: 'none',
    scorer: 'none',
    status: 'REFERENCED',
    dataset_hash: '',
    last_verified_at: null,
    notes: 'Jailbreak robustness with refusal/over-refusal control. Judge model not wired.',
  },
  {
    id: 'mcptox',
    name: 'MCPTox',
    version: '2025.08',
    source: 'https://arxiv.org/abs/2508.14925',
    filter: 'F3',
    attack_family: 'tool_metadata_poisoning',
    runner: 'none',
    scorer: 'none',
    status: 'REFERENCED',
    dataset_hash: '',
    last_verified_at: null,
    notes: 'Poisoned MCP tool descriptions against real servers.',
  },
  {
    id: 'mcp_itp',
    name: 'MCP-ITP',
    version: '2026.01',
    source: 'https://arxiv.org/abs/2601.07395',
    filter: 'F3',
    attack_family: 'implicit_tool_poisoning',
    runner: 'none',
    scorer: 'none',
    status: 'REFERENCED',
    dataset_hash: '',
    last_verified_at: null,
    notes: 'Implicit (non-imperative) tool metadata poisoning.',
  },
  {
    id: 'facts',
    name: 'FACTS Benchmark Suite',
    version: '2025.12',
    source: 'https://deepmind.google/blog/facts-benchmark-suite-systematically-evaluating-the-factuality-of-large-language-models/',
    filter: 'F5',
    attack_family: 'hallucination',
    runner: 'none',
    scorer: 'none',
    status: 'REFERENCED',
    dataset_hash: '',
    last_verified_at: null,
    notes: 'Grounding, retrieval, parametric and multimodal factuality.',
  },
  // Internal, actually executable suites derived from the local goldset engine.
  {
    id: 'internal_input_integrity',
    name: 'Internal Input Integrity Goldset',
    version: BENCHMARK_REGISTRY_VERSION,
    source: 'internal://goldsets/benign+malicious',
    filter: 'F1',
    attack_family: 'malformed_encoding_spoofing',
    runner: 'tafe.regression',
    scorer: 'tafe.metrics',
    status: 'INTEGRATED',
    dataset_hash: '',
    last_verified_at: null,
    notes: 'Malformed payloads, hidden characters, encoding tricks, source spoofing.',
  },
  {
    id: 'internal_privacy',
    name: 'Internal Privacy / Secret Leakage Goldset',
    version: BENCHMARK_REGISTRY_VERSION,
    source: 'internal://goldsets/privacy',
    filter: 'F4',
    attack_family: 'secret_leakage',
    runner: 'tafe.regression',
    scorer: 'tafe.metrics',
    status: 'INTEGRATED',
    dataset_hash: '',
    last_verified_at: null,
    notes: 'API keys, JWT, passwords, PII, infrastructure secrets before logging.',
  },
  {
    id: 'internal_evidence',
    name: 'Internal Evidence Goldset',
    version: BENCHMARK_REGISTRY_VERSION,
    source: 'internal://goldsets/factuality',
    filter: 'F5',
    attack_family: 'unsupported_claims',
    runner: 'tafe.regression',
    scorer: 'tafe.metrics',
    status: 'INTEGRATED',
    dataset_hash: '',
    last_verified_at: null,
    notes: 'FACT / INFERENCE / ASSUMPTION / MODEL_GUESS separation and confidence calibration.',
  },
  {
    id: 'internal_drift',
    name: 'Internal Drift / Retry Suite',
    version: BENCHMARK_REGISTRY_VERSION,
    source: 'internal://goldsets/drift',
    filter: 'F6',
    attack_family: 'behaviour_drift',
    runner: 'tafe.regression',
    scorer: 'tafe.metrics',
    status: 'INTEGRATED',
    dataset_hash: '',
    last_verified_at: null,
    notes: 'Loops, excessive retries, block-rate spikes, circumvention of earlier decisions.',
  },
  {
    id: 'internal_action_gate',
    name: 'Internal Unsafe Action E2E Suite',
    version: BENCHMARK_REGISTRY_VERSION,
    source: 'internal://goldsets/tool+adaptive',
    filter: 'F7',
    attack_family: 'unsafe_action',
    runner: 'tafe.regression',
    scorer: 'tafe.metrics',
    status: 'INTEGRATED',
    dataset_hash: '',
    last_verified_at: null,
    notes: 'End-to-end destructive/external actions through the Final Action Gate.',
  },
];

/** BENCHMARK MATRIX — which suites cover which filter. */
export const BENCHMARK_MATRIX: Record<FilterId, string[]> = {
  F1: ['internal_input_integrity'],
  F2: ['longpibench', 'agentdojo', 'injecagent', 'jailbreakbench'],
  F3: ['mcptox', 'mcp_itp'],
  F4: ['internal_privacy'],
  F5: ['facts', 'internal_evidence'],
  F6: ['internal_drift'],
  F7: ['internal_action_gate'],
};

export const ATTACK_FAMILIES = [
  'direct_prompt_injection',
  'indirect_prompt_injection_long_context',
  'indirect_prompt_injection_agentic',
  'tool_output_injection',
  'tool_metadata_poisoning',
  'implicit_tool_poisoning',
  'jailbreak',
  'role_manipulation',
  'context_poisoning',
  'privilege_escalation',
  'secret_leakage',
  'pii_exposure',
  'hallucination',
  'unsupported_claims',
  'behaviour_drift',
  'unsafe_action',
  'encoding_obfuscation',
  'multilingual_evasion',
] as const;

export const DEFENSE_FAMILIES = [
  { id: 'input_normalisation', filter: 'F1', label: 'Normalisation, decoding and structural validation of input' },
  { id: 'trust_boundary', filter: 'F2', label: 'Separation of retrieved/tool data from user instructions' },
  { id: 'pattern_deterministic', filter: 'F2', label: 'Deterministic pattern and fingerprint matching' },
  { id: 'least_privilege', filter: 'F3', label: 'Per-call authorisation, L0–L4 ladder, no self-escalation' },
  { id: 'secret_scanning', filter: 'F4', label: 'Secret scanner with MASK / REDACT / BLOCK before logging' },
  { id: 'evidence_gating', filter: 'F5', label: 'Claim typing, evidence and confidence scoring, abstention' },
  { id: 'behaviour_baseline', filter: 'F6', label: 'Per-agent baselines, anomaly and loop detection' },
  { id: 'final_gate', filter: 'F7', label: 'Deterministic aggregation gate with human review' },
] as const;

export function benchmarksByStatus(status: BenchmarkStatus): BenchmarkEntry[] {
  return BENCHMARKS.filter((b) => b.status === status);
}
