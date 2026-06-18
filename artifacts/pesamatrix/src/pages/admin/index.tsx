import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import {
  useGetAdminStats,
  useGetAdminSettings,
  useUpdateAdminSettings,
  useListAdminUsers,
  useGetIntegrationStatus,
  useGetSchedulerStatus,
  useTriggerSchedulerRun,
  getGetSchedulerStatusQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Shield, Users, CreditCard, Settings, RefreshCw, TrendingUp, AlertCircle,
  CheckCircle2, Eye, EyeOff, Webhook, Copy, Check, XCircle, Activity,
  Clock, Zap, AlertTriangle, Link2, Link2Off, RotateCcw,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetAdminSettingsQueryKey } from "@workspace/api-client-react";

function StatusRow({ label, ok, optional = false }: { label: string; ok: boolean; optional?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-mono text-muted-foreground truncate">{label}</span>
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-400" />
      ) : optional ? (
        <XCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
      ) : (
        <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
      )}
    </div>
  );
}

function WebhookUrlDisplay() {
  const [copied, setCopied] = useState(false);
  const webhookUrl = `${window.location.origin}/api/webhooks/copyfactory`;

  const copy = () => {
    void navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        <Webhook className="h-4 w-4" /> CopyFactory Webhook URL
      </Label>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md border border-input font-mono truncate text-muted-foreground">
          {webhookUrl}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 h-9 w-9 flex items-center justify-center rounded-md border border-input bg-background hover:bg-muted transition-colors"
          title="Copy URL"
        >
          {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Register this URL as a subscriber/strategy listener in your{" "}
        <a href="https://app.metaapi.cloud" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
          MetaApi CopyFactory
        </a>{" "}
        dashboard. To secure it, set the <code className="bg-muted px-1 rounded">COPYFACTORY_WEBHOOK_SECRET</code> secret and append{" "}
        <code className="bg-muted px-1 rounded">?secret=YOUR_SECRET</code> to the URL above.
      </p>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  color,
  sub,
}: {
  label: string;
  value: string | number | null | undefined;
  icon: React.ElementType;
  color: "blue" | "green" | "orange" | "red" | "purple";
  sub?: string;
}) {
  const colorMap = {
    blue: "bg-blue-600/10 text-blue-400",
    green: "bg-green-600/10 text-green-400",
    orange: "bg-orange-500/10 text-orange-400",
    red: "bg-red-500/10 text-red-400",
    purple: "bg-purple-500/10 text-purple-400",
  };
  return (
    <Card className="border-border">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground leading-tight">{label}</p>
            <p className="text-2xl font-bold text-foreground mt-1">{value ?? "—"}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${colorMap[color]}`}>
            <Icon className="h-4.5 w-4.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SchedulerMonitorTab() {
  const qc = useQueryClient();
  const { data: status, isLoading, refetch } = useGetSchedulerStatus({
    query: { refetchInterval: 15_000 },
  });
  const { mutate: triggerRun, isPending: triggering } = useTriggerSchedulerRun({
    mutation: {
      onSuccess: () => {
        setTimeout(() => void qc.invalidateQueries({ queryKey: getGetSchedulerStatusQueryKey() }), 1500);
      },
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const lastRun = status?.lastRun;
  const hasErrors = (lastRun?.errors?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          {status?.isRunning ? (
            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 flex items-center gap-1.5">
              <RefreshCw className="h-3 w-3 animate-spin" /> Running
            </Badge>
          ) : (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3" /> Idle
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">Schedule: every 30 minutes</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => void refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs bg-blue-600 hover:bg-blue-700"
            disabled={triggering || status?.isRunning}
            onClick={() => triggerRun()}
          >
            <Zap className="h-3.5 w-3.5 mr-1.5" />
            {triggering ? "Triggering..." : "Run Now"}
          </Button>
        </div>
      </div>

      {/* Timing cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Last Run"
          value={timeAgo(status?.lastRunAt)}
          icon={Clock}
          color="blue"
          sub={status?.lastRunAt ? formatDateTime(status.lastRunAt) : undefined}
        />
        <StatTile
          label="Next Scheduled Run"
          value={timeAgo(status?.nextRunAt)}
          icon={RotateCcw}
          color="purple"
          sub={status?.nextRunAt ? formatDateTime(status.nextRunAt) : undefined}
        />
        <StatTile
          label="Active Bindings"
          value={status?.activeBindingsTotal ?? "—"}
          icon={Link2}
          color="green"
          sub="across all subscribers"
        />
        <StatTile
          label="Unbindings Today"
          value={status?.unbindingsToday ?? 0}
          icon={Link2Off}
          color="orange"
          sub="via enforcement runs"
        />
      </div>

      {/* DB subscription counts */}
      <div className="grid grid-cols-3 gap-3">
        <StatTile
          label="Total Subscriptions"
          value={status?.totalSubscriptionsInDb ?? "—"}
          icon={CreditCard}
          color="blue"
        />
        <StatTile
          label="Active Subscribers"
          value={status?.activeSubscriptionsInDb ?? "—"}
          icon={CheckCircle2}
          color="green"
        />
        <StatTile
          label="Expired Subscribers"
          value={status?.expiredSubscriptionsInDb ?? "—"}
          icon={XCircle}
          color="red"
        />
      </div>

      {/* Last run detail */}
      {lastRun ? (
        <Card className={`border-border ${hasErrors ? "border-red-500/30" : ""}`}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {hasErrors ? (
                <AlertTriangle className="h-4 w-4 text-red-400" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-400" />
              )}
              Last Run Detail
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {formatDateTime(lastRun.runAt)} · {formatDuration(lastRun.durationMs)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              {[
                { label: "Checked", value: lastRun.totalChecked, color: "text-foreground" },
                { label: "Active", value: lastRun.totalActive, color: "text-green-400" },
                { label: "Expired", value: lastRun.totalExpired, color: "text-orange-400" },
                { label: "Renewed", value: lastRun.totalRenewed, color: "text-blue-400" },
                { label: "Unbound", value: lastRun.totalUnbound, color: "text-red-400" },
                { label: "Rebound", value: lastRun.totalRebound, color: "text-green-400" },
                { label: "Failures", value: lastRun.totalFailures, color: "text-red-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center p-3 rounded-lg bg-muted/30">
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {hasErrors && (
              <div className="space-y-2 mt-2">
                <p className="text-xs font-semibold text-red-400 uppercase tracking-wide">Worker Errors</p>
                {lastRun.errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 p-2.5 rounded bg-red-500/10 border border-red-500/20">
                    <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-300 font-mono break-all">{err}</p>
                  </div>
                ))}
              </div>
            )}

            {!hasErrors && (
              <div className="flex items-center gap-2 text-xs text-green-400 mt-1">
                <CheckCircle2 className="h-3.5 w-3.5" /> No errors in last run
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No runs recorded yet. The scheduler fires every 30 minutes automatically,
            or click "Run Now" to trigger it manually.
          </CardContent>
        </Card>
      )}

      {/* Recent runs history */}
      {(status?.recentRuns?.length ?? 0) > 1 && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-400" />
              Run History
              <span className="ml-auto text-xs font-normal text-muted-foreground">Last {status!.recentRuns.length} runs</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground uppercase tracking-wide">
                    <th className="text-left py-2 pr-3">Run Time</th>
                    <th className="text-right py-2 pr-3">Checked</th>
                    <th className="text-right py-2 pr-3">Expired</th>
                    <th className="text-right py-2 pr-3">Renewed</th>
                    <th className="text-right py-2 pr-3">Unbound</th>
                    <th className="text-right py-2 pr-3">Rebound</th>
                    <th className="text-right py-2 pr-3">Failures</th>
                    <th className="text-right py-2">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {status!.recentRuns.map((run, i) => (
                    <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
                      <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{formatDateTime(run.runAt)}</td>
                      <td className="py-2 pr-3 text-right text-foreground">{run.totalChecked}</td>
                      <td className={`py-2 pr-3 text-right ${run.totalExpired > 0 ? "text-orange-400" : "text-muted-foreground"}`}>{run.totalExpired}</td>
                      <td className={`py-2 pr-3 text-right ${run.totalRenewed > 0 ? "text-blue-400" : "text-muted-foreground"}`}>{run.totalRenewed}</td>
                      <td className={`py-2 pr-3 text-right ${run.totalUnbound > 0 ? "text-red-400" : "text-muted-foreground"}`}>{run.totalUnbound}</td>
                      <td className={`py-2 pr-3 text-right ${run.totalRebound > 0 ? "text-green-400" : "text-muted-foreground"}`}>{run.totalRebound}</td>
                      <td className={`py-2 pr-3 text-right ${run.totalFailures > 0 ? "text-red-400 font-semibold" : "text-muted-foreground"}`}>{run.totalFailures}</td>
                      <td className="py-2 text-right text-muted-foreground">{formatDuration(run.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Enforcement guarantees */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-green-400" />
            Enforcement Guarantees
          </CardTitle>
          <CardDescription>How the system ensures no expired subscriber can receive copy trades</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                title: "Every subscription scanned",
                desc: "The worker fetches ALL subscriptions from the database on every tick — not just recently modified ones.",
                ok: true,
              },
              {
                title: "Expired → immediately unbound",
                desc: "When endDate passes, bindings are suspended in the DB and an empty subscriptions list is pushed to CopyFactory in the same tick.",
                ok: true,
              },
              {
                title: "Renewed → automatically rebound",
                desc: "If an expired subscription has an endDate in the future (user paid again), bindings are reactivated and CopyFactory is re-synced.",
                ok: true,
              },
              {
                title: "DB is the source of truth",
                desc: "CopyFactory sync is gated on DB binding status. Stale API responses cannot re-enable copying — the DB state is re-applied every tick.",
                ok: true,
              },
              {
                title: "Per-account error isolation",
                desc: "Each subscription and each slave account is processed in its own try/catch. One failure never blocks remaining accounts from being processed.",
                ok: true,
              },
              {
                title: "Runs every 30 minutes",
                desc: "node-cron schedule '*/30 * * * *'. Maximum exposure window for any expired subscriber is 30 minutes.",
                ok: true,
              },
            ].map(({ title, desc, ok }) => (
              <div key={title} className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/10">
                {ok ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (user && user.role !== "admin") navigate("/dashboard");
  }, [user, navigate]);

  const qc = useQueryClient();
  const { data: stats, isLoading: statsLoading } = useGetAdminStats();
  const { data: settings } = useGetAdminSettings();
  const { data: adminUsers, isLoading: usersLoading } = useListAdminUsers();
  const { data: integrationStatus, isLoading: statusLoading } = useGetIntegrationStatus();
  const [dailyFee, setDailyFee] = useState("");
  const [minDays, setMinDays] = useState("");
  const [maxDays, setMaxDays] = useState("");
  const [metaApiToken, setMetaApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (settings) {
      setDailyFee(String(settings.dailyFee ?? 100));
      setMinDays(String(settings.minDays ?? 1));
      setMaxDays(String(settings.maxDays ?? 365));
      setMetaApiToken(settings.metaApiToken ?? "");
    }
  }, [settings]);

  const { mutate: updateSettings } = useUpdateAdminSettings({
    mutation: {
      onSuccess: () => {
        setSaveStatus("saved");
        qc.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
        setTimeout(() => setSaveStatus("idle"), 2000);
      },
      onError: () => setSaveStatus("error"),
    },
  });

  const handleSaveSettings = () => {
    setSaveStatus("saving");
    updateSettings({
      data: {
        dailyFee: parseFloat(dailyFee),
        minDays: parseInt(minDays),
        maxDays: parseInt(maxDays),
        metaApiToken: metaApiToken.trim() || null,
      },
    });
  };

  const statusBadge = (s?: string) => {
    if (s === "active") return "bg-green-500/20 text-green-400 border-green-500/30";
    if (s === "suspended") return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    return "bg-muted/50 text-muted-foreground border-muted";
  };

  const subBadge = (s?: string) => {
    if (s === "active") return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    if (s === "expired") return "bg-red-500/20 text-red-400 border-red-500/30";
    return "bg-muted/50 text-muted-foreground border-muted";
  };

  if (!user || user.role !== "admin") return null;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-green-600/20 flex items-center justify-center">
            <Shield className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Admin Panel</h1>
            <p className="text-sm text-muted-foreground">Manage platform settings and users</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Users", value: stats?.totalUsers, icon: Users, color: "blue" as const },
            { label: "Active Subs", value: stats?.activeSubscriptions, icon: CreditCard, color: "green" as const },
            { label: "Total Revenue (KES)", value: stats?.totalRevenue != null ? `${stats.totalRevenue.toFixed(0)}` : "0", icon: TrendingUp, color: "green" as const },
            { label: "Total Payments", value: stats?.totalPayments, icon: TrendingUp, color: "blue" as const },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="border-border">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-2xl font-bold text-foreground mt-1">
                      {statsLoading ? "—" : value ?? 0}
                    </p>
                  </div>
                  <div className={`h-10 w-10 rounded-lg bg-${color}-600/10 flex items-center justify-center`}>
                    <Icon className={`h-5 w-5 text-${color}-400`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="users" className="space-y-4">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="monitor">Enforcement Monitor</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          {/* Users tab */}
          <TabsContent value="users">
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4 text-blue-400" />
                  All Users
                </CardTitle>
                <CardDescription>Manage platform users and subscriptions</CardDescription>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                          <th className="text-left py-2 pr-4">Name</th>
                          <th className="text-left py-2 pr-4">Email</th>
                          <th className="text-left py-2 pr-4">Phone</th>
                          <th className="text-left py-2 pr-4">Role</th>
                          <th className="text-left py-2 pr-4">Status</th>
                          <th className="text-left py-2 pr-4">Subscription</th>
                          <th className="text-right py-2">Joined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminUsers?.map((u) => (
                          <tr key={u.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                            <td className="py-3 pr-4 font-medium text-foreground">{u.name}</td>
                            <td className="py-3 pr-4 text-muted-foreground">{u.email}</td>
                            <td className="py-3 pr-4 text-muted-foreground">{u.phone}</td>
                            <td className="py-3 pr-4">
                              <Badge className={u.role === "admin" ? "bg-purple-500/20 text-purple-400 border-purple-500/30" : "bg-muted/50 text-muted-foreground"}>
                                {u.role}
                              </Badge>
                            </td>
                            <td className="py-3 pr-4">
                              <Badge className={statusBadge(u.status ?? undefined)}>{u.status}</Badge>
                            </td>
                            <td className="py-3 pr-4">
                              <Badge className={subBadge(u.subscriptionStatus ?? undefined)}>{u.subscriptionStatus ?? "none"}</Badge>
                            </td>
                            <td className="py-3 text-right text-xs text-muted-foreground">
                              {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!adminUsers?.length && (
                      <div className="text-center py-8 text-muted-foreground text-sm">No users found</div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Enforcement Monitor tab */}
          <TabsContent value="monitor">
            <SchedulerMonitorTab />
          </TabsContent>

          {/* Settings tab */}
          <TabsContent value="settings" className="space-y-4">
            {/* Integration Status Card */}
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-blue-400" />
                  Production Integration Status
                </CardTitle>
                <CardDescription>Live status of required environment secrets</CardDescription>
              </CardHeader>
              <CardContent>
                {statusLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <RefreshCw className="h-4 w-4 animate-spin" /> Checking...
                  </div>
                ) : integrationStatus ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Payment mode:</span>
                      {integrationStatus.mode === "live" ? (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Live</Badge>
                      ) : (
                        <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Demo</Badge>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="rounded-lg border border-border p-3 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">MetaApi</p>
                        <StatusRow label="METAAPI_TOKEN" ok={integrationStatus.metaapi.token} />
                      </div>

                      <div className="rounded-lg border border-border p-3 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">M-Pesa</p>
                        <StatusRow label="CONSUMER_KEY" ok={integrationStatus.mpesa.consumerKey} />
                        <StatusRow label="CONSUMER_SECRET" ok={integrationStatus.mpesa.consumerSecret} />
                        <StatusRow label="PASSKEY" ok={integrationStatus.mpesa.passkey} />
                        <StatusRow label="SHORTCODE" ok={integrationStatus.mpesa.shortcode} />
                        <StatusRow label="CALLBACK_URL" ok={integrationStatus.mpesa.callbackUrl} />
                      </div>

                      <div className="rounded-lg border border-border p-3 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Webhook</p>
                        <StatusRow label="WEBHOOK_SECRET" ok={integrationStatus.webhook.secret} optional />
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Add missing secrets in the Replit Secrets tab and restart the API server to activate them.
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  Platform Settings
                </CardTitle>
                <CardDescription>Configure subscription pricing and limits</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 max-w-sm">
                <div className="space-y-2">
                  <Label>Daily Fee (KES)</Label>
                  <Input type="number" min="1" step="1" value={dailyFee} onChange={(e) => setDailyFee(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Amount charged per trading day</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Min Days</Label>
                    <Input type="number" min="1" value={minDays} onChange={(e) => setMinDays(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Max Days</Label>
                    <Input type="number" min="1" max="365" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>MetaApi Token</Label>
                  <div className="relative">
                    <Input
                      type={showToken ? "text" : "password"}
                      placeholder="Paste your MetaApi token here"
                      value={metaApiToken}
                      onChange={(e) => setMetaApiToken(e.target.value)}
                      className="pr-10 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Token stored in the database — server picks it up within 30 seconds, no restart needed.
                    Leave blank to fall back to the <code className="bg-muted px-1 rounded">METAAPI_TOKEN</code> environment variable.
                  </p>
                </div>
                <WebhookUrlDisplay />
                <div className="flex items-center gap-3">
                  <Button onClick={handleSaveSettings} className="bg-green-600 hover:bg-green-700" disabled={saveStatus === "saving"}>
                    {saveStatus === "saving" ? "Saving..." : "Save Settings"}
                  </Button>
                  {saveStatus === "saved" && (
                    <div className="flex items-center gap-1 text-green-400 text-sm">
                      <CheckCircle2 className="h-4 w-4" /> Saved
                    </div>
                  )}
                  {saveStatus === "error" && (
                    <div className="flex items-center gap-1 text-destructive text-sm">
                      <AlertCircle className="h-4 w-4" /> Failed to save
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
