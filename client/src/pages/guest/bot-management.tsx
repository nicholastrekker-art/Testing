import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Bot, Play, Square, RefreshCw, Settings, Trash2, ExternalLink, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface BotInfo {
  id: string;
  name: string;
  phoneNumber: string;
  status: string;
  approvalStatus: string;
  serverName?: string;
  lastActivity?: string;
  messagesCount?: number;
  commandsCount?: number;
  isActive: boolean;
  needsCredentials?: boolean;
  features?: {
    autoLike?: boolean;
    autoReact?: boolean;
    autoView?: boolean;
    chatGPT?: boolean;
  };
}

export default function GuestBotManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [searchTriggered, setSearchTriggered] = useState(false);

  // Search for user's bots
  const { data: userBots = [], isLoading, error } = useQuery({
    queryKey: ["/api/guest/my-bots", phoneNumber],
    queryFn: async () => {
      if (!phoneNumber.trim()) return [];
      
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const response = await fetch('/api/guest/my-bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanedPhone }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch your bots');
      }
      
      return response.json();
    },
    enabled: searchTriggered && !!phoneNumber.trim(),
  });

  // Bot action mutation
  const botActionMutation = useMutation({
    mutationFn: async ({ action, botId, data }: { action: string; botId: string; data?: any }) => {
      const response = await fetch('/api/guest/bot-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem("guest_token")}`,
        },
        body: JSON.stringify({ action, botId, ...data }),
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
      queryClient.invalidateQueries({ queryKey: ["/api/guest/my-bots"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Action Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleSearch = () => {
    if (!phoneNumber.trim()) {
      toast({
        title: "Phone Required",
        description: "Please enter your phone number to find your bots",
        variant: "destructive"
      });
      return;
    }
    setSearchTriggered(true);
  };

  const handleBotAction = (action: string, bot: BotInfo, data?: any) => {
    botActionMutation.mutate({ action, botId: bot.id, data });
  };

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

  const activeBots = userBots.filter((bot: BotInfo) => bot.isActive && bot.approvalStatus === 'approved');
  const pendingBots = userBots.filter((bot: BotInfo) => bot.approvalStatus === 'pending');
  const inactiveBots = userBots.filter((bot: BotInfo) => !bot.isActive || bot.approvalStatus === 'rejected');

  return (
    <div className="min-h-screen w-full p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Bot Management</h1>
          <p className="text-muted-foreground">
            Manage your WhatsApp bots across all servers
          </p>
        </div>

        {/* Search Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              Find Your Bots
            </CardTitle>
            <CardDescription>
              Enter your phone number to find and manage your bots across all servers
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
                data-testid="input-search-phone"
              />
              <Button 
                onClick={handleSearch}
                disabled={isLoading}
                data-testid="button-search-bots"
              >
                {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Find Bots"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Error State */}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {error.message}
            </AlertDescription>
          </Alert>
        )}

        {/* Bot Management Tabs */}
        {searchTriggered && !isLoading && userBots.length > 0 && (
          <Tabs defaultValue="active" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="active" data-testid="tab-active-bots">
                Active Bots ({activeBots.length})
              </TabsTrigger>
              <TabsTrigger value="pending" data-testid="tab-pending-bots">
                Pending ({pendingBots.length})
              </TabsTrigger>
              <TabsTrigger value="inactive" data-testid="tab-inactive-bots">
                Inactive ({inactiveBots.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="active" className="space-y-4">
              {activeBots.length === 0 ? (
                <Card>
                  <CardContent className="pt-6 text-center">
                    <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No active bots found</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {activeBots.map((bot: BotInfo) => (
                    <Card key={bot.id} className="border-green-200">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-lg">{bot.name}</CardTitle>
                          {getStatusBadge(bot.status, bot.approvalStatus)}
                        </div>
                        <CardDescription>
                          {bot.phoneNumber}
                          {bot.serverName && (
                            <Badge variant="outline" className="ml-2">
                              {bot.serverName}
                            </Badge>
                          )}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Bot Stats */}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Messages</p>
                            <p className="font-medium">{bot.messagesCount || 0}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Commands</p>
                            <p className="font-medium">{bot.commandsCount || 0}</p>
                          </div>
                        </div>

                        {/* Feature Status */}
                        {bot.features && (
                          <div className="space-y-2">
                            <p className="text-sm font-medium">Features</p>
                            <div className="flex flex-wrap gap-1">
                              {bot.features.autoLike && <Badge variant="outline" className="text-xs">Auto Like</Badge>}
                              {bot.features.autoReact && <Badge variant="outline" className="text-xs">Auto React</Badge>}
                              {bot.features.autoView && <Badge variant="outline" className="text-xs">Auto View</Badge>}
                              {bot.features.chatGPT && <Badge variant="outline" className="text-xs">ChatGPT</Badge>}
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2">
                          {bot.status === 'offline' ? (
                            <Button
                              size="sm"
                              onClick={() => handleBotAction('start', bot)}
                              disabled={botActionMutation.isPending}
                              className="flex-1"
                              data-testid={`button-start-${bot.id}`}
                            >
                              <Play className="h-3 w-3 mr-1" />
                              Start
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleBotAction('stop', bot)}
                              disabled={botActionMutation.isPending}
                              className="flex-1"
                              data-testid={`button-stop-${bot.id}`}
                            >
                              <Square className="h-3 w-3 mr-1" />
                              Stop
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleBotAction('restart', bot)}
                            disabled={botActionMutation.isPending}
                            data-testid={`button-restart-${bot.id}`}
                          >
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        </div>

                        {/* Credentials Warning */}
                        {bot.needsCredentials && (
                          <Alert>
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription className="text-xs">
                              Bot needs credential update. Visit the Credential Manager to update.
                            </AlertDescription>
                          </Alert>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="pending" className="space-y-4">
              {pendingBots.length === 0 ? (
                <Card>
                  <CardContent className="pt-6 text-center">
                    <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No pending bots</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {pendingBots.map((bot: BotInfo) => (
                    <Card key={bot.id} className="border-yellow-200">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-medium">{bot.name}</h4>
                            <p className="text-sm text-muted-foreground">{bot.phoneNumber}</p>
                            {bot.serverName && (
                              <Badge variant="outline" className="mt-1">
                                {bot.serverName}
                              </Badge>
                            )}
                          </div>
                          {getStatusBadge(bot.status, bot.approvalStatus)}
                        </div>
                        <Alert className="mt-4">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription>
                            Your bot is waiting for admin approval. You'll be notified once it's approved.
                          </AlertDescription>
                        </Alert>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="inactive" className="space-y-4">
              {inactiveBots.length === 0 ? (
                <Card>
                  <CardContent className="pt-6 text-center">
                    <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">No inactive bots</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {inactiveBots.map((bot: BotInfo) => (
                    <Card key={bot.id} className="border-gray-200">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-medium text-muted-foreground">{bot.name}</h4>
                            <p className="text-sm text-muted-foreground">{bot.phoneNumber}</p>
                            {bot.serverName && (
                              <Badge variant="outline" className="mt-1">
                                {bot.serverName}
                              </Badge>
                            )}
                          </div>
                          {getStatusBadge(bot.status, bot.approvalStatus)}
                        </div>
                        <div className="flex gap-2 mt-4">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleBotAction('reactivate', bot)}
                            disabled={botActionMutation.isPending}
                            data-testid={`button-reactivate-${bot.id}`}
                          >
                            Reactivate
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleBotAction('delete', bot)}
                            disabled={botActionMutation.isPending}
                            className="text-red-600 hover:bg-red-50"
                            data-testid={`button-delete-${bot.id}`}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}

        {/* No Results */}
        {searchTriggered && !isLoading && userBots.length === 0 && !error && (
          <Card>
            <CardContent className="pt-6 text-center space-y-4">
              <Bot className="h-16 w-16 text-muted-foreground mx-auto" />
              <div>
                <h3 className="text-lg font-medium">No Bots Found</h3>
                <p className="text-muted-foreground">
                  No bots found for phone number {phoneNumber}. 
                </p>
              </div>
              <Button variant="outline" asChild>
                <a href="/guest/verification">Register a New Bot</a>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}