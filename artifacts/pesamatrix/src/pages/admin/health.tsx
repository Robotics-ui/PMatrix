import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, XCircle, RefreshCw, ChevronLeft, Activity,
  Wifi, ShieldCheck, Zap, Link2, Users, Server, Clock,
  AlertTriangle, Database, Radio, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

type CheckResult = { pass: boolean; detail: string };

type CfAuditData = {
  generatedAt: string;
  result: "PASS" | "FAIL";
  passCount: number;
  failCount: number;
  totalChecks: number;
  checks: {
    masterConnected: CheckResult;
    providerRegistered: CheckResult;
    strategyRegistered: CheckResult;
    activeStrategySet: CheckResult;
    activeStrategyCfIdPresent: CheckResult;
    slaveDeployed: CheckResult;
    subscribersRegistered: CheckResult;
    bindingsPresent: CheckResult;
    bindingsSynced: CheckResult;
    schedulerRunning: CheckResult;
  };
  failures: { check: string; detail: string }[];
};

type DiagnosticsData = {
  summary: {
    masters: Record<string, number>;
    slaves: Record<string, number>;
  };
};

type IntegrationStatus = {
  metaapi: { token: boolean };
  mpesa: {
    consumerKey: boolean;
    consumerSecret: boolean;
    passkey: boolean;
    shortcode: boolean;
    callbackUrl: boolean;
  };
  webhook: { secret: boolean };
  mode: "live" | "demo";
};

// ── Check metadata ─────────────────────────────────────────────────────────────

const CHECK_META: Record<
  keyof CfAuditData["checks"],
  { label: string; icon: React.ComponentType<{ className?: string }>; group: string }
> = {
  masterConnected:         { label: "Master Connected",        icon: Wifi,         group: "Accounts" },
  providerRegistered:      { label: "Provider Registered",     icon: ShieldCheck,  group: "Accounts" },
  strategyRegistered:      { label: "Strategy Has CF ID",      icon: Database,     group: "Strategy" },
  activeStrategySet:       { label: "Active Strategy Set",     icon: Zap,          group: "Strategy" },
  activeStrategyCfIdPresent:{ label: "Active Strategy CF ID",  icon: Radio,        group: "Strategy" },
  slaveDeployed:           { label: "Slave Deployed",          icon: Server,       group: "Slaves" },
  subscribersRegistered:   { label: "Subscribers Registered",  icon: Users,        group: "Slaves" },
  bindingsPresent:         { label: "Bindings Present",        icon: Link2,        group: "Bindings" },
  bindingsSynced:          { label: "Bindings Synced to CF",   icon: Activity,     group: "Bindings" },
  schedulerRunning:        { label: "Scheduler Running",       icon: Clock,        group: "Workers" },
};

const CHECK_ORDER: (keyof CfAuditData["checks"])[] = [
  "masterConnected",
  "providerRegistered",
  "strategyRegistered",
  "activeStrategySet",
  "activeStrategyCfIdPresent",
  "slaveDeployed",
  "subscribersRegistered",
  "bindingsPresent",
  "bindingsSynced",
  "schedulerRunning",
];

const GROUPS = ["Accounts", "Strategy", "Slaves", "Bindings", "Workers"] as const;

// ── apiFetch helper ────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function CheckCard({
  checkKey,
  result,
}: {
  checkKey: keyof CfAuditData["checks"];
  result: CheckResult;
}) {
  const meta = CHECK_META[checkKey];
  const Icon = meta.icon;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4 transition-colors",
        result.pass
          ? "border-green-700/40 bg-green-950/30"
          : "border-red-700/40 bg-red-950/30",
      )}
    >
      <div
        className={cn(
          "mt-0.5 h-8 w-8 shrink-0 rounded-lg flex items-center justify-center",
          result.pass ? "bg-green-600/20 text-green-400" : "bg-red-600/20 text-red-400",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground">{meta.label}</span>
          {result.pass ? (
            <Badge className="bg-green-700/30 text-green-300 border-green-700/40 text-[10px] px-1.5 py-0">
              <CheckCircle2 className="h-3 w-3 mr-1" /> PASS
            </Badge>
          ) : (
            <Badge className="bg-red-700/30 text-red-300 border-red-700/40 text-[10px] px-1.5 py-0">
              <XCircle className="h-3 w-3 mr-1" /> FAIL
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{result.detail}</p>
      </div>
    </div>
  );
}

function SummaryBar({
  passCount,
  totalChecks,
  result,
}: {
  passCount: number;
  totalChecks: number;
  result: "PASS" | "FAIL";
}) {
  const pct = Math.round((passCount / totalChecks) * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            result === "PASS" ? "bg-green-500" : passCount >= totalChecks * 0.7 ? "bg-yellow-500" : "bg-red-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {passCount}/{totalChecks} checks
      </span>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        ok ? "bg-green-500" : "bg-red-500",
      )}
    />
  );
}

function IntegrationStatusCard({ data }: { data: IntegrationStatus }) {
  const mpesaAll =
    data.mpesa.consumerKey &&
    data.mpesa.consumerSecret &&
    data.mpesa.passkey &&
    data.mpesa.shortcode &&
    data.mpesa.callbackUrl;

  const rows: { label: string; ok: boolean }[] = [
    { label: "MetaApi Token",     ok: data.metaapi.token },
    { label: "M-Pesa Consumer Key",   ok: data.mpesa.consumerKey },
    { label: "M-Pesa Consumer Secret",ok: data.mpesa.consumerSecret },
    { label: "M-Pesa Passkey",        ok: data.mpesa.passkey },
    { label: "M-Pesa Shortcode",      ok: data.mpesa.shortcode },
    { label: "M-Pesa Callback URL",   ok: data.mpesa.callbackUrl },
    { label: "Webhook Secret",        ok: data.webhook.secret },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-blue-400" />
          Integration Status
          <Badge
            className={cn(
              "ml-auto text-[10px] px-1.5",
              data.mode === "live"
                ? "bg-green-700/30 text-green-300 border-green-700/40"
                : "bg-yellow-700/30 text-yellow-300 border-yellow-700/40",
            )}
          >
            {data.mode === "live" ? "LIVE" : "DEMO"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(({ label, ok }) => (
          <div key={label} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{label}</span>
            <div className="flex items-center gap-1.5">
              <StatusDot ok={ok} />
              <span className={ok ? "text-green-400" : "text-red-400"}>{ok ? "set" : "missing"}</span>
            </div>
          </div>
        ))}
        {!mpesaAll && (
          <p className="text-[11px] text-yellow-400/80 pt-1">
            M-Pesa running in demo mode — payments are simulated.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DiagnosticsSummaryCard({ data }: { data: DiagnosticsData }) {
  const { masters, slaves } = data.summary;
  const statusColor = (key: string) => {
    if (key === "connected") return "text-green-400";
    if (key === "failed" || key === "rejected") return "text-red-400";
    if (key === "disconnected" || key === "suspended") return "text-yellow-400";
    return "text-muted-foreground";
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-green-400" />
          Account Diagnostics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Masters — total {masters.total ?? 0}
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(masters)
              .filter(([k]) => k !== "total")
              .filter(([, v]) => (v as number) > 0)
              .map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                  <span className={cn("font-medium", statusColor(k))}>{v as number}</span>
                </div>
              ))}
            {Object.entries(masters).filter(([k]) => k !== "total" && (masters[k] as number) > 0).length === 0 && (
              <p className="text-xs text-muted-foreground col-span-2">No masters yet</p>
            )}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Slaves — total {slaves.total ?? 0}
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(slaves)
              .filter(([k]) => k !== "total")
              .filter(([, v]) => (v as number) > 0)
              .map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                  <span className={cn("font-medium", statusColor(k))}>{v as number}</span>
                </div>
              ))}
            {Object.entries(slaves).filter(([k]) => k !== "total" && (slaves[k] as number) > 0).length === 0 && (
              <p className="text-xs text-muted-foreground col-span-2">No slaves yet</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminHealthPage() {
  const { user, token } = useAuth();
  const [cfAudit, setCfAudit] = useState<CfAuditData | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData | null>(null);
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async (silent = false) => {
    if (!token) return;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [audit, diag, integ] = await Promise.all([
        apiFetch<CfAuditData>("/admin/copyfactory-audit", token),
        apiFetch<DiagnosticsData>("/admin/diagnostics", token),
        apiFetch<IntegrationStatus>("/admin/integration-status", token),
      ]);
      setCfAudit(audit);
      setDiagnostics(diag);
      setIntegration(integ);
      setLastFetched(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch health data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(() => fetchAll(true), 30_000);
    return () => clearInterval(id);
  }, [fetchAll]);

  if (user?.role !== "admin") return null;

  const overallOk = cfAudit?.result === "PASS";

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <a
              href="/admin"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Admin
            </a>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm text-foreground">Endpoint Health</span>
          </div>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "h-10 w-10 rounded-xl flex items-center justify-center",
                  loading
                    ? "bg-muted text-muted-foreground"
                    : overallOk
                    ? "bg-green-600/20 text-green-400"
                    : "bg-red-600/20 text-red-400",
                )}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : overallOk ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <XCircle className="h-5 w-5" />
                )}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Endpoint Health</h1>
                <p className="text-xs text-muted-foreground">
                  {loading
                    ? "Fetching..."
                    : cfAudit
                    ? `${cfAudit.passCount}/${cfAudit.totalChecks} checks passing — auto-refreshes every 30 s`
                    : "Failed to load"}
                  {lastFetched && !loading && (
                    <span className="ml-2 opacity-60">
                      Last: {lastFetched.toLocaleTimeString()}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fetchAll(false)}
              disabled={loading || refreshing}
              className="flex items-center gap-1.5"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", (loading || refreshing) && "animate-spin")} />
              Refresh Now
            </Button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-700/40 bg-red-950/30 px-4 py-3 text-sm text-red-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Overall progress bar */}
        {cfAudit && !loading && (
          <Card>
            <CardContent className="pt-5 pb-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">CopyFactory Pipeline</span>
                <Badge
                  className={cn(
                    "text-xs px-2",
                    cfAudit.result === "PASS"
                      ? "bg-green-700/30 text-green-300 border-green-700/40"
                      : "bg-red-700/30 text-red-300 border-red-700/40",
                  )}
                >
                  {cfAudit.result === "PASS" ? (
                    <><CheckCircle2 className="h-3 w-3 mr-1" /> ALL PASS</>
                  ) : (
                    <><XCircle className="h-3 w-3 mr-1" /> {cfAudit.failCount} FAILING</>
                  )}
                </Badge>
              </div>
              <SummaryBar
                passCount={cfAudit.passCount}
                totalChecks={cfAudit.totalChecks}
                result={cfAudit.result}
              />
              {cfAudit.failures.length > 0 && (
                <div className="pt-1 space-y-1">
                  <p className="text-xs font-medium text-red-400">Failing checks:</p>
                  {cfAudit.failures.map((f) => (
                    <div key={f.check} className="flex items-start gap-1.5 text-xs">
                      <XCircle className="h-3 w-3 text-red-400 shrink-0 mt-0.5" />
                      <span>
                        <span className="text-foreground font-medium">
                          {CHECK_META[f.check as keyof CfAuditData["checks"]]?.label ?? f.check}
                        </span>
                        {" — "}
                        <span className="text-muted-foreground">{f.detail}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="h-20 rounded-lg border border-border bg-muted/20 animate-pulse"
              />
            ))}
          </div>
        )}

        {/* CopyFactory checks grid — grouped by section */}
        {cfAudit && !loading && (
          <div className="space-y-5">
            {GROUPS.map((group) => {
              const groupChecks = CHECK_ORDER.filter(
                (k) => CHECK_META[k].group === group,
              );
              return (
                <div key={group}>
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    {group}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {groupChecks.map((k) => (
                      <CheckCard key={k} checkKey={k} result={cfAudit.checks[k]} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Sidebar row — integration + diagnostics */}
        {(integration || diagnostics) && !loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {integration && <IntegrationStatusCard data={integration} />}
            {diagnostics && <DiagnosticsSummaryCard data={diagnostics} />}
          </div>
        )}

        {/* Footer */}
        {cfAudit && !loading && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            Report generated at {new Date(cfAudit.generatedAt).toLocaleString()}
          </p>
        )}
      </div>
    </AppLayout>
  );
}
