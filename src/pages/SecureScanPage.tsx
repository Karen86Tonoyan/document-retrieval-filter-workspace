import { useState, useCallback, useRef } from 'react';
import {
  ScanLine, ShieldAlert, ShieldCheck, Play, Square, Download,
  AlertTriangle, CheckCircle2, Clock, Zap, ChevronDown, ChevronRight,
  RotateCcw, FileSearch, XCircle, Shield, Activity, Lock,
  ArrowRight, Eye, EyeOff
} from 'lucide-react';
import { TEST_PROMPTS } from '@/types/tonoyan-filters';
import type { PipelineResult, GuardianDecision, SessionAnomaly, AnomalyType } from '@/types/tonoyan-filters';
import { runPipeline } from '@/lib/pipeline/orchestrator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { StatCard } from '@/components/StatCard';

// ─── constants ───────────────────────────────────────────────────────────────

const SESSION_MAX_ANOMALIES = 5;
const SESSION_MAX_BLOCKS = 3;

// ─── helpers ─────────────────────────────────────────────────────────────────

const DECISION_STYLE: Record<GuardianDecision, { color: string; label: string }> = {
  PASS:         { color: 'text-green-400 border-green-400/40',   label: 'PASS' },
  LIMITED_PASS: { color: 'text-yellow-400 border-yellow-400/40', label: 'LIMITED' },
  HOLD:         { color: 'text-orange-400 border-orange-400/40', label: 'HOLD' },
  BLOCK:        { color: 'text-red-400 border-red-400/40',       label: 'BLOCK' },
  HUMAN_REVIEW: { color: 'text-purple-400 border-purple-400/40', label: 'REVIEW' },
};

const ANOMALY_STYLE: Record<AnomalyType, { color: string; label: string }> = {
  block:          { color: 'text-red-400',    label: 'BLOCK' },
  cerber_fail:    { color: 'text-orange-400', label: 'CERBER FAIL' },
  high_risk:      { color: 'text-yellow-400', label: 'HIGH RISK' },
  sensitive_data: { color: 'text-blue-400',   label: 'SENSITIVE DATA' },
  attack_detected:{ color: 'text-red-500',    label: 'ATTACK' },
};

function DecisionBadge({ decision }: { decision: GuardianDecision }) {
  const s = DECISION_STYLE[decision];
  return <Badge variant="outline" className={`font-mono text-[10px] ${s.color}`}>{s.label}</Badge>;
}

function ScoreBar({ label, value, warn = 0.3 }: { label: string; value: number; warn?: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.7 ? 'bg-red-500' : value >= warn ? 'bg-yellow-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-6 text-muted-foreground font-mono shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`w-7 text-right font-mono shrink-0 ${value >= warn ? 'text-yellow-400' : 'text-muted-foreground'}`}>
        {pct}%
      </span>
    </div>
  );
}

interface ScanEntry {
  id: string;
  label: string;
  prompt: string;
  result: PipelineResult;
  expanded: boolean;
  monoExpanded: boolean;
}

// ─── anomaly detection ───────────────────────────────────────────────────────

function detectAnomalies(result: PipelineResult, label: string): SessionAnomaly[] {
  const anomalies: SessionAnomaly[] = [];
  const preview = result.input.slice(0, 60) + (result.input.length > 60 ? '…' : '');
  const ts = new Date().toISOString();

  if (result.final_decision === 'BLOCK' || result.final_decision === 'HUMAN_REVIEW') {
    anomalies.push({ id: `${result.id}-block`, timestamp: ts, type: 'block', detail: `${label} — ${result.final_decision}`, input_preview: preview });
  }
  if (result.cerber.survival_status === 'FAILED') {
    anomalies.push({ id: `${result.id}-cerber`, timestamp: ts, type: 'cerber_fail', detail: `CERBER FAILED — ${result.cerber.impact_simulation.severity} severity`, input_preview: preview });
  }
  if (result.lasuch.risk_score > 0.7) {
    anomalies.push({ id: `${result.id}-risk`, timestamp: ts, type: 'high_risk', detail: `Risk score ${Math.round(result.lasuch.risk_score * 100)}%`, input_preview: preview });
  }
  if (result.mono_gateway?.sensitive_data_found) {
    anomalies.push({ id: `${result.id}-dlp`, timestamp: ts, type: 'sensitive_data', detail: `MONO detected ${result.mono_gateway.transformations.length} sensitive pattern(s)`, input_preview: preview });
  }
  if (result.mono_gateway?.attack_payload_blocked) {
    anomalies.push({ id: `${result.id}-attack`, timestamp: ts, type: 'attack_detected', detail: 'Attack payload blocked by MONO gateway', input_preview: preview });
  }
  return anomalies;
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function SecureScanPage() {
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [customInput, setCustomInput] = useState('');
  const [customScanning, setCustomScanning] = useState(false);
  const [customResult, setCustomResult] = useState<PipelineResult | null>(null);
  const [customMonoExpanded, setCustomMonoExpanded] = useState(false);
  const [anomalies, setAnomalies] = useState<SessionAnomaly[]>([]);
  const [sessionTerminated, setSessionTerminated] = useState(false);
  const [terminationReason, setTerminationReason] = useState('');
  const [showRawPayload, setShowRawPayload] = useState<Record<string, boolean>>({});
  const abortRef = useRef(false);

  const checkSessionPolicy = useCallback((allAnomalies: SessionAnomaly[]) => {
    const blocks = allAnomalies.filter(a => a.type === 'block').length;
    if (allAnomalies.length >= SESSION_MAX_ANOMALIES) {
      setSessionTerminated(true);
      setTerminationReason(`Session auto-terminated: ${allAnomalies.length} anomalies detected (threshold: ${SESSION_MAX_ANOMALIES})`);
      return true;
    }
    if (blocks >= SESSION_MAX_BLOCKS) {
      setSessionTerminated(true);
      setTerminationReason(`Session auto-terminated: ${blocks} blocks detected (threshold: ${SESSION_MAX_BLOCKS})`);
      return true;
    }
    return false;
  }, []);

  const runBatchScan = useCallback(async () => {
    if (sessionTerminated) return;
    setScanning(true);
    setEntries([]);
    setProgress(0);
    setAnomalies([]);
    abortRef.current = false;

    let runningAnomalies: SessionAnomaly[] = [];

    for (let i = 0; i < TEST_PROMPTS.length; i++) {
      if (abortRef.current) break;
      const tp = TEST_PROMPTS[i];
      const result = await runPipeline(tp.prompt, { mode: 'benchmark' });

      const newAnomalies = detectAnomalies(result, tp.label);
      runningAnomalies = [...runningAnomalies, ...newAnomalies];
      setAnomalies([...runningAnomalies]);

      setEntries(prev => [...prev, { id: tp.id, label: tp.label, prompt: tp.prompt, result, expanded: false, monoExpanded: false }]);
      setProgress(Math.round(((i + 1) / TEST_PROMPTS.length) * 100));

      if (newAnomalies.length > 0 && checkSessionPolicy(runningAnomalies)) {
        abortRef.current = true;
        break;
      }
      await new Promise(r => setTimeout(r, 0));
    }

    setScanning(false);
  }, [sessionTerminated, checkSessionPolicy]);

  const stopScan = useCallback(() => {
    abortRef.current = true;
    setScanning(false);
  }, []);

  const resetSession = useCallback(() => {
    abortRef.current = true;
    setEntries([]);
    setProgress(0);
    setAnomalies([]);
    setSessionTerminated(false);
    setTerminationReason('');
    setCustomResult(null);
    setCustomInput('');
    setScanning(false);
  }, []);

  const toggleExpand = (id: string) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, expanded: !e.expanded } : e));
  };
  const toggleMono = (id: string) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, monoExpanded: !e.monoExpanded } : e));
  };
  const toggleRaw = (id: string) => {
    setShowRawPayload(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const runCustomScan = useCallback(async () => {
    if (!customInput.trim() || sessionTerminated) return;
    setCustomScanning(true);
    setCustomResult(null);
    const result = await runPipeline(customInput.trim(), { mode: 'benchmark' });
    setCustomResult(result);

    // Update session anomalies from custom scan
    const newAnomalies = detectAnomalies(result, 'Custom prompt');
    if (newAnomalies.length > 0) {
      setAnomalies(prev => {
        const updated = [...prev, ...newAnomalies];
        checkSessionPolicy(updated);
        return updated;
      });
    }

    setCustomScanning(false);
  }, [customInput, sessionTerminated, checkSessionPolicy]);

  const exportResults = useCallback(() => {
    const data = {
      exported_at: new Date().toISOString(),
      session_terminated: sessionTerminated,
      termination_reason: terminationReason || null,
      scan_count: entries.length,
      anomaly_count: anomalies.length,
      summary: buildSummary(entries),
      layer_detection_rates: buildLayerMetrics(entries),
      anomalies,
      results: entries.map(e => ({
        id: e.id,
        label: e.label,
        prompt: e.prompt.slice(0, 120),
        final_decision: e.result.final_decision,
        lasuch: {
          risk_score: e.result.lasuch.risk_score,
          manipulation_score: e.result.lasuch.manipulation_score,
          exploit_score: e.result.lasuch.exploit_score,
          flags: e.result.lasuch.flags,
        },
        cerber_status: e.result.cerber.survival_status,
        cerber_severity: e.result.cerber.impact_simulation.severity,
        mono: e.result.mono_gateway ? {
          sensitive_data_found: e.result.mono_gateway.sensitive_data_found,
          attack_payload_blocked: e.result.mono_gateway.attack_payload_blocked,
          transformations: e.result.mono_gateway.transformations.length,
          raw_size_bytes: e.result.mono_gateway.raw_size_bytes,
          mono_size_bytes: e.result.mono_gateway.mono_size_bytes,
          policy_applied: e.result.mono_gateway.policy_applied,
        } : null,
        latency_ms: e.result.total_latency_ms,
        stage_latency: {
          lasuch_ms: e.result.lasuch.processing_time_ms,
          cerber_ms: e.result.cerber.processing_time_ms,
          guardian_ms: e.result.guardian.processing_time_ms,
          mono_ms: e.result.mono_gateway?.processing_time_ms ?? 0,
        },
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alfa-secure-scan-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [entries, anomalies, sessionTerminated, terminationReason]);

  const summary = buildSummary(entries);
  const metrics = buildLayerMetrics(entries);
  const blockCount = anomalies.filter(a => a.type === 'block').length;

  return (
    <div className="p-4 sm:p-8 space-y-6 animate-fade-up">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ScanLine className="w-6 h-6 text-primary" />
            <h1 className="text-2xl sm:text-3xl font-display font-bold text-primary tracking-wider">
              Secure Scan
            </h1>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            LASUCH → CERBER → MONO Gateway → GUARDIAN → CORE — with session anomaly tracking
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {entries.length > 0 && !scanning && (
            <Button variant="outline" size="sm" onClick={exportResults} className="gap-2">
              <Download className="w-3.5 h-3.5" />
              Export JSON
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={resetSession} className="gap-2 text-muted-foreground">
            <RotateCcw className="w-3.5 h-3.5" />
            Reset Session
          </Button>
          {scanning ? (
            <Button variant="destructive" size="sm" onClick={stopScan} className="gap-2">
              <Square className="w-3.5 h-3.5 fill-current" />
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={runBatchScan} disabled={scanning || sessionTerminated} className="gap-2">
              <Play className="w-3.5 h-3.5 fill-current" />
              Run Batch Scan ({TEST_PROMPTS.length})
            </Button>
          )}
        </div>
      </div>

      {/* Session termination banner */}
      {sessionTerminated && (
        <div className="bg-red-950/40 border border-red-500/40 rounded-xl p-4 flex items-start gap-3">
          <Lock className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-red-400 font-semibold text-sm">SESSION TERMINATED</p>
            <p className="text-red-300/70 text-xs mt-0.5">{terminationReason}</p>
            <p className="text-muted-foreground text-xs mt-1">Reset the session to enable further scanning.</p>
          </div>
        </div>
      )}

      {/* Progress */}
      {(scanning || (entries.length > 0 && progress < 100 && !sessionTerminated)) && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground font-mono">
            <span>{scanning ? 'Scanning…' : 'Stopped'}</span>
            <span>{entries.length} / {TEST_PROMPTS.length}</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
      )}

      {/* Aggregate stats */}
      {entries.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={FileSearch}   label="Scanned"        value={entries.length}    description="prompts"            variant="primary" />
          <StatCard icon={XCircle}      label="Threats"        value={summary.threats}   description={`of ${entries.length}`} variant="warning" />
          <StatCard icon={ShieldAlert}  label="Blocked"        value={summary.blocked}   description="BLOCK / REVIEW"     variant="accent" />
          <StatCard icon={ShieldCheck}  label="Passed"         value={summary.passed}    description="PASS / LIMITED"     variant="info" />
        </div>
      )}

      {/* Layer detection rates */}
      {entries.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-display font-semibold text-foreground tracking-wide flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Detection Rate by Layer
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {[
              { label: 'LASUCH flags', value: metrics.lasuch_flag_rate, unit: 'flagged' },
              { label: 'CERBER failed', value: metrics.cerber_fail_rate, unit: 'failed' },
              { label: 'MONO sensitive', value: metrics.mono_sensitive_rate, unit: 'found' },
              { label: 'MONO attack blocked', value: metrics.mono_attack_rate, unit: 'blocked' },
            ].map(m => (
              <div key={m.label} className="space-y-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>{m.label}</span>
                  <span className="font-mono">{Math.round(m.value * 100)}%</span>
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${m.value > 0.5 ? 'bg-red-500' : m.value > 0.2 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.round(m.value * 100)}%` }}
                  />
                </div>
                <p className="text-muted-foreground/60">{Math.round(m.value * entries.length)} of {entries.length} {m.unit}</p>
              </div>
            ))}
          </div>
          {entries.length > 0 && (
            <div className="pt-1 border-t border-border/50 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-muted-foreground font-mono">
              <span>Avg latency: <span className="text-foreground">{metrics.avg_latency}ms</span></span>
              <span>LASUCH avg: <span className="text-foreground">{metrics.lasuch_avg_ms}ms</span></span>
              <span>CERBER avg: <span className="text-foreground">{metrics.cerber_avg_ms}ms</span></span>
              <span>MONO avg: <span className="text-foreground">{metrics.mono_avg_ms}ms</span></span>
            </div>
          )}
        </div>
      )}

      {/* Pipeline flow diagram */}
      {entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono text-muted-foreground">
          <Badge variant="outline" className="border-primary/30 text-primary">RAW INPUT</Badge>
          <ArrowRight className="w-3 h-3" />
          <Badge variant="outline" className="border-primary/30 text-primary">LASUCH</Badge>
          <ArrowRight className="w-3 h-3" />
          <Badge variant="outline" className="border-accent/30 text-accent">CERBER</Badge>
          <ArrowRight className="w-3 h-3" />
          <Badge variant="outline" className="border-blue-400/30 text-blue-400">MONO Gateway</Badge>
          <ArrowRight className="w-3 h-3" />
          <Badge variant="outline" className="border-primary/30 text-primary">GUARDIAN</Badge>
          <ArrowRight className="w-3 h-3" />
          <Badge variant="outline" className="border-yellow-400/30 text-yellow-400">CORE</Badge>
          <ArrowRight className="w-3 h-3" />
          <Badge variant="outline" className="border-muted text-muted-foreground">OUTPUT</Badge>
        </div>
      )}

      {/* Scan results */}
      {entries.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-base font-display font-semibold text-foreground tracking-wide">Scan Results</h2>
          <div className="space-y-1.5">
            {entries.map(entry => (
              <div
                key={entry.id}
                className={`bg-card border rounded-lg transition-colors ${
                  entry.result.final_decision === 'BLOCK' || entry.result.final_decision === 'HUMAN_REVIEW'
                    ? 'border-destructive/20'
                    : entry.result.final_decision === 'PASS'
                    ? 'border-success/10'
                    : 'border-border'
                }`}
              >
                {/* Summary row */}
                <button
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  onClick={() => toggleExpand(entry.id)}
                >
                  <span className="text-muted-foreground w-4 shrink-0">
                    {entry.expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{entry.label}</p>
                    <p className="text-xs text-muted-foreground truncate font-mono mt-0.5">
                      {entry.prompt.slice(0, 80)}{entry.prompt.length > 80 ? '…' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {entry.result.mono_gateway?.is_sanitized && (
                      <Badge variant="outline" className="text-[9px] font-mono border-blue-400/30 text-blue-400">MONO</Badge>
                    )}
                    {entry.result.lasuch.flags.length > 0 && (
                      <span className="text-[10px] font-mono text-destructive">
                        {entry.result.lasuch.flags.length}f
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {entry.result.total_latency_ms}ms
                    </span>
                    <DecisionBadge decision={entry.result.final_decision} />
                  </div>
                </button>

                {/* Expanded detail */}
                {entry.expanded && (
                  <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-4">

                    {/* LASUCH */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">LASUCH</p>
                      <ScoreBar label="R" value={entry.result.lasuch.risk_score} />
                      <ScoreBar label="M" value={entry.result.lasuch.manipulation_score} />
                      <ScoreBar label="E" value={entry.result.lasuch.exploit_score} />
                      {entry.result.lasuch.flags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {entry.result.lasuch.flags.map(f => (
                            <Badge key={f} variant="outline" className="text-[10px] font-mono border-destructive/30 text-destructive">{f}</Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* CERBER + GUARDIAN */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-secondary/30 rounded-lg p-3 space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">CERBER</p>
                        <p className="text-xs font-mono">
                          <span className={
                            entry.result.cerber.survival_status === 'FAILED' ? 'text-red-400' :
                            entry.result.cerber.survival_status === 'SURVIVED' ? 'text-green-400' : 'text-yellow-400'
                          }>{entry.result.cerber.survival_status}</span>
                          {' — '}
                          <span className="text-muted-foreground">{entry.result.cerber.impact_simulation.severity}</span>
                        </p>
                        {entry.result.cerber.hidden_objective && (
                          <p className="text-[11px] text-muted-foreground italic">"{entry.result.cerber.hidden_objective}"</p>
                        )}
                      </div>
                      <div className="bg-secondary/30 rounded-lg p-3 space-y-1">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">GUARDIAN</p>
                        <DecisionBadge decision={entry.result.guardian.decision} />
                        <p className="text-xs text-muted-foreground font-mono">mode: {entry.result.guardian.response_mode}</p>
                        {entry.result.guardian.reason_codes.slice(0, 3).map(rc => (
                          <Badge key={rc} variant="outline" className="text-[9px] border-muted text-muted-foreground mr-1">{rc}</Badge>
                        ))}
                      </div>
                    </div>

                    {/* MONO Gateway */}
                    {entry.result.mono_gateway && (
                      <div className={`rounded-lg border p-3 space-y-3 ${
                        entry.result.mono_gateway.is_sanitized
                          ? 'border-blue-400/30 bg-blue-950/20'
                          : 'border-border bg-secondary/20'
                      }`}>
                        <button
                          className="w-full flex items-center justify-between text-left"
                          onClick={() => toggleMono(entry.id)}
                        >
                          <div className="flex items-center gap-2">
                            <Shield className="w-3.5 h-3.5 text-blue-400" />
                            <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">MONO Gateway</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {entry.result.mono_gateway.sensitive_data_found && (
                              <Badge variant="outline" className="text-[9px] border-blue-400/40 text-blue-400">SENSITIVE DATA FOUND</Badge>
                            )}
                            {entry.result.mono_gateway.attack_payload_blocked && (
                              <Badge variant="outline" className="text-[9px] border-red-400/40 text-red-400">ATTACK BLOCKED</Badge>
                            )}
                            {!entry.result.mono_gateway.is_sanitized && (
                              <Badge variant="outline" className="text-[9px] border-green-400/40 text-green-400">CLEAN</Badge>
                            )}
                            {entry.monoExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                          </div>
                        </button>

                        {entry.monoExpanded && (
                          <div className="space-y-3 pt-1 border-t border-blue-400/10">
                            {/* Size comparison */}
                            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                              <div className="bg-secondary/40 rounded p-2">
                                <p className="text-muted-foreground text-[9px] uppercase mb-0.5">Raw payload</p>
                                <p className="text-foreground">{entry.result.mono_gateway.raw_size_bytes} bytes</p>
                              </div>
                              <div className="bg-secondary/40 rounded p-2">
                                <p className="text-muted-foreground text-[9px] uppercase mb-0.5">MONO payload</p>
                                <p className={entry.result.mono_gateway.mono_size_bytes < entry.result.mono_gateway.raw_size_bytes ? 'text-blue-400' : 'text-foreground'}>
                                  {entry.result.mono_gateway.mono_size_bytes} bytes
                                  {entry.result.mono_gateway.mono_size_bytes < entry.result.mono_gateway.raw_size_bytes && (
                                    <span className="text-muted-foreground ml-1">
                                      (−{entry.result.mono_gateway.raw_size_bytes - entry.result.mono_gateway.mono_size_bytes})
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>

                            {/* Transformations */}
                            {entry.result.mono_gateway.transformations.length > 0 && (
                              <div>
                                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Transformations</p>
                                <div className="space-y-1">
                                  {entry.result.mono_gateway.transformations.map((t, i) => (
                                    <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                                      <span className="text-muted-foreground bg-secondary/60 rounded px-1.5 py-0.5">{t.pattern_name}</span>
                                      <span className="text-muted-foreground">{t.original_preview}</span>
                                      <ArrowRight className="w-3 h-3 text-blue-400 shrink-0" />
                                      <span className="text-blue-400">{t.placeholder}</span>
                                      {t.count > 1 && <span className="text-muted-foreground">×{t.count}</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* MONO payload preview */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
                                  {showRawPayload[entry.id] ? 'Raw payload (original)' : 'MONO payload (sent to model)'}
                                </p>
                                <button
                                  onClick={() => toggleRaw(entry.id)}
                                  className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  {showRawPayload[entry.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                                  {showRawPayload[entry.id] ? 'show MONO' : 'show raw'}
                                </button>
                              </div>
                              <pre className="text-[10px] font-mono text-muted-foreground bg-secondary/30 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                                {showRawPayload[entry.id]
                                  ? entry.result.mono_gateway.raw_payload.slice(0, 300)
                                  : entry.result.mono_gateway.mono_payload.slice(0, 300)}
                                {(showRawPayload[entry.id]
                                  ? entry.result.mono_gateway.raw_payload
                                  : entry.result.mono_gateway.mono_payload).length > 300 && '…'}
                              </pre>
                            </div>

                            {/* Policy applied */}
                            {entry.result.mono_gateway.policy_applied.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {entry.result.mono_gateway.policy_applied.map(p => (
                                  <Badge key={p} variant="outline" className="text-[9px] border-blue-400/20 text-blue-400/80">{p}</Badge>
                                ))}
                              </div>
                            )}

                            <p className="text-[10px] text-muted-foreground font-mono">
                              MONO processing: {entry.result.mono_gateway.processing_time_ms}ms
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* CORE */}
                    <div className="bg-secondary/30 rounded-lg p-3">
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">CORE</p>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px] font-mono">
                        {Object.entries(entry.result.core.scores).map(([k, v]) => (
                          <div key={k} className="text-center">
                            <p className="text-muted-foreground text-[9px] uppercase">{k.replace('_score', '')}</p>
                            <p className={(v as number) > 0.5 ? 'text-yellow-400' : 'text-muted-foreground'}>{Math.round((v as number) * 100)}%</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Per-stage latency */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-muted-foreground">
                      <span>LASUCH: {entry.result.lasuch.processing_time_ms}ms</span>
                      <span>CERBER: {entry.result.cerber.processing_time_ms}ms</span>
                      <span>GUARDIAN: {entry.result.guardian.processing_time_ms}ms</span>
                      {entry.result.mono_gateway && <span>MONO: {entry.result.mono_gateway.processing_time_ms}ms</span>}
                      <span className="text-foreground">Total: {entry.result.total_latency_ms}ms</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!scanning && entries.length === 0 && !sessionTerminated && (
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <ScanLine className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
          <p className="text-foreground font-medium mb-1">No scans yet</p>
          <p className="text-muted-foreground text-sm">
            Run the batch scan to analyse all {TEST_PROMPTS.length} built-in test prompts,
            or enter a custom prompt below.
          </p>
        </div>
      )}

      {/* Custom scan */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <h2 className="text-base font-display font-semibold text-foreground tracking-wide">Custom Prompt Scan</h2>
        </div>

        <Textarea
          value={customInput}
          onChange={e => setCustomInput(e.target.value)}
          placeholder="Enter any prompt to scan through the full ALFA + MONO pipeline…"
          className="font-mono text-sm resize-none h-24"
          disabled={sessionTerminated}
        />

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            size="sm"
            onClick={runCustomScan}
            disabled={!customInput.trim() || customScanning || sessionTerminated}
            className="gap-2"
          >
            {customScanning ? (
              <><ScanLine className="w-3.5 h-3.5 animate-pulse" />Scanning…</>
            ) : (
              <><Play className="w-3.5 h-3.5 fill-current" />Scan</>
            )}
          </Button>
          {customResult && (
            <div className="flex items-center gap-2 flex-wrap">
              <DecisionBadge decision={customResult.final_decision} />
              {customResult.mono_gateway?.is_sanitized && (
                <Badge variant="outline" className="text-[10px] border-blue-400/40 text-blue-400">MONO sanitized</Badge>
              )}
              {customResult.lasuch.flags.length > 0 ? (
                <span className="text-xs text-destructive font-mono">{customResult.lasuch.flags.length} flag{customResult.lasuch.flags.length !== 1 ? 's' : ''}</span>
              ) : (
                <span className="text-xs text-emerald-400 font-mono flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" />Clean</span>
              )}
              <span className="text-xs text-muted-foreground font-mono">{customResult.total_latency_ms}ms</span>
            </div>
          )}
        </div>

        {/* Custom result detail */}
        {customResult && (
          <div className="border border-border rounded-lg p-4 space-y-4 mt-2">
            {/* Scores */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">LASUCH</p>
                <ScoreBar label="R" value={customResult.lasuch.risk_score} />
                <ScoreBar label="M" value={customResult.lasuch.manipulation_score} />
                <ScoreBar label="E" value={customResult.lasuch.exploit_score} />
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">CERBER</p>
                <p className="text-xs font-mono">
                  <span className={customResult.cerber.survival_status === 'FAILED' ? 'text-red-400' : customResult.cerber.survival_status === 'SURVIVED' ? 'text-green-400' : 'text-yellow-400'}>
                    {customResult.cerber.survival_status}
                  </span>
                  {' — '}<span className="text-muted-foreground">{customResult.cerber.impact_simulation.severity}</span>
                </p>
                {customResult.cerber.hidden_objective && (
                  <p className="text-[11px] text-muted-foreground italic">"{customResult.cerber.hidden_objective}"</p>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">GUARDIAN</p>
                <DecisionBadge decision={customResult.final_decision} />
                <p className="text-xs text-muted-foreground font-mono">mode: {customResult.guardian.response_mode}</p>
              </div>
            </div>

            {/* MONO */}
            {customResult.mono_gateway && (
              <div className={`rounded-lg border p-3 space-y-3 ${customResult.mono_gateway.is_sanitized ? 'border-blue-400/30 bg-blue-950/20' : 'border-border bg-secondary/20'}`}>
                <button className="w-full flex items-center justify-between text-left" onClick={() => setCustomMonoExpanded(v => !v)}>
                  <div className="flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-blue-400" />
                    <p className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold">MONO Gateway</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {customResult.mono_gateway.sensitive_data_found && <Badge variant="outline" className="text-[9px] border-blue-400/40 text-blue-400">SENSITIVE DATA</Badge>}
                    {customResult.mono_gateway.attack_payload_blocked && <Badge variant="outline" className="text-[9px] border-red-400/40 text-red-400">ATTACK BLOCKED</Badge>}
                    {!customResult.mono_gateway.is_sanitized && <Badge variant="outline" className="text-[9px] border-green-400/40 text-green-400">CLEAN</Badge>}
                    {customMonoExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                  </div>
                </button>
                {customMonoExpanded && (
                  <div className="space-y-3 pt-1 border-t border-blue-400/10">
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="bg-secondary/40 rounded p-2">
                        <p className="text-muted-foreground text-[9px] uppercase mb-0.5">Raw</p>
                        <p>{customResult.mono_gateway.raw_size_bytes} bytes</p>
                      </div>
                      <div className="bg-secondary/40 rounded p-2">
                        <p className="text-muted-foreground text-[9px] uppercase mb-0.5">MONO</p>
                        <p className={customResult.mono_gateway.mono_size_bytes < customResult.mono_gateway.raw_size_bytes ? 'text-blue-400' : ''}>
                          {customResult.mono_gateway.mono_size_bytes} bytes
                        </p>
                      </div>
                    </div>
                    {customResult.mono_gateway.transformations.length > 0 && (
                      <div className="space-y-1">
                        {customResult.mono_gateway.transformations.map((t, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
                            <span className="text-muted-foreground bg-secondary/60 rounded px-1.5 py-0.5">{t.pattern_name}</span>
                            <span className="text-muted-foreground">{t.original_preview}</span>
                            <ArrowRight className="w-3 h-3 text-blue-400 shrink-0" />
                            <span className="text-blue-400">{t.placeholder}</span>
                            {t.count > 1 && <span className="text-muted-foreground">×{t.count}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    <pre className="text-[10px] font-mono text-muted-foreground bg-secondary/30 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                      {customResult.mono_gateway.mono_payload.slice(0, 400)}
                      {customResult.mono_gateway.mono_payload.length > 400 && '…'}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Flags */}
            {customResult.lasuch.flags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {customResult.lasuch.flags.map(f => (
                  <Badge key={f} variant="outline" className="text-[10px] font-mono border-destructive/30 text-destructive">{f}</Badge>
                ))}
              </div>
            )}

            {/* Suspected intent */}
            {customResult.lasuch.suspected_hidden_intent && (
              <div className="bg-secondary/40 rounded p-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Suspected Intent</p>
                <p className="text-xs text-muted-foreground italic">"{customResult.lasuch.suspected_hidden_intent}"</p>
              </div>
            )}

            {/* Latency breakdown */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-muted-foreground">
              <span>LASUCH: {customResult.lasuch.processing_time_ms}ms</span>
              <span>CERBER: {customResult.cerber.processing_time_ms}ms</span>
              <span>GUARDIAN: {customResult.guardian.processing_time_ms}ms</span>
              {customResult.mono_gateway && <span>MONO: {customResult.mono_gateway.processing_time_ms}ms</span>}
              <span className="text-foreground">Total: {customResult.total_latency_ms}ms</span>
            </div>
          </div>
        )}
      </div>

      {/* Session anomaly history */}
      {anomalies.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-display font-semibold text-foreground tracking-wide flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              Session Anomaly History
            </h2>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="text-muted-foreground">{anomalies.length} anomalies</span>
              <span className="text-destructive">{blockCount} blocks</span>
              <span className={`${anomalies.length >= SESSION_MAX_ANOMALIES * 0.6 ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                {anomalies.length}/{SESSION_MAX_ANOMALIES} threshold
              </span>
            </div>
          </div>

          {/* Threshold progress */}
          <div className="space-y-1 text-[10px] text-muted-foreground">
            <div className="flex justify-between"><span>Anomaly threshold</span><span>{anomalies.length}/{SESSION_MAX_ANOMALIES}</span></div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${anomalies.length >= SESSION_MAX_ANOMALIES ? 'bg-red-500' : anomalies.length >= SESSION_MAX_ANOMALIES * 0.6 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(100, (anomalies.length / SESSION_MAX_ANOMALIES) * 100)}%` }}
              />
            </div>
            <div className="flex justify-between"><span>Block threshold</span><span>{blockCount}/{SESSION_MAX_BLOCKS}</span></div>
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${blockCount >= SESSION_MAX_BLOCKS ? 'bg-red-500' : blockCount >= SESSION_MAX_BLOCKS * 0.6 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                style={{ width: `${Math.min(100, (blockCount / SESSION_MAX_BLOCKS) * 100)}%` }}
              />
            </div>
          </div>

          <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {anomalies.map(a => (
              <div key={a.id} className="flex items-start gap-3 bg-secondary/30 rounded-lg px-3 py-2">
                <span className={`text-[10px] font-mono font-semibold shrink-0 mt-0.5 ${ANOMALY_STYLE[a.type].color}`}>
                  {ANOMALY_STYLE[a.type].label}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground">{a.detail}</p>
                  <p className="text-[10px] text-muted-foreground truncate font-mono mt-0.5">{a.input_preview}</p>
                </div>
                <span className="text-[9px] text-muted-foreground font-mono shrink-0">
                  {new Date(a.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── summary helpers ──────────────────────────────────────────────────────────

function buildSummary(entries: ScanEntry[]) {
  const threats = entries.filter(e => e.result.lasuch.flags.length > 0 || e.result.lasuch.risk_score > 0.3).length;
  const blocked = entries.filter(e => e.result.final_decision === 'BLOCK' || e.result.final_decision === 'HUMAN_REVIEW').length;
  const passed = entries.filter(e => e.result.final_decision === 'PASS' || e.result.final_decision === 'LIMITED_PASS').length;
  return { threats, blocked, passed };
}

function buildLayerMetrics(entries: ScanEntry[]) {
  if (entries.length === 0) return { lasuch_flag_rate: 0, cerber_fail_rate: 0, mono_sensitive_rate: 0, mono_attack_rate: 0, avg_latency: 0, lasuch_avg_ms: 0, cerber_avg_ms: 0, mono_avg_ms: 0 };
  const n = entries.length;
  return {
    lasuch_flag_rate: entries.filter(e => e.result.lasuch.flags.length > 0).length / n,
    cerber_fail_rate: entries.filter(e => e.result.cerber.survival_status === 'FAILED').length / n,
    mono_sensitive_rate: entries.filter(e => e.result.mono_gateway?.sensitive_data_found).length / n,
    mono_attack_rate: entries.filter(e => e.result.mono_gateway?.attack_payload_blocked).length / n,
    avg_latency: Math.round(entries.reduce((s, e) => s + e.result.total_latency_ms, 0) / n),
    lasuch_avg_ms: Math.round(entries.reduce((s, e) => s + e.result.lasuch.processing_time_ms, 0) / n),
    cerber_avg_ms: Math.round(entries.reduce((s, e) => s + e.result.cerber.processing_time_ms, 0) / n),
    mono_avg_ms: Math.round(entries.reduce((s, e) => s + (e.result.mono_gateway?.processing_time_ms ?? 0), 0) / n),
  };
}
