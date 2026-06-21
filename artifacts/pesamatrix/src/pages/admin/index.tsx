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
  useListAdminMasterAccounts,
  useApproveMasterAccount,
  useRejectMasterAccount,
  getListAdminMasterAccountsQueryKey,
  useGetBannerSettings,
  useUpdateBannerSettings,
  getGetBannerSettingsQueryKey,
  useGetForexRates,
  getGetForexRatesQueryKey,
  useAdminGenerateResetLink,
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
  Clock, Zap, AlertTriangle, Link2, Link2Off, RotateCcw, Server, ThumbsUp, ThumbsDown, Radio, KeyRound,
  Gift, Plus, Trash2, Pencil,
} from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { getGetAdminSettingsQueryKey } from "@workspace/api-client-react";

const ALL_PAIRS_LIST = ["EUR/USD","GBP/USD","USD/JPY","USD/CHF","AUD/USD","NZD/USD","USD/CAD","EUR/GBP","EUR/JPY","GBP/JPY"];

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
    query: { queryKey: getGetSchedulerStatusQueryKey(), refetchInterval: 15_000 },
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

function MasterApprovalStatusBadge({ status }: { status?: string | null }) {
  switch (status) {
    case "pending_approval":
      return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">Pending Approval</Badge>;
    case "approved":
      return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Approved</Badge>;
    case "deploying":
    case "connecting":
    case "synchronizing":
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">{status.charAt(0).toUpperCase() + status.slice(1)}</Badge>;
    case "deployed":
      return <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">Deployed</Badge>;
    case "strategy_created":
      return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Strategy Created</Badge>;
    case "active":
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Active</Badge>;
    case "suspended":
      return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Suspended</Badge>;
    case "rejected":
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Rejected</Badge>;
    case "failed":
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Failed</Badge>;
    case "disconnected":
      return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Disconnected</Badge>;
    default:
      return <Badge className="bg-muted/50 text-muted-foreground border-muted">{status ?? "unknown"}</Badge>;
  }
}

function MasterApprovalsTab() {
  const qc = useQueryClient();
  const { data: accounts, isLoading, refetch } = useListAdminMasterAccounts();
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState("");

  const { mutate: approve, isPending: approving } = useApproveMasterAccount({
    mutation: {
      onSuccess: () => void qc.invalidateQueries({ queryKey: getListAdminMasterAccountsQueryKey() }),
    },
  });

  const { mutate: reject, isPending: rejecting } = useRejectMasterAccount({
    mutation: {
      onSuccess: () => {
        setRejectId(null);
        setRejectReason("");
        setRejectError("");
        void qc.invalidateQueries({ queryKey: getListAdminMasterAccountsQueryKey() });
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        setRejectError(e?.data?.error ?? "Failed to reject account");
      },
    },
  });

  const pending = (accounts ?? []).filter((a) => a.status === "pending_approval");
  const rest = (accounts ?? []).filter((a) => a.status !== "pending_approval");

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">{pending.length} pending approval</p>
          <p className="text-xs text-muted-foreground">Approve to deploy to MetaApi · Reject with reason to notify user</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Pending accounts — action required */}
      {pending.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-purple-400 uppercase tracking-wide">Awaiting Review</p>
          {pending.map((acc) => (
            <Card key={acc.id} className="border-purple-500/30 bg-purple-500/5">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                      <Server className="h-4.5 w-4.5 text-purple-400" />
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-foreground">MT5: {acc.mt5Login}</p>
                        <MasterApprovalStatusBadge status={acc.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">{acc.broker} · {acc.server}</p>
                      <p className="text-xs text-muted-foreground">
                        Owner: <span className="text-foreground">{acc.userName ?? "—"}</span>
                        {acc.userEmail && <span className="ml-1 text-muted-foreground/70">({acc.userEmail})</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Submitted: {new Date(acc.createdAt!).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-green-600 hover:bg-green-700"
                      disabled={approving}
                      onClick={() => approve({ id: acc.id! })}
                    >
                      <ThumbsUp className="h-3.5 w-3.5 mr-1.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                      onClick={() => { setRejectId(acc.id!); setRejectReason(""); setRejectError(""); }}
                    >
                      <ThumbsDown className="h-3.5 w-3.5 mr-1.5" /> Reject
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-border">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No accounts pending approval.
          </CardContent>
        </Card>
      )}

      {/* All other accounts — history */}
      {rest.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">All Accounts</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wide">
                  <th className="text-left py-2 pr-4">MT5 Login</th>
                  <th className="text-left py-2 pr-4">Broker · Server</th>
                  <th className="text-left py-2 pr-4">Owner</th>
                  <th className="text-left py-2 pr-4">Status</th>
                  <th className="text-left py-2 pr-4">MetaApi ID</th>
                  <th className="text-right py-2">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {rest.map((acc) => (
                  <tr key={acc.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="py-3 pr-4 font-medium text-foreground">{acc.mt5Login}</td>
                    <td className="py-3 pr-4 text-muted-foreground text-xs">{acc.broker} · {acc.server}</td>
                    <td className="py-3 pr-4 text-muted-foreground text-xs">
                      {acc.userName ?? "—"}
                      {acc.userEmail && <span className="block text-muted-foreground/60">{acc.userEmail}</span>}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="space-y-1">
                        <MasterApprovalStatusBadge status={acc.status} />
                        {acc.rejectionReason && (
                          <p className="text-xs text-red-300 max-w-xs">{acc.rejectionReason}</p>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-xs font-mono text-muted-foreground truncate max-w-[160px]">
                      {acc.metaapiAccountId ?? "—"}
                    </td>
                    <td className="py-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(acc.createdAt!).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={rejectId !== null} onOpenChange={() => { setRejectId(null); setRejectReason(""); setRejectError(""); }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Reject Master Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {rejectError && (
              <div className="flex items-center gap-2 p-3 rounded bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" /> {rejectError}
              </div>
            )}
            <div className="space-y-2">
              <Label>Rejection Reason</Label>
              <Textarea
                placeholder="Explain why this account is being rejected..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">This reason will be visible to the account owner.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectId(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              disabled={rejecting || !rejectReason.trim()}
              onClick={() => {
                if (rejectId && rejectReason.trim()) {
                  reject({ id: rejectId, data: { reason: rejectReason.trim() } });
                }
              }}
            >
              {rejecting ? "Rejecting..." : "Reject Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BannerSettingsTab() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useGetBannerSettings({
    query: { queryKey: getGetBannerSettingsQueryKey() },
  });

  type FormState = {
    enabled: boolean;
    displayMode: string;
    backgroundColor: string;
    primaryColor: string;
    secondaryColor: string;
    textColor: string;
    bullishColor: string;
    bearishColor: string;
    fontFamily: string;
    fontSize: number;
    bannerHeight: number;
    tickerSpeed: number;
    refreshRate: number;
    selectedPairs: string[];
  };

  const [form, setForm] = useState<FormState>({
    enabled: true,
    displayMode: "ticker",
    backgroundColor: "#0a0f1e",
    primaryColor: "#2563eb",
    secondaryColor: "#16a34a",
    textColor: "#f1f5f9",
    bullishColor: "#16a34a",
    bearishColor: "#dc2626",
    fontFamily: "Inter",
    fontSize: 13,
    bannerHeight: 48,
    tickerSpeed: 40,
    refreshRate: 10,
    selectedPairs: ALL_PAIRS_LIST,
  });

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (settings) {
      setForm({
        enabled: settings.enabled,
        displayMode: settings.displayMode,
        backgroundColor: settings.backgroundColor,
        primaryColor: settings.primaryColor,
        secondaryColor: settings.secondaryColor,
        textColor: settings.textColor,
        bullishColor: settings.bullishColor,
        bearishColor: settings.bearishColor,
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize,
        bannerHeight: settings.bannerHeight,
        tickerSpeed: settings.tickerSpeed,
        refreshRate: settings.refreshRate,
        selectedPairs: Array.isArray(settings.selectedPairs) ? settings.selectedPairs : ALL_PAIRS_LIST,
      });
    }
  }, [settings]);

  const { data: ratesData } = useGetForexRates({
    query: { queryKey: getGetForexRatesQueryKey(), refetchInterval: 15_000, retry: 1 },
  });

  const SAMPLE_RATES = [
    { pair: "EUR/USD", midPrice: 1.08542, bid: 1.08536, ask: 1.08548, spread: 0.00012, change: 0.00023, changePercent: 0.021, direction: "up" },
    { pair: "GBP/USD", midPrice: 1.26731, bid: 1.26724, ask: 1.26738, spread: 0.00015, change: -0.00156, changePercent: -0.123, direction: "down" },
    { pair: "USD/JPY", midPrice: 149.823, bid: 149.808, ask: 149.838, spread: 0.015, change: 0.234, changePercent: 0.156, direction: "up" },
    { pair: "USD/CHF", midPrice: 0.90124, bid: 0.90106, ask: 0.90142, spread: 0.00018, change: -0.00043, changePercent: -0.048, direction: "down" },
    { pair: "AUD/USD", midPrice: 0.64872, bid: 0.64857, ask: 0.64887, spread: 0.00015, change: 0.00112, changePercent: 0.173, direction: "up" },
    { pair: "NZD/USD", midPrice: 0.59341, bid: 0.59326, ask: 0.59356, spread: 0.00025, change: -0.00074, changePercent: -0.124, direction: "down" },
    { pair: "USD/CAD", midPrice: 1.36218, bid: 1.36198, ask: 1.36238, spread: 0.00020, change: 0.00142, changePercent: 0.104, direction: "up" },
    { pair: "EUR/GBP", midPrice: 0.85682, bid: 0.85664, ask: 0.85700, spread: 0.00018, change: -0.00021, changePercent: -0.024, direction: "down" },
    { pair: "EUR/JPY", midPrice: 162.543, bid: 162.518, ask: 162.568, spread: 0.025, change: 0.312, changePercent: 0.192, direction: "up" },
    { pair: "GBP/JPY", midPrice: 189.721, bid: 189.691, ask: 189.751, spread: 0.030, change: -0.187, changePercent: -0.099, direction: "down" },
  ];

  const allRates = (ratesData?.rates?.length ? ratesData.rates : SAMPLE_RATES) as typeof SAMPLE_RATES;
  const previewRates = allRates.filter((r) => form.selectedPairs.includes(r.pair));

  const { mutate: save } = useUpdateBannerSettings({
    mutation: {
      onSuccess: () => {
        setSaveStatus("saved");
        qc.invalidateQueries({ queryKey: getGetBannerSettingsQueryKey() });
        setTimeout(() => setSaveStatus("idle"), 2000);
      },
      onError: () => setSaveStatus("error"),
    },
  });

  const handleSave = () => {
    setSaveStatus("saving");
    save({ data: form });
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const togglePair = (pair: string) => {
    setForm((prev) => ({
      ...prev,
      selectedPairs: prev.selectedPairs.includes(pair)
        ? prev.selectedPairs.filter((p) => p !== pair)
        : [...prev.selectedPairs, pair],
    }));
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const previewItems = previewRates.length > 0 ? previewRates : SAMPLE_RATES.slice(0, 5);
  const previewDuped = [...previewItems, ...previewItems];

  return (
    <div className="space-y-6">
      {/* Live Preview */}
      <Card className="border-border overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4 w-4 text-blue-400" />
            Live Preview
          </CardTitle>
          <CardDescription>
            Updates instantly as you change settings below
            {!ratesData && <span className="ml-1 text-amber-400/70">(showing sample data)</span>}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {/* Simulated browser chrome */}
          <div className="mx-4 mb-4 rounded-lg overflow-hidden border border-white/10">
            <div className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border-b border-white/10">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500/60" />
              <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/60" />
              <div className="h-2.5 w-2.5 rounded-full bg-green-500/60" />
              <div className="ml-2 flex-1 rounded bg-white/5 px-3 py-0.5 text-[10px] text-white/30 font-mono">
                pesamatrix.app/dashboard
              </div>
            </div>
            {/* Banner preview */}
            {!form.enabled ? (
              <div
                className="flex items-center justify-center text-xs text-white/30 italic"
                style={{ height: 48, backgroundColor: "#0a0f1e" }}
              >
                Banner is disabled — not shown to users
              </div>
            ) : (
              <div
                className="w-full flex items-center border-b border-white/10 overflow-hidden"
                style={{
                  backgroundColor: form.backgroundColor,
                  color: form.textColor,
                  fontFamily: form.fontFamily,
                  height: form.displayMode === "cards" ? "auto" : form.bannerHeight,
                  minHeight: form.displayMode === "cards" ? 110 : form.bannerHeight,
                }}
              >
                {/* Market status badge */}
                <div className="flex items-center gap-1.5 shrink-0 px-3 border-r border-white/10">
                  <span
                    className="h-2 w-2 rounded-full animate-pulse"
                    style={{ backgroundColor: form.bullishColor, boxShadow: `0 0 6px ${form.bullishColor}` }}
                  />
                  <span className="text-[11px] font-semibold tracking-wider whitespace-nowrap" style={{ color: form.bullishColor }}>
                    MARKET OPEN
                  </span>
                </div>

                {form.displayMode === "ticker" && (
                  <div className="overflow-hidden flex-1 flex items-center">
                    <style>{`
                      @keyframes preview-ticker-scroll {
                        0%   { transform: translateX(0); }
                        100% { transform: translateX(-50%); }
                      }
                      .preview-ticker-track {
                        animation: preview-ticker-scroll ${form.tickerSpeed}s linear infinite;
                        will-change: transform;
                      }
                      .preview-ticker-track:hover { animation-play-state: paused; }
                    `}</style>
                    <div className="preview-ticker-track flex items-center">
                      {previewDuped.map((r, i) => {
                        const color = r.direction === "up" ? form.bullishColor : r.direction === "down" ? form.bearishColor : "#9ca3af";
                        const sign = r.changePercent >= 0 ? "+" : "";
                        return (
                          <div
                            key={`${r.pair}-${i}`}
                            className="flex items-center gap-2 px-4 border-r border-white/10"
                            style={{ fontSize: form.fontSize }}
                          >
                            <span className="font-semibold tracking-wide whitespace-nowrap" style={{ color: form.textColor }}>
                              {r.pair}
                            </span>
                            <span className="font-mono font-bold whitespace-nowrap" style={{ color: form.textColor }}>
                              {r.midPrice.toFixed(r.pair.includes("JPY") ? 3 : 5)}
                            </span>
                            <span className="text-[11px] whitespace-nowrap" style={{ color }}>
                              {r.direction === "up" ? "▲" : r.direction === "down" ? "▼" : "–"}
                              {" "}{sign}{r.changePercent.toFixed(2)}%
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {form.displayMode === "compact" && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 flex-1 overflow-hidden">
                    {previewItems.map((r) => {
                      const color = r.direction === "up" ? form.bullishColor : r.direction === "down" ? form.bearishColor : "#9ca3af";
                      return (
                        <span key={r.pair} className="flex items-center gap-1 whitespace-nowrap" style={{ fontSize: form.fontSize }}>
                          <span className="text-xs" style={{ color: form.textColor, opacity: 0.7 }}>{r.pair}</span>
                          <span className="font-mono font-semibold" style={{ color: form.textColor }}>
                            {r.midPrice.toFixed(r.pair.includes("JPY") ? 3 : 5)}
                          </span>
                          <span style={{ color }} className="text-[11px]">
                            {r.direction === "up" ? "▲" : r.direction === "down" ? "▼" : "–"}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                )}

                {form.displayMode === "cards" && (
                  <div className="w-full overflow-x-auto">
                    <div className="flex gap-3 p-3">
                      {previewItems.map((r) => {
                        const color = r.direction === "up" ? form.bullishColor : r.direction === "down" ? form.bearishColor : "#9ca3af";
                        const sign = r.changePercent >= 0 ? "+" : "";
                        return (
                          <div
                            key={r.pair}
                            className="shrink-0 rounded-lg border border-white/10 p-3"
                            style={{ backgroundColor: "rgba(255,255,255,0.05)", minWidth: 130, fontSize: form.fontSize }}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-semibold text-xs tracking-wide" style={{ color: form.textColor }}>{r.pair}</span>
                              <span style={{ color }}>{r.direction === "up" ? "▲" : r.direction === "down" ? "▼" : "–"}</span>
                            </div>
                            <div className="font-mono font-bold text-sm mb-1" style={{ color: form.textColor }}>
                              {r.midPrice.toFixed(r.pair.includes("JPY") ? 3 : 5)}
                            </div>
                            <div className="text-xs font-semibold" style={{ color }}>
                              {sign}{r.changePercent.toFixed(2)}%
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Simulated page content below banner */}
            <div className="flex gap-3 p-4 bg-[#0d1117]">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex-1 h-10 rounded-md bg-white/5 border border-white/5" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className="h-4 w-4 text-blue-400" />
            Banner Status
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Button
            size="sm"
            className={form.enabled ? "bg-green-600 hover:bg-green-700" : "bg-muted hover:bg-muted/80"}
            onClick={() => setField("enabled", true)}
          >
            Enable
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={!form.enabled ? "border-red-500/30 text-red-400 bg-red-500/10" : ""}
            onClick={() => setField("enabled", false)}
          >
            Disable
          </Button>
          <span className="text-sm text-muted-foreground">
            Banner is currently{" "}
            <span className={form.enabled ? "text-green-400" : "text-red-400"}>
              {form.enabled ? "enabled" : "disabled"}
            </span>
          </span>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Display Mode</CardTitle>
          <CardDescription>How the banner is presented to users</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 flex-wrap">
            {[
              { value: "ticker", label: "Scrolling Ticker", desc: "Continuous scrolling pairs strip" },
              { value: "cards", label: "Card View", desc: "Individual pair cards" },
              { value: "compact", label: "Compact View", desc: "Small static header strip" },
            ].map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => setField("displayMode", mode.value)}
                className={`flex-1 min-w-[140px] p-3 rounded-lg border text-left transition-colors ${
                  form.displayMode === mode.value
                    ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                    : "border-border hover:border-muted-foreground/30 text-muted-foreground"
                }`}
              >
                <p className="font-medium text-sm">{mode.label}</p>
                <p className="text-xs mt-0.5 opacity-70">{mode.desc}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Colors</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {(
              [
                { key: "backgroundColor" as const, label: "Background" },
                { key: "textColor" as const, label: "Text Color" },
                { key: "bullishColor" as const, label: "Bullish (Up)" },
                { key: "bearishColor" as const, label: "Bearish (Down)" },
                { key: "primaryColor" as const, label: "Primary Accent" },
                { key: "secondaryColor" as const, label: "Secondary Accent" },
              ] as const
            ).map(({ key, label }) => (
              <div key={key} className="space-y-1.5">
                <Label className="text-xs">{label}</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    className="h-9 w-12 rounded cursor-pointer border border-border bg-transparent p-0.5"
                  />
                  <Input
                    value={form[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    className="font-mono text-xs h-9"
                    maxLength={7}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Typography</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-sm">
          <div className="space-y-2">
            <Label>Font Family</Label>
            <select
              value={form.fontFamily}
              onChange={(e) => setField("fontFamily", e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground"
            >
              {["Inter", "Poppins", "Montserrat", "Roboto", "Open Sans"].map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Font Size — {form.fontSize}px</Label>
            <input
              type="range" min={10} max={20} value={form.fontSize}
              onChange={(e) => setField("fontSize", Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Display Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 max-w-sm">
          <div className="space-y-2">
            <Label>Banner Height — {form.bannerHeight}px</Label>
            <input
              type="range" min={32} max={80} value={form.bannerHeight}
              onChange={(e) => setField("bannerHeight", Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>
          <div className="space-y-2">
            <Label>Ticker Speed — {form.tickerSpeed}s per loop (lower = faster)</Label>
            <input
              type="range" min={15} max={90} value={form.tickerSpeed}
              onChange={(e) => setField("tickerSpeed", Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>
          <div className="space-y-2">
            <Label>Data Refresh Rate — every {form.refreshRate}s</Label>
            <input
              type="range" min={5} max={30} value={form.refreshRate}
              onChange={(e) => setField("refreshRate", Number(e.target.value))}
              className="w-full accent-blue-500"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Forex Pairs</CardTitle>
          <CardDescription>Select which pairs to display on the banner</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {ALL_PAIRS_LIST.map((pair) => {
              const selected = form.selectedPairs.includes(pair);
              return (
                <button
                  key={pair}
                  type="button"
                  onClick={() => togglePair(pair)}
                  className={`px-3 py-1.5 rounded-md text-sm font-mono font-medium border transition-colors ${
                    selected
                      ? "border-blue-500/50 bg-blue-500/20 text-blue-300"
                      : "border-border text-muted-foreground hover:border-muted-foreground/50"
                  }`}
                >
                  {pair}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {form.selectedPairs.length} / {ALL_PAIRS_LIST.length} pairs selected
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          className="bg-green-600 hover:bg-green-700"
          disabled={saveStatus === "saving"}
        >
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
    </div>
  );
}

type ReferralSetting = { id: number; referralsRequired: number; rewardDays: number; isEnabled: boolean };

function ReferralSettingsTab() {
  const [milestones, setMilestones] = useState<ReferralSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ referralsRequired: "", rewardDays: "" });
  const [showAdd, setShowAdd] = useState(false);

  const token = () => localStorage.getItem("token") ?? "";

  async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const res = await fetch(path, {
      ...opts,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}`, ...(opts.headers ?? {}) },
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error((b as { error?: string }).error ?? res.statusText);
    }
    return res.json() as Promise<T>;
  }

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<ReferralSetting[]>("/api/admin/referral-settings");
      setMilestones(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleAdd() {
    const r = parseInt(form.referralsRequired);
    const d = parseInt(form.rewardDays);
    if (isNaN(r) || r < 1 || isNaN(d) || d < 1) { setError("Both fields must be positive numbers"); return; }
    setSaving(true); setError("");
    try {
      await apiFetch("/api/admin/referral-settings", { method: "POST", body: JSON.stringify({ referralsRequired: r, rewardDays: d }) });
      setForm({ referralsRequired: "", rewardDays: "" });
      setShowAdd(false);
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function handleSave(id: number) {
    const m = milestones.find((x) => x.id === id);
    if (!m) return;
    setSaving(true); setError("");
    try {
      const updated = await apiFetch<ReferralSetting>(`/api/admin/referral-settings/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ referralsRequired: parseInt(form.referralsRequired) || m.referralsRequired, rewardDays: parseInt(form.rewardDays) || m.rewardDays }),
      });
      setMilestones((prev) => prev.map((x) => x.id === id ? updated : x));
      setEditId(null);
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function handleToggle(id: number, isEnabled: boolean) {
    try {
      const updated = await apiFetch<ReferralSetting>(`/api/admin/referral-settings/${id}`, { method: "PATCH", body: JSON.stringify({ isEnabled }) });
      setMilestones((prev) => prev.map((x) => x.id === id ? updated : x));
    } catch (e) { setError((e as Error).message); }
  }

  async function handleDelete(id: number) {
    try {
      await apiFetch(`/api/admin/referral-settings/${id}`, { method: "DELETE" });
      setMilestones((prev) => prev.filter((x) => x.id !== id));
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Gift className="h-4 w-4 text-blue-400" />
                Referral Reward Milestones
              </CardTitle>
              <CardDescription className="mt-1">
                When a user reaches a milestone (number of referrals who subscribe), they earn bonus trading days.
              </CardDescription>
            </div>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => { setShowAdd(true); setError(""); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Milestone
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <div className="flex items-center gap-2 p-3 rounded bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          {showAdd && (
            <div className="flex items-end gap-3 p-3 rounded border border-blue-600/30 bg-blue-600/5">
              <div className="space-y-1 flex-1">
                <Label className="text-xs">Referrals Required</Label>
                <Input type="number" min="1" placeholder="e.g. 3" value={form.referralsRequired} onChange={(e) => setForm((f) => ({ ...f, referralsRequired: e.target.value }))} className="h-8" />
              </div>
              <div className="space-y-1 flex-1">
                <Label className="text-xs">Reward Days</Label>
                <Input type="number" min="1" placeholder="e.g. 7" value={form.rewardDays} onChange={(e) => setForm((f) => ({ ...f, rewardDays: e.target.value }))} className="h-8" />
              </div>
              <Button size="sm" className="bg-green-600 hover:bg-green-700 h-8" disabled={saving} onClick={() => void handleAdd()}>Save</Button>
              <Button size="sm" variant="outline" className="h-8" onClick={() => { setShowAdd(false); setForm({ referralsRequired: "", rewardDays: "" }); }}>Cancel</Button>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-6"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : milestones.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No milestones yet. Add one above.</p>
          ) : (
            <div className="space-y-2">
              {milestones.sort((a, b) => a.referralsRequired - b.referralsRequired).map((m) => (
                <div key={m.id} className={`flex items-center gap-3 p-3 rounded border ${m.isEnabled ? "border-border" : "border-border/40 opacity-60"}`}>
                  {editId === m.id ? (
                    <>
                      <div className="flex items-center gap-2 flex-1">
                        <div className="space-y-1">
                          <Label className="text-xs">Referrals</Label>
                          <Input type="number" min="1" defaultValue={m.referralsRequired} onChange={(e) => setForm((f) => ({ ...f, referralsRequired: e.target.value }))} className="h-7 w-20 text-sm" />
                        </div>
                        <span className="text-muted-foreground text-sm mt-4">=</span>
                        <div className="space-y-1">
                          <Label className="text-xs">Reward Days</Label>
                          <Input type="number" min="1" defaultValue={m.rewardDays} onChange={(e) => setForm((f) => ({ ...f, rewardDays: e.target.value }))} className="h-7 w-20 text-sm" />
                        </div>
                      </div>
                      <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 text-xs" disabled={saving} onClick={() => void handleSave(m.id)}>Save</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditId(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      <Gift className="h-4 w-4 text-blue-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {m.referralsRequired} referral{m.referralsRequired !== 1 ? "s" : ""} <span className="text-muted-foreground">→</span> <span className="text-green-400">{m.rewardDays} bonus day{m.rewardDays !== 1 ? "s" : ""}</span>
                        </p>
                      </div>
                      <Badge className={m.isEnabled ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-gray-500/20 text-gray-400 border-gray-500/30"}>
                        {m.isEnabled ? "Active" : "Disabled"}
                      </Badge>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-blue-400" onClick={() => { setEditId(m.id); setForm({ referralsRequired: String(m.referralsRequired), rewardDays: String(m.rewardDays) }); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" title={m.isEnabled ? "Disable" : "Enable"} onClick={() => void handleToggle(m.id, !m.isEnabled)}>
                        {m.isEnabled ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => void handleDelete(m.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">How It Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Each user gets a unique promo code on registration. When a new user signs up using that code and makes their first payment, the referrer earns bonus trading days based on the matching milestone.</p>
          <p>Milestones are checked cumulatively — if a user reaches 3 referrals and the milestone gives 7 days, those 7 days are added to their subscription when the milestone is hit.</p>
          <p>Disable a milestone to stop awarding it without deleting it.</p>
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
  const [expiryWarningDays, setExpiryWarningDays] = useState("3");
  const [metaApiToken, setMetaApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [resetLinkData, setResetLinkData] = useState<{ email: string; link: string } | null>(null);
  const [resetLinkCopied, setResetLinkCopied] = useState(false);

  const { mutate: generateResetLink, isPending: generatingReset } = useAdminGenerateResetLink({
    mutation: {
      onSuccess: (data, variables) => {
        const email = adminUsers?.find((u) => u.id === variables.id)?.email ?? "";
        setResetLinkData({ email, link: data.resetLink ?? "" });
      },
    },
  });

  const copyResetLink = () => {
    if (!resetLinkData) return;
    void navigator.clipboard.writeText(resetLinkData.link);
    setResetLinkCopied(true);
    setTimeout(() => setResetLinkCopied(false), 2000);
  };

  useEffect(() => {
    if (settings) {
      setDailyFee(String(settings.dailyFee ?? 100));
      setMinDays(String(settings.minDays ?? 1));
      setMaxDays(String(settings.maxDays ?? 365));
      setExpiryWarningDays(String(settings.expiryWarningDays ?? 3));
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
        expiryWarningDays: parseInt(expiryWarningDays),
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

        <Tabs defaultValue="approvals" className="space-y-4">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="approvals" className="relative">
              Approvals
              {/* Pending count badge */}
            </TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="monitor">Enforcement Monitor</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="referrals">Referrals</TabsTrigger>
            <TabsTrigger value="banner">Market Banner</TabsTrigger>
          </TabsList>

          {/* Master Approvals tab */}
          <TabsContent value="approvals">
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="h-4 w-4 text-purple-400" />
                  Master Account Approvals
                </CardTitle>
                <CardDescription>Review and approve master MT5 accounts before MetaApi deployment</CardDescription>
              </CardHeader>
              <CardContent>
                <MasterApprovalsTab />
              </CardContent>
            </Card>
          </TabsContent>

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
                          <th className="text-left py-2 pr-4">Joined</th>
                          <th className="text-right py-2">Actions</th>
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
                            <td className="py-3 pr-4 text-xs text-muted-foreground">
                              {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                            </td>
                            <td className="py-3 text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1.5 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                                disabled={generatingReset}
                                onClick={() => generateResetLink({ id: u.id })}
                                title="Generate password reset link"
                              >
                                <KeyRound className="h-3 w-3" />
                                Reset Link
                              </Button>
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
                  <Label>Expiry Warning (days before)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="30"
                    value={expiryWarningDays}
                    onChange={(e) => setExpiryWarningDays(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Send a <code className="bg-muted px-1 rounded">subscription_expiring</code> SMS this many days before a subscription ends.
                    Set to <strong>0</strong> to disable.
                  </p>
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

          {/* Referral Settings tab */}
          <TabsContent value="referrals">
            <ReferralSettingsTab />
          </TabsContent>

          {/* Market Banner tab */}
          <TabsContent value="banner">
            <Card className="border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Radio className="h-4 w-4 text-blue-400" />
                  Market Banner Settings
                </CardTitle>
                <CardDescription>
                  Customize the live forex market ticker displayed across all pages
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BannerSettingsTab />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Reset Link Dialog */}
      <Dialog open={!!resetLinkData} onOpenChange={(open) => { if (!open) { setResetLinkData(null); setResetLinkCopied(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-blue-400" />
              Password Reset Link
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {resetLinkData?.email && (
              <p className="text-sm text-muted-foreground">
                Reset link for <span className="text-foreground font-medium">{resetLinkData.email}</span>
              </p>
            )}
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-mono text-muted-foreground break-all">
                {resetLinkData?.link}
              </div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={copyResetLink}>
                {resetLinkCopied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-amber-400/80">
              <Clock className="h-3.5 w-3.5" />
              This link expires in 1 hour and can only be used once.
            </div>
            <p className="text-xs text-muted-foreground">
              Share this link with the user via WhatsApp, SMS, or email so they can set a new password.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setResetLinkData(null); setResetLinkCopied(false); }}>
              Close
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => { if (resetLinkData) window.open(resetLinkData.link, "_blank"); }}
            >
              Open Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
