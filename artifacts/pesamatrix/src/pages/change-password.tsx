import { useState } from "react";
import { useLocation } from "wouter";
import { useChangePassword } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, TrendingUp, ShieldCheck } from "lucide-react";

export default function ChangePasswordPage() {
  const [, navigate] = useLocation();
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const { mutate, isPending } = useChangePassword({
    mutation: {
      onSuccess: () => {
        logout();
        navigate("/login");
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string } };
        setError(e?.data?.error ?? "Failed to change password");
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }

    mutate({ data: { currentPassword, newPassword } });
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
            <div className="flex justify-center mb-2">
              <div className="h-12 w-12 rounded-full bg-blue-600/10 border border-blue-600/30 flex items-center justify-center">
                <ShieldCheck className="h-6 w-6 text-blue-400" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold text-center">Set a new password</CardTitle>
            <CardDescription className="text-center">
              Your account uses a temporary password. Please set a permanent one before continuing.
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
                <Label htmlFor="currentPassword">Current (temporary) password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  placeholder="••••••••"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="At least 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Repeat new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700"
                disabled={isPending}
              >
                {isPending ? "Saving..." : "Set new password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
