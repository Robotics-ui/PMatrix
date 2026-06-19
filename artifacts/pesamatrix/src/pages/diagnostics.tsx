import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Server, Users, CheckCircle2, XCircle, AlertTriangle, Loader2, WifiOff, Activity } from "lucide-react";

type AccountRecord = {
  id: number;
  userId: number;
  metaapiAccountId: string | null;
  mt5Login: string;
  broker: string;
  server: string;
  status: string;
  deploymentStatus: string | null;
  connectionStatus: string | null;
  lastCheckedAt: string | null;
  userEmail: string | null;
  rejectionReason?: string | null;
};

type DiagnosticsData = {
  summary: {
    masters: Record<string, number>;
    slaves: Record<string, number>;
  };
  masters: AccountRecord[];
  slaves: AccountRecord[];
};

function StatusBadge({ status }: { status: string }) {
  if (status === "connected") return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Connected</Badge>;
  if (status === "synchronizing") return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Synchronizing</Badge>;
  if (status === "connecting") return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Connecting</Badge>;
  if (status === "deploying") return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Deploying</Badge>;
  if (status === "disconnected") return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Disconnected</Badge>;
  if (status === "failed") return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Failed</Badge>;
  if (status === "suspended") return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Suspended</Badge>;
  if (status === "pending_approval") return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Pending</Badge>;
  if (status === "rejected") return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Rejected</Badge>;
  return <Badge className="bg-muted text-muted-foreground">{status}</Badge>;
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${color}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function formatCheckedAt(ts: string | null): string {
  if (!ts) return "Never";
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return d.toLocaleTimeString();
}

export default function DiagnosticsPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [pollerTriggering, setPollerTriggering] = useState(false);

  const { data, isLoading, error } = useQuery<DiagnosticsData>({
    queryKey: ["diagnostics"],
    queryFn: async () => {
      const res = await fetch("/api/admin/diagnostics", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch diagnostics");
      return res.json() as Promise<DiagnosticsData>;
    },
    refetchInterval: 15_000,
    enabled: !!token,
  });

  const triggerPoller = async () => {
    setPollerTriggering(true);
    try {
      await fetch("/api/admin/poller/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      await new Promise((r) => setTimeout(r, 3000));
      await qc.invalidateQueries({ queryKey: ["diagnostics"] });
    } finally {
      setPollerTriggering(false);
    }
  };

  const s = data?.summary;

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">MetaApi Diagnostics</h1>
            <p className="text-sm text-muted-foreground mt-1">Live connection status for all deployed accounts — auto-refreshes every 15s</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void qc.invalidateQueries({ queryKey: ["diagnostics"] })}
              disabled={isLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-2 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => void triggerPoller()}
              disabled={pollerTriggering}
            >
              {pollerTriggering ? (
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
              ) : (
                <Activity className="h-3.5 w-3.5 mr-2" />
              )}
              Poll Now
            </Button>
          </div>
        </div>

        {error && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="py-3 text-sm text-destructive">
              Failed to load diagnostics. Make sure you are logged in as admin.
            </CardContent>
          </Card>
        )}

        {isLoading && !data && (
          <div className="flex justify-center py-16">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {s && (
          <>
            {/* Master summary */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Server className="h-4 w-4 text-blue-400" />
                <h2 className="font-semibold text-foreground">Master Accounts ({s.masters.total})</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                <StatCard label="Connected" value={s.masters.connected} color="border-green-500/30 bg-green-500/5 text-green-400" />
                <StatCard label="Synchronizing" value={s.masters.synchronizing} color="border-blue-500/30 bg-blue-500/5 text-blue-400" />
                <StatCard label="Connecting" value={s.masters.connecting} color="border-yellow-500/30 bg-yellow-500/5 text-yellow-400" />
                <StatCard label="Deploying" value={s.masters.deploying} color="border-purple-500/30 bg-purple-500/5 text-purple-400" />
                <StatCard label="Disconnected" value={s.masters.disconnected} color="border-orange-500/30 bg-orange-500/5 text-orange-400" />
                <StatCard label="Failed" value={s.masters.failed} color="border-red-500/30 bg-red-500/5 text-red-400" />
                <StatCard label="Pending" value={s.masters.pending_approval} color="border-purple-500/30 bg-purple-500/5 text-purple-400" />
                <StatCard label="Rejected" value={s.masters.rejected} color="border-red-500/30 bg-red-500/5 text-red-400" />
              </div>
            </div>

            {/* Slave summary */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-4 w-4 text-green-400" />
                <h2 className="font-semibold text-foreground">Slave Accounts ({s.slaves.total})</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                <StatCard label="Connected" value={s.slaves.connected} color="border-green-500/30 bg-green-500/5 text-green-400" />
                <StatCard label="Synchronizing" value={s.slaves.synchronizing} color="border-blue-500/30 bg-blue-500/5 text-blue-400" />
                <StatCard label="Connecting" value={s.slaves.connecting} color="border-yellow-500/30 bg-yellow-500/5 text-yellow-400" />
                <StatCard label="Deploying" value={s.slaves.deploying} color="border-purple-500/30 bg-purple-500/5 text-purple-400" />
                <StatCard label="Disconnected" value={s.slaves.disconnected} color="border-orange-500/30 bg-orange-500/5 text-orange-400" />
                <StatCard label="Failed" value={s.slaves.failed} color="border-red-500/30 bg-red-500/5 text-red-400" />
                <StatCard label="Suspended" value={s.slaves.suspended} color="border-orange-500/30 bg-orange-500/5 text-orange-400" />
              </div>
            </div>

            {/* Master accounts table */}
            {data.masters.length > 0 && (
              <Card className="border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Server className="h-4 w-4 text-blue-400" />
                    Master Accounts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wider">
                          <th className="text-left py-2 pr-4">Login</th>
                          <th className="text-left py-2 pr-4">Broker</th>
                          <th className="text-left py-2 pr-4">User</th>
                          <th className="text-left py-2 pr-4">Status</th>
                          <th className="text-left py-2 pr-4">Deploy State</th>
                          <th className="text-left py-2 pr-4">Connection</th>
                          <th className="text-left py-2">Last Checked</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {data.masters.map((a) => (
                          <tr key={a.id} className="hover:bg-muted/20">
                            <td className="py-2 pr-4 font-mono">{a.mt5Login}</td>
                            <td className="py-2 pr-4 text-muted-foreground">{a.broker}</td>
                            <td className="py-2 pr-4 text-muted-foreground truncate max-w-[140px]">{a.userEmail ?? `uid:${a.userId}`}</td>
                            <td className="py-2 pr-4"><StatusBadge status={a.status} /></td>
                            <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{a.deploymentStatus ?? "—"}</td>
                            <td className="py-2 pr-4">
                              {a.connectionStatus ? (
                                <span className={`text-xs font-mono ${a.connectionStatus === "CONNECTED" ? "text-green-400" : "text-orange-400"}`}>
                                  {a.connectionStatus}
                                </span>
                              ) : "—"}
                            </td>
                            <td className="py-2 text-xs text-muted-foreground">{formatCheckedAt(a.lastCheckedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Slave accounts table */}
            {data.slaves.length > 0 && (
              <Card className="border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4 text-green-400" />
                    Slave Accounts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground text-xs uppercase tracking-wider">
                          <th className="text-left py-2 pr-4">Login</th>
                          <th className="text-left py-2 pr-4">Broker</th>
                          <th className="text-left py-2 pr-4">User</th>
                          <th className="text-left py-2 pr-4">Status</th>
                          <th className="text-left py-2 pr-4">Deploy State</th>
                          <th className="text-left py-2 pr-4">Connection</th>
                          <th className="text-left py-2">Last Checked</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {data.slaves.map((a) => (
                          <tr key={a.id} className="hover:bg-muted/20">
                            <td className="py-2 pr-4 font-mono">{a.mt5Login}</td>
                            <td className="py-2 pr-4 text-muted-foreground">{a.broker}</td>
                            <td className="py-2 pr-4 text-muted-foreground truncate max-w-[140px]">{a.userEmail ?? `uid:${a.userId}`}</td>
                            <td className="py-2 pr-4"><StatusBadge status={a.status} /></td>
                            <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{a.deploymentStatus ?? "—"}</td>
                            <td className="py-2 pr-4">
                              {a.connectionStatus ? (
                                <span className={`text-xs font-mono ${a.connectionStatus === "CONNECTED" ? "text-green-400" : "text-orange-400"}`}>
                                  {a.connectionStatus}
                                </span>
                              ) : "—"}
                            </td>
                            <td className="py-2 text-xs text-muted-foreground">{formatCheckedAt(a.lastCheckedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {data.masters.length === 0 && data.slaves.length === 0 && (
              <Card className="border-border">
                <CardContent className="flex flex-col items-center py-12 text-center">
                  <WifiOff className="h-12 w-12 text-muted-foreground/30 mb-4" />
                  <h3 className="font-semibold text-foreground">No accounts deployed yet</h3>
                  <p className="text-sm text-muted-foreground mt-1">Approve master accounts and add slave accounts to see status here</p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
