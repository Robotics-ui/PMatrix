import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { useAuth } from "@/hooks/use-auth";
import {
  useInitiatePayment,
  useListPayments,
  useGetAdminSettings,
  useGetPaymentStatus,
  useVerifyPayment,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Smartphone, Clock, CreditCard, Info, Loader2, RefreshCw, ListOrdered } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMySubscriptionQueryKey } from "@workspace/api-client-react";

function isTradingDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function addTradingDays(start: Date, days: number): Date {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (isTradingDay(result)) added++;
  }
  return result;
}

function getExpiryDate(days: number): string {
  const end = addTradingDays(new Date(), days);
  return end.toLocaleDateString("en-KE", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function normalizePhone(raw: string): string {
  let p = raw.replace(/\s+/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("0") && p.length === 10) return "254" + p.slice(1);
  if (/^[71]/.test(p) && p.length === 9) return "254" + p;
  return p;
}

const POLL_INTERVAL_MS = 3500;
const POLL_MAX_MS = 120_000;

export default function PaymentPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: settings } = useGetAdminSettings();
  const { data: payments, refetch: refetchPayments } = useListPayments();

  const minDays = settings?.minDays ?? 1;
  const maxDays = settings?.maxDays ?? 365;
  const dailyFee = typeof settings?.dailyFee === "number"
    ? settings.dailyFee
    : parseFloat(String(settings?.dailyFee ?? "100"));

  const [days, setDays] = useState(5);
  const [phone, setPhone] = useState(user?.phone ?? "");

  const clampedDays = Math.min(Math.max(days, minDays), maxDays);
  const totalAmount = clampedDays * dailyFee;

  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [pollStatus, setPollStatus] = useState<"idle" | "polling" | "confirmed" | "failed" | "timeout">("idle");
  const [pollMessage, setPollMessage] = useState("");
  const pollStart = useRef<number>(0);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { refetch: refetchStatus } = useGetPaymentStatus(checkoutId ?? "");
  const { mutate: verifyMutate, isPending: isVerifying } = useVerifyPayment({
    mutation: {
      onSuccess: (data) => {
        if (data.status === "completed") {
          stopPolling();
          setPollStatus("confirmed");
          const receipt = data.mpesaReceipt;
          setPollMessage(receipt ? `Receipt: ${receipt}` : "Subscription activated!");
          refetchPayments();
          void qc.invalidateQueries({ queryKey: getGetMySubscriptionQueryKey() });
        } else if (data.status === "failed") {
          stopPolling();
          setPollStatus("failed");
          setPollMessage("Payment was cancelled or failed. Please try again.");
          refetchPayments();
        } else {
          setPollMessage("Payment not confirmed yet. Please complete the M-Pesa prompt or wait.");
        }
      },
      onError: () => {
        setPollMessage("Could not reach Safaricom to verify. Keep waiting or try again shortly.");
      },
    },
  });

  function handleManualCheck() {
    if (!checkoutId) return;
    verifyMutate({ checkoutRequestId: checkoutId });
  }

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function startPolling(id: string) {
    stopPolling();
    pollStart.current = Date.now();
    setPollStatus("polling");

    pollTimer.current = setInterval(async () => {
      if (Date.now() - pollStart.current > POLL_MAX_MS) {
        stopPolling();
        setPollStatus("timeout");
        setPollMessage("Payment not confirmed within 2 minutes. Check your payment history below.");
        return;
      }
      try {
        const result = await refetchStatus();
        const s = result.data?.status;
        if (s === "completed") {
          stopPolling();
          setPollStatus("confirmed");
          const receipt = result.data?.mpesaReceipt;
          setPollMessage(receipt ? `Receipt: ${receipt}` : "Subscription activated!");
          refetchPayments();
          void qc.invalidateQueries({ queryKey: getGetMySubscriptionQueryKey() });
        } else if (s === "failed") {
          stopPolling();
          setPollStatus("failed");
          setPollMessage("Payment was cancelled or failed. Please try again.");
          refetchPayments();
        }
      } catch {
        // Network hiccup — keep polling
      }
    }, POLL_INTERVAL_MS);
  }

  useEffect(() => () => stopPolling(), []);

  const { mutate, isPending } = useInitiatePayment({
    mutation: {
      onSuccess: (data) => {
        setCheckoutId(data.checkoutRequestId);
        setPollMessage(data.message ?? "STK Push sent. Enter your M-Pesa PIN.");
        startPolling(data.checkoutRequestId);
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        setPollStatus("failed");
        setPollMessage(e?.data?.error ?? "Payment failed. Please try again.");
      },
    },
  });

  const handlePay = () => {
    setPollStatus("idle");
    setCheckoutId(null);
    setDays(clampedDays);
    mutate({ data: { phone: normalizePhone(phone), days: clampedDays } });
  };

  const isBlocked = isPending || pollStatus === "polling";

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Subscribe</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Pay via M-Pesa STK Push to activate copy trading
          </p>
        </div>

        {/* Pricing info */}
        <Card className="border-blue-600/30 bg-blue-600/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
                <Info className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-400">
                  KES {dailyFee.toFixed(0)} per trading day
                </p>
                <p className="text-xs text-muted-foreground">
                  Weekends are not counted — subscription runs on trading days only (Mon–Fri).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Step-by-step instructions */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-blue-400" />
              How to Subscribe
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {[
                {
                  step: 1,
                  title: "Choose your trading days",
                  desc: "Use the slider or preset buttons to select how many trading days you want. Weekends don't count — only Mon–Fri.",
                },
                {
                  step: 2,
                  title: "Enter your M-Pesa number",
                  desc: "Type the Safaricom number you want to pay from. Accepted formats: 07XXXXXXXX, 7XXXXXXXX, or 254XXXXXXXXX.",
                },
                {
                  step: 3,
                  title: "Tap Pay and wait for the STK Push",
                  desc: "A payment prompt will pop up on your phone automatically. This may take a few seconds.",
                },
                {
                  step: 4,
                  title: "Enter your M-Pesa PIN",
                  desc: "On your phone, confirm the payment by entering your M-Pesa PIN when prompted.",
                },
                {
                  step: 5,
                  title: "Subscription activates instantly",
                  desc: "Once payment is confirmed your subscription is activated and copy trading begins. You'll see the receipt and status update below.",
                },
              ].map(({ step, title, desc }) => (
                <li key={step} className="flex gap-3">
                  <span className="flex-shrink-0 h-6 w-6 rounded-full bg-blue-600/20 text-blue-400 text-xs font-bold flex items-center justify-center mt-0.5">
                    {step}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-4 pt-4 border-t border-border flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                If the STK Push doesn't arrive within 30 seconds, ensure your phone has network coverage and your M-Pesa account is active. You can also use the <span className="text-foreground font-medium">I Have Paid — Check Now</span> button after tapping Pay.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-green-400" />
              M-Pesa Payment
            </CardTitle>
            <CardDescription>Select your trading days, enter your M-Pesa number and pay</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Trading Days Slider */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Trading Days</Label>
                <span className="text-sm font-semibold text-blue-400">
                  {clampedDays} day{clampedDays !== 1 ? "s" : ""}
                </span>
              </div>
              <input
                type="range"
                min={minDays}
                max={maxDays}
                step={1}
                value={clampedDays}
                onChange={(e) => setDays(parseInt(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-blue-500 bg-muted"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{minDays} day</span>
                <span>{maxDays} days</span>
              </div>
              {/* Quick presets */}
              <div className="flex flex-wrap gap-2 pt-1">
                {[1, 5, 10, 20, 30].filter((d) => d >= minDays && d <= maxDays).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      clampedDays === d
                        ? "bg-blue-600 text-white border-blue-600"
                        : "border-border text-muted-foreground hover:border-blue-600/50 hover:text-foreground"
                    }`}
                  >
                    {d}d
                  </button>
                ))}
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={minDays}
                    max={maxDays}
                    value={clampedDays}
                    onChange={(e) => setDays(parseInt(e.target.value) || minDays)}
                    className="w-20 h-7 text-xs px-2"
                  />
                </div>
              </div>
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="phone">M-Pesa Phone Number</Label>
              <Input
                id="phone"
                placeholder="07XXXXXXXX or 254XXXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Accepts: 07XXXXXXXX, 7XXXXXXXX, or 254XXXXXXXXX
              </p>
            </div>

            {/* Summary */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Trading days</span>
                <span className="text-foreground font-medium">
                  {clampedDays} day{clampedDays !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Rate</span>
                <span className="text-foreground">KES {dailyFee.toFixed(0)} / day</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Expires approximately
                </span>
                <span className="text-foreground">{getExpiryDate(clampedDays)}</span>
              </div>
              <div className="border-t border-border pt-3 flex justify-between">
                <span className="font-semibold text-foreground">Total</span>
                <span className="font-bold text-lg text-blue-400">
                  KES {totalAmount.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Status feedback */}
            {pollStatus === "polling" && (
              <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Loader2 className="h-5 w-5 text-green-400 shrink-0 mt-0.5 animate-spin" />
                  <div>
                    <p className="text-sm font-medium text-green-400">STK Push Sent — Waiting for PIN…</p>
                    <p className="text-xs text-muted-foreground mt-1">{pollMessage}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Checking automatically every few seconds.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleManualCheck}
                  disabled={isVerifying}
                  className="w-full border-green-500/40 text-green-400 hover:bg-green-500/10 hover:text-green-300"
                >
                  {isVerifying ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Checking with Safaricom…</>
                  ) : (
                    <><RefreshCw className="h-3.5 w-3.5 mr-2" /> I Have Paid — Check Now</>
                  )}
                </Button>
              </div>
            )}

            {pollStatus === "confirmed" && (
              <div className="flex items-start gap-3 p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-green-400">Payment Confirmed! Subscription Activated.</p>
                  <p className="text-xs text-muted-foreground mt-1">{pollMessage}</p>
                </div>
              </div>
            )}

            {(pollStatus === "failed" || pollStatus === "timeout") && (
              <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">
                    {pollStatus === "timeout" ? "Confirmation Timeout" : "Payment Failed"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{pollMessage}</p>
                </div>
              </div>
            )}

            <Button
              onClick={handlePay}
              disabled={isBlocked || !phone || clampedDays < 1}
              className="w-full bg-green-600 hover:bg-green-700 text-white"
            >
              {isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending STK Push…</>
              ) : pollStatus === "polling" ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Waiting for Payment…</>
              ) : (
                `Pay KES ${totalAmount.toFixed(2)} via M-Pesa`
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Payment history */}
        {payments && payments.length > 0 && (
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                Payment History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {payments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between py-2 border-b border-border last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        KES {parseFloat(p.amount as unknown as string ?? "0").toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.mpesaReceipt ?? "Pending"} · {p.days} trading day{p.days !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge
                        className={
                          p.status === "completed"
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : p.status === "pending"
                            ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                            : "bg-red-500/20 text-red-400 border-red-500/30"
                        }
                      >
                        {p.status}
                      </Badge>
                      {p.createdAt && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
