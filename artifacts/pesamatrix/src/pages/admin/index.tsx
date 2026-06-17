import { useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import {
  useGetAdminStats,
  useGetAdminSettings,
  useUpdateAdminSettings,
  useListAdminUsers,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Users, CreditCard, Settings, RefreshCw, TrendingUp, AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetAdminSettingsQueryKey } from "@workspace/api-client-react";
import { useEffect } from "react";

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
  const [dailyFee, setDailyFee] = useState("");
  const [minDays, setMinDays] = useState("");
  const [maxDays, setMaxDays] = useState("");
  const [metaApiToken, setMetaApiToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (settings) {
      setDailyFee(settings.dailyFee ?? "100");
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
        dailyFee,
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
            { label: "Total Users", value: stats?.totalUsers, icon: Users, color: "blue" },
            { label: "Active Subs", value: stats?.activeSubscriptions, icon: CreditCard, color: "green" },
            { label: "Total Revenue (KES)", value: stats?.totalRevenue != null ? `${stats.totalRevenue.toFixed(0)}` : "0", icon: TrendingUp, color: "green" },
            { label: "Total Payments", value: stats?.totalPayments, icon: TrendingUp, color: "blue" },
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

          {/* Settings tab */}
          <TabsContent value="settings">
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
