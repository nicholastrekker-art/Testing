
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Bot, Play, Square, RefreshCw, Settings, Trash2, ExternalLink, AlertTriangle, Shield, CheckCircle, Phone, Eye, EyeOff } from "lucide-react";
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

type Step = 'phone' | 'verification' | 'testing' | 'dashboard';

export default function GuestBotManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // State management
  const [phoneNumber, setPhoneNumber] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [currentStep, setCurrentStep] = useState<Step>('phone');
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [authenticatedBotId, setAuthenticatedBotId] = useState<string | null>(null);
  const [showSessionId, setShowSessionId] = useState(false);
  const [foundBots, setFoundBots] = useState<BotInfo[]>([]);

  // Step 1: Phone number verification
  const phoneCheckMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const response = await fetch('/api/guest/verify-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanedPhone }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Phone number verification failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      if (data.verified) {
        setCurrentStep('verification');
        toast({
          title: "Phone Number Verified",
          description: "Please provide your session ID to continue.",
        });
      } else {
        toast({
          title: "No Bot Found",
          description: "No bot registered with this phone number.",
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

  // Step 2: Session ID verification and phone number match
  const verifySessionMutation = useMutation({
    mutationFn: async ({ phoneNumber, sessionId }: { phoneNumber: string, sessionId: string }) => {
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      
      try {
        const decoded = Buffer.from(sessionId.trim(), 'base64').toString('utf-8');
        const credentials = JSON.parse(decoded);
        
        // Extract phone number from credentials
        const credentialsPhone = credentials.creds?.me?.id?.match(/^(\d+):/)?.[1];
        
        if (!credentialsPhone) {
          throw new Error('Invalid session ID format - no phone number found');
        }
        
        if (credentialsPhone !== cleanedPhone) {
          throw new Error('Phone number in session ID does not match the provided phone number');
        }
        
        return { success: true, phoneVerified: true };
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
        throw new Error('Invalid session ID format');
      }
    },
    onSuccess: () => {
      setCurrentStep('testing');
      toast({
        title: "Authentication Complete",
        description: "Session ID verified. Testing connection...",
      });
      
      // Automatically start testing credentials
      setTimeout(() => {
        testCredentialsMutation.mutate({ sessionId });
      }, 1000);
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed", 
        description: error.message,
        variant: "destructive"
      });
    },
  });

  // Step 3: Test if credentials are valid (connection test)
  const testCredentialsMutation = useMutation({
    mutationFn: async ({ sessionId }: { sessionId: string }) => {
      const response = await fetch('/api/guest/test-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Credential test failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      if (data.connectionOpen) {
        // Now validate with backend to get proper token
        validateBotMutation.mutate({ phoneNumber, sessionId });
      } else {
        toast({
          title: "Credentials Expired",
          description: "Your session has expired. Please get a new session ID.",
          variant: "destructive"
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Connection Failed",
        description: "Credentials are expired or invalid. Please get a new session ID.",
        variant: "destructive"
      });
    },
  });

  // Final step: Get authentication token and bot info
  const validateBotMutation = useMutation({
    mutationFn: async ({ phoneNumber, sessionId }: { phoneNumber: string, sessionId: string }) => {
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const response = await fetch('/api/guest/validate-existing-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phoneNumber: cleanedPhone, 
          sessionId: sessionId.trim()
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Bot validation failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setGuestToken(data.guestToken);
      setAuthenticatedBotId(data.bot?.botId);
      setCurrentStep('dashboard');
      toast({
        title: "Welcome!",
        description: "You can now manage your bot.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Validation Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Get user's bots for dashboard
  const { data: userBots = [], isLoading: loadingBots } = useQuery({
    queryKey: ["/api/guest/my-bots", phoneNumber],
    queryFn: async () => {
      if (!phoneNumber.trim() || currentStep !== 'dashboard' || !guestToken) return [];
      
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const response = await fetch('/api/guest/my-bots', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`
        },
        body: JSON.stringify({ phoneNumber: cleanedPhone }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch your bots');
      }
      
      return response.json();
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

  // Bot feature toggle mutation
  const featureToggleMutation = useMutation({
    mutationFn: async ({ feature, enabled, botId }: { feature: string; enabled: boolean; botId: string }) => {
      const response = await fetch('/api/guest/bot/features', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${guestToken}`,
        },
        body: JSON.stringify({ feature, enabled }),
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
      queryClient.invalidateQueries({ queryKey: ["/api/guest/my-bots"] });
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
  const handlePhoneSubmit = () => {
    if (!phoneNumber.trim()) {
      toast({
        title: "Phone Required",
        description: "Please enter your phone number",
        variant: "destructive"
      });
      return;
    }
    phoneCheckMutation.mutate(phoneNumber);
  };

  const handleSessionVerification = () => {
    if (!sessionId.trim()) {
      toast({
        title: "Session ID Required",
        description: "Please paste your session ID (base64 credentials)",
        variant: "destructive"
      });
      return;
    }
    verifySessionMutation.mutate({ phoneNumber, sessionId });
  };

  const handleBotAction = (action: string, bot: BotInfo) => {
    botActionMutation.mutate({ action, botId: bot.botId });
  };

  const handleFeatureToggle = (feature: string, enabled: boolean, bot: BotInfo) => {
    featureToggleMutation.mutate({ feature, enabled, botId: bot.botId });
  };

  const resetFlow = () => {
    setCurrentStep('phone');
    setPhoneNumber("");
    setSessionId("");
    setGuestToken(null);
    setAuthenticatedBotId(null);
    setFoundBots([]);
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
            Manage your WhatsApp bots across all servers with secure authentication and real-time monitoring
          </p>
        </div>

        {/* Progress Steps */}
        <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-900/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              {[
                { step: 1, title: "Phone Verification", icon: Phone, active: currentStep === 'phone', completed: currentStep !== 'phone' },
                { step: 2, title: "Session Verification", icon: Shield, active: currentStep === 'verification', completed: ['testing', 'dashboard'].includes(currentStep) },
                { step: 3, title: "Connection Test", icon: RefreshCw, active: currentStep === 'testing', completed: currentStep === 'dashboard' },
                { step: 4, title: "Bot Management", icon: Settings, active: currentStep === 'dashboard', completed: false },
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
                  {index < 3 && (
                    <div className={`hidden sm:block w-16 h-0.5 mx-4 ${
                      item.completed ? 'bg-green-500' : 'bg-gray-300'
                    }`} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Step 1: Phone Number Entry */}
        {currentStep === 'phone' && (
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-6 w-6 text-blue-600" />
                Enter Your Phone Number
              </CardTitle>
              <CardDescription>
                Enter the phone number associated with your WhatsApp bot registration
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  type="tel"
                  placeholder="+1234567890"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="flex-1 text-lg py-3"
                  onKeyDown={(e) => e.key === 'Enter' && handlePhoneSubmit()}
                />
                <Button 
                  onClick={handlePhoneSubmit}
                  disabled={phoneCheckMutation.isPending}
                  size="lg"
                  className="px-8"
                >
                  {phoneCheckMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Verify"}
                </Button>
              </div>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Enter the phone number exactly as it was registered with your bot (including country code if used).
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Session ID Verification */}
        {currentStep === 'verification' && (
          <Card className="border-amber-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-6 w-6 text-amber-600" />
                Verify Your Session
              </CardTitle>
              <CardDescription>
                Paste your session ID (base64 credentials) to verify bot ownership for {phoneNumber}
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
                />
                <p className="text-xs text-muted-foreground">
                  This verifies that you own the bot registered with {phoneNumber}. Get your session ID from{" "}
                  <a 
                    href="https://dc693d3f-99a0-4944-94cc-6b839418279c.e1-us-east-azure.choreoapps.dev/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline font-medium"
                  >
                    NEW SESSION ID
                  </a>
                </p>
              </div>
              
              <div className="flex gap-2">
                <Button 
                  onClick={handleSessionVerification}
                  disabled={verifySessionMutation.isPending}
                  className="flex-1"
                  size="lg"
                >
                  {verifySessionMutation.isPending ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Verifying...</>
                  ) : (
                    <><Shield className="h-4 w-4 mr-2" /> Verify Session</>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep('phone')}
                  size="lg"
                >
                  Back
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Testing Connection */}
        {currentStep === 'testing' && (
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
                Testing Connection
              </CardTitle>
              <CardDescription>
                Verifying your credentials and testing WhatsApp connection...
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center p-8">
                <RefreshCw className="h-16 w-16 animate-spin mx-auto mb-4 text-blue-500" />
                <h3 className="text-xl font-medium mb-2">Testing Credentials</h3>
                <p className="text-muted-foreground">
                  Please wait while we verify your session and test the WhatsApp connection...
                </p>
                <div className="mt-4 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    This may take up to 30 seconds. We're ensuring your bot credentials are valid and can connect to WhatsApp.
                  </p>
                </div>
              </div>
              
              {(testCredentialsMutation.isError || validateBotMutation.isError) && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Credentials are expired or invalid. Please get a new session ID from:{" "}
                    <a 
                      href="https://dc693d3f-99a0-4944-94cc-6b839418279c.e1-us-east-azure.choreoapps.dev/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline font-medium"
                    >
                      NEW SESSION ID
                    </a>
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 4: Bot Management Dashboard */}
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
                            {bot.serverName && (
                              <Badge variant="outline" className="ml-2">
                                {bot.serverName}
                              </Badge>
                            )}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
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

                          {/* Bot Control Actions */}
                          <div className="flex gap-2">
                            {bot.status === 'offline' ? (
                              <Button
                                size="sm"
                                onClick={() => handleBotAction('start', bot)}
                                disabled={botActionMutation.isPending || !bot.canManage}
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
                                disabled={botActionMutation.isPending || !bot.canManage}
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
                              disabled={botActionMutation.isPending || !bot.canManage}
                            >
                              <RefreshCw className="h-3 w-3" />
                            </Button>
                          </div>

                          {/* Feature Management */}
                          {bot.features && (
                            <div className="space-y-2">
                              <p className="text-sm font-medium">Features</p>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                {Object.entries(bot.features).map(([feature, enabled]) => (
                                  <div key={feature} className="flex items-center justify-between">
                                    <span className="capitalize">{feature.replace(/([A-Z])/g, ' $1').trim()}</span>
                                    <Button
                                      size="sm"
                                      variant={enabled ? "default" : "outline"}
                                      onClick={() => handleFeatureToggle(feature, !enabled, bot)}
                                      disabled={featureToggleMutation.isPending || !bot.canManage}
                                      className="h-6 px-2 text-xs"
                                    >
                                      {enabled ? "On" : "Off"}
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
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
                            </div>
                            {getStatusBadge(bot.status, bot.approvalStatus)}
                          </div>
                          <Alert className="mt-4">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>
                              Your bot is waiting for admin approval. You'll be notified once it's approved.
                              Contact +254704897825 for faster approval.
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
                            </div>
                            {getStatusBadge(bot.status, bot.approvalStatus)}
                          </div>
                          <div className="flex gap-2 mt-4">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleBotAction('reactivate', bot)}
                              disabled={botActionMutation.isPending}
                            >
                              Reactivate
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleBotAction('delete', bot)}
                              disabled={botActionMutation.isPending}
                              className="text-red-600 hover:bg-red-50"
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
          </>
        )}
      </div>
    </div>
  );
}
