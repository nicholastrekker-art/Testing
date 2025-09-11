import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface MasterControlPanelProps {
  open: boolean;
  onClose: () => void;
}

interface TenancyServer {
  name: string;
  url?: string;
  status?: 'online' | 'offline' | 'unknown';
  botCount: number;
  lastSync?: string;
  registrations: any[];
}

interface CrossTenancyBot {
  id: string;
  name: string;
  phoneNumber: string;
  status: string;
  approvalStatus: string;
  tenancy: string;
  lastActivity: string;
  isLocal: boolean;
  settings?: any;
  autoLike?: boolean;
  autoReact?: boolean;
  autoViewStatus?: boolean;
  chatgptEnabled?: boolean;
  credentials?: any;
  messagesCount?: number;
  commandsCount?: number;
  approvalDate?: string;
  expirationMonths?: number;
}

export default function MasterControlPanel({ open, onClose }: MasterControlPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [selectedTenancy, setSelectedTenancy] = useState<string>("");
  const [tenancyCredentials, setTenancyCredentials] = useState({
    serverUrl: "",
    adminToken: ""
  });
  const [selectedBot, setSelectedBot] = useState<CrossTenancyBot | null>(null);
  const [showCredentialUpdate, setShowCredentialUpdate] = useState(false);
  const [newCredentials, setNewCredentials] = useState("");
  const [credentialType, setCredentialType] = useState<"base64" | "file">("base64");
  const [selectedBots, setSelectedBots] = useState<string[]>([]);

  // Fetch tenancies from God Registry
  const { data: connectedTenancies = [], isLoading: tenanciesLoading } = useQuery({
    queryKey: ['/api/master/tenancies'],
    enabled: open
  });

  // Fetch cross-tenancy bots
  const { data: crossTenancyBots = [], isLoading: botsLoading, refetch: refetchBots } = useQuery({
    queryKey: ['/api/master/cross-tenancy-bots'],
    enabled: open,
    refetchInterval: 10000 // Refresh every 10 seconds for real-time updates
  });

  // Fetch server information
  const { data: servers = [], isLoading: serversLoading } = useQuery({
    queryKey: ['/api/servers/list'],
    enabled: open,
    refetchInterval: 15000 // Refresh every 15 seconds
  });

  // Connect to tenancy mutation (for logging purposes, as connections are via God Registry)
  const connectTenancyMutation = useMutation({
    mutationFn: async (data: { tenancy: string; serverUrl: string; adminToken: string }) => {
      // This is mainly for logging the connection attempt
      console.log(`Attempting to connect to ${data.tenancy} via God Registry`);
      return { success: true, message: `Connected to ${data.tenancy} via God Registry` };
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Successfully connected to tenancy server"
      });
      queryClient.invalidateQueries({ queryKey: ['/api/master/cross-tenancy-bots'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Cross-tenancy bot action mutation
  const botActionMutation = useMutation({
    mutationFn: async ({ action, botId, tenancy, data }: { 
      action: string; 
      botId: string; 
      tenancy: string; 
      data?: any 
    }) => {
      const response = await apiRequest('POST', '/api/master/bot-action', { action, botId, tenancy, data });
      return response.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Success",
        description: `Successfully ${variables.action}d bot`
      });
      queryClient.invalidateQueries({ queryKey: ['/api/master/cross-tenancy-bots'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Action Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Cross-tenancy feature management mutation
  const featureManagementMutation = useMutation({
    mutationFn: async ({ action, botId, tenancy, feature, enabled }: { 
      action: 'toggle_feature'; 
      botId?: string; 
      tenancy: string; 
      feature: string;
      enabled: boolean;
    }) => {
      const response = await apiRequest('POST', '/api/master/feature-management', { 
        action, botId, tenancy, feature, enabled 
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Feature Updated",
        description: "Bot feature settings updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/master/cross-tenancy-bots'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Feature Update Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Command sync across tenancies mutation
  const commandSyncMutation = useMutation({
    mutationFn: async ({ sourceServer, targetServers, commandIds }: { 
      sourceServer: string;
      targetServers: string[];
      commandIds: string[];
    }) => {
      const response = await apiRequest('POST', '/api/master/sync-commands', { 
        sourceServer, targetServers, commandIds 
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Commands Synced",
        description: "Commands successfully synced across selected tenancies",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Command Sync Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleConnectTenancy = () => {
    if (!selectedTenancy || !tenancyCredentials.serverUrl || !tenancyCredentials.adminToken) {
      toast({
        title: "Validation Error",
        description: "Please fill in all fields",
        variant: "destructive"
      });
      return;
    }

    connectTenancyMutation.mutate({
      tenancy: selectedTenancy,
      serverUrl: tenancyCredentials.serverUrl,
      adminToken: tenancyCredentials.adminToken
    });
  };

  const handleBotAction = (action: string, botId: string, tenancy: string, data?: any) => {
    botActionMutation.mutate({ action, botId, tenancy, data });
  };

  const handleFeatureToggle = (botId: string, tenancy: string, feature: string, enabled: boolean) => {
    featureManagementMutation.mutate({ 
      action: 'toggle_feature', 
      botId, 
      tenancy, 
      feature, 
      enabled 
    });
  };

  const handleCommandSync = (sourceServer: string, targetServers: string[], commandIds: string[]) => {
    commandSyncMutation.mutate({ sourceServer, targetServers, commandIds });
  };

  const getStatusBadge = (status: string) => {
    const statusColors = {
      online: "bg-green-500",
      offline: "bg-gray-500", 
      pending: "bg-yellow-500",
      approved: "bg-blue-500",
      rejected: "bg-red-500",
      dormant: "bg-purple-500"
    };
    
    return (
      <Badge className={`${statusColors[status as keyof typeof statusColors] || "bg-gray-500"} text-white`}>
        {status}
      </Badge>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            🎛️ Master Control Panel
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="servers">Servers</TabsTrigger>
            <TabsTrigger value="bots">Bot Management</TabsTrigger>
            <TabsTrigger value="features">Features</TabsTrigger>
            <TabsTrigger value="credentials">Credentials</TabsTrigger>
            <TabsTrigger value="bulk">Bulk Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6 mb-6 dark:from-blue-900/20 dark:to-purple-900/20 dark:border-blue-800">
              <h3 className="text-xl font-bold text-blue-800 dark:text-blue-200 mb-2 flex items-center gap-2">
                🎛️ Master Control Dashboard
              </h3>
              <p className="text-sm text-blue-700 dark:text-blue-300 mb-4">
                Complete control over all server tenancies and bot containers in the TREKKER-MD ecosystem
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border shadow-sm">
                  <div className="text-2xl font-bold text-green-600">{(connectedTenancies as TenancyServer[]).length}</div>
                  <div className="text-sm text-muted-foreground">Active Tenancies</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border shadow-sm">
                  <div className="text-2xl font-bold text-blue-600">{(crossTenancyBots as CrossTenancyBot[]).length}</div>
                  <div className="text-sm text-muted-foreground">Total Bots</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border shadow-sm">
                  <div className="text-2xl font-bold text-orange-600">
                    {(crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.approvalStatus === 'pending').length}
                  </div>
                  <div className="text-sm text-muted-foreground">Pending Approval</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border shadow-sm">
                  <div className="text-2xl font-bold text-green-600">
                    {(crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.status === 'online').length}
                  </div>
                  <div className="text-sm text-muted-foreground">Online Bots</div>
                </div>
              </div>
            </div>
            
            {/* Real-time Activity Monitor */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  📊 Real-time System Status
                  <Badge variant="outline" className="ml-auto">Live</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-medium mb-3">Tenancy Distribution</h4>
                    <div className="space-y-2">
                      {(connectedTenancies as TenancyServer[]).map((tenancy) => (
                        <div key={tenancy.name} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                            <span className="font-medium">{tenancy.name}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">{tenancy.botCount} bots</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="font-medium mb-3">Bot Status Summary</h4>
                    <div className="space-y-2">
                      {[
                        { status: 'online', count: (crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.status === 'online').length, color: 'bg-green-500' },
                        { status: 'offline', count: (crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.status === 'offline').length, color: 'bg-gray-500' },
                        { status: 'pending', count: (crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.approvalStatus === 'pending').length, color: 'bg-yellow-500' },
                        { status: 'error', count: (crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.status === 'error').length, color: 'bg-red-500' }
                      ].map((item) => (
                        <div key={item.status} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded">
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 ${item.color} rounded-full`}></div>
                            <span className="capitalize">{item.status}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="servers" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-blue-600">🖥️ Server Tenancy Management</CardTitle>
                <CardDescription>
                  Monitor and control all server instances and their bot containers
                </CardDescription>
              </CardHeader>
              <CardContent>
                {serversLoading ? (
                  <div className="text-center py-8">Loading server information...</div>
                ) : (
                  <div className="space-y-4">
                    {(servers as any[]).slice(0, 20).map((server: any) => (
                      <Card key={server.name} className="border-l-4 border-l-blue-500">
                        <CardContent className="pt-6">
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div>
                              <h4 className="font-bold text-lg flex items-center gap-2">
                                🏢 {server.name}
                                {server.status === 'active' ? (
                                  <Badge className="bg-green-500 text-white">Active</Badge>
                                ) : (
                                  <Badge className="bg-gray-500 text-white">Available</Badge>
                                )}
                              </h4>
                              <p className="text-sm text-muted-foreground">
                                {server.description || 'Server instance ready for bot deployment'}
                              </p>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-blue-600">{server.currentBots}</div>
                              <div className="text-sm text-muted-foreground">Current Bots</div>
                            </div>
                            <div className="text-center">
                              <div className="text-2xl font-bold text-green-600">{server.remainingBots}</div>
                              <div className="text-sm text-muted-foreground">Available Slots</div>
                            </div>
                            <div className="text-center">
                              <div className="text-lg font-medium">
                                {Math.round((server.currentBots / server.totalBots) * 100)}%
                              </div>
                              <div className="text-sm text-muted-foreground">Capacity Used</div>
                              <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                                <div 
                                  className="bg-blue-600 h-2 rounded-full" 
                                  style={{ width: `${Math.round((server.currentBots / server.totalBots) * 100)}%` }}
                                ></div>
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 flex gap-2">
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => {
                                // Switch to this server for management
                                fetch('/api/server/configure', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ 
                                    serverName: server.name,
                                    description: `Switched to ${server.name} for administration`
                                  })
                                }).then(() => {
                                  toast({
                                    title: "Server Switched",
                                    description: `Successfully switched to ${server.name}`,
                                  });
                                  refetchBots();
                                });
                              }}
                              data-testid={`button-switch-to-${server.name}`}
                            >
                              🔄 Switch To
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => {
                                // View bots on this server
                                const serverBots = (crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.tenancy === server.name);
                                toast({
                                  title: "Server Bots",
                                  description: `${server.name} has ${serverBots.length} bots registered`,
                                });
                              }}
                            >
                              👁️ View Bots ({(crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.tenancy === server.name).length})
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tenancies" className="space-y-4">
            <div className="grid gap-4">
              {(connectedTenancies as TenancyServer[]).map((tenancy) => (
                <Card key={tenancy.name}>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {tenancy.name}
                        {getStatusBadge(tenancy.status || 'unknown')}
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => handleBotAction('sync', '', tenancy.name)}
                          disabled={botActionMutation.isPending}
                        >
                          Sync
                        </Button>
                        <Button 
                          size="sm" 
                          variant="destructive"
                          onClick={() => handleBotAction('disconnect', '', tenancy.name)}
                          disabled={botActionMutation.isPending}
                        >
                          Disconnect
                        </Button>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Server URL</Label>
                        <Input value={tenancy.url} readOnly />
                      </div>
                      <div>
                        <Label>Bot Count</Label>
                        <Input value={tenancy.botCount.toString()} readOnly />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="bots" className="space-y-4">
            {/* Enhanced Bot Management with Individual Controls */}
            
            {/* Quick Actions Bar */}
            <Card className="border-l-4 border-l-purple-500">
              <CardContent className="pt-6">
                <div className="flex flex-wrap gap-4">
                  <Button 
                    variant="outline"
                    onClick={() => refetchBots()}
                    disabled={botsLoading}
                    className="flex items-center gap-2"
                  >
                    🔄 Refresh Data
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => {
                      const pendingCount = (crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.approvalStatus === 'pending').length;
                      toast({
                        title: "Pending Approvals",
                        description: `${pendingCount} bots awaiting approval`,
                      });
                    }}
                  >
                    ⏳ Pending ({(crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.approvalStatus === 'pending').length})
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => {
                      const onlineCount = (crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.status === 'online').length;
                      toast({
                        title: "Online Bots",
                        description: `${onlineCount} bots currently online`,
                      });
                    }}
                  >
                    🟢 Online ({(crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.status === 'online').length})
                  </Button>
                </div>
              </CardContent>
            </Card>
            {/* Comprehensive Bot Management Table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-purple-600">🤖 Complete Bot Registry</CardTitle>
                <CardDescription>
                  All bots across all server tenancies with individual container controls
                </CardDescription>
              </CardHeader>
              <CardContent>
                {botsLoading ? (
                  <div className="text-center py-8">Loading bot registry...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bot Details</TableHead>
                        <TableHead>Server</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Approval</TableHead>
                        <TableHead>Features</TableHead>
                        <TableHead>Stats</TableHead>
                        <TableHead>Container Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(crossTenancyBots as CrossTenancyBot[]).map((bot) => (
                        <TableRow key={`${bot.tenancy}-${bot.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                          <TableCell>
                            <div>
                              <div className="font-medium">{bot.name}</div>
                              <div className="text-sm text-muted-foreground">{bot.phoneNumber}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={bot.tenancy === 'default-server' ? 'default' : 'outline'}>
                              {bot.tenancy}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {getStatusBadge(bot.status)}
                              {bot.approvalStatus && (
                                <div>{getStatusBadge(bot.approvalStatus)}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {bot.approvalStatus === 'pending' ? (
                              <div className="flex gap-1">
                                <Button 
                                  size="sm" 
                                  variant="default"
                                  onClick={() => handleBotAction('approve', bot.id, bot.tenancy, { duration: 6 })}
                                  disabled={botActionMutation.isPending}
                                  data-testid={`button-approve-${bot.id}`}
                                >
                                  ✅
                                </Button>
                                <Button 
                                  size="sm" 
                                  variant="destructive"
                                  onClick={() => handleBotAction('reject', bot.id, bot.tenancy)}
                                  disabled={botActionMutation.isPending}
                                  data-testid={`button-reject-${bot.id}`}
                                >
                                  ❌
                                </Button>
                              </div>
                            ) : bot.approvalStatus === 'approved' ? (
                              <div className="text-xs text-green-600">
                                ✅ Approved
                                {bot.expirationMonths && (
                                  <div>({bot.expirationMonths}mo)</div>
                                )}
                              </div>
                            ) : (
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleBotAction('approve', bot.id, bot.tenancy, { duration: 6 })}
                                disabled={botActionMutation.isPending}
                              >
                                🔄 Return to Normal
                              </Button>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant={bot.autoLike ? 'default' : 'outline'} className="text-xs">
                                👍 {bot.autoLike ? 'ON' : 'OFF'}
                              </Badge>
                              <Badge variant={bot.chatgptEnabled ? 'default' : 'outline'} className="text-xs">
                                🤖 {bot.chatgptEnabled ? 'ON' : 'OFF'}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-xs space-y-1">
                              <div>Msgs: {bot.messagesCount || 0}</div>
                              <div>Cmds: {bot.commandsCount || 0}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {/* Start/Stop Controls */}
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleBotAction(
                                  bot.status === 'online' ? 'stop' : 'start', 
                                  bot.id, 
                                  bot.tenancy
                                )}
                                disabled={botActionMutation.isPending}
                                data-testid={`button-${bot.status === 'online' ? 'stop' : 'start'}-${bot.id}`}
                              >
                                {bot.status === 'online' ? '⏹️' : '▶️'}
                              </Button>
                              
                              {/* Credential Update */}
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => {
                                  setSelectedBot(bot);
                                  setShowCredentialUpdate(true);
                                }}
                                data-testid={`button-creds-${bot.id}`}
                              >
                                🔐
                              </Button>
                              
                              {/* Feature Toggle */}
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleFeatureToggle(bot.id, bot.tenancy, 'autoLike', !bot.autoLike)}
                                disabled={featureManagementMutation.isPending}
                              >
                                🎛️
                              </Button>
                              
                              {/* Delete */}
                              <Button 
                                size="sm" 
                                variant="destructive"
                                onClick={() => handleBotAction('delete', bot.id, bot.tenancy)}
                                disabled={botActionMutation.isPending}
                                data-testid={`button-delete-${bot.id}`}
                              >
                                🗑️
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Approved Bots Section */}
            <Card>
              <CardHeader>
                <CardTitle className="text-green-600">✅ Approved & Active Bots</CardTitle>
                <CardDescription>
                  Currently approved and active bots across all tenancies
                </CardDescription>
              </CardHeader>
              <CardContent>
                {botsLoading ? (
                  <div className="text-center py-8">Loading approved bots...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bot Name</TableHead>
                        <TableHead>Phone Number</TableHead>
                        <TableHead>Tenancy</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Approval Date</TableHead>
                        <TableHead>Last Activity</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.approvalStatus === 'approved').map((bot) => (
                        <TableRow key={`approved-${bot.tenancy}-${bot.id}`}>
                          <TableCell className="font-medium">{bot.name}</TableCell>
                          <TableCell>{bot.phoneNumber}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{bot.tenancy}</Badge>
                          </TableCell>
                          <TableCell>{getStatusBadge(bot.status)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date().toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {bot.lastActivity}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleBotAction(
                                  bot.status === 'online' ? 'stop' : 'start', 
                                  bot.id, 
                                  bot.tenancy
                                )}
                                disabled={botActionMutation.isPending}
                                data-testid={`button-${bot.status === 'online' ? 'stop' : 'start'}-${bot.id}`}
                              >
                                {bot.status === 'online' ? '⏹️ Stop' : '▶️ Start'}
                              </Button>
                              <Button 
                                size="sm" 
                                variant="destructive"
                                onClick={() => handleBotAction('delete', bot.id, bot.tenancy)}
                                disabled={botActionMutation.isPending}
                                data-testid={`button-delete-approved-${bot.id}`}
                              >
                                🗑️ Delete
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="features" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-purple-600">🎛️ Cross-Tenancy Feature Control</CardTitle>
                <CardDescription>
                  Manage bot features across all tenancies from this central panel
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Global Feature Controls */}
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 dark:bg-purple-900/20 dark:border-purple-800">
                  <h4 className="font-medium text-purple-800 dark:text-purple-200 mb-3 flex items-center gap-2">
                    🌐 Global Feature Management
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { key: 'autoLike', label: 'Auto Like', icon: '👍', description: 'Automatically like status updates' },
                      { key: 'autoReact', label: 'Auto React', icon: '😄', description: 'Automatically react to messages' },
                      { key: 'autoView', label: 'Auto View', icon: '👁️', description: 'Automatically view status updates' },
                      { key: 'chatGPT', label: 'ChatGPT', icon: '🤖', description: 'Enable AI chat responses' },
                      { key: 'typingIndicator', label: 'Typing', icon: '⌨️', description: 'Show typing indicators' },
                      { key: 'readReceipts', label: 'Read Receipts', icon: '✓✓', description: 'Send read receipts' }
                    ].map((feature) => (
                      <div key={feature.key} className="bg-white dark:bg-gray-800 rounded-lg p-3 border shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">{feature.icon}</span>
                          <span className="font-medium text-sm">{feature.label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">{feature.description}</p>
                        <div className="space-y-2">
                          {(connectedTenancies as TenancyServer[]).map((tenancy) => (
                            <div key={tenancy.name} className="flex items-center justify-between">
                              <span className="text-xs">{tenancy.name}</span>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleFeatureToggle('', tenancy.name, feature.key, true)}
                                className="h-6 px-2 text-xs"
                                disabled={featureManagementMutation.isPending}
                              >
                                Toggle
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Individual Bot Feature Controls */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 dark:bg-blue-900/20 dark:border-blue-800">
                  <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-3 flex items-center gap-2">
                    🤖 Individual Bot Feature Control
                  </h4>
                  <div className="space-y-4">
                    {(crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.approvalStatus === 'approved').map((bot) => (
                      <div key={`${bot.tenancy}-${bot.id}`} className="bg-white dark:bg-gray-800 rounded-lg p-4 border">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h5 className="font-medium">{bot.name}</h5>
                            <p className="text-sm text-muted-foreground">{bot.phoneNumber} • {bot.tenancy}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {getStatusBadge(bot.status)}
                            <Badge variant="outline">{bot.tenancy}</Badge>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                          {[
                            { key: 'autoLike', label: 'Like', icon: '👍' },
                            { key: 'autoReact', label: 'React', icon: '😄' },
                            { key: 'autoView', label: 'View', icon: '👁️' },
                            { key: 'chatGPT', label: 'AI', icon: '🤖' },
                            { key: 'typing', label: 'Type', icon: '⌨️' },
                            { key: 'receipts', label: 'Read', icon: '✓✓' }
                          ].map((feature) => (
                            <Button
                              key={feature.key}
                              size="sm"
                              variant="outline"
                              onClick={() => handleFeatureToggle(bot.id, bot.tenancy, feature.key, true)}
                              className="flex flex-col items-center gap-1 h-auto py-2"
                              disabled={featureManagementMutation.isPending}
                            >
                              <span className="text-sm">{feature.icon}</span>
                              <span className="text-xs">{feature.label}</span>
                            </Button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Command Sync Panel */}
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 dark:bg-emerald-900/20 dark:border-emerald-800">
                  <h4 className="font-medium text-emerald-800 dark:text-emerald-200 mb-3 flex items-center gap-2">
                    📡 Command Sync Across Tenancies
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Source Server</label>
                      <select className="w-full p-2 border rounded-md bg-white dark:bg-gray-800">
                        <option value="">Select source server...</option>
                        {(connectedTenancies as TenancyServer[]).map((tenancy) => (
                          <option key={tenancy.name} value={tenancy.name}>{tenancy.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-2 block">Target Servers</label>
                      <div className="space-y-2">
                        {(connectedTenancies as TenancyServer[]).map((tenancy) => (
                          <div key={tenancy.name} className="flex items-center gap-2">
                            <input type="checkbox" id={`target-${tenancy.name}`} className="rounded" />
                            <label htmlFor={`target-${tenancy.name}`} className="text-sm">{tenancy.name}</label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <Button 
                    className="w-full mt-4 bg-emerald-600 hover:bg-emerald-700"
                    disabled={commandSyncMutation.isPending}
                  >
                    🔄 Sync Selected Commands
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="credentials" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-green-600">🔐 Bot Credential Management</CardTitle>
                <CardDescription>
                  Update WhatsApp credentials for bots in their respective containers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 dark:bg-yellow-900/20 dark:border-yellow-800">
                  <h4 className="font-medium text-yellow-800 dark:text-yellow-200 mb-2">⚠️ Credential Update Safety</h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300">
                    Credential updates are performed within each bot's isolated container. 
                    Data registry entries remain unchanged to maintain system integrity.
                  </p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.approvalStatus === 'approved').map((bot) => (
                    <Card key={`cred-${bot.tenancy}-${bot.id}`} className="border-l-4 border-l-green-500">
                      <CardContent className="pt-6">
                        <div className="space-y-3">
                          <div>
                            <h4 className="font-medium">{bot.name}</h4>
                            <p className="text-sm text-muted-foreground">{bot.phoneNumber}</p>
                            <Badge variant="outline" className="mt-1">{bot.tenancy}</Badge>
                          </div>
                          
                          <div className="flex items-center justify-between">
                            <span className="text-sm">Container Status:</span>
                            {getStatusBadge(bot.status)}
                          </div>
                          
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => {
                              setSelectedBot(bot);
                              setShowCredentialUpdate(true);
                            }}
                            className="w-full"
                            data-testid={`button-update-creds-${bot.id}`}
                          >
                            🔐 Update Credentials
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bulk" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-red-600">⚡ Bulk Operations</CardTitle>
                <CardDescription>
                  Perform actions on multiple bots across all server tenancies
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {/* Bulk Selection */}
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 dark:bg-red-900/20 dark:border-red-800">
                    <h4 className="font-medium text-red-800 dark:text-red-200 mb-3">📋 Bulk Bot Selection</h4>
                    <div className="flex flex-wrap gap-2 mb-4">
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => {
                          const allBotIds = (crossTenancyBots as CrossTenancyBot[]).map(bot => `${bot.tenancy}-${bot.id}`);
                          setSelectedBots(allBotIds);
                        }}
                      >
                        ✅ Select All ({(crossTenancyBots as CrossTenancyBot[]).length})
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => {
                          const pendingBotIds = (crossTenancyBots as CrossTenancyBot[])
                            .filter(bot => bot.approvalStatus === 'pending')
                            .map(bot => `${bot.tenancy}-${bot.id}`);
                          setSelectedBots(pendingBotIds);
                        }}
                      >
                        ⏳ Select Pending ({(crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.approvalStatus === 'pending').length})
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => {
                          const onlineBotIds = (crossTenancyBots as CrossTenancyBot[])
                            .filter(bot => bot.status === 'online')
                            .map(bot => `${bot.tenancy}-${bot.id}`);
                          setSelectedBots(onlineBotIds);
                        }}
                      >
                        🟢 Select Online ({(crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.status === 'online').length})
                      </Button>
                      <Button 
                        size="sm" 
                        variant="destructive"
                        onClick={() => setSelectedBots([])}
                      >
                        ❌ Clear Selection
                      </Button>
                    </div>
                    <p className="text-sm text-red-700 dark:text-red-300">
                      Selected: {selectedBots.length} bots
                    </p>
                  </div>

                  {/* Bulk Actions */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card className="border-l-4 border-l-green-500">
                      <CardContent className="pt-6">
                        <h4 className="font-medium text-green-600 mb-3">✅ Bulk Approve</h4>
                        <p className="text-sm text-muted-foreground mb-4">
                          Approve all selected pending bots
                        </p>
                        <Button 
                          size="sm" 
                          variant="default"
                          className="w-full"
                          disabled={selectedBots.length === 0}
                          onClick={() => {
                            selectedBots.forEach(botKey => {
                              const [tenancy, botId] = botKey.split('-');
                              const bot = (crossTenancyBots as CrossTenancyBot[]).find(b => b.tenancy === tenancy && b.id === botId);
                              if (bot && bot.approvalStatus === 'pending') {
                                handleBotAction('approve', botId, tenancy, { duration: 6 });
                              }
                            });
                            toast({
                              title: "Bulk Approval",
                              description: `Processing approval for ${selectedBots.length} bots`,
                            });
                          }}
                        >
                          Approve Selected
                        </Button>
                      </CardContent>
                    </Card>

                    <Card className="border-l-4 border-l-blue-500">
                      <CardContent className="pt-6">
                        <h4 className="font-medium text-blue-600 mb-3">▶️ Bulk Start</h4>
                        <p className="text-sm text-muted-foreground mb-4">
                          Start all selected offline bots
                        </p>
                        <Button 
                          size="sm" 
                          variant="outline"
                          className="w-full"
                          disabled={selectedBots.length === 0}
                          onClick={() => {
                            selectedBots.forEach(botKey => {
                              const [tenancy, botId] = botKey.split('-');
                              const bot = (crossTenancyBots as CrossTenancyBot[]).find(b => b.tenancy === tenancy && b.id === botId);
                              if (bot && bot.status === 'offline') {
                                handleBotAction('start', botId, tenancy);
                              }
                            });
                            toast({
                              title: "Bulk Start",
                              description: `Starting ${selectedBots.length} bots`,
                            });
                          }}
                        >
                          Start Selected
                        </Button>
                      </CardContent>
                    </Card>

                    <Card className="border-l-4 border-l-orange-500">
                      <CardContent className="pt-6">
                        <h4 className="font-medium text-orange-600 mb-3">⏹️ Bulk Stop</h4>
                        <p className="text-sm text-muted-foreground mb-4">
                          Stop all selected online bots
                        </p>
                        <Button 
                          size="sm" 
                          variant="outline"
                          className="w-full"
                          disabled={selectedBots.length === 0}
                          onClick={() => {
                            selectedBots.forEach(botKey => {
                              const [tenancy, botId] = botKey.split('-');
                              const bot = (crossTenancyBots as CrossTenancyBot[]).find(b => b.tenancy === tenancy && b.id === botId);
                              if (bot && bot.status === 'online') {
                                handleBotAction('stop', botId, tenancy);
                              }
                            });
                            toast({
                              title: "Bulk Stop",
                              description: `Stopping ${selectedBots.length} bots`,
                            });
                          }}
                        >
                          Stop Selected
                        </Button>
                      </CardContent>
                    </Card>

                    <Card className="border-l-4 border-l-purple-500">
                      <CardContent className="pt-6">
                        <h4 className="font-medium text-purple-600 mb-3">🎛️ Bulk Features</h4>
                        <p className="text-sm text-muted-foreground mb-4">
                          Enable features for selected bots
                        </p>
                        <Button 
                          size="sm" 
                          variant="outline"
                          className="w-full"
                          disabled={selectedBots.length === 0}
                          onClick={() => {
                            selectedBots.forEach(botKey => {
                              const [tenancy, botId] = botKey.split('-');
                              handleFeatureToggle(botId, tenancy, 'autoLike', true);
                            });
                            toast({
                              title: "Bulk Feature Update",
                              description: `Enabling features for ${selectedBots.length} bots`,
                            });
                          }}
                        >
                          Enable Auto-Like
                        </Button>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="connect" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>God Registry Information</CardTitle>
                <CardDescription>
                  Cross-tenancy management is powered by the God Registry table
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h4 className="font-medium text-yellow-800 mb-2">🔄 How Cross-Tenancy Works:</h4>
                  <ul className="text-sm text-yellow-700 space-y-1">
                    <li>• All bot registrations are stored in the God Registry table</li>
                    <li>• Each entry contains phone number and tenancy name (SERVER1, SERVER2, etc.)</li>
                    <li>• Master control can see and manage bots across all tenancies</li>
                    <li>• Local tenancy bots show full details, remote ones show registry info</li>
                    <li>• Actions on local tenancy bots are executed directly</li>
                    <li>• Actions on remote tenancy bots are logged for coordination</li>
                  </ul>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-800 mb-2">📋 Current Setup:</h4>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• Current Server: {import.meta.env.VITE_SERVER_NAME || 'SERVER1'}</li>
                    <li>• God Registry: Active and monitoring all tenancies</li>
                    <li>• Cross-tenancy actions: Logged and tracked</li>
                    <li>• Data isolation: Each tenancy maintains its own bot data</li>
                  </ul>
                </div>

                <div className="text-center py-4">
                  <p className="text-sm text-muted-foreground">
                    No additional setup required - God Registry manages everything automatically
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Credential Update Modal */}
        {selectedBot && (
          <Dialog open={showCredentialUpdate} onOpenChange={setShowCredentialUpdate}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>🔐 Update Bot Credentials</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 dark:bg-blue-900/20 dark:border-blue-800">
                  <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-2">Bot Information</h4>
                  <div className="space-y-1 text-sm">
                    <div><strong>Name:</strong> {selectedBot.name}</div>
                    <div><strong>Phone:</strong> {selectedBot.phoneNumber}</div>
                    <div><strong>Server:</strong> {selectedBot.tenancy}</div>
                    <div><strong>Status:</strong> {selectedBot.status}</div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label htmlFor="credential-type">Credential Type</Label>
                    <Select value={credentialType} onValueChange={(value: "base64" | "file") => setCredentialType(value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select credential type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="base64">Base64 String</SelectItem>
                        <SelectItem value="file">File Upload</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {credentialType === 'base64' ? (
                    <div>
                      <Label htmlFor="credentials">New Credentials (Base64)</Label>
                      <textarea
                        id="credentials"
                        className="w-full h-32 p-3 border rounded-md resize-none font-mono text-sm"
                        placeholder="Paste your base64-encoded credentials here..."
                        value={newCredentials}
                        onChange={(e) => setNewCredentials(e.target.value)}
                      />
                    </div>
                  ) : (
                    <div>
                      <Label htmlFor="credential-file">Upload Credentials File</Label>
                      <input
                        id="credential-file"
                        type="file"
                        accept=".json"
                        className="w-full p-2 border rounded-md"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              setNewCredentials(event.target?.result as string || '');
                            };
                            reader.readAsText(file);
                          }
                        }}
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button 
                      onClick={() => {
                        if (!newCredentials.trim()) {
                          toast({
                            title: "Validation Error",
                            description: "Please provide credentials",
                            variant: "destructive"
                          });
                          return;
                        }

                        // Call credential update API
                        fetch('/api/master/bot-action', {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
                          },
                          body: JSON.stringify({
                            action: 'update_credentials',
                            botId: selectedBot.id,
                            tenancy: selectedBot.tenancy,
                            data: {
                              credentials: credentialType === 'base64' ? newCredentials : JSON.parse(newCredentials),
                              type: credentialType
                            }
                          })
                        }).then(async (response) => {
                          if (response.ok) {
                            toast({
                              title: "Credentials Updated",
                              description: `Credentials updated for ${selectedBot.name} in ${selectedBot.tenancy} container`,
                            });
                            setShowCredentialUpdate(false);
                            setSelectedBot(null);
                            setNewCredentials('');
                            refetchBots();
                          } else {
                            const error = await response.json();
                            toast({
                              title: "Update Failed",
                              description: error.message || "Failed to update credentials",
                              variant: "destructive"
                            });
                          }
                        });
                      }}
                      className="flex-1"
                      data-testid="button-save-credentials"
                    >
                      💾 Update Credentials
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => {
                        setShowCredentialUpdate(false);
                        setSelectedBot(null);
                        setNewCredentials('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}