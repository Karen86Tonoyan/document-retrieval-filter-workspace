/**
 * Pipeline Orchestrator
 * ŁASUCH → CERBER → GUARDIAN → ENHANCER → CORE → [MODEL if PASS]
 */
import type { PipelineResult, PipelineMode, GuardianDecision, ResponseMode } from '@/types/tonoyan-filters';
import { runLasuch } from './lasuch';
import { runCerber } from './cerber';
import { runGuardian } from './guardian';
import { runCore } from './core';
import { enhancePrompt } from './prompt-enhancer';
import { runMonoGateway, runMonoDecode } from './mono';
import type { ModelAdapter } from '@/lib/adapters/types';

function hashInput(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export interface PipelineOptions {
  mode: PipelineMode;
  adapter?: ModelAdapter;
  systemPrompt?: string;
}

export async function runPipeline(input: string, options: PipelineOptions): Promise<PipelineResult> {
  const startTime = performance.now();
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const input_hash = hashInput(input);

  // === STAGE 1: ŁASUCH ===
  const lasuch = runLasuch(input);

  // === STAGE 2: CERBER ===
  const cerber = runCerber(input, lasuch);

  // === STAGE 3: GUARDIAN ===
  const guardian = runGuardian(lasuch, cerber);

  // === STAGE 3.5: PROMPT ENHANCER (always runs) ===
  // Determine enhancer mode based on pipeline mode
  const enhancerMode = options.mode === 'benchmark' ? 'benchmark' as const : 'safe' as const;
  const enhancementRaw = enhancePrompt(input, enhancerMode);
  const enhancement: import('@/types/tonoyan-filters').PromptEnhancementResult = {
    original: enhancementRaw.original,
    enhanced: enhancementRaw.enhanced,
    dual_prompt: enhancementRaw.dual_prompt,
    weaknesses: enhancementRaw.weaknesses.map(w => ({
      category: w.category,
      description: w.description,
      severity: w.severity,
      fix: w.fix,
    })),
    enhancement_summary: enhancementRaw.enhancement_summary,
    strength_score: enhancementRaw.strength_score,
    improvement_delta: enhancementRaw.improvement_delta,
    modification_level: enhancementRaw.modification_level,
    risk_of_distortion: enhancementRaw.risk_of_distortion,
    added_assumptions: enhancementRaw.added_assumptions,
    mode: enhancementRaw.mode,
    processing_time_ms: enhancementRaw.processing_time_ms,
  };

  // === STAGE 3.7: MONO GATEWAY ===
  const mono_gateway = runMonoGateway(input, lasuch, cerber, guardian);

  // === STAGE 4: CORE ===
  const core = runCore(input, lasuch, cerber, guardian);

  let final_decision: GuardianDecision = guardian.decision;
  let response_mode: ResponseMode = guardian.response_mode;
  let model_response: string | undefined;
  let provider_used: string | undefined;
  let model_used: string | undefined;
  let mono_decode: import('@/types/tonoyan-filters').MonoDecodeResult | undefined;

  // Core can override Guardian in edge cases
  if (core.recommendation === 'block' && final_decision === 'PASS') {
    final_decision = 'HOLD';
    response_mode = 'restricted';
  }

  // v2.0: If HIGH distortion risk + assumptions → escalate to HOLD
  if (enhancement.modification_level === 'HIGH' && enhancement.added_assumptions && final_decision === 'PASS') {
    final_decision = 'LIMITED_PASS';
    response_mode = 'restricted';
  }

  // === STAGE 5: MODEL (only if allowed) ===
  // DUAL PROMPT: system_guard as system prefix + raw_input as user message
  const systemGuardPrefix = enhancement.dual_prompt.system_guard;
  const effectiveSystemPrompt = systemGuardPrefix
    ? [systemGuardPrefix, options.systemPrompt].filter(Boolean).join('\n\n')
    : options.systemPrompt;

  if (options.mode !== 'benchmark' && (final_decision === 'PASS' || final_decision === 'LIMITED_PASS') && options.adapter) {
    try {
      // MONO: model receives sanitized payload, not raw input
      const monoInput = mono_gateway.is_sanitized ? mono_gateway.mono_payload : input;
      const userInput = final_decision === 'LIMITED_PASS'
        ? `[RESTRICTED MODE] ${monoInput}`
        : monoInput;

      model_response = await options.adapter.chat(userInput, effectiveSystemPrompt);
      provider_used = options.adapter.provider;
      model_used = options.adapter.modelId;

      // MONO decode: check model response for data leakage
      mono_decode = runMonoDecode(model_response);
    } catch (e) {
      model_response = `[ERROR] Model call failed: ${e instanceof Error ? e.message : 'Unknown error'}`;
    }
  } else if (final_decision === 'BLOCK') {
    model_response = undefined;
  } else if (final_decision === 'HOLD' || final_decision === 'HUMAN_REVIEW') {
    model_response = undefined;
  }

  // RAW mode: skip all filters, just call model
  if (options.mode === 'raw' && options.adapter) {
    try {
      model_response = await options.adapter.chat(input, options.systemPrompt);
      provider_used = options.adapter.provider;
      model_used = options.adapter.modelId;
      final_decision = 'PASS';
      response_mode = 'normal';
    } catch (e) {
      model_response = `[ERROR] ${e instanceof Error ? e.message : 'Unknown error'}`;
    }
  }

  const total_latency_ms = Math.round(performance.now() - startTime);
  const token_estimate = Math.ceil(input.split(/\s+/).length * 1.3 + (model_response?.split(/\s+/).length || 0) * 1.3);

  return {
    id,
    timestamp,
    input,
    input_hash,
    lasuch,
    cerber,
    guardian,
    core,
    enhancement,
    mono_gateway,
    mono_decode,
    final_decision,
    response_mode,
    model_response,
    provider_used,
    model_used,
    total_latency_ms,
    token_estimate,
    mode: options.mode,
  };
}
