import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  useListSlaveAccounts,
  useCreateSlaveAccount,
  useDeleteSlaveAccount,
  refreshSlaveAccountStatus,
  getListSlaveAccountsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Users, Plus, Trash2, RefreshCw, AlertCircle, Info, KeyRound, Server as ServerIcon, Rocket, Clock as ClockIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { BrokerCombobox, ServerCombobox } from "@/components/broker-combobox";

const SETTLED_STATUSES = new Set(["connected", "disconnected", "failed", "suspended", "pending"]);
const POLL_INTERVAL_MS = 10_000;

function isPolling(status?: string | null): boolean {
  return !SETTLED_STATUSES.has(status ?? "");
}

function StatusBadge({ status }: { status?: string | null }) {
  if (status === "connected") return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Connected</Badge>;
  if (status === "synchronizing") return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Synchronizing</Badge>;
  if (status === "deploying") return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Deploying</Badge>;
  if (status === "connecting") return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Connecting</Badge>;
  if (status === "disconnected") return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Disconnected</Badge>;
  if (status === "failed") return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Failed</Badge>;
  if (status === "suspended") return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Suspended</Badge>;
  if (status === "pending") return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">Pending</Badge>;
  return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">{status ?? "unknown"}</Badge>;
}

function RefreshButton({ accountId }: { accountId: number }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await refreshSlaveAccountStatus(accountId);
      await qc.invalidateQueries({ queryKey: getListSlaveAccountsQueryKey() });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 text-muted-foreground hover:text-blue-400"
      title="Refresh status from MetaApi"
      onClick={() => void handleRefresh()}
      disabled={loading}
    >
      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
    </Button>
  );
}

export default function SlaveAccountsPage() {
  const qc = useQueryClient();
  const { data: accounts, isLoading } = useListSlaveAccounts();
  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ mt5Login: "", tradingPassword: "", server: "", broker: "", platform: "mt5" });
  const [error, setError] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pendingAccounts = (accounts ?? []).filter(
    (acc) => acc.metaapiAccountId && isPolling(acc.status)
  );
  const hasPolling = pendingAccounts.length > 0;

  useEffect(() => {
    if (!hasPolling) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    const tick = async () => {
      const current = (accounts ?? []).filter(
        (acc) => acc.metaapiAccountId && isPolling(acc.status)
      );
      if (current.length === 0) return;
      await Promise.allSettled(current.map((acc) => refreshSlaveAccountStatus(acc.id!)));
      await qc.invalidateQueries({ queryKey: getListSlaveAccountsQueryKey() });
    };

    intervalRef.current = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [hasPolling, accounts, qc]);

  const { mutate: create, isPending: creating } = useCreateSlaveAccount({
    mutation: {
      onSuccess: () => {
        setOpen(false);
        setForm({ mt5Login: "", tradingPassword: "", server: "", broker: "", platform: "mt5" });
        void qc.invalidateQueries({ queryKey: getListSlaveAccountsQueryKey() });
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        setError(e?.data?.error ?? "Failed to create account");
      },
    },
  });

  const { mutate: del } = useDeleteSlaveAccount({
    mutation: {
      onSuccess: () => void qc.invalidateQueries({ queryKey: getListSlaveAccountsQueryKey() }),
    },
  });

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Slave Accounts</h1>
            <p className="text-sm text-muted-foreground mt-1">Follower accounts that copy trades from master accounts</p>
          </div>
          <div className="flex items-center gap-3">
            {hasPolling && (
              <div className="flex items-center gap-1.5 text-xs text-blue-400">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Auto-refreshing
              </div>
            )}
            <Button onClick={() => { setError(""); setOpen(true); }} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" /> Add Slave
            </Button>
          </div>
        </div>

        <Card className="border-blue-600/30 bg-blue-600/5">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-300">
              <Info className="h-4 w-4 shrink-0" />
              How to add a slave account
            </div>
            <ol className="space-y-2.5 pl-1">
              {[
                {
                  icon: KeyRound,
                  title: "Get your trading password",
                  detail: "Log into your broker portal or MT5/MT4 terminal and copy your trading password. This is not the investor's password — slave accounts require the trading password so CopyFactory can open, modify, and close trades on your behalf.",
                },
                {
                  icon: Users,
                  title: "Enter your login number and trading password",
                  detail: "Your login is the account number shown in MT5 (e.g. 12345678). You must use the trading password, not the investor's password — only the trading password gives CopyFactory the write access needed to execute copied trades.",
                },
                {
                  icon: ServerIcon,
                  title: "Select your broker and server",
                  detail: "Start typing your broker name and select the matching server. The server name appears in your MT5 terminal under File → Open Account.",
                },
                {
                  icon: Rocket,
                  title: "Submit — MetaApi deploys the account",
                  detail: "Deployment takes 1–3 minutes. Status auto-refreshes every 10 seconds. Once Connected, you can bind this account to a strategy.",
                },
                {
                  icon: ClockIcon,
                  title: "Accounts are suspended when your subscription expires",
                  detail: "All bindings pause automatically when your plan expires, and resume when you renew.",
                },
              ].map(({ icon: Icon, title, detail }, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="flex items-center gap-2 shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-blue-400 w-4 text-right">{i + 1}.</span>
                    <Icon className="h-3.5 w-3.5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-blue-300">{title}</p>
                    <p className="text-xs text-blue-300/60 mt-0.5">{detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !accounts?.length ? (
          <Card className="border-border">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <Users className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-semibold text-foreground">No slave accounts yet</h3>
              <p className="text-sm text-muted-foreground mt-1">Add accounts that will copy trades</p>
              <Button onClick={() => setOpen(true)} className="mt-4 bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" /> Add Slave Account
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {accounts.map((acc) => {
              const settling = !!acc.metaapiAccountId && isPolling(acc.status);
              return (
                <Card
                  key={acc.id}
                  className={`border-border hover:border-blue-600/30 transition-colors ${settling ? "border-blue-600/20" : ""}`}
                >
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 min-w-0">
                        <div className="h-10 w-10 rounded-lg bg-green-600/10 flex items-center justify-center shrink-0">
                          <Users className="h-5 w-5 text-green-400" />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="font-semibold text-foreground">{((acc as { platform?: string }).platform ?? "MT5").toUpperCase()}: {acc.mt5Login}</p>
                          <p className="text-xs text-muted-foreground">{acc.broker} · {acc.server}</p>
                          {acc.metaapiAccountId ? (
                            <p className="text-xs font-mono text-blue-400 truncate max-w-xs" title={acc.metaapiAccountId}>
                              MetaApi: {acc.metaapiAccountId}
                            </p>
                          ) : acc.status === "pending" ? (
                            <p className="text-xs text-gray-400">Awaiting MetaApi deployment</p>
                          ) : (
                            <p className="text-xs text-red-400">No MetaApi ID — creation failed</p>
                          )}
                          <div className="flex items-center gap-3 pt-1 flex-wrap">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">Status:</span>
                              <StatusBadge status={acc.status} />
                            </div>
                            {acc.deploymentStatus && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Deploy:</span>
                                <span className="text-xs font-mono text-muted-foreground">{acc.deploymentStatus}</span>
                              </div>
                            )}
                            {acc.connectionStatus && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Conn:</span>
                                <span className={`text-xs font-mono ${acc.connectionStatus === "CONNECTED" ? "text-green-400" : "text-orange-400"}`}>
                                  {acc.connectionStatus}
                                </span>
                              </div>
                            )}
                            {(acc as { synchronizationStatus?: string | null }).synchronizationStatus && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">Sync:</span>
                                <span className={`text-xs font-mono ${(acc as { synchronizationStatus?: string | null }).synchronizationStatus === "SYNCHRONIZED" ? "text-green-400" : "text-yellow-400"}`}>
                                  {(acc as { synchronizationStatus?: string | null }).synchronizationStatus}
                                </span>
                              </div>
                            )}
                          </div>
                          {(acc as { lastErrorMessage?: string | null }).lastErrorMessage && (
                            <div className="flex items-start gap-1.5 mt-1">
                              <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                              <p className="text-xs text-red-300">{(acc as { lastErrorMessage?: string | null }).lastErrorMessage}</p>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {acc.metaapiAccountId && <RefreshButton accountId={acc.id!} />}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteId(acc.id!)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle>Add Slave Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" /> {error}
                </div>
              )}
              <div className="space-y-2">
                <Label>Platform</Label>
                <div className="flex rounded-md border border-input overflow-hidden h-9">
                  {(["mt5", "mt4"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setForm({ ...form, platform: p })}
                      className={`flex-1 text-sm font-medium transition-colors ${
                        form.platform === p
                          ? "bg-blue-600 text-white"
                          : "bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      }`}
                    >
                      {p.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>{form.platform === "mt4" ? "MT4" : "MT5"} Login</Label>
                  <Input placeholder="12345678" value={form.mt5Login} onChange={(e) => setForm({ ...form, mt5Login: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Trading Password</Label>
                  <Input type="password" placeholder="••••••••" value={form.tradingPassword} onChange={(e) => setForm({ ...form, tradingPassword: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Broker</Label>
                <BrokerCombobox
                  value={form.broker}
                  onChange={(v) => setForm({ ...form, broker: v })}
                  onServerReset={() => setForm((f) => ({ ...f, server: "" }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Server</Label>
                <ServerCombobox
                  value={form.server}
                  onChange={(v) => setForm({ ...form, server: v })}
                  broker={form.broker}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Submitting creates a real MetaApi account and deploys it. Status will auto-refresh every 10 seconds until connected or disconnected.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                disabled={creating || !form.mt5Login || !form.broker || !form.tradingPassword || !form.server}
                onClick={() => create({ data: { platform: form.platform as "mt4" | "mt5", mt5Login: form.mt5Login, tradingPassword: form.tradingPassword, server: form.server, broker: form.broker } })}
              >
                {creating ? "Creating..." : "Add Account"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent className="bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Slave Account?</AlertDialogTitle>
              <AlertDialogDescription>
                This will undeploy the account from MetaApi and remove it along with all associated bindings. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                onClick={() => { if (deleteId) del({ id: deleteId }); setDeleteId(null); }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppLayout>
  );
}
