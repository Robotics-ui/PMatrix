import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  RefreshCw, ChevronLeft, ClipboardList, Search, CheckCircle2, XCircle,
  Clock, AlertTriangle, Activity, ChevronRight, ArrowRight, User, Shield,
  FileText, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Fetch helpers ─────────────────────────────────────────────────────────────

const token = () => localStorage.getItem("token") ?? "";

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface MasterSummary {
  id: number;
  mt5Login: number;
  broker: string;
  status: string;
  platform: string | null;
  userId: number;
  createdAt: string;
  userEmail: string | null;
  auditEventCount: number;
}

interface AuditLog {
  id: number;
  masterAccountId: number;
  userId: number;
  adminId: number | null;
  adminEmail: string | null;
  event: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  createdAt: string;
}

interface MasterTimeline {
  master: Omit<MasterSummary, "auditEventCount">;
  logs: AuditLog[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  pending_approval: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  approved: "bg-blue-600/10 text-blue-400 border-blue-600/30",
  deploying: "bg-blue-600/10 text-blue-400 border-blue-600/30",
  deployed: "bg-blue-600/10 text-blue-400 border-blue-600/30",
  connected: "bg-green-600/10 text-green-400 border-green-600/30",
  strategy_created: "bg-green-600/10 text-green-400 border-green-600/30",
  active: "bg-green-600/10 text-green-400 border-green-600/30",
  failed: "bg-red-500/10 text-red-400 border-red-500/30",
  rejected: "bg-red-500/10 text-red-400 border-red-500/30",
  suspended: "bg-orange-500/10 text-orange-400 border-orange-500/30",
};

const EVENT_LABELS: Record<string, string> = {
  submitted: "Account Submitted",
  approved: "Approved by Admin",
  rejected: "Rejected by Admin",
  deployment_started: "Deployment Started",
  deployment_success: "Deployed to MetaApi",
  deployment_failed: "Deployment Failed",
  connected: "MetaApi Connected",
  connection_failed: "Connection Failed",
  provider_registered: "Provider Role Registered",
  strategy_created: "Strategy Created",
  first_binding_created: "First Binding Created",
  health_check_passed: "Health Check Passed",
  health_check_failed: "Health Check Failed",
  suspended: "Account Suspended",
  reactivated: "Account Reactivated",
};

const EVENT_ICONS: Record<string, React.ElementType> = {
  submitted: FileText,
  approved: CheckCircle2,
  rejected: XCircle,
  deployment_started: Activity,
  deployment_success: CheckCircle2,
  deployment_failed: XCircle,
  connected: CheckCircle2,
  connection_failed: XCircle,
  provider_registered: CheckCircle2,
  strategy_created: CheckCircle2,
  first_binding_created: CheckCircle2,
  health_check_passed: CheckCircle2,
  health_check_failed: AlertTriangle,
  suspended: AlertTriangle,
  reactivated: CheckCircle2,
};

const EVENT_COLORS: Record<string, string> = {
  submitted: "text-blue-400 bg-blue-600/10 border-blue-600/20",
  approved: "text-green-400 bg-green-600/10 border-green-600/20",
  rejected: "text-red-400 bg-red-500/10 border-red-500/20",
  deployment_started: "text-blue-400 bg-blue-600/10 border-blue-600/20",
  deployment_success: "text-green-400 bg-green-600/10 border-green-600/20",
  deployment_failed: "text-red-400 bg-red-500/10 border-red-500/20",
  connected: "text-green-400 bg-green-600/10 border-green-600/20",
  connection_failed: "text-red-400 bg-red-500/10 border-red-500/20",
  provider_registered: "text-green-400 bg-green-600/10 border-green-600/20",
  strategy_created: "text-green-400 bg-green-600/10 border-green-600/20",
  first_binding_created: "text-green-400 bg-green-600/10 border-green-600/20",
  health_check_passed: "text-green-400 bg-green-600/10 border-green-600/20",
  health_check_failed: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  suspended: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  reactivated: "text-green-400 bg-green-600/10 border-green-600/20",
};

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? "bg-muted/50 text-muted-foreground border-border";
  return (
    <Badge className={cn("text-xs capitalize", cls)}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

// ── Timeline ──────────────────────────────────────────────────────────────────

function TimelineEntry({ log, isLast }: { log: AuditLog; isLast: boolean }) {
  const label = EVENT_LABELS[log.event] ?? log.event.replace(/_/g, " ");
  const Icon = EVENT_ICONS[log.event] ?? Clock;
  const colorCls = EVENT_COLORS[log.event] ?? "text-muted-foreground bg-muted/30 border-border";
  const isFailure = log.event.includes("failed") || log.event === "rejected";

  return (
    <div className="flex gap-3">
      {/* Connector column */}
      <div className="flex flex-col items-center">
        <div className={cn("h-7 w-7 rounded-full border flex items-center justify-center shrink-0", colorCls)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border mt-1 mb-0" />}
      </div>

      {/* Content */}
      <div className={cn("pb-5 flex-1 min-w-0", isLast && "pb-1")}>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <p className={cn("text-sm font-semibold leading-tight", isFailure ? "text-red-400" : "text-foreground")}>
            {label}
          </p>
          <span className="text-xs text-muted-foreground shrink-0 mt-0.5" title={formatDateTime(log.createdAt)}>
            {timeAgo(log.createdAt)}
          </span>
        </div>

        <p className="text-xs text-muted-foreground mt-0.5">{formatDateTime(log.createdAt)}</p>

        {/* Status transition */}
        {(log.fromStatus || log.toStatus) && (
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {log.fromStatus && (
              <Badge className={cn("text-xs capitalize", STATUS_COLORS[log.fromStatus] ?? "bg-muted/50 text-muted-foreground")}>
                {log.fromStatus.replace(/_/g, " ")}
              </Badge>
            )}
            {log.fromStatus && log.toStatus && (
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
            {log.toStatus && (
              <Badge className={cn("text-xs capitalize", STATUS_COLORS[log.toStatus] ?? "bg-muted/50 text-muted-foreground")}>
                {log.toStatus.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
        )}

        {/* Admin note */}
        {log.adminEmail && (
          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
            <Shield className="h-3 w-3 shrink-0" />
            <span className="font-mono">{log.adminEmail}</span>
          </div>
        )}

        {/* Reason / notes */}
        {log.reason && (
          <div className={cn(
            "mt-2 rounded border px-2.5 py-1.5 text-xs leading-snug",
            isFailure
              ? "bg-red-500/5 border-red-500/20 text-red-300"
              : "bg-muted/30 border-border text-muted-foreground"
          )}>
            {log.reason}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Timeline Drawer ───────────────────────────────────────────────────────────

function TimelineDrawer({
  masterId,
  onClose,
}: {
  masterId: number;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery<MasterTimeline>({
    queryKey: ["master-audit-timeline", masterId],
    queryFn: () => apiFetch<MasterTimeline>(`/api/admin/master-audit/${masterId}`),
    staleTime: 30_000,
  });

  const master = data?.master;
  const logs = data?.logs ?? [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-background border-l border-border z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-blue-400 shrink-0" />
              Lifecycle Audit Trail
            </h2>
            {master && (
              <p className="text-xs text-muted-foreground mt-1">
                MT5 #{master.mt5Login} &middot; {master.broker}
                {master.userEmail && (
                  <span className="ml-1.5 text-foreground/70">({master.userEmail})</span>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0 mt-0.5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Master status */}
        {master && (
          <div className="px-5 py-3 bg-muted/20 border-b border-border shrink-0 flex items-center gap-3">
            <StatusBadge status={master.status} />
            <span className="text-xs text-muted-foreground">
              {logs.length} event{logs.length !== 1 ? "s" : ""} recorded
            </span>
            <span className="text-xs text-muted-foreground ml-auto">
              Submitted {timeAgo(master.createdAt)}
            </span>
          </div>
        )}

        {/* Lifecycle milestones */}
        <div className="px-5 py-3 border-b border-border shrink-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Pipeline</p>
          <div className="flex items-center gap-1 flex-wrap">
            {[
              { key: "submitted", label: "Submitted" },
              { key: "deployment_success", label: "Deployed" },
              { key: "connected", label: "Connected" },
              { key: "strategy_created", label: "Strategy" },
              { key: "first_binding_created", label: "Bound" },
            ].map(({ key, label }, i, arr) => {
              const reached = logs.some((l) => l.event === key);
              return (
                <div key={key} className="flex items-center gap-1">
                  <div className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border",
                    reached
                      ? "bg-green-600/10 text-green-400 border-green-600/20"
                      : "bg-muted/30 text-muted-foreground border-border"
                  )}>
                    {reached ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
                    {label}
                  </div>
                  {i < arr.length - 1 && (
                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Timeline scroll area */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading && (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="h-7 w-7 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 bg-muted rounded w-2/3" />
                    <div className="h-2 bg-muted rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {isError && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <XCircle className="h-4 w-4 shrink-0" />
              Failed to load audit timeline.
            </div>
          )}

          {!isLoading && logs.length === 0 && (
            <div className="text-center py-12">
              <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No audit events recorded yet.</p>
            </div>
          )}

          {logs.length > 0 && (
            <div>
              {logs.map((log, i) => (
                <TimelineEntry key={log.id} log={log} isLast={i === logs.length - 1} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Master Row ────────────────────────────────────────────────────────────────

function MasterRow({
  master,
  onSelect,
  isSelected,
}: {
  master: MasterSummary;
  onSelect: () => void;
  isSelected: boolean;
}) {
  const isProblematic = master.status === "failed" || master.status === "rejected";
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left px-4 py-3.5 border-b border-border hover:bg-muted/30 transition-colors flex items-center gap-3",
        isSelected && "bg-blue-600/5 border-l-2 border-l-blue-500",
        isProblematic && "bg-red-500/3"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground font-mono">
            #{master.mt5Login}
          </span>
          <span className="text-xs text-muted-foreground truncate max-w-[120px]">{master.broker}</span>
          <StatusBadge status={master.status} />
        </div>
        <div className="flex items-center gap-3 mt-1">
          {master.userEmail && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground truncate">
              <User className="h-3 w-3 shrink-0" />
              {master.userEmail}
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cn(
          "text-xs font-semibold px-2 py-0.5 rounded-full",
          master.auditEventCount > 0
            ? "bg-blue-600/10 text-blue-400"
            : "bg-muted/50 text-muted-foreground"
        )}>
          {master.auditEventCount} event{master.auditEventCount !== 1 ? "s" : ""}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{timeAgo(master.createdAt)}</div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MasterAuditPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<MasterSummary[]>({
    queryKey: ["master-audit-list"],
    queryFn: () => apiFetch<MasterSummary[]>("/api/admin/master-audit"),
    staleTime: 30_000,
  });

  if (user?.role !== "admin") return null;

  const masters = data ?? [];

  const filtered = masters.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      String(m.mt5Login).includes(q) ||
      m.broker.toLowerCase().includes(q) ||
      m.status.toLowerCase().includes(q) ||
      (m.userEmail ?? "").toLowerCase().includes(q)
    );
  });

  const statusCounts = masters.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/admin">
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <ChevronLeft className="h-4 w-4" />
              Admin
            </button>
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-blue-400" />
            Master Audit Trail
          </h1>
        </div>
        <p className="text-sm text-muted-foreground -mt-3">
          Full lifecycle history for every master account — submitted through deployed, connected, strategy created, and first binding.
        </p>

        {/* Summary chips */}
        {masters.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {masters.length} total &middot;
            </span>
            {Object.entries(statusCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([status, cnt]) => (
                <Badge
                  key={status}
                  className={cn("text-xs capitalize cursor-pointer", STATUS_COLORS[status] ?? "bg-muted/50 text-muted-foreground border-border")}
                  onClick={() => setSearch(search === status ? "" : status)}
                >
                  {status.replace(/_/g, " ")} ({cnt})
                </Badge>
              ))}
          </div>
        )}

        {/* Search + refresh */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by MT5 login, broker, user, status..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
        </div>

        {/* Table card */}
        <Card className="border-border overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto] px-4 py-2 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span>Account</span>
            <span>Events</span>
          </div>

          {isError && (
            <CardContent className="pt-8 pb-8 text-center">
              <XCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
              <p className="text-sm text-red-400">Failed to load master accounts.</p>
            </CardContent>
          )}

          {isLoading && (
            <div className="divide-y divide-border">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="px-4 py-4 animate-pulse flex items-center gap-3">
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded w-1/3" />
                    <div className="h-2.5 bg-muted rounded w-1/2" />
                  </div>
                  <div className="h-5 w-16 bg-muted rounded-full" />
                </div>
              ))}
            </div>
          )}

          {!isLoading && !isError && filtered.length === 0 && (
            <CardContent className="pt-12 pb-12 text-center">
              <ClipboardList className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {search ? "No accounts match your search." : "No master accounts found."}
              </p>
            </CardContent>
          )}

          {filtered.map((master) => (
            <MasterRow
              key={master.id}
              master={master}
              isSelected={selectedId === master.id}
              onSelect={() => setSelectedId(master.id === selectedId ? null : master.id)}
            />
          ))}
        </Card>

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <ClipboardList className="h-3 w-3" />
          Click any row to view the full lifecycle timeline with timestamps and admin notes.
        </p>
      </div>

      {/* Timeline drawer */}
      {selectedId !== null && (
        <TimelineDrawer masterId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </AppLayout>
  );
}
