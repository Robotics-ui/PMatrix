import { useEffect, useRef, useState } from "react";
import { AppLayout } from "@/components/layout/app-layout";
import { useAuth } from "@/hooks/use-auth";
import { useGetDashboardSummary, useGetMySubscription, useGetAdminSettings, getGetMySubscriptionQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  TrendingUp,
  Server,
  Users,
  GitBranch,
  Link2,
  Calendar,
  CreditCard,
  Clock,
  Activity,
  AlertCircle,
  Phone,
  CheckCircle,
  CheckCircle2,
  Circle,
  RefreshCw,
  HelpCircle,
  ChevronRight,
  Copy,
  Gift,
} from "lucide-react";

interface CriticalAnnouncement {
  id: number; title: string; message: string; priority: string;
}

interface OtpStatus {
  phoneVerified: boolean;
  requiresOtp: boolean;
  subscriptionStatus: string;
}

const COOLDOWN_TOTAL = 60;

function CountdownRing({ seconds }: { seconds: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ * (seconds / COOLDOWN_TOTAL);
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="36" height="36" className="-rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="2.5" className="stroke-muted-foreground/20" />
        <circle
          cx="18" cy="18" r={r}
          fill="none" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - offset}
          className="stroke-blue-500 transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span className="absolute text-[10px] font-mono font-semibold text-blue-400">{seconds}</span>
    </div>
  );
}

// ── Phone Verification Banner ─────────────────────────────────────────────────

function PhoneVerificationBanner({ token }: { token: string | null }) {
  const queryClient = useQueryClient();

  const { data: otpStatus, refetch: refetchOtpStatus } = useQuery<OtpStatus>({
    queryKey: ["otp-status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/otp-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { phoneVerified: true, requiresOtp: false, subscriptionStatus: "expired" };
      return res.json() as Promise<OtpStatus>;
    },
    enabled: !!token,
    staleTime: 30_000,
  });

  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [verified, setVerified] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startCooldown(seconds = COOLDOWN_TOTAL) {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setResendCooldown(seconds);
    cooldownRef.current = setInterval(() => {
      setResendCooldown((c) => {
        if (c <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  // Start initial cooldown on mount — OTP was already sent at registration
  useEffect(() => {
    startCooldown();
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setVerifyError("");
    setIsVerifying(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: otp.trim() }),
      });
      const result = (await res.json()) as {
        trialActivated?: boolean;
        message?: string;
        trialDeniedReason?: string;
        error?: string;
      };

      if (!res.ok) {
        setVerifyError(result.error ?? "Verification failed");
        return;
      }

      setVerified(true);
      await refetchOtpStatus();
      queryClient.invalidateQueries({ queryKey: getGetMySubscriptionQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });

      if (!result.trialActivated && result.trialDeniedReason) {
        setVerifyError(result.trialDeniedReason);
      }
    } catch {
      setVerifyError("Verification failed. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!token || resendCooldown > 0) return;
    setIsResending(true);
    setVerifyError("");
    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = (await res.json()) as { _devOtp?: string; error?: string };
      if (!res.ok) {
        setVerifyError(result.error ?? "Failed to send code");
        return;
      }
      if (result._devOtp) setDevOtp(result._devOtp);
      startCooldown();
    } catch {
      setVerifyError("Failed to send code. Please try again.");
    } finally {
      setIsResending(false);
    }
  };

  // Don't show if status not loaded or phone already verified
  if (!otpStatus || !otpStatus.requiresOtp) return null;

  // Trial already used — show subscribe prompt instead
  const trialDenied = verified && verifyError;

  return (
    <div className="rounded-lg border border-blue-500/40 bg-blue-600/10 p-4">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-blue-600/20 border border-blue-600/40 flex items-center justify-center shrink-0 mt-0.5">
          <Phone className="h-4 w-4 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-blue-300">
            {verified && !verifyError
              ? "Phone verified — free trial active"
              : "Verify your phone to activate your free trial"}
          </p>
          {verified && !verifyError ? (
            <div className="flex items-center gap-1.5 mt-1">
              <CheckCircle className="h-4 w-4 text-green-400" />
              <p className="text-sm text-green-400">Your 2-day free trial has been activated.</p>
            </div>
          ) : (
            <p className="text-xs text-blue-300/70 mt-0.5">
              {trialDenied
                ? verifyError
                : "Enter the 6-digit code sent to your registered phone number."}
            </p>
          )}

          {!verified && (
            <>
              {devOtp && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-blue-300/80">
                  <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                  Dev mode — code: <strong>{devOtp}</strong>
                </div>
              )}

              {verifyError && !trialDenied && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {verifyError}
                </div>
              )}

              <form onSubmit={handleVerify} className="mt-3 flex items-center gap-2 flex-wrap">
                <Input
                  placeholder="123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="w-32 text-center font-mono tracking-widest text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
                  disabled={isVerifying || otp.length < 6}
                >
                  {isVerifying ? "Verifying..." : "Verify"}
                </Button>
              </form>
              <div className="mt-3 flex items-center gap-2">
                {resendCooldown > 0 ? (
                  <>
                    <CountdownRing seconds={resendCooldown} />
                    <span className="text-xs text-muted-foreground">
                      Resend in <span className="font-semibold text-blue-400">{resendCooldown}s</span>
                    </span>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isResending}
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
                  >
                    {isResending ? (
                      <>
                        <span className="h-3 w-3 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-3 w-3" />
                        Resend code
                      </>
                    )}
                  </button>
                )}
              </div>
            </>
          )}

          {trialDenied && (
            <div className="mt-3">
              <Link href="/payment">
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700">Subscribe Now</Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Getting Started Checklist ─────────────────────────────────────────────────

interface SummaryShape {
  slaveAccounts?: number | null;
  strategies?: number | null;
  activeBindings?: number | null;
}

function GettingStartedChecklist({
  token,
  summary,
}: {
  token: string | null;
  summary: SummaryShape | undefined;
}) {
  const { data: otpStatus } = useQuery<OtpStatus>({
    queryKey: ["otp-status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/otp-status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { phoneVerified: true, requiresOtp: false, subscriptionStatus: "expired" };
      return res.json() as Promise<OtpStatus>;
    },
    enabled: !!token,
    staleTime: 30_000,
  });

  const steps = [
    {
      done: otpStatus?.phoneVerified ?? false,
      label: "Verify your phone number",
      detail: "Confirm the OTP sent to you to activate your 2-day free trial",
      href: null as string | null,
      icon: Phone,
    },
    {
      done: (summary?.slaveAccounts ?? 0) > 0,
      label: "Add a slave account",
      detail: "Connect an MT5/MT4 follower account that will copy trades",
      href: "/slave-accounts",
      icon: Users,
    },
    {
      done: (summary?.strategies ?? 0) > 0,
      label: "Create a strategy",
      detail: "Link a master account to a CopyFactory strategy",
      href: "/strategies",
      icon: GitBranch,
    },
    {
      done: (summary?.activeBindings ?? 0) > 0,
      label: "Create a binding",
      detail: "Connect your slave account to a strategy to start copying",
      href: "/bindings",
      icon: Link2,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  if (allDone) return null;

  return (
    <Card className="border-blue-600/30 bg-blue-600/5">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Getting started
          </div>
          <span className="text-xs text-muted-foreground">
            {doneCount}/{steps.length} complete
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-600 to-green-500 rounded-full transition-all duration-500"
            style={{ width: `${(doneCount / steps.length) * 100}%` }}
          />
        </div>

        <ol className="space-y-2 pt-1">
          {steps.map(({ done, label, detail, href, icon: Icon }, i) => {
            const content = (
              <div
                className={`flex items-start gap-3 rounded-md px-2 py-1.5 transition-colors ${
                  done ? "opacity-50" : href ? "hover:bg-blue-600/10 cursor-pointer" : ""
                }`}
              >
                <div className="shrink-0 mt-0.5">
                  {done ? (
                    <CheckCircle className="h-4 w-4 text-green-400" />
                  ) : (
                    <Circle className="h-4 w-4 text-blue-400/50" />
                  )}
                </div>
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <Icon className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${done ? "text-muted-foreground" : "text-blue-400"}`} />
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                      {i + 1}. {label}
                    </p>
                    {!done && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
                  </div>
                </div>
                {!done && href && (
                  <span className="text-xs text-blue-400 shrink-0 mt-0.5">Go &rarr;</span>
                )}
              </div>
            );

            return (
              <li key={i}>
                {href && !done ? <Link href={href}>{content}</Link> : content}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}

// ── Referral Card ─────────────────────────────────────────────────────────────

interface MyReferralData {
  promoCode: string | null;
  totalReferrals: number;
  pendingRewards: number;
  totalRewardDays: number;
}

function ReferralCard({ token }: { token: string | null }) {
  const { data, isLoading } = useQuery<MyReferralData>({
    queryKey: ["referrals-my"],
    queryFn: async () => {
      const res = await fetch("/api/referrals/my", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load referral data");
      return res.json() as Promise<MyReferralData>;
    },
    enabled: !!token,
    staleTime: 60_000,
  });

  const [codeCopied, setCodeCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const promoCode = data?.promoCode ?? null;
  const referralLink = promoCode
    ? `${window.location.origin}/register?ref=${promoCode}`
    : null;

  function copyText(text: string, type: "code" | "link") {
    void navigator.clipboard.writeText(text).then(() => {
      if (type === "code") {
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 2000);
      } else {
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      }
    });
  }

  if (isLoading) return null;
  if (!promoCode) return null;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Gift className="h-4 w-4 text-green-400" />
          Refer a Friend
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Share your code and earn bonus trading days for every friend who subscribes.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats row */}
        {(data!.totalReferrals > 0 || data!.totalRewardDays > 0) && (
          <div className="flex gap-4">
            <div className="flex-1 rounded-lg bg-muted/40 px-4 py-3 text-center">
              <p className="text-xl font-bold text-foreground">{data!.totalReferrals}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Friends referred</p>
            </div>
            <div className="flex-1 rounded-lg bg-muted/40 px-4 py-3 text-center">
              <p className="text-xl font-bold text-green-400">{data!.totalRewardDays}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Bonus days earned</p>
            </div>
            {data!.pendingRewards > 0 && (
              <div className="flex-1 rounded-lg bg-blue-600/10 px-4 py-3 text-center">
                <p className="text-xl font-bold text-blue-400">{data!.pendingRewards}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Pending rewards</p>
              </div>
            )}
          </div>
        )}

        {/* Code copy */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Your referral code</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-sm font-semibold tracking-widest text-foreground select-all">
              {promoCode}
            </div>
            <button
              onClick={() => copyText(promoCode, "code")}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors shrink-0 ${
                codeCopied
                  ? "border-green-500/50 bg-green-500/10 text-green-400"
                  : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {codeCopied ? (
                <><CheckCircle2 className="h-3.5 w-3.5" /> Copied</>
              ) : (
                <><Copy className="h-3.5 w-3.5" /> Copy</>
              )}
            </button>
          </div>
        </div>

        {/* Link copy */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Or share your referral link</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground truncate select-all font-mono">
              {referralLink}
            </div>
            <button
              onClick={() => copyText(referralLink!, "link")}
              className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors shrink-0 ${
                linkCopied
                  ? "border-green-500/50 bg-green-500/10 text-green-400"
                  : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {linkCopied ? (
                <><CheckCircle2 className="h-3.5 w-3.5" /> Copied</>
              ) : (
                <><Copy className="h-3.5 w-3.5" /> Copy</>
              )}
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── FAQ Widget ────────────────────────────────────────────────────────────────

interface FaqItem { id: number; question: string; category: string; viewCount: number; }

function FaqWidget() {
  const { data: faqs = [] } = useQuery<FaqItem[]>({
    queryKey: ["faqs-dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/faqs");
      if (!res.ok) return [];
      return (res.json() as Promise<FaqItem[]>);
    },
    staleTime: 5 * 60 * 1000,
    select: (data) =>
      [...data].sort((a, b) => b.viewCount - a.viewCount).slice(0, 4),
  });

  if (faqs.length === 0) return null;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-blue-400" />
            Popular Questions
          </CardTitle>
          <Link href="/faq">
            <button className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
              View all <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {faqs.map((faq) => (
            <Link key={faq.id} href="/faq">
              <div className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer group">
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0 group-hover:text-blue-400 transition-colors" />
                <p className="text-sm text-foreground flex-1 leading-snug truncate group-hover:text-blue-300 transition-colors">
                  {faq.question}
                </p>
                <Badge variant="outline" className="text-xs text-muted-foreground border-border shrink-0 hidden sm:flex">
                  {faq.category}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Critical Announcements ────────────────────────────────────────────────────

function CriticalAnnouncementBanner({ token }: { token: string | null }) {
  const { data: announcements = [] } = useQuery<CriticalAnnouncement[]>({
    queryKey: ["announcements-critical"],
    queryFn: async () => {
      const res = await fetch("/api/announcements", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return [];
      return (res.json() as Promise<CriticalAnnouncement[]>);
    },
    enabled: !!token,
    select: (data) => data.filter((a) => a.priority === "critical"),
  });

  if (announcements.length === 0) return null;

  return (
    <div className="space-y-2">
      {announcements.map((a) => (
        <div key={a.id} className="flex items-start gap-3 rounded-lg border border-red-600/40 bg-red-600/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-red-300 text-sm">{a.title}: </span>
            <span className="text-sm text-red-200/80 line-clamp-2">{a.message}</span>
          </div>
          <Link href="/announcements">
            <span className="text-xs text-red-400 underline shrink-0 cursor-pointer">View all</span>
          </Link>
        </div>
      ))}
    </div>
  );
}

// ── Subscription Countdown ────────────────────────────────────────────────────

function SubscriptionCountdown({ endDate, daysLeft }: { endDate?: string | null; daysLeft?: number | null }) {
  if (!endDate || !daysLeft || daysLeft <= 0) {
    return (
      <Card className="border-orange-500/30 bg-orange-500/5">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-orange-400">No Active Subscription</p>
              <p className="text-xs text-muted-foreground mt-1">Subscribe to start copy trading</p>
            </div>
            <Link href="/payment">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700">Subscribe Now</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const end = new Date(endDate);
  const urgent = daysLeft <= 2;

  return (
    <Card className={`border-${urgent ? "orange" : "green"}-500/30 bg-${urgent ? "orange" : "green"}-500/5`}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${urgent ? "bg-orange-500/20" : "bg-green-500/20"}`}>
              <Clock className={`h-5 w-5 ${urgent ? "text-orange-400" : "text-green-400"}`} />
            </div>
            <div>
              <p className={`text-sm font-semibold ${urgent ? "text-orange-400" : "text-green-400"}`}>
                {daysLeft} trading day{daysLeft !== 1 ? "s" : ""} remaining
              </p>
              <p className="text-xs text-muted-foreground">Expires {end.toLocaleDateString()}</p>
            </div>
          </div>
          <Link href="/payment">
            <Button size="sm" variant="outline" className={urgent ? "border-orange-500/40 text-orange-400" : "border-green-500/40 text-green-400"}>
              {urgent ? "Renew Now" : "Top Up"}
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Dashboard Page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user, token } = useAuth();
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: subscription } = useGetMySubscription();
  const { data: settings } = useGetAdminSettings();

  const dailyFee = settings?.dailyFee ?? 100;
  const minDays = settings?.minDays ?? 1;
  const maxDays = settings?.maxDays ?? 365;

  const stats = [
    { label: "Master Accounts", value: summary?.masterAccounts ?? 0, icon: Server, color: "blue" },
    { label: "Slave Accounts", value: summary?.slaveAccounts ?? 0, icon: Users, color: "blue" },
    { label: "Strategies", value: summary?.strategies ?? 0, icon: GitBranch, color: "green" },
    { label: "Active Bindings", value: summary?.activeBindings ?? 0, icon: Link2, color: "green" },
  ];

  return (
    <AppLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Welcome back, {user?.name?.split(" ")[0]}</h1>
          <p className="text-muted-foreground text-sm mt-1">Here&apos;s your trading overview</p>
        </div>

        {/* Phone verification banner — shown when OTP is pending */}
        <PhoneVerificationBanner token={token} />

        {/* Getting started checklist — auto-hides once all steps complete */}
        <GettingStartedChecklist token={token} summary={summary} />

        {/* Critical announcements */}
        <CriticalAnnouncementBanner token={token} />

        {/* Subscription status */}
        <SubscriptionCountdown
          endDate={subscription?.endDate}
          daysLeft={subscription?.remainingTradingDays}
        />

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="border-border">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-2xl font-bold text-foreground mt-1">
                      {isLoading ? "—" : value}
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

        {/* Recent trade performance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Activity className="h-4 w-4 text-blue-400" />
                Copy Trading Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summary?.activeBindings ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Active bindings</span>
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30">{summary.activeBindings} active</Badge>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-600 to-green-500 rounded-full transition-all"
                      style={{ width: `${Math.min((summary.activeBindings / Math.max(summary.slaveAccounts || 1, 1)) * 100, 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {summary.activeBindings} of {summary.slaveAccounts} slave accounts actively copying
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center py-6 text-center space-y-2">
                  <Link2 className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No active bindings yet</p>
                  <Link href="/bindings">
                    <Button size="sm" variant="outline" className="mt-2">Set up bindings</Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4 text-green-400" />
                Subscription Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Pricing info — always visible */}
              <div className="mb-3 pb-3 border-b border-border">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Rate</span>
                  <span className="text-blue-400 font-semibold">KES {dailyFee.toFixed(0)} / trading day</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Plans available</span>
                  <span className="text-foreground">{minDays}–{maxDays} days</span>
                </div>
              </div>
              {subscription ? (
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <Badge
                      className={
                        subscription.status === "active" || subscription.status === "free_trial"
                          ? "bg-green-500/20 text-green-400 border-green-500/30"
                          : "bg-red-500/20 text-red-400 border-red-500/30"
                      }
                    >
                      {subscription.status === "free_trial" ? "Free Trial" : subscription.status}
                    </Badge>
                  </div>
                  {subscription.startDate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Started</span>
                      <span className="text-foreground">{new Date(subscription.startDate).toLocaleDateString()}</span>
                    </div>
                  )}
                  {subscription.endDate && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Expires</span>
                      <span className="text-foreground">{new Date(subscription.endDate).toLocaleDateString()}</span>
                    </div>
                  )}
                  {subscription.daysPaid != null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Days paid</span>
                      <span className="text-foreground">{subscription.daysPaid} trading days</span>
                    </div>
                  )}
                  {subscription.daysPaid != null && (
                    <div className="flex justify-between text-sm font-medium">
                      <span className="text-muted-foreground">Total paid</span>
                      <span className="text-foreground">KES {(subscription.daysPaid * dailyFee).toFixed(0)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center py-4 text-center space-y-2">
                  <CreditCard className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No active subscription</p>
                  <Link href="/payment">
                    <Button size="sm" className="mt-2 bg-blue-600 hover:bg-blue-700">Subscribe Now</Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Referral card */}
        <ReferralCard token={token} />

        {/* Popular FAQs widget */}
        <FaqWidget />

        {/* Recent trade logs */}
        {summary?.recentTradeLogs && summary.recentTradeLogs.length > 0 && (
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-400" />
                Recent Trade Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {summary.recentTradeLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0 text-sm">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-xs font-mono">{log.action}</Badge>
                      {log.details && (
                        <span className="text-muted-foreground text-xs truncate max-w-[200px]">{log.details}</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </span>
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
