import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, MessageCircle, ExternalLink } from "lucide-react";

const phones = [
  { label: "Primary", number: "+254717434943", tel: "tel:+254717434943" },
  { label: "Secondary", number: "+254781585319", tel: "tel:+254781585319" },
];

const socials = [
  {
    key: "whatsapp",
    label: "WhatsApp",
    display: "+254717434943",
    sub: "Chat with us on WhatsApp",
    href: "https://wa.me/254717434943",
    icon: MessageCircle,
    badgeClass: "bg-green-600/20 text-green-400 border-green-600/30 hover:bg-green-600/20",
    iconBg: "bg-green-600/20 border-green-600/30",
    iconColor: "text-green-400",
    cardHover: "hover:border-green-600/40",
  },
  {
    key: "tiktok",
    label: "TikTok",
    display: "@pesamatrixsignals",
    sub: "Follow us on TikTok",
    href: "https://tiktok.com/@pesamatrixsignals",
    icon: ({ className }: { className?: string }) => (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V9.67a8.18 8.18 0 0 0 4.79 1.52V7.73a4.85 4.85 0 0 1-1.02-.04Z" />
      </svg>
    ),
    badgeClass: "bg-blue-600/20 text-blue-400 border-blue-600/30 hover:bg-blue-600/20",
    iconBg: "bg-blue-600/20 border-blue-600/30",
    iconColor: "text-blue-400",
    cardHover: "hover:border-blue-600/40",
    newTab: true,
  },
];

export default function ContactsPage() {
  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border pb-6">
          <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
            <Phone className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Contacts</h1>
            <p className="text-sm text-muted-foreground">Get in touch with us</p>
          </div>
        </div>

        {/* Phone Numbers */}
        <Card className="bg-card border-border">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30 hover:bg-blue-600/20">
                Phone Numbers
              </Badge>
            </div>
            <h2 className="text-lg font-semibold text-foreground">Call us directly</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {phones.map(({ label, number, tel }) => (
                <a
                  key={tel}
                  href={tel}
                  className="flex items-center gap-4 p-4 rounded-xl bg-muted/40 border border-border hover:border-blue-600/40 hover:bg-blue-600/5 transition-all group"
                >
                  <div className="h-10 w-10 rounded-lg bg-blue-600/20 border border-blue-600/30 flex items-center justify-center shrink-0 group-hover:bg-blue-600/30 transition-colors">
                    <Phone className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-base font-semibold text-foreground group-hover:text-blue-400 transition-colors">
                      {number}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Social / Messaging */}
        <div className="space-y-4">
          {socials.map(({ key, label, display, sub, href, icon: Icon, badgeClass, iconBg, iconColor, cardHover, newTab }) => (
            <a
              key={key}
              href={href}
              target={newTab ? "_blank" : undefined}
              rel={newTab ? "noopener noreferrer" : undefined}
              className={`flex items-center gap-4 p-5 rounded-xl bg-card border border-border ${cardHover} hover:bg-muted/30 transition-all group block`}
            >
              <div className={`h-12 w-12 rounded-xl ${iconBg} border flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform`}>
                <Icon className={`h-6 w-6 ${iconColor}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge className={`${badgeClass} text-xs`}>{label}</Badge>
                </div>
                <p className="text-base font-semibold text-foreground group-hover:text-blue-400 transition-colors truncate">
                  {display}
                </p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </div>
              {newTab && (
                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-blue-400 transition-colors shrink-0" />
              )}
            </a>
          ))}
        </div>

        {/* Footer contact summary */}
        <Card className="bg-muted/20 border-border">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">Quick Contact</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Phone</span>
                <a href="tel:+254717434943" className="text-blue-400 hover:text-blue-300 font-medium transition-colors">
                  +254717434943
                </a>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">WhatsApp</span>
                <a href="https://wa.me/254717434943" className="text-green-400 hover:text-green-300 font-medium transition-colors">
                  +254717434943
                </a>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">TikTok</span>
                <a
                  href="https://tiktok.com/@pesamatrixsignals"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
                >
                  @pesamatrixsignals
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
