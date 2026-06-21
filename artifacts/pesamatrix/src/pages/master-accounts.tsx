import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  useListMasterAccounts,
  useCreateMasterAccount,
  useDeleteMasterAccount,
  refreshMasterAccountStatus,
  getListMasterAccountsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Server, Plus, Trash2, RefreshCw, AlertCircle, Clock, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { BrokerCombobox, ServerCombobox } from "@/components/broker-combobox";

const SETTLED_STATUSES = new Set([
  "pending_approval",
  "approved",
  "deployed",
  "strategy_created",
  "active",
  "suspended",
  "failed",
  "rejected",
  "disconnected",
  "pending",
]);

const POLL_INTERVAL_MS = 10_000;

function isPolling(status?: string | null): boolean {
  return !SETTLED_STATUSES.has(status ?? "");
}

function StatusBadge({ status }: { status?: string | null }) {
  switch (status) {
    case "pending_approval":
      return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">Pending Approval</Badge>;
    case "approved":
      return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Approved</Badge>;
    case "deploying":
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Deploying</Badge>;
    case "connecting":
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Connecting</Badge>;
    case "synchronizing":
      return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Synchronizing</Badge>;
    case "deployed":
      return <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">Deployed</Badge>;
    case "strategy_created":
      return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Strategy Created</Badge>;
    case "active":
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Active</Badge>;
    case "suspended":
      return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Suspended</Badge>;
    case "failed":
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Failed</Badge>;
    case "rejected":
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Rejected</Badge>;
    case "disconnected":
      return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Disconnected</Badge>;
    case "pending":
      return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">Pending</Badge>;
    default:
      return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">{status ?? "Unknown"}</Badge>;
  }
}

function RefreshButton({ accountId }: { accountId: number }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await refreshMasterAccountStatus(accountId);
      await qc.invalidateQueries({ queryKey: getListMasterAccountsQueryKey() });
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

export default function MasterAccountsPage() {
  const qc = useQueryClient();
  const { data: accounts, isLoading } = useListMasterAccounts();
  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ mt5Login: "", investorPassword: "", server: "", broker: "", platform: "mt5" });
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
      await Promise.allSettled(current.map((acc) => refreshMasterAccountStatus(acc.id!)));
      await qc.invalidateQueries({ queryKey: getListMasterAccountsQueryKey() });
    };

    intervalRef.current = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [hasPolling, accounts, qc]);

  const { mutate: create, isPending: creating } = useCreateMasterAccount({
    mutation: {
      onSuccess: () => {
        setOpen(false);
        setForm({ mt5Login: "", investorPassword: "", server: "", broker: "", platform: "mt5" });
        void qc.invalidateQueries({ queryKey: getListMasterAccountsQueryKey() });
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        setError(e?.data?.error ?? "Failed to create account");
      },
    },
  });

  const { mutate: del } = useDeleteMasterAccount({
    mutation: {
      onSuccess: () => void qc.invalidateQueries({ queryKey: getListMasterAccountsQueryKey() }),
    },
  });

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Master Accounts</h1>
            <p className="text-sm text-muted-foreground mt-1">Signal provider MT5 accounts — require admin approval before deployment</p>
          </div>
          <div className="flex items-center gap-3">
            {hasPolling && (
              <div className="flex items-center gap-1.5 text-xs text-blue-400">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Auto-refreshing
              </div>
            )}
            <Button onClick={() => { setError(""); setOpen(true); }} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" /> Add Master
            </Button>
          </div>
        </div>

        <Card className="border-purple-500/20 bg-purple-500/5">
          <CardContent className="py-3">
            <div className="flex items-start gap-2 text-sm text-purple-300">
              <Clock className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Master accounts go through a lifecycle: Pending Approval → Approved → Deploying → Deployed → Strategy Created → Active.
                Only <span className="font-semibold text-green-400">Active</span> accounts can accept subscribers.
              </p>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !accounts?.length ? (
          <Card className="border-border">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <Server className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-semibold text-foreground">No master accounts yet</h3>
              <p className="text-sm text-muted-foreground mt-1">Submit your first master account for admin review</p>
              <Button onClick={() => setOpen(true)} className="mt-4 bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" /> Add Master Account
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {accounts.map((acc) => {
              const settling = !!acc.metaapiAccountId && isPolling(acc.status);
              const isPendingApproval = acc.status === "pending_approval";
              const isRejected = acc.status === "rejected";
              const isActive = acc.status === "active";
              const isSuspended = acc.status === "suspended";
              return (
                <Card
                  key={acc.id}
                  className={`border-border transition-colors ${
                    isActive ? "border-green-500/20 hover:border-green-500/30" :
                    isSuspended ? "border-orange-500/20 hover:border-orange-500/30" :
                    settling ? "border-blue-600/20 hover:border-blue-600/30" :
                    isPendingApproval ? "border-gray-500/20 hover:border-gray-500/30" :
                    isRejected ? "border-red-500/20 hover:border-red-500/30" :
                    "hover:border-blue-600/30"
                  }`}
                >
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 min-w-0">
                        <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                          isActive ? "bg-green-500/10" :
                          isSuspended ? "bg-orange-500/10" :
                          isPendingApproval ? "bg-gray-500/10" :
                          isRejected ? "bg-red-500/10" :
                          "bg-blue-600/10"
                        }`}>
                          <Server className={`h-5 w-5 ${
                            isActive ? "text-green-400" :
                            isSuspended ? "text-orange-400" :
                            isPendingApproval ? "text-gray-400" :
                            isRejected ? "text-red-400" :
                            "text-blue-400"
                          }`} />
                        </div>
                        <div className="min-w-0 space-y-1">
                          <p className="font-semibold text-foreground">{((acc as { platform?: string }).platform ?? "MT5").toUpperCase()}: {acc.mt5Login}</p>
                          <p className="text-xs text-muted-foreground">{acc.broker} · {acc.server}</p>
                          {acc.metaapiAccountId ? (
                            <p className="text-xs font-mono text-muted-foreground truncate max-w-xs">
                              MetaApi ID: {acc.metaapiAccountId}
                            </p>
                          ) : isPendingApproval ? (
                            <p className="text-xs text-gray-400">Awaiting admin review</p>
                          ) : isRejected ? null : (
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
                          {isRejected && acc.rejectionReason && (
                            <div className="flex items-start gap-1.5 mt-1">
                              <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
                              <p className="text-xs text-red-300">
                                Rejection reason: {acc.rejectionReason}
                              </p>
                            </div>
                          )}
                          {isSuspended && (
                            <div className="flex items-start gap-1.5 mt-1">
                              <AlertCircle className="h-3.5 w-3.5 text-orange-400 shrink-0 mt-0.5" />
                              <p className="text-xs text-orange-300">
                                Account suspended — MetaApi connection lost. Will reactivate automatically when connection is restored.
                              </p>
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
          <DialogContent className="dark bg-card border-border">
            <DialogHeader>
              <DialogTitle>Submit Master Account for Approval</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" /> {error}
                </div>
              )}
              <div className="flex items-start gap-2 p-3 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs">
                <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Your account details will be reviewed by an admin. Once approved and deployed, the account will go through the full activation lifecycle before accepting subscribers.
              </div>
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
                  <Label>Investor Password</Label>
                  <Input type="password" placeholder="••••••••" value={form.investorPassword} onChange={(e) => setForm({ ...form, investorPassword: e.target.value })} />
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
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                disabled={creating || !form.mt5Login || !form.broker || !form.investorPassword || !form.server}
                onClick={() => create({ data: { platform: form.platform as "mt4" | "mt5", mt5Login: form.mt5Login, investorPassword: form.investorPassword, server: form.server, broker: form.broker } })}
              >
                {creating ? "Submitting..." : "Submit for Approval"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent className="dark bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Master Account?</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove the account and all associated strategies. If the account was approved and deployed, it will be undeployed from MetaApi. This cannot be undone.
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
