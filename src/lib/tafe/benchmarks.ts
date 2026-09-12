// Research registry of current attack benchmarks and the defences they exercise.
// This is a reference catalogue — it does NOT claim the official datasets were executed here.
export const BENCHMARK_REVIEW_DATE = '2026-09-12';

export interface BenchmarkEntry {
  name: string;
  date: string;
  focus_pl: string;
  focus_en: string;
  defense_pl: string;
  defense_en: string;
  filters: ('F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7')[];
  url: string;
  status_pl: string;
  status_en: string;
}

export const ATTACK_BENCHMARKS: BenchmarkEntry[] = [
  {
    name: 'LongPIBench',
    date: '2026-08-28',
    focus_pl: 'Wstrzyknięcia ukryte w długich dokumentach (początek/środek/koniec kontekstu).',
    focus_en: 'Injections hidden in long documents (start/middle/end of context).',
    defense_pl: 'Granice zaufania dla treści pobranej, skan całego kontekstu, nie tylko prefiksu.',
    defense_en: 'Trust boundaries for retrieved content, full-context scanning, not just the prefix.',
    filters: ['F1', 'F2'],
    url: 'https://arxiv.org/abs/2608.28411',
    status_pl: 'Do integracji: pełny kontekst; obecny limit F1 to 20 000 znaków.',
    status_en: 'To integrate: full context; current F1 limit is 20,000 characters.',
  },
  {
    name: 'MCP-ITP',
    date: '2026-01',
    focus_pl: 'Niejawne zatruwanie metadanych narzędzi MCP.',
    focus_en: 'Implicit poisoning of MCP tool metadata.',
    defense_pl: 'Walidacja metadanych i autoryzacja wywołań poza modelem (F3).',
    defense_en: 'Metadata validation and call authorisation outside the model (F3).',
    filters: ['F3'],
    url: 'https://arxiv.org/abs/2601.07395',
    status_pl: 'Do integracji: testy adaptacyjne na MCPTox.',
    status_en: 'To integrate: adaptive tests against MCPTox.',
  },
  {
    name: 'FACTS Benchmark Suite',
    date: '2025-12-09',
    focus_pl: 'Faktyczność, źródła, wyszukiwanie i treści obrazowe.',
    focus_en: 'Factuality, sourcing, retrieval and image grounding.',
    defense_pl: 'Weryfikacja twierdzeń względem źródeł i abstencja przy braku dowodów (F5).',
    defense_en: 'Claim verification against sources and abstention without evidence (F5).',
    filters: ['F5'],
    url: 'https://deepmind.google/blog/facts-benchmark-suite-systematically-evaluating-the-factuality-of-large-language-models/',
    status_pl: 'Do integracji: model i oficjalny scorer.',
    status_en: 'To integrate: model and official scorer.',
  },
  {
    name: 'MCPTox',
    date: '2025-08-19',
    focus_pl: 'Zatruwanie opisów narzędzi MCP.',
    focus_en: 'Poisoning of MCP tool descriptions.',
    defense_pl: 'Minimalne uprawnienia, kontrola parametrów i celu wywołania (F3, F7).',
    defense_en: 'Least privilege, parameter and target control on every call (F3, F7).',
    filters: ['F3', 'F7'],
    url: 'https://arxiv.org/abs/2508.14925',
    status_pl: 'Do integracji: sandbox narzędzi.',
    status_en: 'To integrate: tool sandbox.',
  },
  {
    name: 'AgentDojo',
    date: '2024',
    focus_pl: 'Pośredni prompt injection przy zachowaniu użyteczności agenta.',
    focus_en: 'Indirect prompt injection versus agent utility.',
    defense_pl: 'Oddzielenie danych z narzędzi od poleceń użytkownika (F1, F2).',
    defense_en: 'Separation of tool data from user instructions (F1, F2).',
    filters: ['F1', 'F2'],
    url: 'https://github.com/ethz-spylab/agentdojo',
    status_pl: 'Do integracji: oficjalny runner.',
    status_en: 'To integrate: official runner.',
  },
  {
    name: 'JailbreakBench',
    date: '2024',
    focus_pl: 'Jailbreaki i odporność odmowy.',
    focus_en: 'Jailbreaks and refusal robustness.',
    defense_pl: 'Testy adaptacyjne wraz z kontrolą fałszywych odmów (F2, regresja).',
    defense_en: 'Adaptive tests together with false-refusal control (F2, regression).',
    filters: ['F2'],
    url: 'https://github.com/JailbreakBench/jailbreakbench',
    status_pl: 'Do integracji: wersjonowany zbiór i sędzia.',
    status_en: 'To integrate: versioned dataset and judge.',
  },
  {
    name: 'InjecAgent',
    date: '2024-03',
    focus_pl: 'Instrukcje w wynikach narzędzi i wyciek danych.',
    focus_en: 'Instructions inside tool outputs and data exfiltration.',
    defense_pl: 'Kontrola przepływu danych i odbiorcy (F3, F4).',
    defense_en: 'Data-flow and recipient control (F3, F4).',
    filters: ['F3', 'F4'],
    url: 'https://arxiv.org/abs/2403.02691',
    status_pl: 'Do integracji: oficjalny runner.',
    status_en: 'To integrate: official runner.',
  },
];
