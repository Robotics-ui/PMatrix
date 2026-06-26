import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import {
  useListStrategies,
  useCreateStrategy,
  useDeleteStrategy,
  useListMasterAccounts,
  getListStrategiesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { GitBranch, Plus, Trash2, RefreshCw, AlertCircle, Server, Clock, Info, Tag, Link2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

// Masters must be at least deployed before a strategy can be created
const STRATEGY_ELIGIBLE_STATUSES = new Set(["deployed", "strategy_created", "active"]);

export default function StrategiesPage() {
  const qc = useQueryClient();
  const { data: strategies, isLoading } = useListStrategies({
    query: { refetchInterval: 30_000 },
  });
  const { data: masterAccounts } = useListMasterAccounts({
    query: { refetchInterval: 30_000 },
  });
  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ strategyName: "", masterAccountId: 0 });
  const [error, setError] = useState("");

  const eligibleMasters = (masterAccounts ?? []).filter((m) => STRATEGY_ELIGIBLE_STATUSES.has(m.status ?? ""));
  const hasPendingMasters = (masterAccounts ?? []).some((m) =>
    ["pending_approval", "approved", "deploying", "connecting", "synchronizing"].includes(m.status ?? "")
  );
  const hasEligible = eligibleMasters.length > 0;

  const { mutate: create, isPending: creating } = useCreateStrategy({
    mutation: {
      onSuccess: () => {
        setOpen(false);
        setForm({ strategyName: "", masterAccountId: 0 });
        void qc.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        setError(e?.data?.error ?? "Failed to create strategy");
      },
    },
  });

  const { mutate: del } = useDeleteStrategy({
    mutation: {
      onSuccess: () => void qc.invalidateQueries({ queryKey: getListStrategiesQueryKey() }),
    },
  });

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Strategies</h1>
            <p className="text-sm text-muted-foreground mt-1">CopyFactory strategies defining how trades are copied</p>
          </div>
          <Button onClick={() => { setError(""); setOpen(true); }} className="bg-blue-600 hover:bg-blue-700" disabled={!hasEligible}>
            <Plus className="h-4 w-4 mr-2" /> New Strategy
          </Button>
        </div>

        <Card className="border-green-600/30 bg-green-600/5">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-green-300">
              <Info className="h-4 w-4 shrink-0" />
              How to create a strategy
            </div>
            <ol className="space-y-2.5 pl-1">
              {[
                {
                  icon: Server,
                  title: "You need a deployed master account first",
                  detail: "Go to Master Accounts and ensure at least one has reached Deployed (or higher) status. The master is the signal provider — the account whose trades get copied.",
                },
                {
                  icon: Tag,
                  title: "Give your strategy a name",
                  detail: "Choose something descriptive (e.g. \"Gold Scalper\", \"EURUSD Swing\"). This name appears in CopyFactory and helps you identify which strategy is running.",
                },
                {
                  icon: GitBranch,
                  title: "Select the master account",
                  detail: "Only accounts at Deployed status or above are available. Selecting one registers the master as a CopyFactory signal provider under this strategy.",
                },
                {
                  icon: Link2,
                  title: "Then create bindings to start copying",
                  detail: "Once the strategy is active and the master is Active, go to Bindings to connect your slave accounts. One strategy can feed multiple slave accounts.",
                },
              ].map(({ icon: Icon, title, detail }, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="flex items-center gap-2 shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-green-400 w-4 text-right">{i + 1}.</span>
                    <Icon className="h-3.5 w-3.5 text-green-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-green-300">{title}</p>
                    <p className="text-xs text-green-300/60 mt-0.5">{detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {!masterAccounts?.length && (
          <Card className="border-orange-500/30 bg-orange-500/5">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 text-sm text-orange-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <p>You need at least one master account before creating a strategy.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {masterAccounts?.length && !hasEligible && hasPendingMasters && (
          <Card className="border-yellow-500/30 bg-yellow-500/5">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 text-sm text-yellow-300">
                <Clock className="h-4 w-4 shrink-0" />
                <p>Your master account is being reviewed or deployed. Strategies can be created once an account reaches <span className="font-semibold">Deployed</span> status.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !strategies?.length ? (
          <Card className="border-border">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <GitBranch className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-semibold text-foreground">No strategies yet</h3>
              <p className="text-sm text-muted-foreground mt-1">Create a CopyFactory strategy to start copying</p>
              <Button onClick={() => setOpen(true)} className="mt-4 bg-blue-600 hover:bg-blue-700" disabled={!hasEligible}>
                <Plus className="h-4 w-4 mr-2" /> New Strategy
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {strategies.map((s) => {
              const master = masterAccounts?.find((m) => m.id === s.masterAccountId);
              const masterIsActive = master?.status === "active";
              return (
                <Card key={s.id} className={`border-border transition-colors ${masterIsActive ? "hover:border-green-500/30" : "hover:border-blue-600/30"}`}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${masterIsActive ? "bg-green-600/10" : "bg-blue-600/10"}`}>
                          <GitBranch className={`h-5 w-5 ${masterIsActive ? "text-green-400" : "text-blue-400"}`} />
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">{s.strategyName}</p>
                          {master && (
                            <div className="flex items-center gap-1 mt-1">
                              <Server className="h-3 w-3 text-blue-400" />
                              <span className="text-xs text-blue-400">{master.mt5Login} · {master.broker}</span>
                            </div>
                          )}
                          {s.copyfactoryStrategyId && (
                            <p className="text-xs text-muted-foreground font-mono mt-0.5">CF: {s.copyfactoryStrategyId}</p>
                          )}
                          {master && !masterIsActive && (
                            <p className="text-xs text-orange-400 mt-0.5">
                              Master not active ({master.status}) — subscribers cannot bind
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge className={
                          s.status === "active" && masterIsActive
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                        }>
                          {s.status === "active" && masterIsActive ? "active" : s.status === "active" ? "master not ready" : (s.status ?? "pending")}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteId(s.id!)}
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
              <DialogTitle>New Strategy</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {error && (
                <div className="flex items-center gap-2 p-3 rounded bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" /> {error}
                </div>
              )}
              <div className="space-y-2">
                <Label>Strategy Name</Label>
                <Input placeholder="My Strategy" value={form.strategyName} onChange={(e) => setForm({ ...form, strategyName: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Master Account</Label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={form.masterAccountId}
                  onChange={(e) => setForm({ ...form, masterAccountId: parseInt(e.target.value) })}
                >
                  <option value={0}>Select deployed master account...</option>
                  {eligibleMasters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.mt5Login} — {m.broker} ({m.status})
                    </option>
                  ))}
                </select>
                {!eligibleMasters.length && (
                  <p className="text-xs text-muted-foreground">
                    Master accounts must reach <span className="font-semibold">Deployed</span> status before a strategy can be created.
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                className="bg-blue-600 hover:bg-blue-700"
                disabled={creating || !form.strategyName || !form.masterAccountId}
                onClick={() => create({ data: { strategyName: form.strategyName, masterAccountId: form.masterAccountId } })}
              >
                {creating ? "Creating..." : "Create Strategy"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent className="bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Strategy?</AlertDialogTitle>
              <AlertDialogDescription>This will remove the strategy and all associated bindings.</AlertDialogDescription>
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
