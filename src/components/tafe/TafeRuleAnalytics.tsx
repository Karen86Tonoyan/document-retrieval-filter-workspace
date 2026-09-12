// TAFE analytics: F1-F7 rule visualisation, decision impact and quality charts
// (TP / FP / precision / recall) built from regression runs and the audit log.
import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import {
  DECISION_STYLES,
  FILTER_TITLES,
  type AuditRow,
  type Decision,
  type FilterId,
  type RegressionRunRow,
  type RuleRow,
} from '@/lib/tafe/api';

const FILTER_IDS: FilterId[] = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'];
const DECISIONS: Decision[] = ['ALLOW', 'WARN', 'HOLD', 'HUMAN_REVIEW', 'BLOCK'];

const CHART_COLORS = {
  primary: 'hsl(var(--primary))',
  accent: 'hsl(var(--accent))',
  success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))',
  info: 'hsl(var(--info))',
  destructive: 'hsl(var(--destructive))',
  muted: 'hsl(var(--muted-foreground))',
};

const DECISION_COLOR: Record<Decision, string> = {
  ALLOW: CHART_COLORS.success,
  WARN: CHART_COLORS.warning,
  HOLD: CHART_COLORS.info,
  HUMAN_REVIEW: CHART_COLORS.primary,
  BLOCK: CHART_COLORS.destructive,
};

const ACTIVE_STATUSES = ['ACTIVE', 'PROMOTED'];
const SHADOW_STATUSES = ['SHADOW_TEST', 'REGRESSION_TEST', 'VERIFIED', 'NEEDS_REVIEW'];

const tooltipStyle = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '0.5rem',
  fontSize: 12,
};

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <header className="mb-3">
        <h3 className="text-sm font-display text-foreground">{title}</h3>
        {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

interface Props {
  rules: RuleRow[];
  runs: RegressionRunRow[];
  audit: AuditRow[];
  lang: 'pl' | 'en';
}

export default function TafeRuleAnalytics({ rules, runs, audit, lang }: Props) {
  // Rules per filter, split by lifecycle stage.
  const ruleDistribution = useMemo(
    () =>
      FILTER_IDS.map((f) => {
        const inFilter = rules.filter((r) => r.filter === f);
        return {
          filter: f,
          active: inFilter.filter((r) => ACTIVE_STATUSES.includes(r.status)).length,
          shadow: inFilter.filter((r) => SHADOW_STATUSES.includes(r.status)).length,
          candidate: inFilter.filter((r) => ['DETECTED', 'CANDIDATE'].includes(r.status)).length,
        };
      }),
    [rules],
  );

  // Decision impact per filter, from the audit log.
  const decisionImpact = useMemo(
    () =>
      FILTER_IDS.map((f) => {
        const rows = audit.filter((a) => a.filter === f);
        const entry: Record<string, string | number> = { filter: f };
        for (const d of DECISIONS) entry[d] = rows.filter((a) => a.decision === d).length;
        return entry;
      }),
    [audit],
  );

  // Latest regression run per rule → confusion matrix bars.
  const latestRuns = useMemo(() => {
    const seen = new Map<string, RegressionRunRow>();
    for (const r of [...runs].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))) {
      if (!seen.has(r.rule_key)) seen.set(r.rule_key, r);
    }
    return Array.from(seen.values()).slice(0, 12);
  }, [runs]);

  const confusion = useMemo(
    () =>
      latestRuns.map((r) => ({
        rule: r.rule_key.length > 14 ? `${r.rule_key.slice(0, 13)}…` : r.rule_key,
        TP: r.tp,
        FP: r.fp,
        FN: r.fn,
        TN: r.tn,
      })),
    [latestRuns],
  );

  const quality = useMemo(
    () =>
      [...runs]
        .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
        .slice(-30)
        .map((r) => ({
          label: new Date(r.created_at).toLocaleDateString(lang === 'pl' ? 'pl-PL' : 'en-GB', {
            day: '2-digit',
            month: '2-digit',
          }),
          precision: Number(r.precision),
          recall: Number(r.recall),
          f1: Number(r.f1),
        })),
    [runs, lang],
  );

  const totals = useMemo(() => {
    const acc = latestRuns.reduce(
      (a, r) => ({ tp: a.tp + r.tp, fp: a.fp + r.fp, fn: a.fn + r.fn, tn: a.tn + r.tn }),
      { tp: 0, fp: 0, fn: 0, tn: 0 },
    );
    const precision = acc.tp + acc.fp ? acc.tp / (acc.tp + acc.fp) : 0;
    const recall = acc.tp + acc.fn ? acc.tp / (acc.tp + acc.fn) : 0;
    return { ...acc, precision, recall };
  }, [latestRuns]);

  const hasRuns = latestRuns.length > 0;
  const hasAudit = audit.length > 0;
  const empty = lang === 'pl' ? 'Brak danych — uruchom testy regresji.' : 'No data — run regression tests.';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {[
          ['TP', totals.tp, 'text-success'],
          ['FP', totals.fp, 'text-destructive'],
          ['FN', totals.fn, 'text-warning'],
          ['TN', totals.tn, 'text-info'],
          ['PRECISION', totals.precision.toFixed(3), 'text-primary'],
          ['RECALL', totals.recall.toFixed(3), 'text-primary'],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className={`mt-1 text-2xl font-display ${tone}`}>{value}</p>
          </div>
        ))}
      </div>

      <Panel
        title={lang === 'pl' ? 'Reguły w filtrach F1–F7' : 'Rules across F1–F7'}
        subtitle={lang === 'pl' ? 'Aktywne, w trybie cienia i kandydujące.' : 'Active, shadow and candidate rules.'}
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={ruleDistribution}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="filter" stroke={CHART_COLORS.muted} fontSize={12} />
            <YAxis allowDecimals={false} stroke={CHART_COLORS.muted} fontSize={12} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="active" name="ACTIVE" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} />
            <Bar dataKey="shadow" name="SHADOW" fill={CHART_COLORS.info} radius={[4, 4, 0, 0]} />
            <Bar dataKey="candidate" name="CANDIDATE" fill={CHART_COLORS.warning} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel
        title={lang === 'pl' ? 'Wpływ filtrów na decyzje' : 'Filter impact on decisions'}
        subtitle={lang === 'pl' ? 'Decyzje zapisane w dzienniku audytu per filtr.' : 'Audited decisions per filter.'}
      >
        {hasAudit ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={decisionImpact} stackOffset="expand">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="filter" stroke={CHART_COLORS.muted} fontSize={12} />
              <YAxis stroke={CHART_COLORS.muted} fontSize={12} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {DECISIONS.map((d) => (
                <Bar key={d} dataKey={d} stackId="dec" fill={DECISION_COLOR[d]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground">
            {lang === 'pl' ? 'Brak wpisów audytu.' : 'No audit entries yet.'}
          </p>
        )}
      </Panel>

      <Panel
        title={lang === 'pl' ? 'Macierz pomyłek per reguła' : 'Confusion matrix per rule'}
        subtitle={lang === 'pl' ? 'Ostatni przebieg regresji każdej reguły.' : 'Latest regression run of each rule.'}
      >
        {hasRuns ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={confusion}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="rule" stroke={CHART_COLORS.muted} fontSize={11} interval={0} angle={-20} height={60} textAnchor="end" />
              <YAxis allowDecimals={false} stroke={CHART_COLORS.muted} fontSize={12} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="TP" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} />
              <Bar dataKey="FP" fill={CHART_COLORS.destructive} radius={[4, 4, 0, 0]} />
              <Bar dataKey="FN" fill={CHART_COLORS.warning} radius={[4, 4, 0, 0]} />
              <Bar dataKey="TN" fill={CHART_COLORS.info} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
      </Panel>

      <Panel
        title={lang === 'pl' ? 'Precision / Recall / F1 w czasie' : 'Precision / Recall / F1 over time'}
        subtitle={lang === 'pl' ? 'Ostatnie 30 przebiegów regresji.' : 'Last 30 regression runs.'}
      >
        {quality.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={quality}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" stroke={CHART_COLORS.muted} fontSize={12} />
              <YAxis domain={[0, 1]} stroke={CHART_COLORS.muted} fontSize={12} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="precision" stroke={CHART_COLORS.primary} dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="recall" stroke={CHART_COLORS.accent} dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="f1" stroke={CHART_COLORS.info} dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground">{empty}</p>
        )}
      </Panel>

      <Panel
        title={lang === 'pl' ? 'Reguły i ich decyzja końcowa' : 'Rules and their enforced decision'}
        subtitle={lang === 'pl' ? 'Każda reguła, jej filtr, severity i wymuszana decyzja.' : 'Each rule with its filter, severity and enforced decision.'}
      >
        {rules.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-muted-foreground font-mono uppercase tracking-wider">
                <tr className="text-left">
                  <th className="py-2 pr-3">Rule</th>
                  <th className="py-2 pr-3">Filter</th>
                  <th className="py-2 pr-3">Severity</th>
                  <th className="py-2 pr-3">Decision</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">v</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="py-2 pr-3 font-mono">{r.rule_key}</td>
                    <td className="py-2 pr-3">
                      <span className="font-mono">{r.filter}</span>{' '}
                      <span className="text-muted-foreground">{FILTER_TITLES[r.filter]?.[lang]}</span>
                    </td>
                    <td className="py-2 pr-3 font-mono">{r.severity}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className={`font-mono text-[10px] ${DECISION_STYLES[r.action]}`}>
                        {r.action}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 font-mono text-muted-foreground">{r.status}</td>
                    <td className="py-2 pr-3 font-mono text-muted-foreground">{r.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{lang === 'pl' ? 'Brak reguł.' : 'No rules yet.'}</p>
        )}
      </Panel>
    </div>
  );
}
