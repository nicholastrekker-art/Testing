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
}

export default function MasterControlPanel({ open, onClose }: MasterControlPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [selectedTenancy, setSelectedTenancy] = useState<string>("");
  const [tenancyCredentials, setTenancyCredentials] = useState({
    serverUrl: "",
    adminToken: ""
  });

  // Fetch tenancies from God Registry
  const { data: connectedTenancies = [], isLoading: tenanciesLoading } = useQuery({
    queryKey: ['/api/master/tenancies'],
    enabled: open
  });

  // Fetch cross-tenancy bots
  const { data: crossTenancyBots = [], isLoading: botsLoading } = useQuery({
    queryKey: ['/api/master/cross-tenancy-bots'],
    enabled: open
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
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="tenancies">Tenancies</TabsTrigger>
            <TabsTrigger value="bots">Cross-Tenancy Bots</TabsTrigger>
            <TabsTrigger value="features">Feature Control</TabsTrigger>
            <TabsTrigger value="connect">Connect New</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <h4 className="font-medium text-blue-800 mb-2">📊 God Registry Overview</h4>
              <p className="text-sm text-blue-700">
                This panel shows tenancies and bots registered in the God Registry table. 
                All cross-tenancy data is managed through this central registry.
              </p>
            </div>
            
            {tenanciesLoading ? (
              <div className="text-center py-8">Loading tenancies from God Registry...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(connectedTenancies as TenancyServer[]).map((tenancy) => (
                  <Card key={tenancy.name}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        {tenancy.name}
                        {getStatusBadge('online')}
                      </CardTitle>
                      <CardDescription>God Registry Tenancy</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span>Registered Bots:</span>
                          <span className="font-medium">{tenancy.botCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Source:</span>
                          <span className="text-sm text-muted-foreground">God Registry</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
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
            {/* Pending Bots Section */}
            <Card>
              <CardHeader>
                <CardTitle className="text-orange-600">⏳ Pending Bot Approvals</CardTitle>
                <CardDescription>
                  Bots waiting for approval across all tenancies
                </CardDescription>
              </CardHeader>
              <CardContent>
                {botsLoading ? (
                  <div className="text-center py-8">Loading pending bots...</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bot Name</TableHead>
                        <TableHead>Phone Number</TableHead>
                        <TableHead>Tenancy</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Approval</TableHead>
                        <TableHead>Last Activity</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(crossTenancyBots as CrossTenancyBot[]).filter(bot => bot.approvalStatus === 'pending').map((bot) => (
                        <TableRow key={`pending-${bot.tenancy}-${bot.id}`}>
                          <TableCell className="font-medium">{bot.name}</TableCell>
                          <TableCell>{bot.phoneNumber}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{bot.tenancy}</Badge>
                          </TableCell>
                          <TableCell>{getStatusBadge(bot.status)}</TableCell>
                          <TableCell>{getStatusBadge(bot.approvalStatus)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {bot.lastActivity}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button 
                                size="sm" 
                                variant="default"
                                onClick={() => handleBotAction('approve', bot.id, bot.tenancy, { duration: 6 })}
                                disabled={botActionMutation.isPending}
                                data-testid={`button-approve-${bot.id}`}
                              >
                                ✅ Approve
                              </Button>
                              <Button 
                                size="sm" 
                                variant="destructive"
                                onClick={() => handleBotAction('reject', bot.id, bot.tenancy)}
                                disabled={botActionMutation.isPending}
                                data-testid={`button-reject-${bot.id}`}
                              >
                                ❌ Reject
                              </Button>
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleBotAction('delete', bot.id, bot.tenancy)}
                                disabled={botActionMutation.isPending}
                                data-testid={`button-delete-${bot.id}`}
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
      </DialogContent>
    </Dialog>
  );
}