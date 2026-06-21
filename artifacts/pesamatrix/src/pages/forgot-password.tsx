import { useState } from "react";
import { Link } from "wouter";
import { useForgotPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, TrendingUp, Copy, Check, ArrowLeft, Clock } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { mutate, isPending } = useForgotPassword({
    mutation: {
      onSuccess: (data) => {
        if (data.resetLink) {
          setResetLink(data.resetLink);
        } else {
          setError("No account found with that email address.");
        }
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        setError(e?.data?.error ?? "Something went wrong. Please try again.");
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setResetLink(null);
    mutate({ data: { email } });
  };

  const copyLink = () => {
    if (!resetLink) return;
    void navigator.clipboard.writeText(resetLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

        <Card className="border-border bg-card">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">Reset Password</CardTitle>
            <CardDescription className="text-center">
              Enter your email to receive a password reset link
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!resetLink ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  disabled={isPending}
                >
                  {isPending ? "Generating link..." : "Get Reset Link"}
                </Button>
                <Link
                  href="/login"
                  className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to login
                </Link>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 rounded-md bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
                  <Check className="h-4 w-4 shrink-0" />
                  Reset link generated successfully.
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Your reset link</Label>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Expires in 1 hour
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs font-mono text-muted-foreground break-all">
                      {resetLink}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={copyLink}
                    >
                      {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Copy and open this link to set your new password. It can only be used once.
                  </p>
                </div>

                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  onClick={() => { window.location.href = resetLink; }}
                >
                  Open Reset Link
                </Button>

                <button
                  type="button"
                  className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setResetLink(null); setEmail(""); }}
                >
                  Generate another link
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
