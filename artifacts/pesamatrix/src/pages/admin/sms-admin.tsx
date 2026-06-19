import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Send, Settings, FileText, List, BarChart3, RefreshCw, Eye, EyeOff } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const token = () => localStorage.getItem("auth_token") ?? "";

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

type SmsSettings = {
  id: number | null;
  providerName: string;
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
  senderId: string;
  enabled: boolean;
};

type SmsTemplate = {
  id: number;
  eventType: string;
  template: string;
  enabled: boolean;
  updatedAt: string;
};

type SmsLog = {
  id: number;
  phone: string;
  message: string;
  eventType: string;
  status: string;
  deliveryStatus: string | null;
  sentAt: string | null;
  createdAt: string;
};

type SmsStats = { total: number; sent: number; failed: number; pending: number };

const EVENT_TYPE_LABELS: Record<string, string> = {
  subscription_activated: "Subscription Activated",
  subscription_expiring: "Subscription Expiring",
  subscription_expired: "Subscription Expired",
  payment_received: "Payment Received",
  master_account_approved: "Master Account Approved",
  account_suspended: "Account Suspended",
  announcement: "Announcement",
  broadcast: "Broadcast",
};

function SettingsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery<SmsSettings>({
    queryKey: ["admin-sms-settings"],
    queryFn: () => apiFetch("/api/admin/sms/settings"),
  });

  const [form, setForm] = useState<Partial<SmsSettings>>({});
  const merged = { ...settings, ...form };

  const saveMutation = useMutation({
    mutationFn: (data: Partial<SmsSettings>) =>
      apiFetch("/api/admin/sms/settings", { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: "Settings saved" });
      qc.invalidateQueries({ queryKey: ["admin-sms-settings"] });
      setForm({});
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);

  async function sendTest() {
    if (!testPhone.trim()) return;
    setTesting(true);
    try {
      const result = await apiFetch<{ success: boolean; response: string }>("/api/admin/sms/test", {
        method: "POST",
        body: JSON.stringify({ phone: testPhone }),
      });
      toast({
        title: result.success ? "Test SMS sent" : "Test SMS failed",
        description: result.response.slice(0, 150),
        variant: result.success ? "default" : "destructive",
      });
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  if (isLoading) return <div className="text-muted-foreground text-sm py-8 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Provider Configuration</CardTitle>
          <CardDescription>Configure your Bulk SMS provider credentials</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <div>
              <p className="text-sm font-medium">Enable SMS Notifications</p>
              <p className="text-xs text-muted-foreground">Send SMS when credentials are configured</p>
            </div>
            <Switch
              checked={merged.enabled ?? false}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Provider Name</Label>
              <Input
                placeholder="e.g. AfricasTalking, BulkSMS Kenya"
                value={merged.providerName ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, providerName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Sender ID</Label>
              <Input
                placeholder="e.g. PESAMTRX"
                value={merged.senderId ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, senderId: e.target.value }))}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>API URL</Label>
              <Input
                placeholder="https://api.yourprovider.com/sms/send"
                value={merged.apiUrl ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, apiUrl: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder={merged.apiKey?.startsWith("••••") ? merged.apiKey : "Enter API key"}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>API Secret</Label>
              <Input
                type="password"
                placeholder={merged.apiSecret?.startsWith("••••") ? merged.apiSecret : "Enter API secret"}
                onChange={(e) => setForm((f) => ({ ...f, apiSecret: e.target.value }))}
              />
            </div>
          </div>

          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-3">
              The system sends a POST request to your API URL with JSON: {"{ to, message, from, api_key, api_secret }"}
            </p>
            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending || Object.keys(form).length === 0}
              className="bg-green-600 hover:bg-green-700"
            >
              {saveMutation.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Test SMS</CardTitle>
          <CardDescription>Send a test message to verify your provider is working</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="Phone number (e.g. 254712345678)"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              className="flex-1"
            />
            <Button onClick={sendTest} disabled={testing || !testPhone.trim()}>
              {testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span className="ml-2">Send Test</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const SAMPLE_VALUES: Record<string, string> = {
  name: "John Doe",
  endDate: "Fri, 27 Jun 2025",
  daysLeft: "3",
  amount: "500",
  receipt: "RGH3K2X1Y4",
  accountId: "ACC-001",
  message: "System announcement: platform maintenance scheduled.",
};

function renderPreview(template: string): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => SAMPLE_VALUES[key] ?? `{{${key}}}`);
}

function TemplatesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: templates = [], isLoading } = useQuery<SmsTemplate[]>({
    queryKey: ["admin-sms-templates"],
    queryFn: () => apiFetch("/api/admin/sms/templates"),
  });

  const [editing, setEditing] = useState<Record<string, { template: string; enabled: boolean }>>({});
  const [previewing, setPreviewing] = useState<Record<string, boolean>>({});

  const updateMutation = useMutation({
    mutationFn: ({ eventType, data }: { eventType: string; data: { template?: string; enabled?: boolean } }) =>
      apiFetch(`/api/admin/sms/templates/${eventType}`, { method: "PUT", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: "Template updated" });
      qc.invalidateQueries({ queryKey: ["admin-sms-templates"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="text-muted-foreground text-sm py-8 text-center">Loading...</div>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Use {"{{name}}"}, {"{{endDate}}"}, {"{{daysLeft}}"}, {"{{amount}}"}, {"{{receipt}}"}, {"{{accountId}}"}, {"{{message}}"} as placeholders.
      </p>
      {templates.map((tpl) => {
        const ed = editing[tpl.eventType];
        const currentTemplate = ed?.template ?? tpl.template;
        const currentEnabled = ed?.enabled ?? tpl.enabled;

        return (
          <Card key={tpl.eventType} className="border-border bg-card">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-medium">{EVENT_TYPE_LABELS[tpl.eventType] ?? tpl.eventType}</CardTitle>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{tpl.eventType}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={currentEnabled}
                    onCheckedChange={(v) => setEditing((e) => ({ ...e, [tpl.eventType]: { ...e[tpl.eventType], template: e[tpl.eventType]?.template ?? tpl.template, enabled: v } }))}
                  />
                  <Badge variant={currentEnabled ? "default" : "secondary"}>{currentEnabled ? "Active" : "Disabled"}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={currentTemplate}
                onChange={(e) => setEditing((prev) => ({ ...prev, [tpl.eventType]: { template: e.target.value, enabled: currentEnabled } }))}
                className="min-h-[80px] font-mono text-sm resize-none"
              />
              {previewing[tpl.eventType] && (
                <div className="rounded-lg border border-blue-600/30 bg-blue-600/5 p-3 space-y-1">
                  <p className="text-xs font-medium text-blue-400">Preview (sample data)</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                    {renderPreview(currentTemplate)}
                  </p>
                  <p className="text-xs text-muted-foreground pt-1">
                    {renderPreview(currentTemplate).length} chars · {Math.ceil(renderPreview(currentTemplate).length / 160)} SMS
                  </p>
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-xs text-muted-foreground">{currentTemplate.length} chars</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreviewing((p) => ({ ...p, [tpl.eventType]: !p[tpl.eventType] }))}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {previewing[tpl.eventType]
                      ? <><EyeOff className="h-3.5 w-3.5 mr-1" /> Hide Preview</>
                      : <><Eye className="h-3.5 w-3.5 mr-1" /> Preview</>
                    }
                  </Button>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    updateMutation.mutate({ eventType: tpl.eventType, data: { template: currentTemplate, enabled: currentEnabled } });
                    setEditing((e) => { const next = { ...e }; delete next[tpl.eventType]; return next; });
                  }}
                  disabled={updateMutation.isPending || (!ed)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function LogsTab() {
  const [page, setPage] = useState(0);
  const limit = 25;

  const { data, isLoading, refetch } = useQuery<{ items: SmsLog[]; total: number }>({
    queryKey: ["admin-sms-logs", page],
    queryFn: () => apiFetch(`/api/admin/sms/logs?limit=${limit}&offset=${page * limit}`),
  });

  const statusColor: Record<string, string> = {
    sent: "text-green-400",
    failed: "text-red-400",
    pending: "text-yellow-400",
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">Total: {data?.total ?? 0} messages</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading...</div>
      ) : (data?.items?.length ?? 0) === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">No SMS logs yet</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Recipient</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Event</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Message</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Status</th>
                <th className="px-3 py-2 text-left text-xs text-muted-foreground font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((log) => (
                <tr key={log.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-xs">{log.phone}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{EVENT_TYPE_LABELS[log.eventType] ?? log.eventType}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground max-w-[240px] truncate">{log.message}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-medium ${statusColor[log.status] ?? "text-muted-foreground"}`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(data?.total ?? 0) > limit && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground py-2">Page {page + 1} of {Math.ceil((data?.total ?? 0) / limit)}</span>
          <Button variant="outline" size="sm" disabled={(page + 1) * limit >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}

function BroadcastTab() {
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [sending, setSending] = useState(false);

  const { data: stats } = useQuery<SmsStats>({
    queryKey: ["admin-sms-stats"],
    queryFn: () => apiFetch("/api/admin/sms/stats"),
    refetchInterval: 10000,
  });

  async function handleBroadcast() {
    if (!message.trim()) return;
    setSending(true);
    try {
      const result = await apiFetch<{ success: boolean; queued: number }>("/api/admin/sms/broadcast", {
        method: "POST",
        body: JSON.stringify({ message: message.trim(), onlyActive }),
      });
      toast({ title: "Broadcast queued", description: `${result.queued} messages added to the SMS queue` });
      setMessage("");
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Sent", value: stats?.total ?? 0, color: "text-foreground" },
          { label: "Delivered", value: stats?.sent ?? 0, color: "text-green-400" },
          { label: "Failed", value: stats?.failed ?? 0, color: "text-red-400" },
          { label: "In Queue", value: stats?.pending ?? 0, color: "text-yellow-400" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="border-border bg-card">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>{value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Send Broadcast SMS</CardTitle>
          <CardDescription>Queue an SMS to be sent to all or active subscribers</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea
              placeholder="Type your broadcast message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="min-h-[100px] resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">{message.length} / 160 chars (1 SMS)</p>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
            <div>
              <p className="text-sm font-medium">Active subscribers only</p>
              <p className="text-xs text-muted-foreground">Send only to users with an active subscription</p>
            </div>
            <Switch checked={onlyActive} onCheckedChange={setOnlyActive} />
          </div>

          <Button
            onClick={handleBroadcast}
            disabled={sending || !message.trim()}
            className="w-full bg-green-600 hover:bg-green-700"
          >
            {sending ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Queueing...</>
            ) : (
              <><Send className="h-4 w-4 mr-2" /> Queue Broadcast</>
            )}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Messages are queued and processed in the background by the SMS worker every minute.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminSmsPage() {
  const { user } = useAuth();
  if (user?.role !== "admin") return null;

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-green-600/20 border border-green-600/30 flex items-center justify-center">
            <MessageSquare className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Bulk SMS</h1>
            <p className="text-sm text-muted-foreground">Manage provider settings, templates, logs, and broadcasts</p>
          </div>
        </div>

        <Tabs defaultValue="settings">
          <TabsList className="bg-muted/50 border border-border">
            <TabsTrigger value="settings" className="gap-2 data-[state=active]:bg-background">
              <Settings className="h-3.5 w-3.5" /> Settings
            </TabsTrigger>
            <TabsTrigger value="templates" className="gap-2 data-[state=active]:bg-background">
              <FileText className="h-3.5 w-3.5" /> Templates
            </TabsTrigger>
            <TabsTrigger value="broadcast" className="gap-2 data-[state=active]:bg-background">
              <Send className="h-3.5 w-3.5" /> Broadcast
            </TabsTrigger>
            <TabsTrigger value="logs" className="gap-2 data-[state=active]:bg-background">
              <List className="h-3.5 w-3.5" /> Logs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="mt-4"><SettingsTab /></TabsContent>
          <TabsContent value="templates" className="mt-4"><TemplatesTab /></TabsContent>
          <TabsContent value="broadcast" className="mt-4"><BroadcastTab /></TabsContent>
          <TabsContent value="logs" className="mt-4"><LogsTab /></TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
