import { useState } from "react";
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
import { Server, Plus, Trash2, RefreshCw, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

function StatusBadge({ status }: { status?: string | null }) {
  if (status === "connected") return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Connected</Badge>;
  if (status === "deploying") return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Deploying</Badge>;
  if (status === "connecting") return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Connecting</Badge>;
  if (status === "disconnected") return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Disconnected</Badge>;
  return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">{status ?? "error"}</Badge>;
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
  const [form, setForm] = useState({ mt5Login: "", investorPassword: "", server: "", broker: "" });
  const [error, setError] = useState("");

  const { mutate: create, isPending: creating } = useCreateMasterAccount({
    mutation: {
      onSuccess: () => {
        setOpen(false);
        setForm({ mt5Login: "", investorPassword: "", server: "", broker: "" });
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
            <p className="text-sm text-muted-foreground mt-1">Signal provider MT5 accounts copied from via MetaApi CopyFactory</p>
          </div>
          <Button onClick={() => { setError(""); setOpen(true); }} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-2" /> Add Master
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !accounts?.length ? (
          <Card className="border-border">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <Server className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-semibold text-foreground">No master accounts yet</h3>
              <p className="text-sm text-muted-foreground mt-1">Add your first MetaApi master account</p>
              <Button onClick={() => setOpen(true)} className="mt-4 bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" /> Add Master Account
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {accounts.map((acc) => (
              <Card key={acc.id} className="border-border hover:border-blue-600/30 transition-colors">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="h-10 w-10 rounded-lg bg-blue-600/10 flex items-center justify-center shrink-0">
                        <Server className="h-5 w-5 text-blue-400" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="font-semibold text-foreground">MT5: {acc.mt5Login}</p>
                        <p className="text-xs text-muted-foreground">{acc.broker} · {acc.server}</p>
                        {acc.metaapiAccountId ? (
                          <p className="text-xs font-mono text-muted-foreground truncate max-w-xs">
                            MetaApi ID: {acc.metaapiAccountId}
                          </p>
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
                              <span className="text-xs text-muted-foreground">Connection:</span>
                              <span className={`text-xs font-mono ${acc.connectionStatus === "CONNECTED" ? "text-green-400" : "text-orange-400"}`}>
                                {acc.connectionStatus}
                              </span>
                            </div>
                          )}
                        </div>
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
            ))}
          </div>
        )}

        {/* Add dialog */}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="dark bg-card border-border">
            <DialogHeader>
              <DialogTitle>Add Master Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" /> {error}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>MT5 Login</Label>
                  <Input placeholder="12345678" value={form.mt5Login} onChange={(e) => setForm({ ...form, mt5Login: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Investor Password</Label>
                  <Input type="password" placeholder="••••••••" value={form.investorPassword} onChange={(e) => setForm({ ...form, investorPassword: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Server</Label>
                  <Input placeholder="ICMarkets-Live" value={form.server} onChange={(e) => setForm({ ...form, server: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Broker</Label>
                  <Input placeholder="ICMarkets" value={form.broker} onChange={(e) => setForm({ ...form, broker: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Submitting creates a real MetaApi account and deploys it. The MetaApi ID is stored automatically.
                Use the refresh button on the account card to poll the live connection status from MetaApi.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                disabled={creating || !form.mt5Login || !form.broker || !form.investorPassword}
                onClick={() => create({ data: { mt5Login: form.mt5Login, investorPassword: form.investorPassword, server: form.server, broker: form.broker } })}
              >
                {creating ? "Creating..." : "Add Account"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirm */}
        <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent className="dark bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Master Account?</AlertDialogTitle>
              <AlertDialogDescription>
                This will undeploy the account from MetaApi and remove it along with all associated strategies. This cannot be undone.
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
