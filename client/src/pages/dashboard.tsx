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
import AddBotModal from "@/components/add-bot-modal";
import CommandManagement from "@/components/command-management";
import GuestBotRegistration from "@/components/guest-bot-registration";
import AdminBotManagement from "@/components/admin-bot-management";

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
  const [selectedBotForFeatures, setSelectedBotForFeatures] = useState<BotInstance | null>(null);
  const [editingRegistration, setEditingRegistration] = useState<GodRegistryEntry | null>(null);

  // Fetch dashboard stats
  const { data: stats = {}, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/dashboard/stats"],
  });

  // Fetch server info
  const { data: serverInfo = {} as ServerInfo, isLoading: serverLoading } = useQuery<ServerInfo>({
    queryKey: ["/api/server/info"],
  });

  // Fetch bot instances - ADMIN ONLY (prevents privilege escalation)
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

  // Fetch commands - ADMIN ONLY (prevents access to command system)
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

  // Revoke approval mutation for dashboard
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

  // Restart bot mutation for dashboard
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

  // Auto-refresh for admin users
  React.useEffect(() => {
    if (isAdmin) {
      // Refresh the page to load admin features if not already loaded
      const hasRefreshed = sessionStorage.getItem('admin-refreshed');
      if (!hasRefreshed) {
        sessionStorage.setItem('admin-refreshed', 'true');
        window.location.reload();
      }
    }
  }, [isAdmin]);

  return (
    <div>
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-foreground">🤖 {serverInfo.serverName || 'TREKKER-MD'} Dashboard</h2>
            </div>
            <p className="text-muted-foreground">
              Ultra fast lifetime WhatsApp bot automation
              {serverInfo.serverName && (
                <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-1 rounded">
                  {serverInfo.currentBots}/{serverInfo.maxBots} slots used
                </span>
              )}
              {!serverInfo.hasSecretConfig && serverInfo.serverName === 'default-server' && (
                <span className="ml-2 text-xs bg-yellow-600 text-white px-2 py-1 rounded">
                  ⚠️ Default server name - Configure recommended
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center space-x-4">
            {isAdmin && (
              <div className="flex space-x-2">
                <Button 
                  onClick={() => setShowCommandManagement(true)}
                  className="bg-blue-600 hover:bg-blue-700 text-white"
                >
                  🔧 Manage Commands
                </Button>
                <Button 
                  onClick={() => setShowAdminBotManagement(true)}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  👥 Manage Bots
                </Button>
                <Button 
                  onClick={() => setShowGodRegistry(true)}
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                >
                  📱 God Registry
                </Button>
              </div>
            )}
            <div className="relative">
              <button className="w-10 h-10 bg-muted rounded-md flex items-center justify-center hover:bg-muted/80 transition-colors" data-testid="button-notifications">
                <i className="fas fa-bell text-muted-foreground"></i>
              </button>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-destructive rounded-full"></span>
            </div>
          </div>
        </div>
      </header>

      <div className="p-6">
        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-muted-foreground text-sm">{isAdmin ? 'Total Bots' : 'Your Bots'}</p>
                  <p className="text-2xl font-bold text-foreground" data-testid="stat-total-bots">
                    {statsLoading || botsLoading ? "..." : isAdmin ? (stats as any)?.totalBots || 0 : (botInstances as any[]).length}
                  </p>
                </div>
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <i className="fas fa-robot text-primary text-xl"></i>
                </div>
              </div>
              <div className="mt-4 flex items-center space-x-2">
                {isAdmin ? (
                  <>
                    <span className="text-green-400 text-sm">+{(stats as any)?.activeBots || 0}</span>
                    <span className="text-muted-foreground text-sm">instances</span>
                  </>
                ) : (
                  <>
                    <span className="text-green-400 text-sm">{Math.max(0, 10 - (botInstances as any[]).length)}</span>
                    <span className="text-muted-foreground text-sm">slots remaining</span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-muted-foreground text-sm">{isAdmin ? 'Active Bots' : 'Online Bots'}</p>
                  <p className="text-2xl font-bold text-foreground" data-testid="stat-active-bots">
                    {statsLoading || botsLoading ? "..." : isAdmin ? (stats as any)?.activeBots || 0 : (botInstances as any[]).filter((bot: any) => bot.status === 'online').length}
                  </p>
                </div>
                <div className="w-12 h-12 bg-green-500/10 rounded-lg flex items-center justify-center">
                  <i className="fas fa-check-circle text-green-400 text-xl"></i>
                </div>
              </div>
              <div className="mt-4 flex items-center space-x-2">
                {isAdmin ? (
                  <>
                    <span className="text-green-400 text-sm">
                      {(stats as any)?.totalBots ? Math.round(((stats as any).activeBots / (stats as any).totalBots) * 100) : 0}%
                    </span>
                    <span className="text-muted-foreground text-sm">uptime</span>
                  </>
                ) : (
                  <>
                    <span className="text-green-400 text-sm">
                      {(botInstances as any[]).length > 0 ? Math.round(((botInstances as any[]).filter((bot: any) => bot.status === 'online').length / (botInstances as any[]).length) * 100) : 0}%
                    </span>
                    <span className="text-muted-foreground text-sm">online rate</span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-muted-foreground text-sm">Messages Today</p>
                  <p className="text-2xl font-bold text-foreground" data-testid="stat-messages">
                    {statsLoading ? "..." : (stats as any)?.messagesCount || 0}
                  </p>
                </div>
                <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center">
                  <i className="fas fa-comment text-blue-400 text-xl"></i>
                </div>
              </div>
              <div className="mt-4 flex items-center space-x-2">
                <span className="text-green-400 text-sm">+12.5%</span>
                <span className="text-muted-foreground text-sm">vs yesterday</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-muted-foreground text-sm">Commands Executed</p>
                  <p className="text-2xl font-bold text-foreground" data-testid="stat-commands">
                    {statsLoading ? "..." : (stats as any)?.commandsCount || 0}
                  </p>
                </div>
                <div className="w-12 h-12 bg-purple-500/10 rounded-lg flex items-center justify-center">
                  <i className="fas fa-terminal text-purple-400 text-xl"></i>
                </div>
              </div>
              <div className="mt-4 flex items-center space-x-2">
                <span className="text-green-400 text-sm">+8.2%</span>
                <span className="text-muted-foreground text-sm">from last hour</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* TREKKER-MD Welcome & Contact */}
        <Card className="bg-gradient-to-r from-blue-600 to-purple-600 border-none mb-8 text-white">
          <CardContent className="p-6">
            <div className="text-center">
              <h3 className="text-2xl font-bold mb-2">🚀 TREKKER-MD LIFETIME BOT</h3>
              <p className="text-blue-100 mb-4">Ultra fast WhatsApp automation - No expiry, Lifetime access</p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 text-sm">
                <div className="bg-white/10 rounded-lg p-3">
                  <div className="flex items-center justify-center mb-2">
                    <i className="fab fa-telegram text-xl"></i>
                  </div>
                  <p className="font-medium">Telegram</p>
                  <p className="text-xs text-blue-100">@trekkermd_</p>
                </div>

                <div className="bg-white/10 rounded-lg p-3">
                  <div className="flex items-center justify-center mb-2">
                    <i className="fab fa-whatsapp text-xl"></i>
                  </div>
                  <p className="font-medium">WhatsApp</p>
                  <p className="text-xs text-blue-100">+254704897825</p>
                </div>

                <div className="bg-white/10 rounded-lg p-3">
                  <div className="flex items-center justify-center mb-2">
                    <i className="fab fa-instagram text-xl"></i>
                  </div>
                  <p className="font-medium">Instagram</p>
                  <p className="text-xs text-blue-100">@nicholaso_tesla</p>
                </div>
              </div>

              <p className="text-xs text-blue-200 mt-4">
                {isAdmin ? 'Admin access - Full system control' : 'Upload base64 credentials to deploy your bot instantly'}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Admin Bot Management or Guest Registration */}
        {isAdmin ? (
          <div className="space-y-6">
            {/* Pending Bots Section */}
            <Card className="bg-card border-border">
              <CardHeader className="border-b border-border">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-foreground">⏳ Pending Bot Registrations</CardTitle>
                  <Button 
                    onClick={() => setShowCommandManagement(true)}
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    🔧 Manage Commands
                  </Button>
                </div>
                <p className="text-muted-foreground text-sm mt-1">Review and approve new bot registrations</p>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {pendingLoading ? (
                    <div className="text-center py-4">
                      <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                    </div>
                  ) : (pendingBots as any[]).length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground">No pending bot registrations</p>
                    </div>
                  ) : (
                    (pendingBots as any[]).map((bot: any) => (
                      <div key={bot.id} className="flex items-center justify-between p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-md" data-testid={`pending-bot-${bot.id}`}>
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 bg-yellow-500/20 rounded-lg flex items-center justify-center">
                            <i className="fas fa-clock text-yellow-500"></i>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{bot.name}</p>
                            <p className="text-xs text-muted-foreground">{bot.phoneNumber || 'No phone number'}</p>
                            <p className="text-xs text-muted-foreground">Registered: {new Date(bot.createdAt).toLocaleDateString()}</p>
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
                            ✅ Approve
                          </Button>
                          <Button 
                            size="sm"
                            onClick={() => rejectBotMutation.mutate(bot.id)}
                            disabled={rejectBotMutation.isPending}
                            variant="destructive"
                            data-testid={`button-reject-${bot.id}`}
                          >
                            ❌ Reject
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Approved Bots Section */}
            {isAdmin && (
              <Card className="bg-card border-border">
                <CardHeader className="border-b border-border">
                  <CardTitle className="text-lg font-semibold text-foreground">✅ Approved Bot Instances</CardTitle>
                  <p className="text-muted-foreground text-sm mt-1">Active bots with auto-running capabilities</p>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="space-y-4">
                    {approvedLoading ? (
                      <div className="text-center py-4">
                        <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                      </div>
                    ) : (approvedBots as any[]).length === 0 ? (
                      <div className="text-center py-4">
                        <p className="text-muted-foreground">No approved bots yet</p>
                      </div>
                    ) : (
                      (approvedBots as any[]).map((bot: any) => (
                        <div key={bot.id} className="flex items-center justify-between p-4 bg-green-500/10 border border-green-500/20 rounded-md" data-testid={`approved-bot-${bot.id}`}>
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                              <i className="fas fa-robot text-green-500"></i>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">{bot.name}</p>
                              <p className="text-xs text-muted-foreground">{bot.phoneNumber || 'No phone number'}</p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-500">
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
            )}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto">
            {/* Guest Registration Section */}
            <Card className="bg-card border-border">
              <CardHeader className="border-b border-border">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-foreground">🚀 Register Your Bot</CardTitle>
                  <Button 
                    onClick={() => setShowGuestRegistration(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    data-testid="button-register-bot"
                  >
                    <i className="fas fa-plus mr-2"></i>
                    Register Bot
                  </Button>
                </div>
                <p className="text-muted-foreground text-sm mt-1">Upload credentials or paste session ID to register your TREKKER-MD bot</p>
              </CardHeader>
              <CardContent className="p-6">
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-blue-600/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                    <i className="fas fa-robot text-blue-600 text-2xl"></i>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">TREKKER-MD Lifetime Bot</h3>
                  <p className="text-muted-foreground mb-6">Register your WhatsApp bot with credentials or session ID</p>
                  <Button 
                    onClick={() => setShowGuestRegistration(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white w-full max-w-xs"
                    data-testid="button-start-registration"
                  >
                    <i className="fas fa-rocket mr-2"></i>
                    Register Your Bot
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <AddBotModal open={showAddBotModal} onClose={() => setShowAddBotModal(false)} />

      {/* Command Management Modal */}
      <CommandManagement
        open={showCommandManagement}
        onClose={() => setShowCommandManagement(false)}
      />

      {/* Guest Bot Registration Modal */}
      <GuestBotRegistration
        open={showGuestRegistration}
        onClose={() => setShowGuestRegistration(false)}
      />

      {/* Admin Bot Management Modal */}
      {isAdmin && (
        <AdminBotManagement
          open={showAdminBotManagement}
          onClose={() => setShowAdminBotManagement(false)}
        />
      )}

      {/* Feature Management Dialog */}
      {selectedBotForFeatures && (
        <Dialog open={!!selectedBotForFeatures} onOpenChange={() => setSelectedBotForFeatures(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">
                Manage Bot Features - {selectedBotForFeatures.name}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Toggle features for this bot. Changes take effect immediately.
              </p>

              {/* Feature toggles */}
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
                    <div key={feature.key} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex-1">
                        <Label className="text-sm font-medium">{feature.label}</Label>
                        <p className="text-xs text-muted-foreground">{feature.description}</p>
                      </div>
                      <Checkbox
                        checked={currentValue}
                        onCheckedChange={(checked) => {
                          toggleFeatureMutation.mutate({
                            botId: selectedBotForFeatures.id,
                            feature: feature.key,
                            enabled: !!checked
                          });
                          // Update local state immediately for UI responsiveness
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
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>📱 God Registry Management</DialogTitle>
              <DialogDescription>
                Manage global phone number registrations across all tenants
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {registryLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : godRegistry.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No registrations found
                </div>
              ) : (
                <div className="space-y-2">
                  {godRegistry.map((registration: GodRegistryEntry) => (
                    <div key={registration.phoneNumber} className="border border-border rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-foreground">
                            📱 {registration.phoneNumber}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Tenant: {registration.tenancyName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Registered: {new Date(registration.registeredAt).toLocaleDateString()}
                          </p>
                        </div>

                        <div className="flex space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingRegistration(registration)}
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
              <Button onClick={() => setShowGodRegistry(false)}>
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Registration Modal */}
      {editingRegistration && (
        <Dialog open={!!editingRegistration} onOpenChange={() => setEditingRegistration(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>✏️ Edit Registration</DialogTitle>
              <DialogDescription>
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
                <label className="block text-sm font-medium mb-1">
                  Phone Number
                </label>
                <input 
                  type="text" 
                  value={editingRegistration.phoneNumber}
                  disabled
                  className="w-full p-3 border border-border rounded-md bg-muted text-muted-foreground"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Tenant Name
                </label>
                <input 
                  type="text" 
                  name="tenancyName"
                  defaultValue={editingRegistration.tenancyName}
                  placeholder="Enter new tenant name"
                  required
                  className="w-full p-3 border border-border rounded-md focus:ring-2 focus:ring-primary focus:border-transparent"
                  data-testid="input-tenancy-name"
                />
              </div>

              <div className="flex justify-end space-x-2">
                <Button 
                  type="button"
                  variant="outline" 
                  onClick={() => setEditingRegistration(null)}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit"
                  disabled={updateRegistrationMutation.isPending}
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

function getActivityIcon(type: string): string {
  switch (type) {
    case 'command': return 'fas fa-comment text-green-400';
    case 'auto_like': return 'fas fa-heart text-blue-400';
    case 'error': return 'fas fa-exclamation-triangle text-yellow-400';
    case 'chatgpt_response': return 'fas fa-brain text-purple-400';
    case 'status_change': return 'fas fa-users text-green-400';
    default: return 'fas fa-info text-blue-400';
  }
}

function getActivityIconBg(type: string): string {
  switch (type) {
    case 'command': return 'bg-green-500/10';
    case 'auto_like': return 'bg-blue-500/10';
    case 'error': return 'bg-yellow-500/10';
    case 'chatgpt_response': return 'bg-purple-500/10';
    case 'status_change': return 'bg-green-500/10';
    default: return 'bg-blue-500/10';
  }
}

function getBotName(botInstanceId: string): string {
  return 'Bot';
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

  if (diffInMinutes < 1) return 'Just now';
  if (diffInMinutes < 60) return `${diffInMinutes} minutes ago`;
  if (diffInMinutes < 1440) return `${Math.floor(diffInMinutes / 60)} hours ago`;
  return `${Math.floor(diffInMinutes / 1440)} days ago`;
}