import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  CreditCard,
  Server,
  Users,
  GitBranch,
  Link2,
  BarChart3,
  Shield,
  LogOut,
  TrendingUp,
  ChevronRight,
  Newspaper,
  BookOpen,
  Bell,
  Image,
  Info,
  Phone,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/payment", label: "Subscribe", icon: CreditCard },
  { href: "/master-accounts", label: "Master Accounts", icon: Server },
  { href: "/slave-accounts", label: "Slave Accounts", icon: Users },
  { href: "/strategies", label: "Strategies", icon: GitBranch },
  { href: "/bindings", label: "Bindings", icon: Link2 },
  { href: "/trade-logs", label: "Trade Logs", icon: BarChart3 },
  { href: "/news", label: "News", icon: Newspaper },
  { href: "/resources", label: "Resources", icon: BookOpen },
  { href: "/announcements", label: "Announcements", icon: Bell },
  { href: "/about", label: "About Us", icon: Info },
  { href: "/contacts", label: "Contacts", icon: Phone },
];

const adminNavItems = [
  { href: "/admin", label: "Admin Panel", icon: Shield },
  { href: "/admin/diagnostics", label: "MetaApi Diagnostics", icon: Activity },
  { href: "/admin/media-center", label: "Media Center", icon: Image },
  { href: "/admin/news", label: "Trading News", icon: Newspaper },
  { href: "/admin/resources", label: "Resources", icon: BookOpen },
  { href: "/admin/announcements", label: "Announcements", icon: Bell },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  return (
    <aside className="flex flex-col w-64 h-screen bg-card border-r border-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-6 h-16 border-b border-border shrink-0">
        <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
          <TrendingUp className="h-5 w-5 text-white" />
        </div>
        <span className="text-lg font-bold text-foreground tracking-tight">PESAMATRIX</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = location === href || location.startsWith(href + "/");
          return (
            <Link key={href} href={href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors",
                  active
                    ? "bg-blue-600/20 text-blue-400 border border-blue-600/30"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {active && <ChevronRight className="h-3 w-3" />}
              </div>
            </Link>
          );
        })}

        {user?.role === "admin" && (
          <div className="mt-4 space-y-1">
            <p className="px-3 text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1">Admin</p>
            {adminNavItems.map(({ href, label, icon: Icon }) => {
              const active = href === "/admin" ? location === "/admin" : location.startsWith(href);
              return (
                <Link key={href} href={href}>
                  <div
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors border",
                      active
                        ? "bg-green-600/20 text-green-400 border-green-600/30"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground border-transparent"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1">{label}</span>
                    {active && <ChevronRight className="h-3 w-3" />}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </nav>

      {/* User footer */}
      <div className="px-3 py-4 border-t border-border">
        <div className="flex items-center gap-3 px-3 py-2">
          <div className="h-8 w-8 rounded-full bg-blue-600/20 border border-blue-600/40 flex items-center justify-center text-blue-400 text-sm font-semibold shrink-0">
            {user?.name?.[0]?.toUpperCase() ?? "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{user?.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={logout} className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
