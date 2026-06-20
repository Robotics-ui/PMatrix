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
import { MessageSquare, Send, Settings, FileText, List, RefreshCw, Eye, EyeOff, CheckCircle, XCircle, ShieldCheck } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

type SmsSettings = {
  id: number | null;
  providerName: string;
  apiUrl: string;
  apiKey: string;
  username: string;
  senderId: string;
  enabled: boolean;
  envOverrides?: {
    apiKey: boolean;
    username: boolean;
    senderId: boolean;
  };
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
  providerResponse: string | null;
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

function ApiResponseBox({ response, success }: { response: string; success: boolean }) {
  let formatted = response;
  try {
    formatted = JSON.stringify(JSON.parse(response), null, 2);
  } catch {
    // not JSON
  }
  return (
    <div className={`rounded-lg border p-3 ${success ? "border-green-600/30 bg-green-600/5" : "border-red-500/30 bg-red-500/5"}`}>
      <div className="flex items-center gap-2 mb-2">
        {success
          ? <CheckCircle className="h-4 w-4 text-green-400" />
          : <XCircle className="h-4 w-4 text-red-400" />}
        <span className={`text-xs font-semibold ${success ? "text-green-400" : "text-red-400"}`}>
          {success ? "MSpace Response — Success" : "MSpace Response — Error"}
        </span>
      </div>
      <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all font-mono leading-relaxed max-h-48 overflow-y-auto">
        {formatted}
      </pre>
    </div>
  );
}

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
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; response: string } | null>(null);

  const [validatePhone, setValidatePhone] = useState("");
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<{ valid: boolean; response: string; statusCode?: number } | null>(null);

  async function sendTest() {
    if (!testPhone.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<{ success: boolean; response: string }>("/api/admin/sms/test", {
        method: "POST",
        body: JSON.stringify({ phone: testPhone }),
      });
      setTestResult(result);
      toast({
        title: result.success ? "Test SMS sent" : "Test SMS failed",
        variant: result.success ? "default" : "destructive",
      });
    } catch (e) {
      const msg = (e as Error).message;
      setTestResult({ success: false, response: msg });
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function validateCredentials() {
    if (!validatePhone.trim()) {
      toast({ title: "Enter a phone number for validation", variant: "destructive" });
      return;
    }
    setValidating(true);
    setValidateResult(null);
    try {
      const result = await apiFetch<{ valid: boolean; response: string; statusCode?: number }>("/api/admin/sms/validate", {
        method: "POST",
        body: JSON.stringify({
          apiUrl: merged.apiUrl,
          apiKey: form.apiKey,
          username: merged.username,
          senderId: merged.senderId,
          testPhone: validatePhone.trim(),
        }),
      });
      setValidateResult(result);
      toast({
        title: result.valid ? "Credentials valid" : "Credentials invalid",
        variant: result.valid ? "default" : "destructive",
      });
    } catch (e) {
      const msg = (e as Error).message;
      setValidateResult({ valid: false, response: msg });
      toast({ title: "Validation error", description: msg, variant: "destructive" });
    } finally {
      setValidating(false);
    }
  }

  if (isLoading) return <div className="text-muted-foreground text-sm py-8 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">MSpace Configuration</CardTitle>
          <CardDescription>
            Configure your MSpace API credentials. The API Key is sent as a request header.
            {settings?.envOverrides && (settings.envOverrides.apiKey || settings.envOverrides.username || settings.envOverrides.senderId) && (
              <span className="block mt-1 text-blue-400 text-xs">
                Some values are overridden by environment variables (MSPACE_API_KEY, MSPACE_USERNAME, MSPACE_SENDER_ID).
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-border">
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
            <div className="space-y-2 md:col-span-2">
              <Label>MSpace API URL</Label>
              <Input
                placeholder="https://api.mspace.co.ke/sms/v1/send"
                value={merged.apiUrl ?? "https://api.mspace.co.ke/sms/v1/send"}
                onChange={(e) => setForm((f) => ({ ...f, apiUrl: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">Default: https://api.mspace.co.ke/sms/v1/send</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>MSpace API Key</Label>
                {settings?.envOverrides?.apiKey && (
                  <Badge variant="outline" className="text-xs text-blue-400 border-blue-600/30">From env</Badge>
                )}
              </div>
              <Input
                type="password"
                placeholder={merged.apiKey?.startsWith("••••") ? merged.apiKey : "Enter MSpace API Key"}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                disabled={settings?.envOverrides?.apiKey}
              />
              <p className="text-xs text-muted-foreground">Sent as <code className="bg-muted px-1 rounded">api-key</code> request header</p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>MSpace Username</Label>
                {settings?.envOverrides?.username && (
                  <Badge variant="outline" className="text-xs text-blue-400 border-blue-600/30">From env</Badge>
                )}
              </div>
              <Input
                placeholder="Your MSpace account username"
                value={merged.username ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                disabled={settings?.envOverrides?.username}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Sender ID</Label>
                {settings?.envOverrides?.senderId && (
                  <Badge variant="outline" className="text-xs text-blue-400 border-blue-600/30">From env</Badge>
                )}
              </div>
              <Input
                placeholder="e.g. PESAMTRX"
                value={merged.senderId ?? "PESAMTRX"}
                onChange={(e) => setForm((f) => ({ ...f, senderId: e.target.value }))}
                disabled={settings?.envOverrides?.senderId}
              />
            </div>
          </div>

          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-3">
              Sends <code className="bg-muted px-1 rounded">POST</code> to the API URL with{" "}
              <code className="bg-muted px-1 rounded">api-key</code> header and body:{" "}
              <code className="bg-muted px-1 rounded">{"{ username, mobile, message, from }"}</code>
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

      {/* Validate Credentials */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-400" />
            Validate Credentials
          </CardTitle>
          <CardDescription>Send a validation request to MSpace to confirm your credentials are correct before saving</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Input
              placeholder="Phone number to validate (e.g. 254712345678)"
              value={validatePhone}
              onChange={(e) => setValidatePhone(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={validateCredentials}
              disabled={validating || !validatePhone.trim()}
              variant="outline"
              className="border-blue-600/40 text-blue-400 hover:bg-blue-600/10"
            >
              {validating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              <span className="ml-2">{validating ? "Validating..." : "Validate"}</span>
            </Button>
          </div>
          {validateResult && (
            <div className="space-y-2">
              {validateResult.statusCode && (
                <p className="text-xs text-muted-foreground">HTTP Status: {validateResult.statusCode}</p>
              )}
              <ApiResponseBox response={validateResult.response} success={validateResult.valid} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test SMS */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base">Test SMS</CardTitle>
          <CardDescription>Send a test message using the saved settings to verify delivery</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Input
              placeholder="Phone number (e.g. 254712345678)"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              className="flex-1"
            />
            <Button onClick={sendTest} disabled={testing || !testPhone.trim()} className="bg-blue-600 hover:bg-blue-700">
              {testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span className="ml-2">{testing ? "Sending..." : "Send Test"}</span>
            </Button>
          </div>
          {testResult && <ApiResponseBox response={testResult.response} success={testResult.success} />}
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
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const limit = 25;

  const { data, isLoading, refetch } = useQuery<{ items: SmsLog[]; total: number }>({
    queryKey: ["admin-sms-logs", page, statusFilter],
    queryFn: () => apiFetch(`/api/admin/sms/logs?limit=${limit}&offset=${page * limit}${statusFilter ? `&status=${statusFilter}` : ""}`),
  });

  const statusColor: Record<string, string> = {
    sent: "text-green-400",
    failed: "text-red-400",
    pending: "text-yellow-400",
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">Total: {data?.total ?? 0} messages</p>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            className="text-xs bg-muted border border-border rounded px-2 py-1 text-foreground"
          >
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading...</div>
      ) : (data?.items?.length ?? 0) === 0 ? (
        <div className="text-muted-foreground text-sm py-8 text-center">No SMS logs yet</div>
      ) : (
        <div className="space-y-2">
          {data?.items.map((log) => (
            <div key={log.id} className="rounded-lg border border-border bg-card overflow-hidden">
              <div
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/20"
                onClick={() => setExpanded((e) => ({ ...e, [log.id]: !e[log.id] }))}
              >
                <span className={`text-xs font-semibold w-14 shrink-0 ${statusColor[log.status] ?? "text-muted-foreground"}`}>
                  {log.status}
                </span>
                <span className="font-mono text-xs text-muted-foreground w-32 shrink-0">{log.phone}</span>
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">
                  {EVENT_TYPE_LABELS[log.eventType] ?? log.eventType}
                </span>
                <span className="text-xs text-muted-foreground truncate flex-1">{log.message}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                  {new Date(log.createdAt).toLocaleString()}
                </span>
              </div>
              {expanded[log.id] && (
                <div className="px-3 pb-3 pt-1 border-t border-border space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Full message:</p>
                    <p className="text-sm text-foreground bg-muted/30 rounded p-2">{log.message}</p>
                  </div>
                  {log.providerResponse && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">MSpace API response:</p>
                      <ApiResponseBox response={log.providerResponse} success={log.status === "sent"} />
                    </div>
                  )}
                  {log.sentAt && (
                    <p className="text-xs text-muted-foreground">Delivered at: {new Date(log.sentAt).toLocaleString()}</p>
                  )}
                </div>
              )}
            </div>
          ))}
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

  const { data: stats, refetch: refetchStats } = useQuery<SmsStats>({
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
      void refetchStats();
    } catch (e) {
      toast({ title: "Error", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  const smsCount = Math.ceil((message.length || 1) / 160);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Logged", value: stats?.total ?? 0, color: "text-foreground" },
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
          <CardTitle className="text-base">Admin Broadcast SMS</CardTitle>
          <CardDescription>Send an SMS to all users or only those with an active subscription</CardDescription>
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
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{message.length} characters</span>
              <span>{smsCount} SMS segment{smsCount !== 1 ? "s" : ""} · {160 - (message.length % 160 || 160)} chars remaining in segment</span>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
            <div>
              <p className="text-sm font-medium">Active subscribers only</p>
              <p className="text-xs text-muted-foreground">Only users with an active subscription will receive this broadcast</p>
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
            Messages are queued and processed by the SMS worker every minute via MSpace.
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
            <h1 className="text-xl font-bold text-foreground">SMS — MSpace</h1>
            <p className="text-sm text-muted-foreground">Manage MSpace credentials, templates, delivery logs, and broadcasts</p>
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
