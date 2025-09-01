import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import * as React from "react";
import { Link } from "wouter";
import { useWebSocket } from "@/hooks/use-websocket";
import { useAuth } from "@/hooks/use-auth";
import AddBotModal from "@/components/add-bot-modal";
import CommandManagement from "@/components/command-management";
import GuestBotRegistration from "@/components/guest-bot-registration";
import AdminBotManagement from "@/components/admin-bot-management";

export default function Dashboard() {
  const { isAdmin } = useAuth();
  const [showAddBotModal, setShowAddBotModal] = useState(false);
  const [showCommandManagement, setShowCommandManagement] = useState(false);
  const [showGuestRegistration, setShowGuestRegistration] = useState(false);
  const [showAdminBotManagement, setShowAdminBotManagement] = useState(false);

  // Fetch dashboard stats
  const { data: stats = {}, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/dashboard/stats"],
  });

  // Fetch bot instances for guest users
  const { data: botInstances = [], isLoading: botsLoading } = useQuery({
    queryKey: ["/api/bot-instances"],
  });

  // Fetch recent activities
  const { data: activities = [], isLoading: activitiesLoading } = useQuery({
    queryKey: ["/api/activities"],
  });

  // Fetch commands for command management
  const { data: commands = [], isLoading: commandsLoading } = useQuery({
    queryKey: ["/api/commands"],
  });

  // WebSocket for real-time updates
  useWebSocket();

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
            <h2 className="text-2xl font-bold text-foreground">🤖 TREKKER-MD Dashboard</h2>
            <p className="text-muted-foreground">Ultra fast lifetime WhatsApp bot automation</p>
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

        {/* Management Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {isAdmin ? (
            // Admin sees command management
            <Card className="bg-card border-border">
              <CardHeader className="border-b border-border">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold text-foreground">🔧 TREKKER-MD Commands</CardTitle>
                  <Button 
                    onClick={() => setShowCommandManagement(true)}
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    🔧 Manage Commands
                  </Button>
                </div>
                <p className="text-muted-foreground text-sm mt-1">Custom command system - Ultra fast response</p>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-3">
                  {commandsLoading ? (
                    <div className="text-center py-4">
                      <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                    </div>
                  ) : (commands as any[]).length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground">No commands configured yet</p>
                    </div>
                  ) : (
                    (commands as any[]).slice(0, 5).map((command: any) => (
                      <div key={command.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-md" data-testid={`command-${command.name}`}>
                        <div className="flex items-center space-x-3">
                          <code className="bg-primary/10 text-primary px-2 py-1 rounded text-sm">.{command.name}</code>
                          <span className="text-sm text-foreground">{command.description}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className={`text-xs px-2 py-1 rounded ${command.isActive ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
                            {command.isActive ? 'Active' : 'Inactive'}
                          </span>
                          <button className="text-muted-foreground hover:text-foreground" data-testid={`button-edit-command-${command.name}`}>
                            <i className="fas fa-edit"></i>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  
                  {(commands as any[]).length > 5 && (
                    <div className="text-center pt-3">
                      <Link href="/commands">
                        <a className="text-primary hover:text-primary/80 text-sm font-medium" data-testid="link-view-all-commands">
                          View All {(commands as any[]).length} Commands
                        </a>
                      </Link>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            // Guests see bot registration section
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
          )}

          {/* Bot Instances for Guests, Recent Activity for Admins */}
          {isAdmin ? (
            <Card className="bg-card border-border">
              <CardHeader className="border-b border-border">
                <CardTitle className="text-lg font-semibold text-foreground">Recent Activity</CardTitle>
                <p className="text-muted-foreground text-sm mt-1">Live activity across all bot instances</p>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {activitiesLoading ? (
                    <div className="text-center py-4">
                      <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                    </div>
                  ) : (activities as any[]).length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground">No recent activity</p>
                    </div>
                  ) : (
                    (activities as any[]).slice(0, 5).map((activity: any) => (
                      <div key={activity.id} className="flex items-start space-x-3" data-testid={`activity-${activity.id}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${getActivityIconBg(activity.type)}`}>
                          <i className={`${getActivityIcon(activity.type)} text-sm`}></i>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground">
                            <span className="font-medium">{getBotName(activity.botInstanceId)}</span> {activity.description}
                          </p>
                          <p className="text-xs text-muted-foreground">{formatTimeAgo(activity.createdAt)}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            // Guests see bot instances list
            <Card className="bg-card border-border">
              <CardHeader className="border-b border-border">
                <CardTitle className="text-lg font-semibold text-foreground">Your Bot Instances</CardTitle>
                <p className="text-muted-foreground text-sm mt-1">View and monitor your installed bot instances</p>
              </CardHeader>
              <CardContent className="p-6">
                <div className="space-y-4">
                  {botsLoading ? (
                    <div className="text-center py-4">
                      <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                    </div>
                  ) : (botInstances as any[]).length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-muted-foreground">No bot instances yet</p>
                      <p className="text-xs text-muted-foreground mt-1">Upload credentials to create your first bot</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {(botInstances as any[]).slice(0, 5).map((bot: any) => (
                        <div key={bot.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-md" data-testid={`bot-instance-${bot.id}`}>
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                              <i className="fas fa-robot text-primary"></i>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">{bot.name}</p>
                              <p className="text-xs text-muted-foreground">{bot.phoneNumber || 'No phone number'}</p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className={`text-xs px-2 py-1 rounded ${
                              bot.status === 'online' ? 'text-green-400 bg-green-500/10' :
                              bot.status === 'offline' ? 'text-gray-400 bg-gray-500/10' :
                              bot.status === 'loading' ? 'text-blue-400 bg-blue-500/10' :
                              bot.status === 'qr_code' ? 'text-yellow-400 bg-yellow-500/10' :
                              'text-red-400 bg-red-500/10'
                            }`}>
                              {bot.status.replace('_', ' ').toUpperCase()}
                            </span>
                          </div>
                        </div>
                      ))}
                      
                      {(botInstances as any[]).length > 5 && (
                        <div className="text-center pt-3">
                          <Link href="/bot-instances">
                            <a className="text-primary hover:text-primary/80 text-sm font-medium" data-testid="link-view-all-bots">
                              View All {(botInstances as any[]).length} Bots
                            </a>
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
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
