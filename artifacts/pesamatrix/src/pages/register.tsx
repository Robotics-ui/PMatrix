import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useRegister } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, TrendingUp, CheckCircle, Phone } from "lucide-react";

const COOLDOWN_TOTAL = 60;

function CountdownRing({ seconds }: { seconds: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ * (seconds / COOLDOWN_TOTAL);
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="44" height="44" className="-rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" strokeWidth="2.5" className="stroke-muted-foreground/20" />
        <circle
          cx="22" cy="22" r={r}
          fill="none" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ - offset}
          className="stroke-blue-500 transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span className="absolute text-xs font-mono font-semibold text-blue-400">{seconds}</span>
    </div>
  );
}

type Step = "register" | "verify";

export default function RegisterPage() {
  const [, navigate] = useLocation();
  const { login } = useAuth();

  const [step, setStep] = useState<Step>("register");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    referralCode: "",
  });
  const [error, setError] = useState("");

  // OTP step state
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  function startCooldown() {
    setResendCooldown(60);
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

  const { mutate, isPending } = useRegister({
    mutation: {
      onSuccess: (data) => {
        const d = data as typeof data & {
          requiresOtp?: boolean;
          _devOtp?: string;
          promoCode?: string;
          token: string;
        };

        if (d.requiresOtp) {
          setPendingToken(d.token);
          if (d._devOtp) setDevOtp(d._devOtp);
          setStep("verify");
          startCooldown();
        } else {
          login(d.token);
          navigate("/dashboard");
        }
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        setError(e?.data?.error ?? "Registration failed");
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const deviceFingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ].join("|");

    const { referralCode, ...baseForm } = form;
    mutate({
      data: {
        ...baseForm,
        ...(referralCode.trim() ? { referralCode: referralCode.trim().toUpperCase() } : {}),
        deviceFingerprint,
      } as Parameters<typeof mutate>[0]["data"],
    });
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingToken) return;
    setVerifyError("");
    setIsVerifying(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pendingToken}`,
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

      login(pendingToken);

      if (!result.trialActivated && result.trialDeniedReason) {
        setVerifyError(result.trialDeniedReason);
        setTimeout(() => navigate("/dashboard"), 2500);
        return;
      }

      navigate("/dashboard");
    } catch {
      setVerifyError("Verification failed. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!pendingToken || resendCooldown > 0) return;
    setIsResending(true);
    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { Authorization: `Bearer ${pendingToken}` },
      });
      const result = (await res.json()) as { _devOtp?: string };
      if (result._devOtp) setDevOtp(result._devOtp);
      startCooldown();
    } catch {
      // ignore
    } finally {
      setIsResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <span className="text-2xl font-bold text-foreground tracking-tight">PESAMATRIX</span>
          </div>
        </div>

        {step === "register" ? (
          <Card className="border-border bg-card">
            <CardHeader className="space-y-1">
              <CardTitle className="text-2xl font-bold text-center">Create account</CardTitle>
              <CardDescription className="text-center">
                Start your 2-day free trial today
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    placeholder="John Doe"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone (M-Pesa)</Label>
                  <Input
                    id="phone"
                    placeholder="254712345678"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="referralCode">
                    Referral code{" "}
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Input
                    id="referralCode"
                    placeholder="e.g. PESA1234"
                    value={form.referralCode}
                    onChange={(e) =>
                      setForm({ ...form, referralCode: e.target.value.toUpperCase() })
                    }
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  disabled={isPending}
                >
                  {isPending ? "Creating account..." : "Create account"}
                </Button>
              </form>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-blue-400 hover:text-blue-300 font-medium">
                  Sign in
                </Link>
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border bg-card">
            <CardHeader className="space-y-1">
              <div className="flex justify-center mb-2">
                <div className="h-12 w-12 rounded-full bg-blue-600/20 border border-blue-600/40 flex items-center justify-center">
                  <Phone className="h-6 w-6 text-blue-400" />
                </div>
              </div>
              <CardTitle className="text-xl font-bold text-center">Verify your phone</CardTitle>
              <CardDescription className="text-center">
                We sent a 6-digit code to <span className="font-medium text-foreground">{form.phone}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                {verifyError && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {verifyError}
                  </div>
                )}
                {devOtp && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-blue-600/10 border border-blue-600/20 text-blue-400 text-sm">
                    <CheckCircle className="h-4 w-4 shrink-0" />
                    <span>Dev mode — your code is: <strong>{devOtp}</strong></span>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="otp">Verification code</Label>
                  <Input
                    id="otp"
                    placeholder="123456"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="text-center text-2xl tracking-widest font-mono"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    The code expires in 10 minutes
                  </p>
                </div>
                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  disabled={isVerifying || otp.length < 6}
                >
                  {isVerifying ? "Verifying..." : "Verify phone number"}
                </Button>
              </form>
              <div className="mt-5 flex flex-col items-center gap-2">
                {resendCooldown > 0 ? (
                  <>
                    <CountdownRing seconds={resendCooldown} />
                    <p className="text-xs text-muted-foreground">
                      Resend available in <span className="font-semibold text-blue-400">{resendCooldown}s</span>
                    </p>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={isResending}
                    className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
                  >
                    {isResending ? (
                      <>
                        <span className="h-3.5 w-3.5 rounded-full border-2 border-blue-400/30 border-t-blue-400 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      "Didn't receive it? Resend code"
                    )}
                  </button>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
