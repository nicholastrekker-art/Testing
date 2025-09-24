import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/dashboard";
import BotInstances from "@/pages/bot-instances";
import Commands from "@/pages/commands";
import AdminConsole from "@/pages/admin-console";
import NotFound from "@/pages/not-found";
import GuestPhoneVerification from "@/pages/guest/verification";
import GuestBotManagement from "@/pages/guest/bot-management";
import GuestCrossServer from "@/pages/guest/cross-server";
import Sidebar from "@/components/sidebar";
import ProtectedRoute from "@/components/protected-route";
import { AuthProvider } from "@/hooks/use-auth";

function Router() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/bot-instances">
            <ProtectedRoute requireAdmin={true}>
              <BotInstances />
            </ProtectedRoute>
          </Route>
          <Route path="/commands">
            <ProtectedRoute requireAdmin={true}>
              <Commands />
            </ProtectedRoute>
          </Route>
          <Route path="/admin">
            <ProtectedRoute requireAdmin={true}>
              <AdminConsole />
            </ProtectedRoute>
          </Route>
          <Route path="/guest/verification" component={GuestPhoneVerification} />
          <Route path="/guest/bot-management" component={GuestBotManagement} />
          <Route path="/guest/cross-server" component={GuestCrossServer} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <div className="dark">
            <Toaster />
            <Router />
          </div>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;