import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import BotCard from "@/components/bot-card";
import AddBotModal from "@/components/add-bot-modal";
import { useState } from "react";
import { Link } from "wouter";
import { useWebSocket } from "@/hooks/use-websocket";

export default function Dashboard() {
  const [showAddBotModal, setShowAddBotModal] = useState(false);

  // Fetch dashboard stats
  const { data: stats = {}, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/dashboard/stats"],
  });

  // Fetch bot instances
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

  return (
    <div>
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
            <p className="text-muted-foreground">Manage your WhatsApp bot instances</p>
          </div>
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => setShowAddBotModal(true)}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors flex items-center space-x-2"
              data-testid="button-add-bot"
            >
              <i className="fas fa-plus"></i>
              <span>Add New Bot</span>
            </button>
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
                  <p className="text-muted-foreground text-sm">Total Bots</p>
                  <p className="text-2xl font-bold text-foreground" data-testid="stat-total-bots">
                    {statsLoading ? "..." : (stats as any)?.totalBots || 0}
                  </p>
                </div>
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                  <i className="fas fa-robot text-primary text-xl"></i>
                </div>
              </div>
              <div className="mt-4 flex items-center space-x-2">
                <span className="text-green-400 text-sm">+{(botInstances as any[]).length}</span>
                <span className="text-muted-foreground text-sm">instances</span>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-muted-foreground text-sm">Active Bots</p>
                  <p className="text-2xl font-bold text-foreground" data-testid="stat-active-bots">
                    {statsLoading ? "..." : (stats as any)?.activeBots || 0}
                  </p>
                </div>
                <div className="w-12 h-12 bg-green-500/10 rounded-lg flex items-center justify-center">
                  <i className="fas fa-check-circle text-green-400 text-xl"></i>
                </div>
              </div>
              <div className="mt-4 flex items-center space-x-2">
                <span className="text-green-400 text-sm">
                  {(stats as any)?.totalBots ? Math.round(((stats as any).activeBots / (stats as any).totalBots) * 100) : 0}%
                </span>
                <span className="text-muted-foreground text-sm">uptime</span>
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

        {/* Bot Instances Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
          {botsLoading ? (
            <div className="col-span-full text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="mt-4 text-muted-foreground">Loading bot instances...</p>
            </div>
          ) : (
            <>
              {(botInstances as any[]).map((bot: any) => (
                <BotCard key={bot.id} bot={bot} />
              ))}
              
              {/* Add Bot Card */}
              <Card 
                className="bg-card border-dashed border-border hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => setShowAddBotModal(true)}
                data-testid="card-add-bot"
              >
                <CardContent className="p-6 flex flex-col items-center justify-center min-h-[300px]">
                  <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center mb-4">
                    <i className="fas fa-plus text-muted-foreground text-2xl"></i>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">Add New Bot</h3>
                  <p className="text-muted-foreground text-center mb-4">Upload credentials and configure a new WhatsApp bot instance</p>
                  <button className="bg-primary text-primary-foreground px-4 py-2 rounded-md hover:bg-primary/90 transition-colors">
                    Upload creds.json
                  </button>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Management Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Command Management */}
          <Card className="bg-card border-border">
            <CardHeader className="border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-semibold text-foreground">Command Management</CardTitle>
                <button className="bg-primary text-primary-foreground px-3 py-1 rounded-md text-sm hover:bg-primary/90 transition-colors" data-testid="button-add-command">
                  Add Command
                </button>
              </div>
              <p className="text-muted-foreground text-sm mt-1">Manage bot commands with prefix (.)</p>
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

          {/* Recent Activity */}
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
                          <span className="font-medium">{getBotName(activity.botInstanceId, botInstances as any[])}</span> {activity.description}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatTimeAgo(activity.createdAt)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <AddBotModal open={showAddBotModal} onClose={() => setShowAddBotModal(false)} />
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

function getBotName(botInstanceId: string, botInstances: any[]): string {
  const bot = botInstances.find(b => b.id === botInstanceId);
  return bot?.name || 'Unknown Bot';
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
