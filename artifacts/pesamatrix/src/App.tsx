import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ThemeProvider } from "@/contexts/theme-context";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import DashboardPage from "@/pages/dashboard";
import PaymentPage from "@/pages/payment";
import MasterAccountsPage from "@/pages/master-accounts";
import SlaveAccountsPage from "@/pages/slave-accounts";
import StrategiesPage from "@/pages/strategies";
import BindingsPage from "@/pages/bindings";
import TradeLogsPage from "@/pages/trade-logs";
import AdminPage from "@/pages/admin/index";
import NewsPage from "@/pages/news";
import ResourcesPage from "@/pages/resources";
import AnnouncementsPage from "@/pages/announcements";
import AdminMediaCenterPage from "@/pages/admin/media-center";
import AdminNewsPage from "@/pages/admin/news-admin";
import AdminResourcesPage from "@/pages/admin/resources-admin";
import AdminAnnouncementsPage from "@/pages/admin/announcements-admin";
import ChangePasswordPage from "@/pages/change-password";
import MarketPulsePage from "@/pages/market-pulse";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import AboutPage from "@/pages/about";
import ContactsPage from "@/pages/contacts";
import LandingPage from "@/pages/landing";
import DiagnosticsPage from "@/pages/diagnostics";
import AdminSmsPage from "@/pages/admin/sms-admin";
import NotificationPreferencesPage from "@/pages/notification-preferences";
import ReferralsPage from "@/pages/referrals";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function GuestRoute({ component: Component }: { component: React.ComponentType }) {
  const { token, isLoading } = useAuth();
  if (isLoading) return null;
  if (token) return <Redirect to="/dashboard" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <GuestRoute component={LandingPage} />} />
      <Route path="/login" component={() => <GuestRoute component={LoginPage} />} />
      <Route path="/register" component={() => <GuestRoute component={RegisterPage} />} />
      <Route path="/dashboard" component={DashboardPage} />
      <Route path="/payment" component={PaymentPage} />
      <Route path="/master-accounts" component={MasterAccountsPage} />
      <Route path="/slave-accounts" component={SlaveAccountsPage} />
      <Route path="/strategies" component={StrategiesPage} />
      <Route path="/bindings" component={BindingsPage} />
      <Route path="/trade-logs" component={TradeLogsPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/news" component={NewsPage} />
      <Route path="/resources" component={ResourcesPage} />
      <Route path="/announcements" component={AnnouncementsPage} />
      <Route path="/admin/media-center" component={AdminMediaCenterPage} />
      <Route path="/admin/news" component={AdminNewsPage} />
      <Route path="/admin/resources" component={AdminResourcesPage} />
      <Route path="/admin/announcements" component={AdminAnnouncementsPage} />
      <Route path="/admin/diagnostics" component={DiagnosticsPage} />
      <Route path="/admin/sms" component={AdminSmsPage} />
      <Route path="/settings/notifications" component={NotificationPreferencesPage} />
      <Route path="/referrals" component={ReferralsPage} />
      <Route path="/change-password" component={ChangePasswordPage} />
      <Route path="/market" component={MarketPulsePage} />
      <Route path="/forgot-password" component={() => <GuestRoute component={ForgotPasswordPage} />} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/about" component={AboutPage} />
      <Route path="/contacts" component={ContactsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppWithTheme() {
  const { token } = useAuth();
  return (
    <ThemeProvider token={token}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
      <Toaster />
    </ThemeProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AppWithTheme />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
