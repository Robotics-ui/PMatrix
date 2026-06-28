import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, Activity, CheckCircle2, XCircle, Clock, AlertTriangle,
  RotateCcw, ChevronDown, ChevronUp, Zap, Server, CircleDot,
  List, Trash2, MessageSquare, Database, ChevronLeft, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

const token = () => localStorage.getItem("token") ?? "";

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token()}`,
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type WorkerStatus = "idle" | "running" | "failed" | "restarting";

interface WorkerRun {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  jobsProcessed: number;
  errors: string[];
  success: boolean;
}

interface WorkerState {
  id: string;
  name: string;
  description: string;
  status: WorkerStatus;
  intervalMs: number;
  staleThresholdMs: number;
  registeredAt: string;
  lastTickAt: string | null;
  lastJobCompletedAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  jobsTotal: number;
  jobsSucceeded: number;
  jobsFailed: number;
  restartCount: number;
  maxRestarts: number;
  isStale: boolean;
  recentRuns: WorkerRun[];
}

interface WorkerSummary {
  total: number;
  running: number;
  idle: number;
  failed: number;
  restarting: number;
  stale: number;
}

interface WorkersResponse {
  workers: WorkerState[];
  summary: WorkerSummary;
}

interface QueueJob {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: string;
  lastAttemptAt?: string;
  completedAt?: string;
}

interface QueueStats {
  pending: number;
  running: number;
  completedInHistory: number;
  failedInHistory: number;
  totalProcessed: number;
}

interface QueueSnapshot {
  name: string;
  stats: QueueStats;
  pending: QueueJob[];
  recentHistory: QueueJob[];
}

interface SmsDbStats {
  pending: number;
  sending: number;
  sent: number;
  failed: number;
}

interface SmsDbItem {
  id: number;
  phone: string;
  eventType: string;
  attempts: number;
  lastAttemptAt?: string;
  scheduledFor?: string;
  createdAt: string;
}

interface QueuesResponse {
  queues: QueueSnapshot[];
  smsDbQueue: {
    stats: SmsDbStats;
    pending: SmsDbItem[];
    failed: SmsDbItem[];
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatInterval(ms: number): string {
  if (ms < 60_000) return `${ms / 1000}s`;
  const mins = ms / 60_000;
  if (mins < 60) return `${mins}m`;
  return `${(mins / 60).toFixed(1)}h`;
}

// ── Worker Components ─────────────────────────────────────────────────────────

function StatusBadge({ status, isStale }: { status: WorkerStatus; isStale: boolean }) {
  if (isStale && status === "idle") {
    return (
      <Badge className="bg-orange-500/10 text-orange-400 border-orange-500/30 gap-1">
        <AlertTriangle className="h-3 w-3" />
        Stale
      </Badge>
    );
  }
  const map: Record<WorkerStatus, { label: string; className: string; Icon: React.ElementType }> = {
    idle: { label: "Idle", className: "bg-green-600/10 text-green-400 border-green-600/30", Icon: CheckCircle2 },
    running: { label: "Running", className: "bg-blue-600/10 text-blue-400 border-blue-600/30", Icon: CircleDot },
    failed: { label: "Failed", className: "bg-red-500/10 text-red-400 border-red-500/30", Icon: XCircle },
    restarting: { label: "Restarting", className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30", Icon: RotateCcw },
  };
  const { label, className, Icon } = map[status];
  return (
    <Badge className={cn("gap-1", className)}>
      <Icon className={cn("h-3 w-3", status === "running" && "animate-pulse")} />
      {label}
    </Badge>
  );
}

function SummaryCard({
  label,
  value,
  color,
  Icon,
}: {
  label: string;
  value: number;
  color: "blue" | "green" | "red" | "orange" | "yellow";
  Icon: React.ElementType;
}) {
  const colorMap = {
    blue: "bg-blue-600/10 text-blue-400",
    green: "bg-green-600/10 text-green-400",
    red: "bg-red-500/10 text-red-400",
    orange: "bg-orange-500/10 text-orange-400",
    yellow: "bg-yellow-500/10 text-yellow-400",
  };
  return (
    <Card className="border-border">
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold text-foreground mt-0.5">{value}</p>
          </div>
          <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", colorMap[color])}>
            <Icon className="h-4.5 w-4.5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecentRunsTable({ runs }: { runs: WorkerRun[] }) {
  if (runs.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No runs yet</p>;
  }
  return (
    <div className="space-y-1">
      {runs.slice(0, 10).map((run, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded",
            run.success ? "bg-green-600/5 border border-green-600/10" : "bg-red-500/5 border border-red-500/10"
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            {run.success ? (
              <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
            ) : (
              <XCircle className="h-3 w-3 text-red-400 shrink-0" />
            )}
            <span className="text-muted-foreground truncate">{timeAgo(run.startedAt)}</span>
            {run.errors.length > 0 && (
              <span className="text-red-400 truncate" title={run.errors.join("; ")}>
                {run.errors[0]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
            <span>{run.jobsProcessed} jobs</span>
            <span>{formatDuration(run.durationMs)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkerCard({
  worker,
  onRestart,
  isRestarting,
}: {
  worker: WorkerState;
  onRestart: (id: string) => void;
  isRestarting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isProblematic = worker.status === "failed" || worker.isStale;

  return (
    <Card
      className={cn(
        "border-border transition-colors",
        worker.status === "failed" && "border-red-500/30 bg-red-500/5",
        worker.isStale && worker.status !== "failed" && "border-orange-500/30 bg-orange-500/5"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CardTitle className="text-sm font-semibold text-foreground">{worker.name}</CardTitle>
              <StatusBadge status={worker.status} isStale={worker.isStale} />
            </div>
            <CardDescription className="text-xs mt-1">{worker.description}</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs shrink-0"
            onClick={() => onRestart(worker.id)}
            disabled={isRestarting || worker.status === "running"}
            title="Trigger an immediate run"
          >
            {isRestarting ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw className="h-3 w-3" />
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div className="text-muted-foreground">Interval</div>
          <div className="text-foreground font-mono">{formatInterval(worker.intervalMs)}</div>

          <div className="text-muted-foreground">Last run</div>
          <div className={cn("font-medium", isProblematic ? "text-orange-400" : "text-foreground")}>
            {timeAgo(worker.lastJobCompletedAt)}
          </div>

          <div className="text-muted-foreground">Jobs total</div>
          <div className="text-foreground">{worker.jobsTotal}</div>

          <div className="text-muted-foreground">Success / Failed</div>
          <div className="flex items-center gap-1">
            <span className="text-green-400">{worker.jobsSucceeded}</span>
            <span className="text-muted-foreground">/</span>
            <span className={cn(worker.jobsFailed > 0 ? "text-red-400" : "text-muted-foreground")}>
              {worker.jobsFailed}
            </span>
          </div>

          {worker.consecutiveFailures > 0 && (
            <>
              <div className="text-muted-foreground">Consecutive fails</div>
              <div className="text-red-400 font-semibold">{worker.consecutiveFailures}</div>
            </>
          )}

          {worker.restartCount > 0 && (
            <>
              <div className="text-muted-foreground">Restarts</div>
              <div className="text-yellow-400">{worker.restartCount} / {worker.maxRestarts}</div>
            </>
          )}
        </div>

        {worker.lastError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5 text-xs text-red-400 font-mono break-all">
            {worker.lastError}
          </div>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Recent runs ({worker.recentRuns.length})
        </button>

        {expanded && <RecentRunsTable runs={worker.recentRuns} />}
      </CardContent>
    </Card>
  );
}

// ── Queue Components ──────────────────────────────────────────────────────────

function QueueJobRow({
  job,
  onRetry,
  isRetrying,
}: {
  job: QueueJob;
  onRetry?: (jobId: string) => void;
  isRetrying?: boolean;
}) {
  const isFailed = job.status === "failed";
  const isCompleted = job.status === "completed";
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded",
        isFailed ? "bg-red-500/5 border border-red-500/10" : isCompleted ? "bg-green-600/5 border border-green-600/10" : "bg-muted/30 border border-border"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {isFailed ? (
          <XCircle className="h-3 w-3 text-red-400 shrink-0" />
        ) : isCompleted ? (
          <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
        ) : (
          <Clock className="h-3 w-3 text-blue-400 shrink-0" />
        )}
        <span className="text-foreground truncate font-mono" title={job.id}>{job.name}</span>
        {job.lastError && (
          <span className="text-red-400 truncate hidden sm:inline" title={job.lastError}>— {job.lastError}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-muted-foreground">
          {job.attempts}/{job.maxAttempts} att.
        </span>
        <span className="text-muted-foreground">{timeAgo(job.lastAttemptAt ?? job.createdAt)}</span>
        {isFailed && onRetry && (
          <Button
            size="sm"
            variant="outline"
            className="h-5 px-1.5 text-xs gap-1"
            onClick={() => onRetry(job.id)}
            disabled={isRetrying}
          >
            {isRetrying ? <RefreshCw className="h-2.5 w-2.5 animate-spin" /> : <RotateCcw className="h-2.5 w-2.5" />}
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

function QueueCard({
  queue,
  onClear,
  onRetryJob,
  onRetryAllFailed,
  clearingName,
  retryingJobId,
  retryingAllName,
}: {
  queue: QueueSnapshot;
  onClear: (name: string) => void;
  onRetryJob: (name: string, jobId: string) => void;
  onRetryAllFailed: (name: string) => void;
  clearingName: string | null;
  retryingJobId: string | null;
  retryingAllName: string | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const { stats, pending, recentHistory } = queue;
  const failedHistory = recentHistory.filter((j) => j.status === "failed");
  const hasActivity = stats.pending > 0 || stats.running > 0 || stats.totalProcessed > 0;

  return (
    <Card className={cn("border-border", (stats.failedInHistory > 0) && "border-orange-500/20")}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-mono text-foreground">{queue.name}</CardTitle>
            <div className="flex items-center gap-3 mt-1.5 text-xs">
              <span className="text-blue-400">{stats.pending} pending</span>
              {stats.running > 0 && <span className="text-green-400 animate-pulse">{stats.running} running</span>}
              <span className="text-muted-foreground">{stats.completedInHistory} done</span>
              {stats.failedInHistory > 0 && <span className="text-red-400">{stats.failedInHistory} failed</span>}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {failedHistory.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs gap-1 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10"
                onClick={() => onRetryAllFailed(queue.name)}
                disabled={retryingAllName === queue.name}
                title="Re-trigger all failed jobs"
              >
                {retryingAllName === queue.name ? (
                  <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-2.5 w-2.5" />
                )}
                Retry failed
              </Button>
            )}
            {stats.pending > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs gap-1 text-red-400 border-red-500/30 hover:bg-red-500/10"
                onClick={() => onClear(queue.name)}
                disabled={clearingName === queue.name}
                title="Remove all pending jobs"
              >
                {clearingName === queue.name ? (
                  <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Trash2 className="h-2.5 w-2.5" />
                )}
                Clear
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {hasActivity && (
        <CardContent className="pt-0 space-y-2">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Hide" : "Show"} jobs
          </button>

          {expanded && (
            <div className="space-y-1">
              {pending.length > 0 && (
                <>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-2">Pending</p>
                  {pending.map((job) => (
                    <QueueJobRow key={job.id} job={job} />
                  ))}
                </>
              )}
              {recentHistory.length > 0 && (
                <>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-2">Recent history</p>
                  {recentHistory.slice(0, 15).map((job) => (
                    <QueueJobRow
                      key={job.id}
                      job={job}
                      onRetry={(jobId) => onRetryJob(queue.name, jobId)}
                      isRetrying={retryingJobId === job.id}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </CardContent>
      )}

      {!hasActivity && (
        <CardContent className="pt-0 pb-3">
          <p className="text-xs text-muted-foreground italic">No activity yet — queue is empty.</p>
        </CardContent>
      )}
    </Card>
  );
}

function SmsDbQueueCard({
  smsDb,
  onRetry,
  retryingId,
}: {
  smsDb: QueuesResponse["smsDbQueue"];
  onRetry: (id: number) => void;
  retryingId: number | null;
}) {
  const [expanded, setExpanded] = useState(true);
  const { stats, pending, failed } = smsDb;
  const hasFailed = stats.failed > 0;

  return (
    <Card className={cn("border-border", hasFailed && "border-orange-500/20")}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-mono text-foreground flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-muted-foreground" />
              sms-database-queue
            </CardTitle>
            <div className="flex items-center gap-3 mt-1.5 text-xs">
              <span className="text-blue-400">{stats.pending} pending</span>
              {stats.sending > 0 && <span className="text-green-400">{stats.sending} sending</span>}
              <span className="text-muted-foreground">{stats.sent} sent</span>
              {stats.failed > 0 && <span className="text-red-400">{stats.failed} failed</span>}
            </div>
          </div>
          <Badge variant="outline" className="text-muted-foreground border-border text-xs shrink-0">DB-backed</Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-2">
        {(pending.length > 0 || failed.length > 0) && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Hide" : "Show"} items
          </button>
        )}

        {expanded && (
          <div className="space-y-1">
            {pending.length > 0 && (
              <>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-2">Pending</p>
                {pending.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded bg-muted/30 border border-border">
                    <div className="flex items-center gap-2 min-w-0">
                      <Clock className="h-3 w-3 text-blue-400 shrink-0" />
                      <span className="text-muted-foreground font-mono">{item.phone}</span>
                      <Badge variant="outline" className="text-xs border-border text-muted-foreground">{item.eventType}</Badge>
                    </div>
                    <span className="text-muted-foreground shrink-0">{timeAgo(item.createdAt)}</span>
                  </div>
                ))}
              </>
            )}
            {failed.length > 0 && (
              <>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mt-2">Failed</p>
                {failed.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded bg-red-500/5 border border-red-500/10">
                    <div className="flex items-center gap-2 min-w-0">
                      <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                      <span className="text-muted-foreground font-mono">{item.phone}</span>
                      <Badge variant="outline" className="text-xs border-red-500/30 text-red-400">{item.eventType}</Badge>
                      <span className="text-muted-foreground">{item.attempts} att.</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-muted-foreground">{timeAgo(item.lastAttemptAt ?? item.createdAt)}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-5 px-1.5 text-xs gap-1"
                        onClick={() => onRetry(item.id)}
                        disabled={retryingId === item.id}
                      >
                        {retryingId === item.id ? (
                          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-2.5 w-2.5" />
                        )}
                        Retry
                      </Button>
                    </div>
                  </div>
                ))}
              </>
            )}
            {pending.length === 0 && failed.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No pending or failed SMS items.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function WorkersTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [restartingIds, setRestartingIds] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, dataUpdatedAt } = useQuery<WorkersResponse>({
    queryKey: ["admin-workers"],
    queryFn: () => apiFetch<WorkersResponse>("/api/admin/workers"),
    refetchInterval: 10_000,
  });

  const restartMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/admin/workers/${encodeURIComponent(id)}/restart`, {
        method: "POST",
      }),
    onMutate: (id) => {
      setRestartingIds((prev) => new Set(prev).add(id));
    },
    onSettled: (_, __, id) => {
      setRestartingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    onSuccess: (_, id) => {
      toast({ title: "Worker triggered", description: `Immediate run triggered for ${id}` });
      void qc.invalidateQueries({ queryKey: ["admin-workers"] });
    },
    onError: (err, id) => {
      toast({
        title: "Restart failed",
        description: `Could not restart ${id}: ${err instanceof Error ? err.message : String(err)}`,
        variant: "destructive",
      });
    },
  });

  const summary = data?.summary;
  const workers = data?.workers ?? [];
  const hasAlerts = (summary?.failed ?? 0) > 0 || (summary?.stale ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {dataUpdatedAt > 0 && `Last refreshed: ${timeAgo(new Date(dataUpdatedAt).toISOString())}`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void qc.invalidateQueries({ queryKey: ["admin-workers"] })}
          disabled={isLoading}
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {hasAlerts && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-sm text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            {(summary?.failed ?? 0) > 0 &&
              `${summary!.failed} worker${summary!.failed > 1 ? "s" : ""} failed. `}
            {(summary?.stale ?? 0) > 0 &&
              `${summary!.stale} worker${summary!.stale > 1 ? "s" : ""} stale (no jobs processed within threshold). `}
            Check the cards below and trigger a restart if needed.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard label="Total" value={summary?.total ?? 0} color="blue" Icon={Server} />
        <SummaryCard label="Running" value={summary?.running ?? 0} color="blue" Icon={Activity} />
        <SummaryCard label="Idle" value={summary?.idle ?? 0} color="green" Icon={CheckCircle2} />
        <SummaryCard label="Failed" value={summary?.failed ?? 0} color="red" Icon={XCircle} />
        <SummaryCard label="Restarting" value={summary?.restarting ?? 0} color="yellow" Icon={RotateCcw} />
        <SummaryCard label="Stale" value={summary?.stale ?? 0} color="orange" Icon={AlertTriangle} />
      </div>

      {isError && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-3 flex items-center gap-2 text-red-400 text-sm">
            <XCircle className="h-4 w-4 shrink-0" />
            Failed to load worker status. The API server may be unavailable.
          </CardContent>
        </Card>
      )}

      {isLoading && workers.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="border-border animate-pulse">
              <CardContent className="pt-4 pb-4 h-36" />
            </Card>
          ))}
        </div>
      )}

      {workers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {workers.map((worker) => (
            <WorkerCard
              key={worker.id}
              worker={worker}
              onRestart={(id) => restartMutation.mutate(id)}
              isRestarting={restartingIds.has(worker.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QueuesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [clearingName, setClearingName] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [retryingAllName, setRetryingAllName] = useState<string | null>(null);
  const [retryingSmsId, setRetryingSmsId] = useState<number | null>(null);

  const { data, isLoading, isError, dataUpdatedAt } = useQuery<QueuesResponse>({
    queryKey: ["admin-queues"],
    queryFn: () => apiFetch<QueuesResponse>("/api/admin/queues"),
    refetchInterval: 10_000,
  });

  const clearMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ success: boolean }>(`/api/admin/queues/${encodeURIComponent(name)}/clear`, { method: "POST" }),
    onMutate: (name) => setClearingName(name),
    onSettled: () => setClearingName(null),
    onSuccess: (_, name) => {
      toast({ title: "Queue cleared", description: `Pending jobs removed from "${name}"` });
      void qc.invalidateQueries({ queryKey: ["admin-queues"] });
    },
    onError: (err) => toast({ title: "Clear failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const retryJobMutation = useMutation({
    mutationFn: ({ name, jobId }: { name: string; jobId: string }) =>
      apiFetch<{ success: boolean }>(`/api/admin/queues/${encodeURIComponent(name)}/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" }),
    onMutate: ({ jobId }) => setRetryingJobId(jobId),
    onSettled: () => setRetryingJobId(null),
    onSuccess: () => {
      toast({ title: "Job re-triggered" });
      void qc.invalidateQueries({ queryKey: ["admin-queues"] });
    },
    onError: (err) => toast({ title: "Retry failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const retryAllMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch<{ success: boolean; count: number }>(`/api/admin/queues/${encodeURIComponent(name)}/retry-failed`, { method: "POST" }),
    onMutate: (name) => setRetryingAllName(name),
    onSettled: () => setRetryingAllName(null),
    onSuccess: (res) => {
      toast({ title: "Failed jobs re-triggered", description: `${res.count} job${res.count !== 1 ? "s" : ""} queued for retry` });
      void qc.invalidateQueries({ queryKey: ["admin-queues"] });
    },
    onError: (err) => toast({ title: "Retry failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const retrySmsMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ success: boolean }>(`/api/admin/sms-queue/${id}/retry`, { method: "POST" }),
    onMutate: (id) => setRetryingSmsId(id),
    onSettled: () => setRetryingSmsId(null),
    onSuccess: () => {
      toast({ title: "SMS queued for retry" });
      void qc.invalidateQueries({ queryKey: ["admin-queues"] });
    },
    onError: (err) => toast({ title: "SMS retry failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const queues = data?.queues ?? [];
  const smsDb = data?.smsDbQueue;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {data && `${queues.length} in-memory queue${queues.length !== 1 ? "s" : ""} registered.`}
          {dataUpdatedAt > 0 && ` Last refreshed: ${timeAgo(new Date(dataUpdatedAt).toISOString())}`}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void qc.invalidateQueries({ queryKey: ["admin-queues"] })}
          disabled={isLoading}
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {isError && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-3 flex items-center gap-2 text-red-400 text-sm">
            <XCircle className="h-4 w-4 shrink-0" />
            Failed to load queue status.
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="border-border animate-pulse">
              <CardContent className="pt-4 pb-4 h-24" />
            </Card>
          ))}
        </div>
      )}

      {!isLoading && queues.length === 0 && !smsDb && (
        <Card className="border-border">
          <CardContent className="pt-8 pb-8 text-center">
            <List className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No queues registered yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Queues appear here when workers start. Reconnect accounts to trigger the reconnect queue.
            </p>
          </CardContent>
        </Card>
      )}

      {queues.map((queue) => (
        <QueueCard
          key={queue.name}
          queue={queue}
          onClear={(name) => clearMutation.mutate(name)}
          onRetryJob={(name, jobId) => retryJobMutation.mutate({ name, jobId })}
          onRetryAllFailed={(name) => retryAllMutation.mutate(name)}
          clearingName={clearingName}
          retryingJobId={retryingJobId}
          retryingAllName={retryingAllName}
        />
      ))}

      {smsDb && (
        <SmsDbQueueCard
          smsDb={smsDb}
          onRetry={(id) => retrySmsMutation.mutate(id)}
          retryingId={retryingSmsId}
        />
      )}

      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        <MessageSquare className="h-3 w-3" />
        In-memory queues reset on server restart. The SMS database queue persists across restarts.
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkersDashboardPage() {
  const { user } = useAuth();

  if (user?.role !== "admin") return null;

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 flex-wrap">
          <a
            href="/admin"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Admin
          </a>
          <span className="text-muted-foreground">/</span>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Server className="h-6 w-6 text-blue-400" />
              Worker Dashboard
            </h1>
          </div>
        </div>
        <p className="text-sm text-muted-foreground -mt-3">
          Monitor background workers and inspect in-memory retry queues — view pending/failed jobs, clear queues, or manually re-trigger retries.
        </p>

        <Tabs defaultValue="workers">
          <TabsList className="mb-4">
            <TabsTrigger value="workers" className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Workers
            </TabsTrigger>
            <TabsTrigger value="queues" className="flex items-center gap-1.5">
              <Search className="h-3.5 w-3.5" />
              Retry Queue Inspector
            </TabsTrigger>
          </TabsList>

          <TabsContent value="workers">
            <WorkersTab />
          </TabsContent>

          <TabsContent value="queues">
            <QueuesTab />
          </TabsContent>
        </Tabs>

        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Zap className="h-3 w-3" />
          Auto-refreshes every 10 seconds. Restart triggers an immediate job run — the scheduled interval continues unaffected.
        </div>
      </div>
    </AppLayout>
  );
}
