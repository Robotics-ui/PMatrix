import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  Target,
  Eye,
  CheckCircle2,
  Cloud,
  Zap,
  CreditCard,
  ShieldCheck,
  Users,
  BookOpen,
  Newspaper,
  Bell,
} from "lucide-react";

const features = [
  { icon: Cloud, label: "Cloud-to-cloud copy trading" },
  { icon: Zap, label: "MetaApi CopyFactory integration" },
  { icon: CreditCard, label: "M-Pesa subscription payments" },
  { icon: ShieldCheck, label: "Admin-approved signal providers" },
  { icon: Users, label: "Automated subscriber management" },
  { icon: BookOpen, label: "Trading education resources" },
  { icon: Newspaper, label: "Market news and announcements" },
  { icon: Bell, label: "Real-time trade notifications" },
];

export default function AboutPage() {
  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border pb-6">
          <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
            <TrendingUp className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">About Us</h1>
            <p className="text-sm text-muted-foreground">Learn more about PesaMatrix</p>
          </div>
        </div>

        {/* Company Overview */}
        <Card className="bg-card border-border">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30 hover:bg-blue-600/20">
                Company Overview
              </Badge>
            </div>
            <h2 className="text-xl font-semibold text-foreground">What is PesaMatrix?</h2>
            <p className="text-muted-foreground leading-relaxed">
              PesaMatrix is a cloud-to-cloud copy trading platform designed to connect professional
              traders and subscribers through secure automated trade replication.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              The platform enables approved master traders to share trading signals while subscribers
              automatically copy trades into their MT5 accounts through MetaApi CopyFactory
              technology.
            </p>
          </CardContent>
        </Card>

        {/* Mission & Vision */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="p-6 space-y-3">
              <div className="h-10 w-10 rounded-lg bg-green-600/20 border border-green-600/30 flex items-center justify-center">
                <Target className="h-5 w-5 text-green-400" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Our Mission</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                To provide reliable, transparent and accessible copy trading solutions for traders
                worldwide.
              </p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-6 space-y-3">
              <div className="h-10 w-10 rounded-lg bg-blue-600/20 border border-blue-600/30 flex items-center justify-center">
                <Eye className="h-5 w-5 text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">Our Vision</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                To become a trusted global copy trading ecosystem connecting successful traders with
                investors through secure automation.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Features */}
        <Card className="bg-card border-border">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-green-600/20 text-green-400 border-green-600/30 hover:bg-green-600/20">
                Platform Features
              </Badge>
            </div>
            <h2 className="text-xl font-semibold text-foreground">What we offer</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              {features.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border">
                  <div className="h-8 w-8 rounded-md bg-blue-600/20 border border-blue-600/30 flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-blue-400" />
                  </div>
                  <span className="text-sm text-foreground">{label}</span>
                  <CheckCircle2 className="h-4 w-4 text-green-400 ml-auto shrink-0" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Footer note */}
        <p className="text-center text-xs text-muted-foreground pb-4">
          PesaMatrix — Secure, Automated, Professional Copy Trading
        </p>
      </div>
    </AppLayout>
  );
}
