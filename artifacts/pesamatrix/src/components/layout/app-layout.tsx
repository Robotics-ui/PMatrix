import { useAuth } from "@/hooks/use-auth";
import { Sidebar } from "./sidebar";
import { ForexBanner } from "@/components/forex-banner";
import { useLocation } from "wouter";
import { useEffect } from "react";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, isLoading, token } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !token) {
      navigate("/login");
    }
  }, [isLoading, token, navigate]);

  if (isLoading) {
    return (
      <div className="dark min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="h-5 w-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="dark flex h-screen bg-background overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <ForexBanner />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
