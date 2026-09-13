// TAFE Phase 2 panel: benchmark matrix, goldsets, adaptive tests, shadow mode,
// promotion gate, Brain evaluation and the PROVIDER contribution surface.
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  tafeApi,
  type BenchmarkRegistry,
  type BrainResult,
  type BrainStatus,
  type TrafficVerdict,
  type DashboardStats,
  type Decision,
  type FilterId,
  type GoldsetCaseRow,
  type MeResponse,
  type RuleRow,
  type ShadowRow,
  type SuiteResult,
} from '@/lib/tafe/api';

const FILTERS: FilterId[] = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'];

const STATUS_STYLE: Record<string, string> = {
  REFERENCED: 'border-muted-foreground/40 text-muted-foreground',
  INTEGRATED: 'border-info/40 text-info',
  VERIFIED: 'border-success/40 text-success',
  BROKEN: 'border-destructive/40 text-destructive',
  DEPRECATED: 'border-muted-foreground/30 text-muted-foreground line-through',
};

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

interface Props {
  me: MeResponse | null;
  rules: RuleRow[];
}

export default function TafePhase2({ me, rules }: Props) {
  const [registry, setRegistry] = useState<BenchmarkRegistry | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [goldsets, setGoldsets] = useState<GoldsetCaseRow[]>([]);
  const [materials, setMaterials] = useState<GoldsetCaseRow[]>([]);
  const [shadow, setShadow] = useState<ShadowRow[]>([]);
  const [suite, setSuite] = useState<SuiteResult | null>(null);
  const [brain, setBrain] = useState<BrainResult | null>(null);
  const [traffic, setTraffic] = useState<TrafficVerdict | null>(null);
  const [brainStatus, setBrainStatus] = useState<BrainStatus | null>(null);
  const [ruleKey, setRuleKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const canContribute = Boolean(me?.capabilities.propose);
  const canRun = Boolean(me?.capabilities.run_tests);

  const load = useCallback(async () => {
    try {
      const [reg, dash, gs, sh, mat] = await Promise.all([
        tafeApi.benchmarks(),
        tafeApi.dashboard(),
        tafeApi.goldsets(),
        tafeApi.shadow(),
        tafeApi.materials().catch(() => ({ cases: [] })),
      ]);
      setRegistry(reg);
      setStats(dash);
      setGoldsets(gs.cases);
      setShadow(sh.observations);
      setMaterials(mat.cases);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd ładowania danych Phase 2');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!ruleKey && rules.length) setRuleKey(rules[0].rule_key);
  }, [rules, ruleKey]);

  const runSuite = async () => {
    if (!ruleKey) return;
    setBusy('suite');
    try {
      const res = await tafeApi.runSuite(ruleKey);
      setSuite(res);
      toast[res.gate.passed ? 'success' : 'warning'](`Gate: ${res.gate.reason}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd testu');
    } finally {
      setBusy(null);
    }
  };

  const runBrain = async () => {
    if (!ruleKey) return;
    setBusy('brain');
    try {
      const res = await tafeApi.brainEvaluate(ruleKey);
      setBrain(res);
      toast.info(`ALFA Brain: ${res.recommendation} → ${res.resulting_status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd oceny Brain');
    } finally {
      setBusy(null);
    }
  };

  const runTrafficBrain = async () => {
    setBusy('traffic');
    try {
      const res = await tafeApi.brainTraffic(24);
      setTraffic(res);
      const status = await tafeApi.brainStatus().catch(() => null);
      if (status) setBrainStatus(status);
      toast.info(`ALFA Brain — ruch: ${res.recommendation} (${res.calls} tool-calli)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd oceny ruchu w Brain');
    } finally {
      setBusy(null);
    }
  };

  // ---- PROVIDER: propose rule ----
  const [proposal, setProposal] = useState({
    rule_key: '',
    name: '',
    description: '',
    filter: 'F2' as FilterId,
    field: 'content',
    op: 'regex',
    value: '',
  });

  const submitProposal = async () => {
    setBusy('propose');
    try {
      await tafeApi.proposeRule({
        rule_key: proposal.rule_key,
        name: proposal.name,
        description: proposal.description,
        filter: proposal.filter,
        conditions: [{ field: proposal.field, op: proposal.op, value: proposal.value }],
      });
      toast.success('Propozycja zapisana jako CANDIDATE (nieaktywna).');
      setProposal({ ...proposal, rule_key: '', name: '', value: '' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd propozycji');
    } finally {
      setBusy(null);
    }
  };

  // ---- PROVIDER: submit material ----
  const [material, setMaterial] = useState({
    case_id: '',
    goldset: 'malicious',
    filter: 'F2' as FilterId,
    input: '',
    expected_decision: 'BLOCK' as Decision,
    attack_family: 'unknown',
  });

  const submitMaterial = async () => {
    setBusy('material');
    try {
      const res = await tafeApi.submitMaterial([
        {
          case_id: material.case_id,
          goldset: material.goldset as never,
          filter: material.filter,
          input: material.input,
          expected_decision: material.expected_decision,
          attack_family: material.attack_family,
        },
      ]);
      toast.success(`Materiał zapisany (${res.stored}).`);
      setMaterial({ ...material, case_id: '', input: '' });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd zapisu materiału');
    } finally {
      setBusy(null);
    }
  };

  // ---- ADMIN: role assignment ----
  const [roleForm, setRoleForm] = useState({ user_id: '', role: 'provider' });
  const assignRole = async () => {
    setBusy('role');
    const { error } = await supabase
      .from('user_roles')
      .insert({ user_id: roleForm.user_id, role: roleForm.role as 'admin' | 'user' | 'provider' | 'guest' });
    setBusy(null);
    if (error) toast.error(error.message);
    else toast.success(`Nadano rolę ${roleForm.role}.`);
  };

  return (
    <Tabs defaultValue="dashboard" className="w-full">
      <TabsList className="flex flex-wrap h-auto">
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        <TabsTrigger value="matrix">Benchmark Matrix</TabsTrigger>
        <TabsTrigger value="families">Attack / Defense</TabsTrigger>
        <TabsTrigger value="goldsets">Goldsets</TabsTrigger>
        <TabsTrigger value="suite">Adaptive + Gate</TabsTrigger>
        <TabsTrigger value="shadow">Shadow Mode</TabsTrigger>
        <TabsTrigger value="brain">Brain</TabsTrigger>
        <TabsTrigger value="provider">Provider</TabsTrigger>
      </TabsList>

      <TabsContent value="dashboard" className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Security score', stats ? stats.security_score.toFixed(3) : '—'],
            ['Utility score', stats ? stats.utility_score.toFixed(3) : '—'],
            ['Adaptive ASR', stats ? pct(stats.adaptive_asr) : '—'],
            ['FP rate', stats ? pct(stats.fp_rate) : '—'],
            ['Reguły ACTIVE', stats?.active_rules ?? '—'],
            ['Kandydaci', stats?.candidates ?? '—'],
            ['Wzorce zablokowane', stats?.patterns_blocked ?? '—'],
            ['Otwarte regresje', stats?.open_regressions.length ?? '—'],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="mt-1 font-mono text-xl">{value}</p>
            </div>
          ))}
        </div>
        {stats?.open_regressions.length ? (
          <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
            <p className="mb-2 text-sm font-semibold">Otwarte regresje</p>
            {stats.open_regressions.map((r, i) => (
              <p key={i} className="font-mono text-xs text-muted-foreground">
                {r.rule_key} — F1 {r.f1.toFixed(3)} / FPR {pct(r.fpr)} ({new Date(r.created_at).toLocaleString()})
              </p>
            ))}
          </div>
        ) : null}
      </TabsContent>

      <TabsContent value="matrix" className="mt-4 space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">
            REFERENCED = skatalogowany, nie uruchomiony. INTEGRATED = wykonywany lokalnie. VERIFIED = potwierdzony wynik.
          </p>
          {me?.is_admin ? (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await tafeApi.syncBenchmarks();
                await load();
                toast.success('Rejestr benchmarków zsynchronizowany.');
              }}
            >
              Sync
            </Button>
          ) : null}
        </div>
        <div className="grid gap-2">
          {(registry?.benchmarks ?? []).map((b) => (
            <div key={b.benchmark_id ?? b.name} className="rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{b.name}</span>
                <Badge variant="outline" className={STATUS_STYLE[b.status]}>{b.status}</Badge>
                <Badge variant="outline">{b.filter ?? '—'}</Badge>
                <span className="font-mono text-xs text-muted-foreground">v{b.version}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{b.notes}</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                runner: {b.runner} · scorer: {b.scorer} · source: {b.source}
              </p>
            </div>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {FILTERS.map((f) => (
            <div key={f} className="rounded-lg border border-border p-3">
              <p className="font-semibold">{f}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {(registry?.matrix?.[f] ?? []).join(', ') || '—'}
              </p>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="families" className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-semibold">Attack families</p>
          {(registry?.attack_families ?? []).map((a) => (
            <div key={a.id} className="rounded-lg border border-destructive/30 p-3">
              <p className="font-semibold">{a.label} <Badge variant="outline">{a.filter}</Badge></p>
              <p className="text-xs text-muted-foreground">{a.description}</p>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-semibold">Defense families</p>
          {(registry?.defense_families ?? []).map((d) => (
            <div key={d.id} className="rounded-lg border border-success/30 p-3">
              <p className="font-semibold">{d.label} <Badge variant="outline">{d.filter}</Badge></p>
              <p className="text-xs text-muted-foreground">{d.description}</p>
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="goldsets" className="mt-4 space-y-2">
        <p className="text-xs text-muted-foreground">
          Wbudowane: {goldsets.length} przypadków · Dostarczone przez providerów: {materials.length}
        </p>
        {[...goldsets, ...materials].slice(0, 120).map((c) => (
          <div key={`${c.case_id}-${c.source}`} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs">{c.case_id}</span>
              <Badge variant="outline">{c.goldset}</Badge>
              <Badge variant="outline">{c.filter}</Badge>
              <Badge variant="outline">{c.expected_decision}</Badge>
              <span className="text-xs text-muted-foreground">{c.source}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{c.input.slice(0, 220)}</p>
          </div>
        ))}
      </TabsContent>

      <TabsContent value="suite" className="mt-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Select value={ruleKey} onValueChange={setRuleKey}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Reguła" /></SelectTrigger>
            <SelectContent>
              {rules.map((r) => (
                <SelectItem key={r.rule_key} value={r.rule_key}>{r.rule_key} (v{r.version}, {r.status})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={runSuite} disabled={!canRun || busy === 'suite' || !ruleKey}>
            {busy === 'suite' ? 'Testuję…' : 'Uruchom suite (goldsets + 7 rund)'}
          </Button>
          {!canRun ? <span className="text-xs text-muted-foreground">Tryb gościa: tylko podgląd.</span> : null}
        </div>
        {suite ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {Object.entries(suite.metrics).map(([k, v]) => (
                <div key={k} className="rounded border border-border p-2">
                  <p className="text-[10px] uppercase text-muted-foreground">{k}</p>
                  <p className="font-mono text-sm">{typeof v === 'number' ? v.toFixed(3) : String(v)}</p>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              {suite.adaptive.rounds.map((r) => (
                <div key={r.round} className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-xs">
                  <Badge variant="outline">R{r.round}</Badge>
                  <span className="font-semibold">{r.round_name}</span>
                  <span className="font-mono">{r.blocked}/{r.variants} zablokowane</span>
                  <span className="font-mono">ASR {pct(r.attack_success_rate)}</span>
                  <Badge variant="outline" className={r.passed ? STATUS_STYLE.VERIFIED : STATUS_STYLE.BROKEN}>
                    {r.passed ? 'PASS' : 'FAIL'}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 font-semibold">
                Promotion gate:{' '}
                <Badge variant="outline" className={suite.gate.passed ? STATUS_STYLE.VERIFIED : STATUS_STYLE.BROKEN}>
                  {suite.gate.passed ? 'PASS' : 'BLOCKED'}
                </Badge>
              </p>
              {suite.gate.checks.map((c) => (
                <p key={c.id} className="font-mono text-xs">
                  {c.passed ? '✓' : '✗'} {c.label} — {c.detail}
                </p>
              ))}
              <p className="mt-2 text-xs text-muted-foreground">
                Gate PASS nie aktywuje reguły. Aktywacja pozostaje decyzją administratora.
              </p>
            </div>
          </div>
        ) : null}
      </TabsContent>

      <TabsContent value="shadow" className="mt-4 space-y-2">
        <p className="text-xs text-muted-foreground">
          Reguły w trybie shadow zapisują swoją hipotetyczną decyzję i nigdy nie zmieniają decyzji produkcyjnej.
        </p>
        {shadow.length === 0 ? <p className="text-sm text-muted-foreground">Brak obserwacji.</p> : null}
        {shadow.slice(0, 100).map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-xs">
            <span className="font-mono">{s.rule_key} v{s.rule_version}</span>
            <Badge variant="outline">shadow: {s.shadow_decision}</Badge>
            <Badge variant="outline">prod: {s.production_decision}</Badge>
            {s.would_change ? <Badge variant="outline" className={STATUS_STYLE.BROKEN}>zmieniłaby decyzję</Badge> : null}
            <span className="text-muted-foreground">{new Date(s.created_at).toLocaleString()}</span>
          </div>
        ))}
      </TabsContent>

      <TabsContent value="brain" className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={brainStatus?.brain_connected ? 'border-success/40 text-success' : 'border-muted-foreground/40 text-muted-foreground'}>
            {brainStatus?.brain_connected ? 'ALFA Brain online' : 'Brain lokalny (brak adresu API)'}
          </Badge>
          {brainStatus?.brain_connected && !brainStatus.token_configured ? (
            <Badge variant="outline" className="border-warning/40 text-warning">bez tokenu</Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={runBrain} disabled={!canRun || busy === 'brain' || !ruleKey}>
            {busy === 'brain' ? 'Oceniam…' : 'Oceń kandydata w ALFA Brain'}
          </Button>
          <Button variant="outline" onClick={runTrafficBrain} disabled={!canRun || busy === 'traffic'}>
            {busy === 'traffic' ? 'Analizuję ruch…' : 'Oceń rzeczywisty ruch (F1–F7)'}
          </Button>
          <span className="text-xs text-muted-foreground">
            Brain dostaje wyłącznie agregaty. APPROVE daje maksymalnie NEEDS_REVIEW.
          </span>
        </div>
        {brain ? (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="font-semibold">
              {brain.recommendation} → {brain.resulting_status}{' '}
              <Badge variant="outline">{brain.brain_connected ? 'Brain online' : 'ocena lokalna'}</Badge>
            </p>
            <p className="text-xs text-muted-foreground">{brain.rationale}</p>
            <pre className="max-h-64 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">
              {JSON.stringify(brain.payload, null, 2)}
            </pre>
          </div>
        ) : null}
        {traffic ? (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="font-semibold">
              Ruch produkcyjny: {traffic.recommendation}{' '}
              <Badge variant="outline">{traffic.calls} tool-calli</Badge>{' '}
              <Badge variant="outline">{traffic.brain_connected ? 'Brain online' : 'ocena lokalna'}</Badge>
            </p>
            <p className="text-xs text-muted-foreground">{traffic.rationale}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {FILTERS.map((f) => {
                const row = traffic.payload.filters[f];
                if (!row) return null;
                return (
                  <div key={f} className="flex items-center justify-between rounded border border-border px-2 py-1 font-mono text-[11px]">
                    <span>{f}</span>
                    <span className="text-muted-foreground">
                      {row.calls} wywołań · BLOCK {row.blocked} · HOLD {row.held} · risk {row.avg_risk.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
            <pre className="max-h-64 overflow-auto rounded bg-muted/40 p-2 font-mono text-[11px]">
              {JSON.stringify(traffic.payload, null, 2)}
            </pre>
          </div>
        ) : null}
      </TabsContent>

      <TabsContent value="provider" className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border p-4">
          <p className="font-semibold">Propozycja reguły</p>
          <p className="text-xs text-muted-foreground">
            Zapisywana zawsze jako CANDIDATE i wyłączona. Provider nie może aktywować reguł.
          </p>
          <Input placeholder="rule_key (np. provider_jailbreak_pl)" value={proposal.rule_key}
            onChange={(e) => setProposal({ ...proposal, rule_key: e.target.value })} />
          <Input placeholder="Nazwa" value={proposal.name}
            onChange={(e) => setProposal({ ...proposal, name: e.target.value })} />
          <Textarea placeholder="Opis / uzasadnienie" value={proposal.description}
            onChange={(e) => setProposal({ ...proposal, description: e.target.value })} />
          <div className="flex gap-2">
            <Select value={proposal.filter} onValueChange={(v) => setProposal({ ...proposal, filter: v as FilterId })}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{FILTERS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder="pole (content)" value={proposal.field}
              onChange={(e) => setProposal({ ...proposal, field: e.target.value })} />
            <Input placeholder="op (regex)" value={proposal.op}
              onChange={(e) => setProposal({ ...proposal, op: e.target.value })} />
          </div>
          <Input placeholder="wartość warunku" value={proposal.value}
            onChange={(e) => setProposal({ ...proposal, value: e.target.value })} />
          <Button onClick={submitProposal} disabled={!canContribute || busy === 'propose'}>
            {busy === 'propose' ? 'Wysyłam…' : 'Zgłoś propozycję'}
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-4">
          <p className="font-semibold">Materiał testowy</p>
          <p className="text-xs text-muted-foreground">Przypadek trafia do goldsetu i jest używany w testach regresji.</p>
          <Input placeholder="case_id" value={material.case_id}
            onChange={(e) => setMaterial({ ...material, case_id: e.target.value })} />
          <div className="flex flex-wrap gap-2">
            <Select value={material.goldset} onValueChange={(v) => setMaterial({ ...material, goldset: v })}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['benign', 'malicious', 'ambiguous', 'tool', 'privacy', 'factuality', 'drift', 'adaptive'].map((g) => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={material.filter} onValueChange={(v) => setMaterial({ ...material, filter: v as FilterId })}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>{FILTERS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
            <Select
              value={material.expected_decision}
              onValueChange={(v) => setMaterial({ ...material, expected_decision: v as Decision })}
            >
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['ALLOW', 'WARN', 'HOLD', 'HUMAN_REVIEW', 'BLOCK'].map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Textarea placeholder="Treść wejścia / ataku" value={material.input}
            onChange={(e) => setMaterial({ ...material, input: e.target.value })} />
          <Button onClick={submitMaterial} disabled={!canContribute || busy === 'material'}>
            {busy === 'material' ? 'Zapisuję…' : 'Dostarcz materiał'}
          </Button>
        </div>
        {me?.is_admin ? (
          <div className="space-y-2 rounded-lg border border-primary/40 p-4 lg:col-span-2">
            <p className="font-semibold">Nadanie roli (tylko admin)</p>
            <p className="text-xs text-muted-foreground">
              provider — testuje, proponuje zmiany i dostarcza materiały. guest — wyłącznie podgląd.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input className="w-96" placeholder="user_id (UUID konta)" value={roleForm.user_id}
                onChange={(e) => setRoleForm({ ...roleForm, user_id: e.target.value })} />
              <Select value={roleForm.role} onValueChange={(v) => setRoleForm({ ...roleForm, role: v })}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['admin', 'provider', 'user', 'guest'].map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={assignRole} disabled={busy === 'role' || !roleForm.user_id}>Nadaj rolę</Button>
            </div>
          </div>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
