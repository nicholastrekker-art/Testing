import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import * as React from "react";
import { Link } from "wouter";
import { useWebSocket } from "@/hooks/use-websocket";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { OfferCountdownBanner } from "@/components/offer-countdown-dialog";
import AddBotModal from "@/components/add-bot-modal";
import CommandManagement from "@/components/command-management";
import GuestBotRegistration from "@/components/guest-bot-registration";
import AdminBotManagement from "@/components/admin-bot-management";
import WhatsAppPairing from "@/components/whatsapp-pairing";

// Type definitions
interface ServerInfo {
  serverName?: string;
  currentBots?: number;
  maxBots?: number;
  hasSecretConfig?: boolean;
}

interface GodRegistryEntry {
  phoneNumber: string;
  tenancyName: string;
  registeredAt: string;
}

interface BotFeatures {
  autoLike?: boolean;
  autoReact?: boolean;
  autoView?: boolean;
  typingIndicator?: boolean;
  chatGPT?: boolean;
  [key: string]: boolean | undefined;
}

interface BotSettings {
  features?: BotFeatures;
}

interface BotInstance {
  id: string;
  name: string;
  phoneNumber?: string;
  status: string;
  expirationMonths?: number;
  settings?: BotSettings;
}

export default function Dashboard() {
  const { isAdmin } = useAuth();
  const { toast } = useToast();
  const [showAddBotModal, setShowAddBotModal] = useState(false);
  const [showCommandManagement, setShowCommandManagement] = useState(false);
  const [showGuestRegistration, setShowGuestRegistration] = useState(false);
  const [showAdminBotManagement, setShowAdminBotManagement] = useState(false);
  const [showGodRegistry, setShowGodRegistry] = useState(false);
  const [showWhatsAppPairing, setShowWhatsAppPairing] = useState(false);
  const [selectedBotForFeatures, setSelectedBotForFeatures] = useState<BotInstance | null>(null);
  const [editingRegistration, setEditingRegistration] = useState<GodRegistryEntry | null>(null);

  // Auto-open registration if coming from pairing flow
  React.useEffect(() => {
    // Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const shouldOpenRegistration = urlParams.get('openRegistration') === 'true';

    const autoRegisterFlow = localStorage.getItem('autoRegisterFlow');
    const sessionId = localStorage.getItem('autoRegisterSessionId');
    const phoneNumber = localStorage.getItem('autoRegisterPhoneNumber');
    const timestamp = localStorage.getItem('autoRegisterTimestamp');

    console.log('Dashboard auto-register check:', {
      autoRegisterFlow,
      hasSessionId: !!sessionId,
      hasPhoneNumber: !!phoneNumber,
      timestamp,
      shouldOpenRegistration
    });

    if ((autoRegisterFlow === 'true' || shouldOpenRegistration) && sessionId && phoneNumber) {
      // Clean URL first
      if (shouldOpenRegistration) {
        window.history.replaceState({}, '', '/');
      }

      // Small delay to ensure DOM is ready
      setTimeout(() => {
        localStorage.removeItem('autoRegisterFlow');
        localStorage.removeItem('autoRegisterTimestamp');

        console.log('Opening registration dialog with auto-filled data');
        setShowGuestRegistration(true);

        toast({
          title: "Ready to Register!",
          description: "Your credentials are ready. Complete your bot registration now.",
        });
      }, 100);
    }
  }, [toast]);

  // Fetch dashboard stats
  const { data: stats = {}, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/dashboard/stats"],
  });

  // Fetch server info
  const { data: serverInfo = {} as ServerInfo, isLoading: serverLoading } = useQuery<ServerInfo>({
    queryKey: ["/api/server/info"],
  });

  // Fetch bot instances - ADMIN ONLY
  const { data: botInstances = [], isLoading: botsLoading } = useQuery({
    queryKey: ["/api/bot-instances"],
    enabled: isAdmin
  });

  // Fetch pending bots for admin
  const { data: pendingBots = [], isLoading: pendingLoading } = useQuery({
    queryKey: ["/api/bots/pending"],
    enabled: isAdmin
  });

  // Fetch approved bots for admin
  const { data: approvedBots = [], isLoading: approvedLoading } = useQuery({
    queryKey: ["/api/bots/approved"],
    enabled: isAdmin
  });

  // Fetch recent activities
  const { data: activities = [], isLoading: activitiesLoading } = useQuery({
    queryKey: ["/api/activities"],
  });

  // Fetch commands - ADMIN ONLY
  const { data: commands = [], isLoading: commandsLoading } = useQuery({
    queryKey: ["/api/commands"],
    enabled: isAdmin
  });

  // Fetch God registry for admin
  const { data: godRegistry = [] as GodRegistryEntry[], isLoading: registryLoading } = useQuery<GodRegistryEntry[]>({
    queryKey: ["/api/admin/god-registry"],
    enabled: isAdmin
  });

  // WebSocket for real-time updates
  useWebSocket();

  // Mutations for bot approval
  const approveBotMutation = useMutation({
    mutationFn: ({ id, expirationMonths }: { id: string; expirationMonths?: number }) =>
      apiRequest("POST", `/api/bots/${id}/approve`, { expirationMonths }),
    onSuccess: () => {
      toast({ title: "Bot approved successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/approved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: () => {
      toast({ title: "Failed to approve bot", variant: "destructive" });
    }
  });

  const rejectBotMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/bots/${id}/reject`),
    onSuccess: () => {
      toast({ title: "Bot rejected and removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: () => {
      toast({ title: "Failed to reject bot", variant: "destructive" });
    }
  });

  // Feature toggle mutation
  const toggleFeatureMutation = useMutation({
    mutationFn: ({ botId, feature, enabled }: { botId: string; feature: string; enabled: boolean }) =>
      apiRequest("POST", `/api/bot-instances/${botId}/toggle-feature`, { feature, enabled }),
    onSuccess: () => {
      toast({ title: "Feature updated successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/approved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
    },
    onError: () => {
      toast({ title: "Failed to update feature", variant: "destructive" });
    }
  });

  // Revoke approval mutation
  const revokeApprovalMutation = useMutation({
    mutationFn: (botId: string) => apiRequest("POST", `/api/bot-instances/${botId}/revoke`),
    onSuccess: () => {
      toast({ title: "Bot approval revoked", description: "Bot returned to pending status" });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/approved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
    onError: () => {
      toast({ title: "Failed to revoke approval", variant: "destructive" });
    }
  });

  // Restart bot mutation
  const restartBotMutation = useMutation({
    mutationFn: (botId: string) => apiRequest("POST", `/api/bot-instances/${botId}/restart`),
    onSuccess: () => {
      toast({ title: "Bot restarted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/approved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances"] });
    },
    onError: () => {
      toast({ title: "Failed to restart bot", variant: "destructive" });
    }
  });

  // God registry mutations
  const updateRegistrationMutation = useMutation({
    mutationFn: ({ phoneNumber, tenancyName }: { phoneNumber: string; tenancyName: string }) =>
      apiRequest("PUT", `/api/admin/god-registry/${encodeURIComponent(phoneNumber)}`, { tenancyName }),
    onSuccess: () => {
      toast({ title: "Registration updated successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/god-registry"] });
      setEditingRegistration(null);
    },
    onError: () => {
      toast({ title: "Failed to update registration", variant: "destructive" });
    }
  });

  const deleteRegistrationMutation = useMutation({
    mutationFn: (phoneNumber: string) => 
      apiRequest("DELETE", `/api/admin/god-registry/${encodeURIComponent(phoneNumber)}`),
    onSuccess: () => {
      toast({ title: "Registration deleted successfully!" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/god-registry"] });
    },
    onError: () => {
      toast({ title: "Failed to delete registration", variant: "destructive" });
    }
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-emerald-950">
      {/* Offer Countdown Banner - Show only for guest users */}
      {!isAdmin && <OfferCountdownBanner />}

      {/* Header with glassmorphism effect */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-gray-900/80 border-b border-emerald-500/20 px-4 sm:px-6 py-4 shadow-lg shadow-emerald-500/5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-400 to-green-600 flex items-center justify-center shadow-lg shadow-emerald-500/50">
                <span className="text-2xl">🤖</span>
              </div>
              <div>
                <h2 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 via-green-400 to-teal-400 bg-clip-text text-transparent">
                  {serverInfo.serverName || 'TREKKER-MD'} Dashboard
                </h2>
                <p className="text-sm text-gray-400">
                  Ultra-fast lifetime WhatsApp bot automation
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <Button 
              onClick={() => {
                const protocol = window.location.protocol;
                const hostname = window.location.hostname;
                let pairUrl;
                
                if (hostname.includes('.repl.co') || hostname.includes('.replit.dev')) {
                  const parts = hostname.split('.');
                  const baseDomain = parts.slice(-3).join('.');
                  const subdomain = parts.slice(0, -3).join('.');
                  pairUrl = `${protocol}//${subdomain}-3001.${baseDomain}`;
                } else {
                  pairUrl = `${protocol}//${hostname}:3001`;
                }
                
                window.open(pairUrl, '_blank');
              }}
              className="bg-gradient-to-r from-teal-600 to-cyan-700 hover:from-teal-700 hover:to-cyan-800 text-white shadow-lg shadow-teal-500/30"
              data-testid="button-trekker-pair"
            >
              <i className="fas fa-link mr-2"></i>
              TREKKER-md pair
            </Button>
            {isAdmin && (
              <div className="flex space-x-2">
                <Button 
                  onClick={() => setShowCommandManagement(true)}
                  className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg shadow-blue-500/30"
                >
                  <i className="fas fa-terminal mr-2"></i>
                  Commands
                </Button>
                <Button 
                  onClick={() => setShowAdminBotManagement(true)}
                  className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white shadow-lg shadow-purple-500/30"
                >
                  <i className="fas fa-robot mr-2"></i>
                  Manage Bots
                </Button>
                <Button 
                  onClick={() => setShowGodRegistry(true)}
                  className="bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white shadow-lg shadow-orange-500/30"
                >
                  <i className="fas fa-database mr-2"></i>
                  Registry
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="p-6">
        {/* Guest User Enhanced Step-by-Step Guide */}
        {!isAdmin && (
          <div className="mb-8">
            {/* Hero Section */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-green-600 to-teal-600 p-8 mb-6 shadow-2xl shadow-emerald-500/30">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4xIj48cGF0aCBkPSJNMzYgMzBoNHYzNmgtNHp2Lz48L2c+PC9nPjwvc3ZnPg==')] opacity-20"></div>
              <div className="relative text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm mb-4 shadow-lg">
                  <span className="text-5xl">🚀</span>
                </div>
                <h2 className="text-4xl font-bold text-white mb-3">
                  Get Started with TREKKER-MD Bot
                </h2>
                <p className="text-lg text-emerald-100 max-w-2xl mx-auto">
                  Follow these simple steps to activate your ultra-fast WhatsApp automation bot
                </p>
              </div>
            </div>

            {/* Steps Grid */}
            <div className="grid gap-6 md:grid-cols-3">
              {/* Step 1: Generate Session ID */}
              <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 border border-blue-500/30 hover:border-blue-400/60 transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/30 hover:-translate-y-1">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="relative p-6">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/50 group-hover:scale-110 transition-transform">
                      <span className="text-2xl font-bold text-white">1</span>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Generate Session ID</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                        <span className="text-xs text-blue-400 font-medium">START HERE</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-gray-300 mb-5 leading-relaxed">
                    Get a pairing code to link your WhatsApp. Enter the code in <span className="font-semibold text-blue-400">WhatsApp Settings → Linked Devices</span> to receive your session ID automatically
                  </p>
                  <Button
                    onClick={() => setShowWhatsAppPairing(true)}
                    className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold py-3 shadow-lg shadow-blue-500/30 group-hover:shadow-blue-500/50 transition-all"
                    data-testid="button-open-pairing"
                  >
                    <i className="fas fa-qrcode mr-2"></i>
                    Get Pairing Code
                    <i className="fas fa-arrow-right ml-2 group-hover:translate-x-1 transition-transform"></i>
                  </Button>
                </div>
              </div>

              {/* Step 2: Register Your Bot */}
              <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 border border-purple-500/30 hover:border-purple-400/60 transition-all duration-300 hover:shadow-2xl hover:shadow-purple-500/30 hover:-translate-y-1">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="relative p-6">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 shadow-lg shadow-purple-500/50 group-hover:scale-110 transition-transform">
                      <span className="text-2xl font-bold text-white">2</span>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Register Your Bot</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse"></span>
                        <span className="text-xs text-purple-400 font-medium">REQUIRED</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-gray-300 mb-5 leading-relaxed">
                    Upload your session credentials and configure your bot features. Choose from <span className="font-semibold text-purple-400">auto-like, auto-react, ChatGPT</span>, and more
                  </p>
                  <Button
                    onClick={() => setShowGuestRegistration(true)}
                    className="w-full bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-semibold py-3 shadow-lg shadow-purple-500/30 group-hover:shadow-purple-500/50 transition-all"
                  >
                    <i className="fas fa-rocket mr-2"></i>
                    Register Now
                    <i className="fas fa-arrow-right ml-2 group-hover:translate-x-1 transition-transform"></i>
                  </Button>
                </div>
              </div>

              {/* Step 3: Manage Your Bot */}
              <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-800 to-gray-900 border border-emerald-500/30 hover:border-emerald-400/60 transition-all duration-300 hover:shadow-2xl hover:shadow-emerald-500/30 hover:-translate-y-1">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <div className="relative p-6">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/50 group-hover:scale-110 transition-transform">
                      <span className="text-2xl font-bold text-white">3</span>
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Manage Your Bot</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span className="text-xs text-emerald-400 font-medium">FINAL STEP</span>
                      </div>
                    </div>
                  </div>
                  <p className="text-gray-300 mb-5 leading-relaxed">
                    Control features, view statistics, and manage your bot settings. Access your <span className="font-semibold text-emerald-400">full dashboard</span> with real-time monitoring
                  </p>
                  <Link href="/guest/bot-management">
                    <Button className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-semibold py-3 shadow-lg shadow-emerald-500/30 group-hover:shadow-emerald-500/50 transition-all">
                      <i className="fas fa-cog mr-2"></i>
                      Bot Management
                      <i className="fas fa-arrow-right ml-2 group-hover:translate-x-1 transition-transform"></i>
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Admin Bot Management or Guest Features */}
        {isAdmin ? (
          <div className="space-y-6">
            {/* Pending Bots Section */}
            <Card className="bg-gray-800/50 border-yellow-500/30 backdrop-blur-sm">
              <CardHeader className="border-b border-yellow-500/20">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                    <i className="fas fa-clock text-yellow-400"></i>
                    Pending Bot Registrations
                  </CardTitle>
                  <Button 
                    onClick={() => setShowCommandManagement(true)}
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    <i className="fas fa-terminal mr-2"></i>
                    Manage Commands
                  </Button>
                </div>
                <p className="text-gray-400 text-sm mt-1">Review and approve new bot registrations</p>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {pendingLoading ? (
                    <div className="text-center py-4">
                      <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-yellow-400"></div>
                    </div>
                  ) : (pendingBots as any[]).length === 0 ? (
                    <div className="text-center py-8">
                      <i className="fas fa-check-circle text-5xl text-gray-600 mb-3"></i>
                      <p className="text-gray-400">No pending bot registrations</p>
                    </div>
                  ) : (
                    (pendingBots as any[]).map((bot: any) => (
                      <div key={bot.id} className="flex items-center justify-between p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg hover:bg-yellow-500/20 transition-colors" data-testid={`pending-bot-${bot.id}`}>
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-yellow-500/20 rounded-lg flex items-center justify-center">
                            <i className="fas fa-robot text-yellow-400"></i>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{bot.name}</p>
                            <p className="text-xs text-gray-400">{bot.phoneNumber || 'No phone number'}</p>
                            <p className="text-xs text-gray-500">Registered: {new Date(bot.createdAt).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button 
                            size="sm"
                            onClick={() => approveBotMutation.mutate({ id: bot.id, expirationMonths: 12 })}
                            disabled={approveBotMutation.isPending}
                            className="bg-green-600 hover:bg-green-700 text-white"
                            data-testid={`button-approve-${bot.id}`}
                          >
                            <i className="fas fa-check mr-1"></i>
                            Approve
                          </Button>
                          <Button 
                            size="sm"
                            onClick={() => rejectBotMutation.mutate(bot.id)}
                            disabled={rejectBotMutation.isPending}
                            variant="destructive"
                            data-testid={`button-reject-${bot.id}`}
                          >
                            <i className="fas fa-times mr-1"></i>
                            Reject
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Approved Bots Section */}
            <Card className="bg-gray-800/50 border-green-500/30 backdrop-blur-sm">
              <CardHeader className="border-b border-green-500/20">
                <CardTitle className="text-lg font-semibold text-white flex items-center gap-2">
                  <i className="fas fa-check-circle text-green-400"></i>
                  Approved Bot Instances
                </CardTitle>
                <p className="text-gray-400 text-sm mt-1">Active bots with auto-running capabilities</p>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {approvedLoading ? (
                    <div className="text-center py-4">
                      <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-green-400"></div>
                    </div>
                  ) : (approvedBots as any[]).length === 0 ? (
                    <div className="text-center py-8">
                      <i className="fas fa-robot text-5xl text-gray-600 mb-3"></i>
                      <p className="text-gray-400">No approved bots yet</p>
                    </div>
                  ) : (
                    (approvedBots as any[]).map((bot: any) => (
                      <div key={bot.id} className="flex items-center justify-between p-4 bg-green-500/10 border border-green-500/20 rounded-lg hover:bg-green-500/20 transition-colors" data-testid={`approved-bot-${bot.id}`}>
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                            <i className="fas fa-robot text-green-400"></i>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">{bot.name}</p>
                            <p className="text-xs text-gray-400">{bot.phoneNumber || 'No phone number'}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400">
                            APPROVED
                          </span>
                          <span className={`text-xs px-2 py-1 rounded ${
                            bot.status === 'online' ? 'text-green-400 bg-green-500/10' :
                            'text-gray-400 bg-gray-500/10'
                          }`}>
                            {bot.status?.toUpperCase() || 'UNKNOWN'}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* TREKKER-MD Contact Section - Enhanced */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-600 via-green-600 to-teal-600 border-none mt-8 text-white shadow-2xl shadow-emerald-500/30">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djEyaDEyVjM0eiIvPjwvZz48L2c+PC9zdmc+')] opacity-30"></div>
          <CardContent className="relative p-8">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm mb-4 shadow-lg">
                <span className="text-5xl">🚀</span>
              </div>
              <h2 className="text-4xl font-bold mb-3">TREKKER-MD LIFETIME BOT</h2>
              <p className="text-xl text-emerald-100 mb-2">Ultra-Fast WhatsApp Automation Platform</p>
              <p className="text-sm text-emerald-200/80 mb-6">No Expiry • Lifetime Access • Premium Features</p>

              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-5 mb-6 border border-white/20">
                <h3 className="text-xl font-semibold mb-4 flex items-center justify-center gap-2">
                  <i className="fas fa-info-circle"></i>
                  Quick Start Guide
                </h3>
                <div className="text-left space-y-3 text-sm">
                  <div className="flex items-start gap-3">
                    <i className="fas fa-check-circle text-emerald-300 mt-1"></i>
                    <p>Use the Quoted Session ID to Deploy your Bot</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <i className="fas fa-check-circle text-emerald-300 mt-1"></i>
                    <p>DM the owner for lifetime TREKKER-MD bot support</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <i className="fas fa-check-circle text-emerald-300 mt-1"></i>
                    <p>Support us - Donations keep this service running</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-white/20 pt-6">
                <h3 className="text-xl font-semibold mb-5 flex items-center justify-center gap-2">
                  <i className="fas fa-link"></i>
                  Connect With Us
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <a
                    href="https://t.me/trekkermd"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-all rounded-lg p-3 text-white font-medium group"
                  >
                    <i className="fab fa-telegram text-xl group-hover:scale-110 transition-transform"></i>
                    <span>Telegram</span>
                  </a>

                  <a
                    href="https://www.instagram.com/nicholaso_tesla?igsh=eG5oNWVuNXF6eGU0_"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-all rounded-lg p-3 text-white font-medium group"
                  >
                    <i className="fab fa-instagram text-xl group-hover:scale-110 transition-transform"></i>
                    <span>Instagram</span>
                  </a>

                  <a
                    href="https://wa.me/254704897825"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-all rounded-lg p-3 text-white font-medium group"
                  >
                    <i className="fab fa-whatsapp text-xl group-hover:scale-110 transition-transform"></i>
                    <span>WhatsApp</span>
                  </a>

                  <a
                    href="https://dc693d3f-99a0-4944-94cc-6b839418279c.e1-us-east-azure.choreoapps.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-all rounded-lg p-3 text-white font-medium group"
                  >
                    <i className="fas fa-qrcode text-xl group-hover:scale-110 transition-transform"></i>
                    <span>Pair Site</span>
                  </a>

                  <a
                    href="https://whatsapp.com/channel/0029Vb6vpSv6WaKiG6ZIy73H"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm transition-all rounded-lg p-3 text-white font-medium group sm:col-span-2"
                  >
                    <i className="fab fa-whatsapp text-xl group-hover:scale-110 transition-transform"></i>
                    <span>WhatsApp Channel</span>
                  </a>
                </div>
              </div>

              <p className="text-xs text-emerald-200/70 mt-6 italic">
                Powered by TREKKER-MD • Ultra Fast Bot 💜
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Modals */}
      <AddBotModal open={showAddBotModal} onClose={() => setShowAddBotModal(false)} />
      <CommandManagement open={showCommandManagement} onClose={() => setShowCommandManagement(false)} />
      <GuestBotRegistration open={showGuestRegistration} onClose={() => setShowGuestRegistration(false)} />
      <WhatsAppPairing open={showWhatsAppPairing} onClose={() => setShowWhatsAppPairing(false)} />
      {isAdmin && <AdminBotManagement open={showAdminBotManagement} onClose={() => setShowAdminBotManagement(false)} />}

      {/* Feature Management Dialog */}
      {selectedBotForFeatures && (
        <Dialog open={!!selectedBotForFeatures} onOpenChange={() => setSelectedBotForFeatures(null)}>
          <DialogContent className="max-w-md bg-gray-900 border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold text-white">
                Manage Bot Features - {selectedBotForFeatures.name}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                Toggle features for this bot. Changes take effect immediately.
              </p>

              <div className="space-y-3">
                {[
                  { key: 'autoLike', label: 'Auto Like Status', description: 'Automatically like WhatsApp status updates' },
                  { key: 'autoReact', label: 'Auto React', description: 'Automatically react to messages' },
                  { key: 'autoView', label: 'Auto View Status', description: 'Automatically view WhatsApp status' },
                  { key: 'typingIndicator', label: 'Typing Indicator', description: 'Show typing indicator for responses' },
                  { key: 'chatGPT', label: 'ChatGPT Integration', description: 'Enable AI responses for conversations' }
                ].map((feature) => {
                  const currentValue = selectedBotForFeatures.settings?.features?.[feature.key] || false;

                  return (
                    <div key={feature.key} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                      <div className="flex-1">
                        <Label className="text-sm font-medium text-white">{feature.label}</Label>
                        <p className="text-xs text-gray-400">{feature.description}</p>
                      </div>
                      <Checkbox
                        checked={currentValue}
                        onCheckedChange={(checked) => {
                          toggleFeatureMutation.mutate({
                            botId: selectedBotForFeatures.id,
                            feature: feature.key,
                            enabled: !!checked
                          });
                          setSelectedBotForFeatures((prev: BotInstance | null) => prev ? ({
                            ...prev,
                            settings: {
                              ...prev.settings,
                              features: {
                                ...prev.settings?.features,
                                [feature.key]: !!checked
                              }
                            }
                          }) : null);
                        }}
                        disabled={toggleFeatureMutation.isPending}
                      />
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end space-x-2 pt-4">
                <Button 
                  variant="outline" 
                  onClick={() => setSelectedBotForFeatures(null)}
                  className="border-gray-700 text-gray-300 hover:bg-gray-800"
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* God Registry Management Modal */}
      {showGodRegistry && (
        <Dialog open={showGodRegistry} onOpenChange={() => setShowGodRegistry(false)}>
          <DialogContent className="max-w-4xl bg-gray-900 border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-white">📱 God Registry Management</DialogTitle>
              <DialogDescription className="text-gray-400">
                Manage global phone number registrations across all tenants
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {registryLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : godRegistry.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  No registrations found
                </div>
              ) : (
                <div className="space-y-2">
                  {godRegistry.map((registration: GodRegistryEntry) => (
                    <div key={registration.phoneNumber} className="border border-gray-700 rounded-lg p-4 bg-gray-800/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-white">
                            📱 {registration.phoneNumber}
                          </p>
                          <p className="text-sm text-gray-400">
                            Tenant: {registration.tenancyName}
                          </p>
                          <p className="text-xs text-gray-500">
                            Registered: {new Date(registration.registeredAt).toLocaleDateString()}
                          </p>
                        </div>

                        <div className="flex space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingRegistration(registration)}
                            className="border-gray-700 text-gray-300 hover:bg-gray-800"
                            data-testid={`button-edit-${registration.phoneNumber}`}
                          >
                            ✏️ Edit
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              if (confirm(`Delete registration for ${registration.phoneNumber}?`)) {
                                deleteRegistrationMutation.mutate(registration.phoneNumber);
                              }
                            }}
                            disabled={deleteRegistrationMutation.isPending}
                            data-testid={`button-delete-${registration.phoneNumber}`}
                          >
                            {deleteRegistrationMutation.isPending ? '...' : '🗑️ Delete'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button onClick={() => setShowGodRegistry(false)} className="bg-emerald-600 hover:bg-emerald-700">
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Registration Modal */}
      {editingRegistration && (
        <Dialog open={!!editingRegistration} onOpenChange={() => setEditingRegistration(null)}>
          <DialogContent className="bg-gray-900 border-gray-700">
            <DialogHeader>
              <DialogTitle className="text-white">✏️ Edit Registration</DialogTitle>
              <DialogDescription className="text-gray-400">
                Update the tenant assignment for {editingRegistration.phoneNumber}
              </DialogDescription>
            </DialogHeader>

            <form 
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const tenancyName = formData.get('tenancyName') as string;
                if (tenancyName.trim()) {
                  updateRegistrationMutation.mutate({
                    phoneNumber: editingRegistration.phoneNumber,
                    tenancyName: tenancyName.trim()
                  });
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium mb-1 text-white">
                  Phone Number
                </label>
                <input 
                  type="text" 
                  value={editingRegistration.phoneNumber}
                  disabled
                  className="w-full p-3 border border-gray-700 rounded-md bg-gray-800 text-gray-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-white">
                  Tenant Name
                </label>
                <input 
                  type="text" 
                  name="tenancyName"
                  defaultValue={editingRegistration.tenancyName}
                  placeholder="Enter new tenant name"
                  required
                  className="w-full p-3 border border-gray-700 rounded-md bg-gray-800 text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  data-testid="input-tenancy-name"
                />
              </div>

              <div className="flex justify-end space-x-2">
                <Button 
                  type="button"
                  variant="outline" 
                  onClick={() => setEditingRegistration(null)}
                  className="border-gray-700 text-gray-300 hover:bg-gray-800"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  disabled={updateRegistrationMutation.isPending}
                  className="bg-emerald-600 hover:bg-emerald-700"
                  data-testid="button-update-registration"
                >
                  {updateRegistrationMutation.isPending ? 'Updating...' : 'Update'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}