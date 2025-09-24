
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Bot, Play, Square, RefreshCw, Settings, Trash2, ExternalLink, AlertTriangle, Shield, CheckCircle } from "lucide-react";
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
  features?: {
    autoLike?: boolean;
    autoReact?: boolean;
    autoView?: boolean;
    chatGPT?: boolean;
  };
}

type Step = 'phone' | 'verification' | 'testing' | 'dashboard';

export default function GuestBotManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [currentStep, setCurrentStep] = useState<Step>('phone');
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [authenticatedBotId, setAuthenticatedBotId] = useState<string | null>(null);

  // Step 1: Check if phone number has a bot (simplified check)
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
          title: "Bot Found",
          description: "Please verify your session ID to continue.",
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

  // Step 2: Verify session ID and phone number match
  const verifySessionMutation = useMutation({
    mutationFn: async ({ phoneNumber, sessionId }: { phoneNumber: string, sessionId: string }) => {
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      
      // First decode and verify phone number matches
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

  const resetFlow = () => {
    setCurrentStep('phone');
    setPhoneNumber("");
    setSessionId("");
    setGuestToken(null);
    setAuthenticatedBotId(null);
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
    <div className="min-h-screen w-full p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Bot Management</h1>
          <p className="text-muted-foreground">
            Manage your WhatsApp bots across servers
          </p>
        </div>

        {/* Step 1: Phone Number Entry */}
        {currentStep === 'phone' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Find Your Bot
              </CardTitle>
              <CardDescription>
                Enter your phone number to check if you have a bot registered
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
                  onKeyDown={(e) => e.key === 'Enter' && handlePhoneSubmit()}
                />
                <Button 
                  onClick={handlePhoneSubmit}
                  disabled={phoneCheckMutation.isPending}
                >
                  {phoneCheckMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Find Bot"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Session ID Verification */}
        {currentStep === 'verification' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Verify Your Session
              </CardTitle>
              <CardDescription>
                Paste your session ID (base64 credentials) to verify bot ownership
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium">Session ID (Base64 Credentials)</label>
                <textarea
                  placeholder="Paste your base64 encoded credentials here..."
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className="w-full h-32 p-3 border rounded-md resize-none font-mono text-sm mt-2"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This verifies that you own the bot registered with {phoneNumber}
                </p>
              </div>
              
              <div className="flex gap-2">
                <Button 
                  onClick={handleSessionVerification}
                  disabled={verifySessionMutation.isPending}
                  className="flex-1"
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
                >
                  Back
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Testing Connection */}
        {currentStep === 'testing' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5 animate-spin" />
                Testing Connection
              </CardTitle>
              <CardDescription>
                Verifying your credentials and testing WhatsApp connection...
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center p-8">
                <RefreshCw className="h-12 w-12 animate-spin mx-auto mb-4 text-blue-500" />
                <h3 className="text-lg font-medium mb-2">Testing Credentials</h3>
                <p className="text-muted-foreground">
                  Please wait while we verify your session and test the connection...
                </p>
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
            <Card className="border-green-200 bg-green-50">
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                  <div>
                    <h3 className="font-medium text-green-800">Authentication Successful!</h3>
                    <p className="text-sm text-green-700">
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
                <TabsTrigger value="active">
                  Active Bots ({activeBots.length})
                </TabsTrigger>
                <TabsTrigger value="pending">
                  Pending ({pendingBots.length})
                </TabsTrigger>
                <TabsTrigger value="inactive">
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
