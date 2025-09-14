import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Network, Server, Bot, Play, Square, RefreshCw, ExternalLink, AlertTriangle, Settings } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CrossServerBot {
  id: string;
  name: string;
  phoneNumber: string;
  serverName: string;
  status: string;
  approvalStatus: string;
  lastActivity?: string;
  isActive: boolean;
  canManage: boolean;
  serverUrl?: string;
  messagesCount?: number;
  commandsCount?: number;
  features?: {
    autoLike?: boolean;
    autoReact?: boolean;
    autoView?: boolean;
    chatGPT?: boolean;
  };
}

interface ServerSummary {
  serverName: string;
  botCount: number;
  onlineBots: number;
  pendingBots: number;
  serverUrl?: string;
  lastSync?: string;
}

export default function GuestCrossServer() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [searchTriggered, setSearchTriggered] = useState(false);

  // Fetch cross-server bot data
  const { data: crossServerData, isLoading } = useQuery({
    queryKey: ["/api/guest/cross-server-bots", phoneNumber],
    queryFn: async () => {
      if (!phoneNumber.trim()) return { bots: [], servers: [] };
      
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const response = await fetch('/api/guest/cross-server-bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanedPhone }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch cross-server data');
      }
      
      return response.json();
    },
    enabled: searchTriggered && !!phoneNumber.trim(),
  });

  // Cross-server bot action mutation
  const crossServerActionMutation = useMutation({
    mutationFn: async ({ 
      action, 
      botId, 
      serverName, 
      data 
    }: { 
      action: string; 
      botId: string; 
      serverName: string; 
      data?: any 
    }) => {
      const response = await fetch('/api/guest/cross-server-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem("guest_token")}`,
        },
        body: JSON.stringify({ action, botId, serverName, ...data }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `Failed to ${action} bot on ${serverName}`);
      }
      
      return response.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Cross-Server Action Successful",
        description: `${variables.action} completed on ${variables.serverName}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/guest/cross-server-bots"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Cross-Server Action Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleSearch = () => {
    if (!phoneNumber.trim()) {
      toast({
        title: "Phone Required",
        description: "Please enter your phone number to find your cross-server bots",
        variant: "destructive"
      });
      return;
    }
    setSearchTriggered(true);
  };

  const handleCrossServerAction = (action: string, bot: CrossServerBot, data?: any) => {
    crossServerActionMutation.mutate({ action, botId: bot.id, serverName: bot.serverName, data });
  };

  const getStatusBadge = (status: string, approvalStatus?: string) => {
    if (approvalStatus === 'pending') {
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-800">Pending</Badge>;
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

  const bots = crossServerData?.bots || [];
  const servers = crossServerData?.servers || [];

  const groupedByServer = bots.reduce((acc: Record<string, CrossServerBot[]>, bot: CrossServerBot) => {
    if (!acc[bot.serverName]) {
      acc[bot.serverName] = [];
    }
    acc[bot.serverName].push(bot);
    return acc;
  }, {});

  return (
    <div className="min-h-screen w-full p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Cross-Server Bot Management</h1>
          <p className="text-muted-foreground">
            Manage your bots across multiple servers from one central location
          </p>
        </div>

        {/* Search Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              Find Your Cross-Server Bots
            </CardTitle>
            <CardDescription>
              Enter your phone number to discover and manage bots across all servers
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                type="tel"
                placeholder="+1234567890"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="flex-1"
                data-testid="input-cross-server-phone"
              />
              <Button 
                onClick={handleSearch}
                disabled={isLoading}
                data-testid="button-search-cross-server"
              >
                {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Find Bots"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Cross-Server Overview */}
        {searchTriggered && !isLoading && servers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Server Overview
              </CardTitle>
              <CardDescription>
                Your bots are distributed across {servers.length} server{servers.length > 1 ? 's' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {servers.map((server: ServerSummary) => (
                  <Card key={server.serverName} className="border-blue-200">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">{server.serverName}</h4>
                          <p className="text-sm text-muted-foreground">
                            {server.botCount} bot{server.botCount > 1 ? 's' : ''}
                          </p>
                        </div>
                        {server.serverUrl && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={server.serverUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </Button>
                        )}
                      </div>
                      <div className="flex gap-4 mt-3 text-sm">
                        <div>
                          <span className="text-green-600">{server.onlineBots}</span> online
                        </div>
                        <div>
                          <span className="text-yellow-600">{server.pendingBots}</span> pending
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cross-Server Bot Management */}
        {searchTriggered && !isLoading && bots.length > 0 && (
          <Tabs defaultValue="all" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="all" data-testid="tab-all-servers">
                All Servers ({bots.length})
              </TabsTrigger>
              <TabsTrigger value="online" data-testid="tab-online-servers">
                Online ({bots.filter((bot: CrossServerBot) => bot.status === 'online').length})
              </TabsTrigger>
              <TabsTrigger value="offline" data-testid="tab-offline-servers">
                Offline ({bots.filter((bot: CrossServerBot) => bot.status === 'offline').length})
              </TabsTrigger>
              <TabsTrigger value="pending" data-testid="tab-pending-servers">
                Pending ({bots.filter((bot: CrossServerBot) => bot.approvalStatus === 'pending').length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="space-y-6">
              {Object.entries(groupedByServer).map(([serverName, serverBots]) => (
                <Card key={serverName}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        {serverName}
                      </div>
                      <Badge variant="outline">{(serverBots as CrossServerBot[]).length} bot{(serverBots as CrossServerBot[]).length > 1 ? 's' : ''}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                      {(serverBots as CrossServerBot[]).map((bot: CrossServerBot) => (
                        <Card key={bot.id} className="border-gray-200">
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between mb-3">
                              <div>
                                <h4 className="font-medium">{bot.name}</h4>
                                <p className="text-sm text-muted-foreground">{bot.phoneNumber}</p>
                              </div>
                              {getStatusBadge(bot.status, bot.approvalStatus)}
                            </div>

                            {/* Bot Stats */}
                            <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                              <div>
                                <p className="text-muted-foreground">Messages</p>
                                <p className="font-medium">{bot.messagesCount || 0}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Commands</p>
                                <p className="font-medium">{bot.commandsCount || 0}</p>
                              </div>
                            </div>

                            {/* Features */}
                            {bot.features && (
                              <div className="mb-4">
                                <p className="text-sm font-medium mb-2">Features</p>
                                <div className="flex flex-wrap gap-1">
                                  {bot.features.autoLike && <Badge variant="outline" className="text-xs">Like</Badge>}
                                  {bot.features.autoReact && <Badge variant="outline" className="text-xs">React</Badge>}
                                  {bot.features.autoView && <Badge variant="outline" className="text-xs">View</Badge>}
                                  {bot.features.chatGPT && <Badge variant="outline" className="text-xs">AI</Badge>}
                                </div>
                              </div>
                            )}

                            {/* Actions */}
                            {bot.canManage && bot.approvalStatus === 'approved' && (
                              <div className="flex gap-1">
                                {bot.status === 'offline' ? (
                                  <Button
                                    size="sm"
                                    onClick={() => handleCrossServerAction('start', bot)}
                                    disabled={crossServerActionMutation.isPending}
                                    className="flex-1"
                                    data-testid={`button-cross-start-${bot.id}`}
                                  >
                                    <Play className="h-3 w-3 mr-1" />
                                    Start
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleCrossServerAction('stop', bot)}
                                    disabled={crossServerActionMutation.isPending}
                                    className="flex-1"
                                    data-testid={`button-cross-stop-${bot.id}`}
                                  >
                                    <Square className="h-3 w-3 mr-1" />
                                    Stop
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCrossServerAction('restart', bot)}
                                  disabled={crossServerActionMutation.isPending}
                                  data-testid={`button-cross-restart-${bot.id}`}
                                >
                                  <RefreshCw className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCrossServerAction('configure', bot)}
                                  disabled={crossServerActionMutation.isPending}
                                  data-testid={`button-cross-config-${bot.id}`}
                                >
                                  <Settings className="h-3 w-3" />
                                </Button>
                              </div>
                            )}

                            {/* Cannot Manage Warning */}
                            {!bot.canManage && (
                              <Alert>
                                <AlertTriangle className="h-4 w-4" />
                                <AlertDescription className="text-xs">
                                  Limited access on this server. Contact admin for full management.
                                </AlertDescription>
                              </Alert>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            {/* Filter tabs for online, offline, pending */}
            <TabsContent value="online" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {bots.filter((bot: CrossServerBot) => bot.status === 'online').map((bot: CrossServerBot) => (
                  <Card key={bot.id} className="border-green-200">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">{bot.name}</h4>
                        {getStatusBadge(bot.status)}
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {bot.phoneNumber} • {bot.serverName}
                      </p>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCrossServerAction('stop', bot)}
                          disabled={crossServerActionMutation.isPending}
                          className="flex-1"
                        >
                          <Square className="h-3 w-3 mr-1" />
                          Stop
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCrossServerAction('restart', bot)}
                          disabled={crossServerActionMutation.isPending}
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="offline" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {bots.filter((bot: CrossServerBot) => bot.status === 'offline').map((bot: CrossServerBot) => (
                  <Card key={bot.id} className="border-gray-200">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium">{bot.name}</h4>
                        {getStatusBadge(bot.status)}
                      </div>
                      <p className="text-sm text-muted-foreground mb-2">
                        {bot.phoneNumber} • {bot.serverName}
                      </p>
                      <Button
                        size="sm"
                        onClick={() => handleCrossServerAction('start', bot)}
                        disabled={crossServerActionMutation.isPending}
                        className="w-full"
                      >
                        <Play className="h-3 w-3 mr-1" />
                        Start Bot
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="pending" className="space-y-4">
              <div className="space-y-4">
                {bots.filter((bot: CrossServerBot) => bot.approvalStatus === 'pending').map((bot: CrossServerBot) => (
                  <Card key={bot.id} className="border-yellow-200">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h4 className="font-medium">{bot.name}</h4>
                          <p className="text-sm text-muted-foreground">
                            {bot.phoneNumber} • {bot.serverName}
                          </p>
                        </div>
                        {getStatusBadge(bot.status, bot.approvalStatus)}
                      </div>
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          This bot is awaiting approval from the admin on {bot.serverName}.
                        </AlertDescription>
                      </Alert>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* No Results */}
        {searchTriggered && !isLoading && bots.length === 0 && (
          <Card>
            <CardContent className="pt-6 text-center space-y-4">
              <Network className="h-16 w-16 text-muted-foreground mx-auto" />
              <div>
                <h3 className="text-lg font-medium">No Cross-Server Bots Found</h3>
                <p className="text-muted-foreground">
                  No bots found across servers for phone number {phoneNumber}.
                </p>
              </div>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" asChild>
                  <a href="/guest/verification">Register New Bot</a>
                </Button>
                <Button variant="outline" asChild>
                  <a href="/guest/bot-management">Manage Existing Bots</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Cross-Server Information */}
        <Card className="border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Network className="h-5 w-5 text-blue-500 mt-0.5" />
              <div>
                <h4 className="font-medium text-blue-800">Cross-Server Management</h4>
                <p className="text-sm text-blue-700 mt-1">
                  This feature allows you to manage bots across multiple servers from a single interface. 
                  Actions are coordinated through the God Registry system to ensure consistency across all servers. 
                  Some features may have limited availability depending on server configuration and your access level.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}