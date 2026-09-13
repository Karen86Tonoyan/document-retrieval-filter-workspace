// n8n MCP connection panel: lets an operator record the n8n MCP endpoint and the
// AI models routed through it, with every workflow call gated by TAFE F1-F7.
import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Plug, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { tafeApi, type EvaluationResponse } from '@/lib/tafe/api';

const STORAGE_KEY = 'alfa_n8n_mcp_config';

export interface N8nMcpConfig {
  mcpUrl: string;
  webhookUrl: string;
  models: string;
  gateToolCalls: boolean;
  connected: boolean;
}

const DEFAULT_CONFIG: N8nMcpConfig = {
  mcpUrl: '',
  webhookUrl: '',
  models: 'google/gemini-2.5-flash, openai/gpt-5-mini',
  gateToolCalls: true,
  connected: false,
};

function readConfig(): N8nMcpConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<N8nMcpConfig>) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

const STEPS_PL = [
  'W n8n otwórz Settings → MCP access i włącz Enable MCP access (wymaga roli owner/admin).',
  'Skopiuj adres MCP, np. https://twoja-instancja.app.n8n.cloud/mcp-server/http',
  'W każdym workflow, który ma być widoczny, włącz Settings → Available in MCP.',
  'Wklej adres poniżej i zapisz, a następnie dodaj serwer w Lovable: Settings → Connectors.',
  'Modele AI wywoływane przez workflow przechodzą przez bramkę TAFE F1–F7 przed wykonaniem akcji.',
];

const STEPS_EN = [
  'In n8n open Settings → MCP access and enable MCP access (owner/admin role required).',
  'Copy the MCP URL, e.g. https://your-instance.app.n8n.cloud/mcp-server/http',
  'For every workflow you want exposed, enable Settings → Available in MCP.',
  'Paste the URL below, save it, then add the server in Lovable: Settings → Connectors.',
  'AI models invoked by workflows pass the TAFE F1–F7 gate before any action runs.',
];

const BLOCKING: string[] = ['HOLD', 'HUMAN_REVIEW', 'BLOCK'];

export default function TafeN8nPanel({ lang }: { lang: 'pl' | 'en' }) {
  const [config, setConfig] = useState<N8nMcpConfig>(DEFAULT_CONFIG);
  const [payload, setPayload] = useState('{"task":"summarize","input":"Raport tygodniowy"}');
  const [gate, setGate] = useState<EvaluationResponse | null>(null);
  const [runResult, setRunResult] = useState<{ status: 'BLOCKED' | 'EXECUTED' | 'ERROR'; detail: string } | null>(null);
  const [running, setRunning] = useState(false);

  /** TAFE gate: F1-F7 decide BEFORE the workflow (tool-call) is executed. */
  const runWorkflow = async () => {
    const hook = config.webhookUrl.trim();
    if (!/^https:\/\/[^\s]+$/i.test(hook)) {
      toast.error(lang === 'pl' ? 'Podaj poprawny adres HTTPS webhooka n8n.' : 'Enter a valid HTTPS n8n webhook URL.');
      return;
    }
    setRunning(true);
    setGate(null);
    setRunResult(null);
    try {
      const decision = await tafeApi.evaluate('tool', {
        agent: 'n8n-workflow',
        model: config.models.split(',')[0]?.trim() || 'unknown',
        content: payload.slice(0, 8000),
        tool: { name: 'n8n.workflow.execute', operation: 'execute', resource: hook },
        context: { source: 'n8n', mcp_url: config.mcpUrl || null },
      });
      setGate(decision);

      if (config.gateToolCalls && BLOCKING.includes(decision.decision)) {
        setRunResult({
          status: 'BLOCKED',
          detail:
            lang === 'pl'
              ? `Akcja zatrzymana przed tool-callem: ${decision.decision}. ${decision.reason}`
              : `Action stopped before the tool call: ${decision.decision}. ${decision.reason}`,
        });
        toast.error(lang === 'pl' ? `Bramka TAFE: ${decision.decision}` : `TAFE gate: ${decision.decision}`);
        return;
      }

      let body = '';
      try {
        const res = await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        body = (await res.text()).slice(0, 1000);
        setRunResult({ status: res.ok ? 'EXECUTED' : 'ERROR', detail: `HTTP ${res.status} — ${body}` });
        if (res.ok) toast.success(lang === 'pl' ? 'Workflow uruchomiony po przejściu bramki.' : 'Workflow executed after passing the gate.');
        else toast.error(`n8n HTTP ${res.status}`);
      } catch (err) {
        setRunResult({ status: 'ERROR', detail: err instanceof Error ? err.message : String(err) });
        toast.error(lang === 'pl' ? 'Nie udało się wywołać webhooka n8n.' : 'Could not reach the n8n webhook.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd bramki TAFE');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => setConfig(readConfig()), []);

  const save = () => {
    const url = config.mcpUrl.trim();
    if (!/^https:\/\/[^\s]+$/i.test(url)) {
      toast.error(lang === 'pl' ? 'Podaj poprawny adres HTTPS serwera MCP.' : 'Enter a valid HTTPS MCP URL.');
      return;
    }
    const next = { ...config, mcpUrl: url, connected: true };
    setConfig(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    toast.success(lang === 'pl' ? 'Konfiguracja n8n MCP zapisana.' : 'n8n MCP configuration saved.');
  };

  const clear = () => {
    localStorage.removeItem(STORAGE_KEY);
    setConfig(DEFAULT_CONFIG);
    toast.success(lang === 'pl' ? 'Konfiguracja wyczyszczona.' : 'Configuration cleared.');
  };

  const steps = lang === 'pl' ? STEPS_PL : STEPS_EN;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Plug className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-display text-foreground">n8n MCP</h3>
          {config.connected && (
            <Badge variant="outline" className="border-success/40 text-success bg-success/10 font-mono text-[10px]">
              {lang === 'pl' ? 'SKONFIGUROWANE' : 'CONFIGURED'}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {lang === 'pl'
            ? 'Podłącz workflow n8n jako narzędzia agenta. Każde wywołanie modelu i narzędzia przechodzi przez filtry F1–F7.'
            : 'Expose n8n workflows as agent tools. Every model and tool call passes filters F1–F7.'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="n8n-url" className="text-[11px] font-mono uppercase tracking-wider">
              MCP URL
            </Label>
            <Input
              id="n8n-url"
              placeholder="https://your-instance.app.n8n.cloud/mcp-server/http"
              value={config.mcpUrl}
              onChange={(e) => setConfig((c) => ({ ...c, mcpUrl: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n8n-webhook" className="text-[11px] font-mono uppercase tracking-wider">
              {lang === 'pl' ? 'Webhook workflow (test bramki)' : 'Workflow webhook (gate test)'}
            </Label>
            <Input
              id="n8n-webhook"
              placeholder="https://your-instance.app.n8n.cloud/webhook/alfa-test"
              value={config.webhookUrl}
              onChange={(e) => setConfig((c) => ({ ...c, webhookUrl: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="n8n-models" className="text-[11px] font-mono uppercase tracking-wider">
              {lang === 'pl' ? 'Modele AI w workflow' : 'AI models in workflows'}
            </Label>
            <Input
              id="n8n-models"
              placeholder="google/gemini-2.5-flash, openai/gpt-5-mini"
              value={config.models}
              onChange={(e) => setConfig((c) => ({ ...c, models: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p className="text-sm text-foreground">
              {lang === 'pl' ? 'Bramka TAFE przed tool-callem' : 'TAFE gate before tool calls'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {lang === 'pl'
                ? 'BLOCK/HOLD z F1–F7 zatrzymuje wykonanie workflow.'
                : 'BLOCK/HOLD from F1–F7 stops workflow execution.'}
            </p>
          </div>
          <Switch
            checked={config.gateToolCalls}
            onCheckedChange={(v) => setConfig((c) => ({ ...c, gateToolCalls: v }))}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save}>{lang === 'pl' ? 'Zapisz konfigurację' : 'Save configuration'}</Button>
          <Button variant="outline" onClick={clear}>
            {lang === 'pl' ? 'Wyczyść' : 'Clear'}
          </Button>
          <Button variant="ghost" asChild>
            <a href="https://docs.n8n.io/advanced-ai/mcp/accessing-n8n-mcp-server/" target="_blank" rel="noreferrer">
              <ExternalLink className="w-4 h-4 mr-1" />
              {lang === 'pl' ? 'Dokumentacja n8n' : 'n8n docs'}
            </a>
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <Workflow className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-display text-foreground">
            {lang === 'pl' ? 'Kroki podłączenia' : 'Connection steps'}
          </h3>
        </div>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 mt-0.5 text-primary shrink-0" />
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
