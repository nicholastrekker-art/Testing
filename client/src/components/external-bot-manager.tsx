import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  ExternalLink, 
  Settings, 
  Wifi, 
  WifiOff, 
  Heart, 
  MessageSquare, 
  Eye, 
  Zap,
  Clock,
  Server,
  Trash2
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ExternalBotConnection {
  id: string;
  phoneNumber: string;
  originServer: string;
  connected: boolean;
  connectedAt?: string;
  expiresAt?: string;
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
  isExternal: true;
}

interface ConnectExternalBotProps {
  onConnectionEstablished: () => void;
}

function ConnectExternalBot({ onConnectionEstablished }: ConnectExternalBotProps) {
  const { toast } = useToast();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [credentials, setCredentials] = useState("");

  const connectMutation = useMutation({
    mutationFn: async ({ phoneNumber, credentials }: { phoneNumber: string; credentials: string }) => {
      // The endpoint was changed to '/api/guest/external-bot/connect' based on the issue description.
      const response = await fetch('/api/guest/external-bot/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, credentials }),
      });

      if (!response.ok) {
        // Handle potential JSON parsing errors and provide a more informative message.
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          throw new Error(`Connection failed: ${response.statusText}`);
        }
        throw new Error(errorData.message || `Connection failed (Status: ${response.status})`);
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "External Bot Connected",
        description: `Successfully connected to bot ${data.phoneNumber} from ${data.originServer}. WhatsApp notification sent to bot owner.`,
      });
      setPhoneNumber("");
      setCredentials("");
      onConnectionEstablished();
    },
    onError: (error: Error) => {
      toast({
        title: "Connection Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleConnect = () => {
    if (!phoneNumber.trim() || !credentials.trim()) {
      toast({
        title: "Missing Information",
        description: "Please provide both phone number and credentials",
        variant: "destructive",
      });
      return;
    }

    connectMutation.mutate({ phoneNumber: phoneNumber.trim(), credentials: credentials.trim() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ExternalLink className="h-5 w-5" />
          Connect External Bot
        </CardTitle>
        <CardDescription>
          Connect to a bot from a different server for temporary management
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="phoneNumber">Phone Number</Label>
          <Input
            id="phoneNumber"
            data-testid="input-external-phone"
            placeholder="e.g., 254799257758"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="credentials">Bot Credentials (Base64)</Label>
          <Input
            id="credentials"
            data-testid="input-external-credentials"
            placeholder="Paste your bot's base64 credentials here"
            value={credentials}
            onChange={(e) => setCredentials(e.target.value)}
            // Changed type from "password" to "text" for better visibility as per the issue.
            type="text" 
          />
        </div>
        <Button 
          onClick={handleConnect} 
          disabled={connectMutation.isPending}
          className="w-full"
          data-testid="button-connect-external"
        >
          {connectMutation.isPending ? 'Connecting...' : 'Connect External Bot'}
        </Button>

        <Alert>
          <AlertDescription>
            External bot connections are temporary (24 hours) and don't store bot data locally. 
            The bot remains on its origin server while allowing remote feature management.
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

interface ExternalBotCardProps {
  connection: ExternalBotConnection;
  onFeatureToggle: (phoneNumber: string, feature: string, enabled: boolean) => void;
  onDisconnect: (phoneNumber: string) => void;
}

function ExternalBotCard({ connection, onFeatureToggle, onDisconnect }: ExternalBotCardProps) {
  const getTimeRemaining = (expiresAt: string) => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = expires.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return 'Expired';
  };

  return (
    <Card className="border-blue-200 dark:border-blue-800">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <ExternalLink className="h-4 w-4 text-blue-600" />
              Bot {connection.phoneNumber}
            </CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              <Server className="h-3 w-3" />
              Origin: {connection.originServer}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {connection.connected ? (
              <Badge variant="default" className="bg-green-100 text-green-800">
                <Wifi className="h-3 w-3 mr-1" />
                Connected
              </Badge>
            ) : (
              <Badge variant="destructive">
                <WifiOff className="h-3 w-3 mr-1" />
                Disconnected
              </Badge>
            )}
          </div>
        </div>

        {connection.expiresAt && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-3 w-3" />
            Expires in: {getTimeRemaining(connection.expiresAt)}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor={`autoLike-${connection.id}`} className="flex items-center gap-2 text-sm">
                <Heart className="h-3 w-3" />
                Auto Like
              </Label>
              <Switch
                id={`autoLike-${connection.id}`}
                data-testid={`switch-autolike-${connection.phoneNumber}`}
                checked={connection.features.autoLike || false}
                onCheckedChange={(checked) => onFeatureToggle(connection.phoneNumber, 'autoLike', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor={`autoReact-${connection.id}`} className="flex items-center gap-2 text-sm">
                <MessageSquare className="h-3 w-3" />
                Auto React
              </Label>
              <Switch
                id={`autoReact-${connection.id}`}
                data-testid={`switch-autoreact-${connection.phoneNumber}`}
                checked={connection.features.autoReact || false}
                onCheckedChange={(checked) => onFeatureToggle(connection.phoneNumber, 'autoReact', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor={`autoView-${connection.id}`} className="flex items-center gap-2 text-sm">
                <Eye className="h-3 w-3" />
                Auto View Status
              </Label>
              <Switch
                id={`autoView-${connection.id}`}
                data-testid={`switch-autoview-${connection.phoneNumber}`}
                checked={connection.features.autoView || false}
                onCheckedChange={(checked) => onFeatureToggle(connection.phoneNumber, 'autoViewStatus', checked)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor={`chatGPT-${connection.id}`} className="flex items-center gap-2 text-sm">
                <Zap className="h-3 w-3" />
                ChatGPT
              </Label>
              <Switch
                id={`chatGPT-${connection.id}`}
                data-testid={`switch-chatgpt-${connection.phoneNumber}`}
                checked={connection.features.chatGPT || false}
                onCheckedChange={(checked) => onFeatureToggle(connection.phoneNumber, 'chatgptEnabled', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor={`alwaysOnline-${connection.id}`} className="flex items-center gap-2 text-sm">
                <Wifi className="h-3 w-3" />
                Always Online
              </Label>
              <Switch
                id={`alwaysOnline-${connection.id}`}
                data-testid={`switch-alwaysonline-${connection.phoneNumber}`}
                checked={connection.features.alwaysOnline || false}
                onCheckedChange={(checked) => onFeatureToggle(connection.phoneNumber, 'alwaysOnline', checked)}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-4 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDisconnect(connection.phoneNumber)}
            className="flex-1"
            data-testid={`button-disconnect-${connection.phoneNumber}`}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Disconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ExternalBotManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch active external connections
  const { data: connectionsData, isLoading } = useQuery({
    // The query key was updated to reflect the correct API endpoint.
    queryKey: ['/api/guest/external-connections'],
    queryFn: async () => {
      const response = await fetch('/api/guest/external-connections');
      if (!response.ok) {
        throw new Error('Failed to fetch external connections');
      }
      return response.json();
    },
  });

  const connections: ExternalBotConnection[] = connectionsData?.connections || [];

  // Feature toggle mutation
  const featureToggleMutation = useMutation({
    mutationFn: async ({ phoneNumber, feature, enabled }: { phoneNumber: string; feature: string; enabled: boolean }) => {
      const response = await fetch('/api/guest/external-bot/features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, feature, enabled }),
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
        description: `${data.feature} ${data.enabled ? 'enabled' : 'disabled'} successfully on origin server`,
      });
      // The query key was updated to reflect the correct API endpoint.
      queryClient.invalidateQueries({ queryKey: ['/api/guest/external-connections'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Feature Update Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const response = await fetch('/api/guest/external-bot/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Disconnect failed');
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "External Bot Disconnected",
        description: "External bot connection has been removed",
      });
      // The query key was updated to reflect the correct API endpoint.
      queryClient.invalidateQueries({ queryKey: ['/api/guest/external-connections'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Disconnect Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleFeatureToggle = (phoneNumber: string, feature: string, enabled: boolean) => {
    featureToggleMutation.mutate({ phoneNumber, feature, enabled });
  };

  const handleDisconnect = (phoneNumber: string) => {
    disconnectMutation.mutate(phoneNumber);
  };

  const handleConnectionEstablished = () => {
    // The query key was updated to reflect the correct API endpoint.
    queryClient.invalidateQueries({ queryKey: ['/api/guest/external-connections'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ExternalLink className="h-6 w-6 text-blue-600" />
            External Bot Manager
          </h2>
          <p className="text-muted-foreground">
            Connect and manage bots from other servers temporarily
          </p>
        </div>
      </div>

      <Tabs defaultValue="connections" className="w-full">
        <TabsList>
          <TabsTrigger value="connections" data-testid="tab-connections">
            Active Connections ({connections.length})
          </TabsTrigger>
          <TabsTrigger value="connect" data-testid="tab-connect">
            Connect New Bot
          </TabsTrigger>
        </TabsList>

        <TabsContent value="connections" className="space-y-4">
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading external connections...</p>
            </div>
          ) : connections.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center py-8">
                  <ExternalLink className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No External Connections</h3>
                  <p className="text-muted-foreground mb-4">
                    Connect to bots from other servers to manage them remotely
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {connections.map((connection) => (
                <ExternalBotCard
                  key={connection.id}
                  connection={connection}
                  onFeatureToggle={handleFeatureToggle}
                  onDisconnect={handleDisconnect}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="connect" className="space-y-4">
          <ConnectExternalBot onConnectionEstablished={handleConnectionEstablished} />
        </TabsContent>
      </Tabs>
    </div>
  );
}