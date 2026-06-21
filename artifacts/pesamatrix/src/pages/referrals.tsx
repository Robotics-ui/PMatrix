import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppLayout } from "@/components/layout/app-layout";
import { useAuth } from "@/hooks/use-auth";
import {
  Copy,
  Gift,
  Users,
  Trophy,
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ReferralMilestone {
  id: number;
  referralsRequired: number;
  rewardDays: number;
  isEnabled: boolean;
}

interface ReferredUser {
  referralId: number;
  name: string;
  email: string;
  joinedAt: string | null;
  status: "pending" | "rewarded" | "rejected";
  rewardDays: number;
  rewardedAt: string | null;
}

interface DashboardData {
  promoCode: string | null;
  totalReferrals: number;
  pendingRewards: number;
  totalRewardDays: number;
  referredUsers: ReferredUser[];
}

async function apiFetch<T>(path: string, token: string | null): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { headers });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json() as Promise<T>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "rewarded") {
    return (
      <Badge className="gap-1 bg-green-600/20 text-green-400 border-green-600/30">
        <CheckCircle2 className="h-3 w-3" />
        Rewarded
      </Badge>
    );
  }
  if (status === "rejected") {
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" />
        Rejected
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Clock className="h-3 w-3" />
      Pending
    </Badge>
  );
}

export default function ReferralsPage() {
  const { toast } = useToast();
  const { token } = useAuth();
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ["referrals-dashboard"],
    queryFn: () => apiFetch<DashboardData>("/api/referrals/my", token),
  });

  const { data: milestones = [] } = useQuery<ReferralMilestone[]>({
    queryKey: ["referral-milestones"],
    queryFn: () => apiFetch<ReferralMilestone[]>("/api/referrals/settings", token),
  });

  function copyCode() {
    if (!data?.promoCode) return;
    void navigator.clipboard.writeText(data.promoCode).then(() => {
      setCopied(true);
      toast({ title: "Copied", description: "Referral code copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-6 text-muted-foreground">Loading referral dashboard...</div>
      </AppLayout>
    );
  }

  if (error || !data) {
    return (
      <AppLayout>
        <div className="p-6 text-destructive">Failed to load referral dashboard.</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-6 space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Referral Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Share your code. Earn free subscription days when your referrals become active.
          </p>
        </div>

        {/* Promo code card */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gift className="h-4 w-4 text-blue-400" />
              Your Referral Code
            </CardTitle>
            <CardDescription>Share this code with traders to earn subscription rewards</CardDescription>
          </CardHeader>
          <CardContent>
            {data.promoCode ? (
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-muted rounded-lg px-4 py-3 font-mono text-lg font-bold text-foreground tracking-widest text-center">
                  {data.promoCode}
                </div>
                <Button
                  variant="outline"
                  className="gap-2 shrink-0"
                  onClick={copyCode}
                >
                  <Copy className="h-4 w-4" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No referral code assigned yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-border bg-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Users className="h-8 w-8 text-blue-400 shrink-0" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{data.totalReferrals}</p>
                  <p className="text-xs text-muted-foreground">Total Referrals</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Clock className="h-8 w-8 text-yellow-400 shrink-0" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{data.pendingRewards}</p>
                  <p className="text-xs text-muted-foreground">Pending Rewards</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border bg-card">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Trophy className="h-8 w-8 text-green-400 shrink-0" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{data.totalRewardDays}</p>
                  <p className="text-xs text-muted-foreground">Total Days Earned</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Reward milestones */}
        {milestones.length > 0 && (
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Reward Milestones</CardTitle>
              <CardDescription>Earn more days as your referrals grow</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {milestones
                  .filter((m) => m.isEnabled)
                  .map((m) => (
                    <div
                      key={m.id}
                      className={`flex items-center justify-between px-4 py-3 rounded-lg border ${
                        data.totalReferrals >= m.referralsRequired
                          ? "border-green-600/30 bg-green-600/5"
                          : "border-border bg-muted/30"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {data.totalReferrals >= m.referralsRequired ? (
                          <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
                        ) : (
                          <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                        )}
                        <span className="text-sm text-foreground">
                          {m.referralsRequired} referral{m.referralsRequired > 1 ? "s" : ""}
                        </span>
                      </div>
                      <Badge
                        className={
                          data.totalReferrals >= m.referralsRequired
                            ? "bg-green-600/20 text-green-400 border-green-600/30"
                            : "bg-muted text-muted-foreground"
                        }
                      >
                        {m.rewardDays} day{m.rewardDays > 1 ? "s" : ""}
                      </Badge>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Referred users table */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your Referrals</CardTitle>
            <CardDescription>
              Rewards are granted when a referred user makes their first payment or completes their free trial.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.referredUsers.length === 0 ? (
              <p className="text-muted-foreground text-sm py-4 text-center">
                No referrals yet. Share your code to get started.
              </p>
            ) : (
              <div className="space-y-2">
                {data.referredUsers.map((ref) => (
                  <div
                    key={ref.referralId}
                    className="flex items-center justify-between px-4 py-3 rounded-lg border border-border bg-muted/20"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{ref.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{ref.email}</p>
                      {ref.joinedAt && (
                        <p className="text-xs text-muted-foreground/70">
                          Joined {new Date(ref.joinedAt).toLocaleDateString("en-KE")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      {ref.status === "rewarded" && (
                        <span className="text-xs text-green-400 font-medium">
                          +{ref.rewardDays}d
                        </span>
                      )}
                      <StatusBadge status={ref.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
