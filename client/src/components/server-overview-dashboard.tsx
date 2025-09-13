import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Server, Activity, Bot, Wifi, WifiOff, AlertTriangle } from "lucide-react";
import type { ServerRegistry } from "@shared/schema";

interface ServerOverviewResponse {
  servers: Array<{
    serverName: string;
    currentBots: number;
    maxBots: number;
    availableSlots: number;
    serverUrl?: string;
    description?: string;
    serverStatus: string;
  }>;
}

export default function ServerOverviewDashboard() {
  // Fetch all servers overview with real-time updates every 5 seconds
  const { data: serversData, isLoading } = useQuery<ServerOverviewResponse>({
    queryKey: ["/api/servers/all"],
    refetchInterval: 5000, // Refetch every 5 seconds for live monitoring
  });

  const servers = serversData?.servers || [];

  const getStatusIcon = (status: string, currentBots: number, maxBots: number) => {
    if (status !== 'active') return <WifiOff className="h-4 w-4 text-red-500" />;
    if (currentBots >= maxBots) return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <Wifi className="h-4 w-4 text-green-500" />;
  };

  const getStatusBadge = (status: string, currentBots: number, maxBots: number) => {
    if (status !== 'active') return <Badge variant="destructive">Inactive</Badge>;
    if (currentBots >= maxBots) return <Badge variant="secondary">Full</Badge>;
    if (currentBots === 0) return <Badge variant="outline">Empty</Badge>;
    return <Badge variant="default">Active</Badge>;
  };

  const getUtilizationColor = (percentage: number) => {
    if (percentage >= 90) return "bg-red-500";
    if (percentage >= 70) return "bg-yellow-500";
    return "bg-green-500";
  };

  // Calculate summary stats
  const totalServers = servers.length;
  const activeServers = servers.filter(s => s.serverStatus === 'active').length;
  const totalBots = servers.reduce((sum, s) => sum + s.currentBots, 0);
  const totalCapacity = servers.reduce((sum, s) => sum + s.maxBots, 0);
  const averageUtilization = totalCapacity > 0 ? Math.round((totalBots / totalCapacity) * 100) : 0;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-8 bg-gray-200 rounded w-1/2"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card data-testid="card-total-servers">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Servers</p>
                <p className="text-2xl font-bold" data-testid="text-total-servers">{totalServers}</p>
              </div>
              <Server className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-active-servers">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Servers</p>
                <p className="text-2xl font-bold text-green-600" data-testid="text-active-servers">{activeServers}</p>
              </div>
              <Activity className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-total-bots">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Bots</p>
                <p className="text-2xl font-bold text-blue-600" data-testid="text-total-bots">{totalBots}</p>
              </div>
              <Bot className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-utilization">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Avg. Utilization</p>
                <p className="text-2xl font-bold" data-testid="text-avg-utilization">{averageUtilization}%</p>
              </div>
              <div className="text-right">
                <Progress 
                  value={averageUtilization} 
                  className="w-16 h-2" 
                  data-testid="progress-avg-utilization"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Server Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Server Status Overview
          </CardTitle>
          <CardDescription>
            Real-time status of all registered servers in the multi-tenant system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {servers.map((server) => {
              const utilization = server.maxBots > 0 ? Math.round((server.currentBots / server.maxBots) * 100) : 0;
              
              return (
                <Card key={server.serverName} className="relative overflow-hidden" data-testid={`card-server-${server.serverName}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(server.serverStatus, server.currentBots, server.maxBots)}
                        <h3 className="font-semibold text-sm" data-testid={`text-server-name-${server.serverName}`}>{server.serverName}</h3>
                      </div>
                      <div data-testid={`badge-status-${server.serverName}`}>
                        {getStatusBadge(server.serverStatus, server.currentBots, server.maxBots)}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Bots</span>
                        <span className="font-medium" data-testid={`text-bot-count-${server.serverName}`}>
                          {server.currentBots}/{server.maxBots}
                        </span>
                      </div>
                      
                      <Progress 
                        value={utilization} 
                        className={`h-2 ${getUtilizationColor(utilization)}`}
                        data-testid={`progress-utilization-${server.serverName}`}
                      />
                      
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span data-testid={`text-utilization-${server.serverName}`}>Utilization: {utilization}%</span>
                        <span data-testid={`text-slots-free-${server.serverName}`}>{server.availableSlots} slots free</span>
                      </div>
                      
                      {server.description && (
                        <p className="text-xs text-muted-foreground truncate mt-2" title={server.description} data-testid={`text-description-${server.serverName}`}>
                          {server.description}
                        </p>
                      )}
                    </div>

                    {/* Visual indicator for full servers */}
                    {server.currentBots >= server.maxBots && (
                      <div className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-bl-lg"></div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {servers.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Server className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium mb-2">No Servers Registered</p>
              <p className="text-sm">Register your first server to see it here.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}