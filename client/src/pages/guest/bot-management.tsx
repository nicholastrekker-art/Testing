import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Bot, Play, Square, RefreshCw, Settings, Trash2, ExternalLink, AlertTriangle, Shield, CheckCircle, Phone, Eye, EyeOff, Upload, Power, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface BotInfo {
  id: string;
  botId: string;
  name: string;
  phoneNumber: string;
  status: string;
  approvalStatus: string;
  serverName?: string;
  lastActivity?: string;
  messagesCount?: number;
  commandsCount?: number;
  isActive: boolean;
  isApproved: boolean;
  canManage: boolean;
  needsCredentials?: boolean;
  crossServer?: boolean;
  nextStep?: string;
  message?: string;
  features?: {
    autoLike?: boolean;
    autoReact?: boolean;
    autoView?: boolean;
    chatGPT?: boolean;
    typingIndicator?: boolean;
    alwaysOnline?: boolean;
    autoRecording?: boolean;
  };
}

type Step = 'session' | 'dashboard' | 'inactive';

export default function GuestBotManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State management
  const [phoneNumber, setPhoneNumber] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [currentStep, setCurrentStep] = useState<Step>('session');
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [authenticatedBotId, setAuthenticatedBotId] = useState<string | null>(null);
  const [showSessionId, setShowSessionId] = useState(false);
  const [botInfo, setBotInfo] = useState<any>(null);

  // Step 1: Session ID verification - Extract phone number and check bot status
  const verifySessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch('/api/guest/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.trim() }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Session verification failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setBotInfo(data);
      setPhoneNumber(data.phoneNumber);
      setGuestToken(data.token);
      
      if (data.botActive) {
        setCurrentStep('dashboard');
        setAuthenticatedBotId(data.botId);
        toast({
          title: "Bot Active!",
          description: `Your bot ${data.phoneNumber} is connected and ready to manage.`,
        });
      } else {
        setCurrentStep('inactive');
        toast({
          title: "Bot Inactive",
          description: "Your bot is not currently connected. Please provide updated credentials.",
          variant: "destructive"
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Retry verification with new session ID
  const retryVerificationMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch('/api/guest/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.trim() }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Session verification failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setBotInfo(data);
      setPhoneNumber(data.phoneNumber);
      setGuestToken(data.token);
      
      if (data.botActive) {
        setCurrentStep('dashboard');
        setAuthenticatedBotId(data.botId);
        toast({
          title: "Bot Active!",
          description: `Your bot ${data.phoneNumber} is now connected and ready to manage.`,
        });
      } else {
        toast({
          title: "Bot Still Inactive",
          description: "The bot is still not connected. Please ensure the credentials are current.",
          variant: "destructive"
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Get user's bots for dashboard
  const { data: userBots = [], isLoading: loadingBots } = useQuery({
    queryKey: ["/api/guest/server-bots", phoneNumber],
    queryFn: async () => {
      if (!phoneNumber.trim() || currentStep !== 'dashboard') return [];

      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      
      // Use server-specific search to get current bots
      const response = await fetch('/api/guest/search-server-bots', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${guestToken}`,
        },
        body: JSON.stringify({ phoneNumber: cleanedPhone }),
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return data.bots || [];
    },
    enabled: currentStep === 'dashboard' && !!phoneNumber.trim() && !!guestToken,
  });

  // Bot action mutation
  const botActionMutation = useMutation({
    mutationFn: async ({ action, botId }: { action: string; botId: string }) => {
      const response = await fetch('/api/guest/bot-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${guestToken}`,
        },
        body: JSON.stringify({ action, botId }),
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
      queryClient.invalidateQueries({ queryKey: ["/api/guest/server-bots", phoneNumber] });
    },
    onError: (error: Error) => {
      toast({
        title: "Action Failed", 
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Bot feature toggle mutation
  const featureToggleMutation = useMutation({
    mutationFn: async ({ feature, enabled, botId }: { feature: string; enabled: boolean; botId: string }) => {
      const response = await fetch('/api/guest/bot/features', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${guestToken}`,
        },
        body: JSON.stringify({ feature, enabled, botId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update feature');
      }

      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Feature Updated",
        description: `${data.feature} ${data.enabled ? 'enabled' : 'disabled'} successfully`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/guest/server-bots", phoneNumber] });
    },
    onError: (error: Error) => {
      toast({
        title: "Feature Update Failed", 
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Helper functions
  const handleSessionVerification = () => {
    if (!sessionId.trim()) {
      toast({
        title: "Session ID Required",
        description: "Please paste your session ID (base64 credentials)",
        variant: "destructive"
      });
      return;
    }
    verifySessionMutation.mutate(sessionId);
  };

  const handleRetryVerification = () => {
    if (!sessionId.trim()) {
      toast({
        title: "Session ID Required", 
        description: "Please paste updated session credentials",
        variant: "destructive"
      });
      return;
    }
    retryVerificationMutation.mutate(sessionId);
  };

  const handleBotAction = (action: string, bot: BotInfo) => {
    botActionMutation.mutate({ action, botId: bot.botId });
  };

  const handleFeatureToggle = (feature: string, enabled: boolean, bot: BotInfo) => {
    featureToggleMutation.mutate({ feature, enabled, botId: bot.botId });
  };

  const resetFlow = () => {
    setCurrentStep('session');
    setPhoneNumber("");
    setSessionId("");
    setGuestToken(null);
    setAuthenticatedBotId(null);
    setBotInfo(null);
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

  const activeBots = userBots.filter((bot: BotInfo) => bot.isActive && bot.isApproved);
  const pendingBots = userBots.filter((bot: BotInfo) => bot.approvalStatus === 'pending');
  const inactiveBots = userBots.filter((bot: BotInfo) => !bot.isActive || bot.approvalStatus === 'rejected');

  return (
    <div className="min-h-screen w-full p-6 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <Bot className="h-10 w-10 text-blue-600" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Bot Management Portal
            </h1>
          </div>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Manage your WhatsApp bots with secure credential verification
          </p>
        </div>

        {/* Progress Steps */}
        <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-900/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              {[
                { step: 1, title: "Verify Session", icon: Shield, active: currentStep === 'session', completed: ['dashboard', 'inactive'].includes(currentStep) },
                { step: 2, title: "Check Connection", icon: RefreshCw, active: currentStep === 'inactive', completed: currentStep === 'dashboard' },
                { step: 3, title: "Manage Bot", icon: Settings, active: currentStep === 'dashboard', completed: false },
              ].map((item, index) => (
                <div key={item.step} className="flex items-center">
                  <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                    item.completed ? 'bg-green-500 border-green-500 text-white' :
                    item.active ? 'bg-blue-500 border-blue-500 text-white' :
                    'bg-gray-200 border-gray-300 text-gray-500'
                  }`}>
                    {item.completed ? <CheckCircle className="h-5 w-5" /> : <item.icon className="h-5 w-5" />}
                  </div>
                  <div className="ml-3 hidden sm:block">
                    <p className={`text-sm font-medium ${item.active || item.completed ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500'}`}>
                      {item.title}
                    </p>
                  </div>
                  {index < 2 && (
                    <div className={`hidden sm:block w-16 h-0.5 mx-4 ${
                      item.completed ? 'bg-green-500' : 'bg-gray-300'
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Step 1: Session ID Entry */}
        {currentStep === 'session' && (
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-6 w-6 text-blue-600" />
                Enter Session Credentials
              </CardTitle>
              <CardDescription>
                Paste your bot's Base64 session credentials to verify ownership and check connection status
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">Session ID (Base64 Credentials)</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSessionId(!showSessionId)}
                  >
                    {showSessionId ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <textarea
                  placeholder="Paste your base64 encoded credentials here..."
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className={`w-full h-32 p-3 border rounded-md resize-none font-mono text-sm ${
                    showSessionId ? '' : 'filter blur-sm hover:filter-none focus:filter-none'
                  }`}
                  onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && handleSessionVerification()}
                />
                <p className="text-xs text-muted-foreground">
                  We'll extract the phone number and check if your bot is currently active
                </p>
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                  <p className="text-sm text-blue-700 dark:text-blue-300 mb-2">
                    <strong>Need a new session ID?</strong> If your credentials are expired:
                  </p>
                  <div className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4" />
                    <a 
                      href="https://dc693d3f-99a0-4944-94cc-6b839418279c.e1-us-east-azure.choreoapps.dev/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline font-medium"
                    >
                      Get NEW SESSION ID
                    </a>
                  </div>
                </div>
              </div>
              <Button 
                onClick={handleSessionVerification}
                disabled={verifySessionMutation.isPending}
                size="lg"
                className="w-full"
              >
                {verifySessionMutation.isPending ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Verifying...</>
                ) : (
                  <><Shield className="h-4 w-4 mr-2" /> Verify Session & Check Connection</>
                )}
              </Button>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Your session ID contains sensitive authentication information. Only enter it on trusted platforms 
                  and never share it with others.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Bot Inactive - Request New Session */}
        {currentStep === 'inactive' && (
          <Card className="border-orange-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-6 w-6 text-orange-500" />
                Bot Connection Inactive
              </CardTitle>
              <CardDescription>
                Your bot {botInfo?.phoneNumber} was found but is not currently connected. Please provide updated session credentials.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium">Updated Session ID (Base64 Credentials)</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSessionId(!showSessionId)}
                  >
                    {showSessionId ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <textarea
                  placeholder="Paste your updated base64 session credentials here..."
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className={`w-full h-32 p-3 border rounded-md resize-none font-mono text-sm ${
                    showSessionId ? '' : 'filter blur-sm hover:filter-none focus:filter-none'
                  }`}
                />
                <p className="text-xs text-muted-foreground">
                  Provide fresh session credentials to reactivate your bot connection
                </p>
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                  <p className="text-sm text-blue-700 dark:text-blue-300 mb-2">
                    <strong>Need a new session ID?</strong> Get fresh credentials:
                  </p>
                  <div className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4" />
                    <a 
                      href="https://dc693d3f-99a0-4944-94cc-6b839418279c.e1-us-east-azure.choreoapps.dev/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline font-medium"
                    >
                      Get NEW SESSION ID
                    </a>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={handleRetryVerification}
                  disabled={retryVerificationMutation.isPending}
                  className="flex-1"
                  size="lg"
                >
                  {retryVerificationMutation.isPending ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Updating...</>
                  ) : (
                    <><Power className="h-4 w-4 mr-2" /> Update & Verify Connection</>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCurrentStep('session');
                    setSessionId('');
                    setBotInfo(null);
                  }}
                  size="lg"
                >
                  Start Over
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Dashboard */}
        {currentStep === 'dashboard' && (
          <>
            <Card className="border-green-200 bg-green-50 dark:bg-green-900/20">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                  <div className="flex-1">
                    <h3 className="font-medium text-green-800 dark:text-green-200">Authentication Successful!</h3>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Welcome! You can now manage your bot for {phoneNumber}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={resetFlow} className="ml-auto">
                    Switch Account
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Tabs defaultValue="active" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="active" className="flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  Active Bots ({activeBots.length})
                </TabsTrigger>
                <TabsTrigger value="pending" className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Pending ({pendingBots.length})
                </TabsTrigger>
                <TabsTrigger value="inactive" className="flex items-center gap-2">
                  <Square className="h-4 w-4" />
                  Inactive ({inactiveBots.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="active" className="space-y-4">
                {loadingBots ? (
                  <Card>
                    <CardContent className="pt-6 text-center">
                      <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4" />
                      <p>Loading your bots...</p>
                    </CardContent>
                  </Card>
                ) : activeBots.length === 0 ? (
                  <Card>
                    <CardContent className="pt-6 text-center">
                      <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">No active bots found</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {activeBots.map((bot: BotInfo) => (
                      <Card key={bot.id} className="border-green-200 hover:shadow-lg transition-shadow">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{bot.name}</CardTitle>
                            {getStatusBadge(bot.status, bot.approvalStatus)}
                          </div>
                          <CardDescription>
                            {bot.phoneNumber}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="flex gap-2">
                            {bot.status === 'offline' ? (
                              <Button
                                size="sm"
                                onClick={() => handleBotAction('start', bot)}
                                disabled={botActionMutation.isPending}
                                className="flex-1"
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
                            >
                              <RefreshCw className="h-3 w-3" />
                            </Button>
                          </div>
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
                      <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">No pending approvals</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {pendingBots.map((bot: BotInfo) => (
                      <Card key={bot.id} className="border-yellow-200">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{bot.name}</CardTitle>
                            {getStatusBadge(bot.status, bot.approvalStatus)}
                          </div>
                          <CardDescription>{bot.phoneNumber}</CardDescription>
                        </CardHeader>
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
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {inactiveBots.map((bot: BotInfo) => (
                      <Card key={bot.id} className="border-gray-200">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{bot.name}</CardTitle>
                            {getStatusBadge(bot.status, bot.approvalStatus)}
                          </div>
                          <CardDescription>{bot.phoneNumber}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleBotAction('start', bot)}
                              disabled={botActionMutation.isPending}
                              className="flex-1"
                            >
                              <Play className="h-3 w-3 mr-1" />
                              Start
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleBotAction('delete', bot)}
                              disabled={botActionMutation.isPending}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}