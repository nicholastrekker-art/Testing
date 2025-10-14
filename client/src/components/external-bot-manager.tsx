import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  Server, 
  Settings, 
  Wifi, 
  WifiOff, 
  Heart, 
  MessageSquare, 
  Eye, 
  Zap,
  Clock,
  Play,
  Square,
  RefreshCw
} from "lucide-react";

interface CrossTenancyBot {
  id: string;
  name: string;
  phoneNumber: string;
  status: string;
  approvalStatus: string;
  serverName: string;
  features: {
    autoLike?: boolean;
    autoReact?: boolean;
    autoView?: boolean;
    chatGPT?: boolean;
    alwaysOnline?: boolean;
    typingIndicator?: boolean;
    autoRecording?: boolean;
    presenceAutoSwitch?: boolean;
  };
  canManage: boolean;
  isActive: boolean;
  isApproved: boolean;
  messagesCount: number;
  commandsCount: number;
}

interface CrossTenancyBotCardProps {
  bot: CrossTenancyBot;
  onFeatureToggle: (botId: string, feature: string, enabled: boolean) => void;
  onBotAction: (botId: string, action: string) => void;
}

function CrossTenancyBotCard({ bot, onFeatureToggle, onBotAction }: CrossTenancyBotCardProps) {
  const getStatusBadge = (status: string, approvalStatus?: string) => {
    if (approvalStatus === 'pending') {
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-800">Pending Approval</Badge>;
    }

    switch (status) {
      case 'online':
        return <Badge className="bg-green-500">Online</Badge>;
      case 'offline':
        return <Badge variant="outline">Offline</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Card className="border-blue-200 dark:border-blue-800">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Server className="h-4 w-4 text-blue-600" />
              {bot.name}
            </CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              <span>{bot.phoneNumber}</span>
              <span>•</span>
              <span>{bot.serverName}</span>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge(bot.status, bot.approvalStatus)}
            <Badge variant="outline" className="bg-blue-50 text-blue-700">
              {bot.serverName}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm">
                <Eye className="h-3 w-3" />
                Auto View Status
              </span>
              <Switch
                data-testid={`switch-autoview-${bot.phoneNumber}`}
                checked={bot.features.autoView || false}
                onCheckedChange={(checked) => onFeatureToggle(bot.id, 'autoView', checked)}
                disabled={bot.approvalStatus !== 'approved'}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm">
                <Zap className="h-3 w-3" />
                ChatGPT
              </span>
              <Switch
                data-testid={`switch-chatgpt-${bot.phoneNumber}`}
                checked={bot.features.chatGPT || false}
                onCheckedChange={(checked) => onFeatureToggle(bot.id, 'chatGPT', checked)}
                disabled={bot.approvalStatus !== 'approved'}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm">
                <Wifi className="h-3 w-3" />
                Always Online
              </span>
              <Switch
                data-testid={`switch-alwaysonline-${bot.phoneNumber}`}
                checked={bot.features.alwaysOnline || false}
                onCheckedChange={(checked) => onFeatureToggle(bot.id, 'alwaysOnline', checked)}
                disabled={bot.approvalStatus !== 'approved'}
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm">
                <Settings className="h-3 w-3" />
                Typing Indicator
              </span>
              <Switch
                data-testid={`switch-typing-${bot.phoneNumber}`}
                checked={bot.features.typingIndicator || false}
                onCheckedChange={(checked) => onFeatureToggle(bot.id, 'typingIndicator', checked)}
                disabled={bot.approvalStatus !== 'approved'}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-4 border-t">
          {bot.approvalStatus === 'approved' ? (
            <>
              {bot.status === 'offline' ? (
                <Button
                  size="sm"
                  onClick={() => onBotAction(bot.id, 'start')}
                  className="flex-1"
                >
                  <Play className="h-3 w-3 mr-1" />
                  Start
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onBotAction(bot.id, 'stop')}
                  className="flex-1"
                >
                  <Square className="h-3 w-3 mr-1" />
                  Stop
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => onBotAction(bot.id, 'restart')}
                title="Restart bot"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled
              className="flex-1"
              title="Bot must be approved to manage"
            >
              Pending Approval
            </Button>
          )}
        </div>

        {/* Bot statistics */}
        <div className="flex justify-between text-xs text-muted-foreground pt-2 border-t">
          <span>Messages: {bot.messagesCount || 0}</span>
          <span>Commands: {bot.commandsCount || 0}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ExternalBotManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch bots from other tenancies on the same database
  const { data: crossTenancyBots = [], isLoading } = useQuery({
    queryKey: ['/api/admin/bot-instances'],
    queryFn: async () => {
      const response = await fetch('/api/admin/bot-instances');
      if (!response.ok) {
        throw new Error('Failed to fetch bot instances');
      }
      const data = await response.json();
      
      // Transform the data to match our interface
      return data.map((bot: any) => ({
        id: bot.id,
        name: bot.name,
        phoneNumber: bot.phoneNumber,
        status: bot.status,
        approvalStatus: bot.approvalStatus,
        serverName: bot.serverName,
        features: {
          autoLike: bot.autoLike || false,
          autoReact: bot.autoReact || false,
          autoView: bot.autoViewStatus || false,
          chatGPT: bot.chatgptEnabled || false,
          alwaysOnline: bot.alwaysOnline || false,
          typingIndicator: bot.typingMode !== 'none',
          autoRecording: bot.presenceMode === 'recording',
          presenceAutoSwitch: bot.presenceAutoSwitch || false,
        },
        canManage: bot.approvalStatus === 'approved',
        isActive: bot.status === 'online',
        isApproved: bot.approvalStatus === 'approved',
        messagesCount: bot.messagesCount || 0,
        commandsCount: bot.commandsCount || 0,
      }));
    },
  });

  // Get current server info to filter out current server bots
  const { data: serverInfo } = useQuery({
    queryKey: ['/api/server/info'],
    queryFn: async () => {
      const response = await fetch('/api/server/info');
      if (!response.ok) throw new Error('Failed to fetch server info');
      return response.json();
    },
  });

  // Filter to show only bots from other tenancies
  const otherTenancyBots = crossTenancyBots.filter((bot: CrossTenancyBot) => 
    serverInfo && bot.serverName !== serverInfo.serverName
  );

  // Feature toggle mutation
  const featureToggleMutation = useMutation({
    mutationFn: async ({ botId, feature, enabled }: { botId: string; feature: string; enabled: boolean }) => {
      const response = await fetch(`/api/bots/${botId}/toggle-feature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feature, enabled }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Feature update failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Feature Updated",
        description: `Feature updated successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/bot-instances'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Feature Update Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Bot action mutation
  const botActionMutation = useMutation({
    mutationFn: async ({ botId, action }: { botId: string; action: string }) => {
      const response = await fetch(`/api/bot-instances/${botId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `Failed to ${action} bot`);
      }

      return response.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Action Successful",
        description: `Bot ${variables.action} completed successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/bot-instances'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Action Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleFeatureToggle = (botId: string, feature: string, enabled: boolean) => {
    featureToggleMutation.mutate({ botId, feature, enabled });
  };

  const handleBotAction = (botId: string, action: string) => {
    botActionMutation.mutate({ botId, action });
  };

  // Group bots by server tenancy
  const botsByTenancy = otherTenancyBots.reduce((acc: Record<string, CrossTenancyBot[]>, bot: CrossTenancyBot) => {
    if (!acc[bot.serverName]) {
      acc[bot.serverName] = [];
    }
    acc[bot.serverName].push(bot);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-6 w-6 text-blue-600" />
            Cross-Tenancy Bot Manager
          </h2>
          <p className="text-muted-foreground">
            Manage bots from different server tenancies on the same database
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">Loading bots from other tenancies...</p>
        </div>
      ) : Object.keys(botsByTenancy).length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Server className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Cross-Tenancy Bots</h3>
              <p className="text-muted-foreground mb-4">
                No bots found from other server tenancies on this database
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue={Object.keys(botsByTenancy)[0]} className="w-full">
          <TabsList>
            {Object.entries(botsByTenancy).map(([tenancy, bots]) => (
              <TabsTrigger key={tenancy} value={tenancy} data-testid={`tab-${tenancy}`}>
                {tenancy} ({bots.length})
              </TabsTrigger>
            ))}
          </TabsList>

          {Object.entries(botsByTenancy).map(([tenancy, bots]: [string, CrossTenancyBot[]]) => (
            <TabsContent key={tenancy} value={tenancy} className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 dark:bg-blue-900/20 dark:border-blue-800">
                <h3 className="font-medium text-blue-800 dark:text-blue-200 mb-2">
                  🏢 Server Tenancy: {tenancy}
                </h3>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  Managing {bots.length} bot{bots.length !== 1 ? 's' : ''} from {tenancy} tenancy
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {bots.map((bot: CrossTenancyBot) => (
                  <CrossTenancyBotCard
                    key={bot.id}
                    bot={bot}
                    onFeatureToggle={handleFeatureToggle}
                    onBotAction={handleBotAction}
                  />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}