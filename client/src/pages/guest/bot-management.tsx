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
import ExternalBotManager from "@/components/external-bot-manager";

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
  const [showPhoneEntry, setShowPhoneEntry] = useState(false);

  // Step 1: Session ID verification - Extract phone number and check bot status
  const verifySessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      // Validate base64 format before sending to server
      try {
        const cleanSessionId = sessionId.trim();
        // Test if it's valid base64 by attempting to decode it
        const decoded = atob(cleanSessionId);
        // Test if decoded content is valid JSON
        JSON.parse(decoded);
      } catch (error) {
        throw new Error('Invalid session ID format. Please ensure you\'re providing valid base64-encoded credentials.');
      }

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
      } else if (data.connectionUpdated) {
        // Session ID was automatically tested and bot is being updated
        setCurrentStep('dashboard');
        setAuthenticatedBotId(data.botId);
        toast({
          title: "Session Updated!",
          description: `New session ID tested successfully! Your bot is reconnecting and a success message has been sent to your WhatsApp.`,
        });
        
        // Clear the session input since update was successful
        setSessionId("");
        
        // Refresh the bot data after a short delay
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/guest/server-bots", data.phoneNumber] });
        }, 3000);
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
      let errorMessage = error.message;
      
      // Provide more helpful error messages
      if (errorMessage.includes("Cannot extract phone number")) {
        errorMessage = "❌ Invalid session ID: Cannot extract phone number from the credentials. Please ensure you're using valid WhatsApp session data.";
      } else if (errorMessage.includes("Invalid session ID format")) {
        errorMessage = "❌ Invalid session ID format: Please ensure you're pasting valid base64-encoded WhatsApp session data.";
      }
      
      toast({
        title: "Verification Failed",
        description: errorMessage,
        variant: "destructive"
      });
    }
  });

  // Update session ID mutation with connection testing
  const updateSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch('/api/guest/update-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phoneNumber: phoneNumber,
          newSessionId: sessionId.trim() 
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Session update failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      if (data.success && data.connectionOpen) {
        setCurrentStep('dashboard');
        setAuthenticatedBotId(data.botId || authenticatedBotId);
        
        const successMessage = data.successMessageSent 
          ? "✅ New session ID updated successfully! Connection verified and success message sent to your WhatsApp."
          : "✅ New session ID updated successfully! Connection verified.";
        
        toast({
          title: "Session Updated!",
          description: successMessage,
        });
        
        // Clear the session input since update was successful
        setSessionId("");
        
        // Refresh the bot data
        queryClient.invalidateQueries({ queryKey: ["/api/guest/server-bots", phoneNumber] });
      } else {
        toast({
          title: "Update Failed",
          description: data.message || "New session update failed - connection could not be verified",
          variant: "destructive"
        });
      }
    },
    onError: (error: Error) => {
      let errorMessage = error.message;
      
      // Provide more helpful error messages
      if (errorMessage.includes("Cannot extract phone number")) {
        errorMessage = "❌ Invalid session ID: Cannot extract phone number from the credentials. Please ensure you're using valid WhatsApp session data.";
      } else if (errorMessage.includes("Connection timeout")) {
        errorMessage = "❌ Connection timeout: Your new session ID may be expired or invalid. Please get a fresh session ID.";
      } else if (errorMessage.includes("phone number mismatch")) {
        errorMessage = "❌ Phone number mismatch: The new session ID belongs to a different phone number.";
      } else if (errorMessage.includes("Failed to establish connection")) {
        errorMessage = "❌ Cannot connect with new session ID. Please ensure it's valid and active.";
      } else if (errorMessage.includes("Invalid session ID format")) {
        errorMessage = "❌ Invalid session ID format: Please ensure you're pasting valid base64-encoded WhatsApp session data.";
      }
      
      toast({
        title: "Update Failed",
        description: errorMessage,
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
      console.log('Bot search response:', data);
      
      // Add server info to each bot
      const bots = (data.bots || []).map((bot: any) => ({
        ...bot,
        hostingServer: data.hostingServer || bot.hostingServer || bot.serverName,
        currentServer: data.currentServer,
        crossServer: bot.crossServer || (data.hostingServer !== data.currentServer)
      }));
      
      return bots;
    },
    enabled: currentStep === 'dashboard' && !!phoneNumber.trim() && !!guestToken,
  });

  // Bot action mutation
  const botActionMutation = useMutation({
    mutationFn: async ({ action, botId, phoneNumber }: { action: string; botId: string; phoneNumber: string }) => {
      const response = await fetch('/api/guest/server-bot-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, botId, phoneNumber }),
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
      const response = await fetch('/api/guest/server-bot-features', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ feature, enabled, botId, phoneNumber }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update feature');
      }

      return response.json();
    },
    onSuccess: (data) => {
      const serverInfo = data.crossServer ? ` on ${data.hostingServer}` : '';
      toast({
        title: "Feature Updated",
        description: `${data.feature} ${data.enabled ? 'enabled' : 'disabled'} successfully${serverInfo}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/guest/server-bots", phoneNumber] });
    },
    onError: (error: Error, variables) => {
      let errorMessage = error.message;
      let errorTitle = "Feature Update Failed";
      
      // Handle specific cross-server configuration errors
      if (errorMessage.includes("Cross-server feature management is not available")) {
        errorTitle = "Cross-Server Not Configured";
        errorMessage = "Feature updates for cross-server bots require server configuration. Please contact the administrator or access the hosting server directly.";
      } else if (errorMessage.includes("server not configured")) {
        errorTitle = "Server Configuration Missing";
        errorMessage = "The hosting server is not configured for cross-tenancy operations. Please contact the administrator.";
      } else if (errorMessage.includes("Failed to update feature on")) {
        errorTitle = "Remote Server Error";
        errorMessage = "Unable to communicate with the hosting server. Please try again later or contact support.";
      }
      
      toast({
        title: errorTitle,
        description: errorMessage,
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
        description: "Please paste your NEW session credentials",
        variant: "destructive"
      });
      return;
    }
    
    // Clear any previous session data to ensure we use the new one
    setSessionId(sessionId.trim());
    
    updateSessionMutation.mutate(sessionId.trim());
  };

  const handleBotAction = (action: string, bot: BotInfo) => {
    botActionMutation.mutate({ 
      action, 
      botId: bot.botId, 
      phoneNumber: phoneNumber 
    });
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
    setShowPhoneEntry(false);
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
        {currentStep === 'session' && !showPhoneEntry && (
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
              <div className="flex gap-2">
                <Button 
                  onClick={handleSessionVerification}
                  disabled={verifySessionMutation.isPending}
                  size="lg"
                  className="flex-1"
                >
                  {verifySessionMutation.isPending ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Verifying...</>
                  ) : (
                    <><Shield className="h-4 w-4 mr-2" /> Verify Session & Check Connection</>
                  )}
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setShowPhoneEntry(true)}
                  size="lg"
                  className="flex items-center gap-2"
                >
                  <Phone className="h-4 w-4" />
                  Use Phone Number
                </Button>
              </div>
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

        {/* Phone Number Entry Alternative */}
        {currentStep === 'session' && showPhoneEntry && (
          <Card className="border-green-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-6 w-6 text-green-600" />
                Enter Phone Number
              </CardTitle>
              <CardDescription>
                Enter your phone number to search for your bot
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Phone Number (with country code)</label>
                <Input
                  placeholder="+254700000000"
                  value={phoneNumber}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[\s\-\(\)]/g, '');
                    setPhoneNumber(cleaned);
                  }}
                  className="text-lg"
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Enter your phone number with country code (+ will be removed automatically)
                </p>
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={() => {
                    if (!phoneNumber.trim()) {
                      toast({
                        title: "Phone number required",
                        description: "Please enter your phone number",
                        variant: "destructive"
                      });
                      return;
                    }
                    // Redirect to the search page for phone number based search
                    window.location.href = '/guest/verification';
                  }}
                  size="lg"
                  className="flex-1"
                >
                  <Phone className="h-4 w-4 mr-2" />
                  Search Bot by Phone
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setShowPhoneEntry(false)}
                  size="lg"
                >
                  Back to Session ID
                </Button>
              </div>
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
                Your bot {botInfo?.phoneNumber} was found but is not currently connected. Enter a NEW session ID and we'll automatically test the connection and update your bot.
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
                  placeholder="Paste your NEW base64 session credentials here..."
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className={`w-full h-32 p-3 border rounded-md resize-none font-mono text-sm ${
                    showSessionId ? '' : 'filter blur-sm hover:filter-none focus:filter-none'
                  }`}
                />
                <p className="text-xs text-muted-foreground">
                  We'll test your NEW session ID connection, verify it works, then update your bot credentials
                </p>
                <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200">
                  <p className="text-sm text-green-700 dark:text-green-300 mb-2">
                    <strong>✅ What happens automatically:</strong>
                  </p>
                  <ul className="text-xs text-green-600 dark:text-green-400 space-y-1">
                    <li>• We test your new session ID connection</li>
                    <li>• Bot credentials are safely updated if valid</li>
                    <li>• A success message is sent to your WhatsApp</li>
                    <li>• You're taken to the bot management dashboard</li>
                  </ul>
                </div>
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
                  disabled={updateSessionMutation.isPending}
                  className="flex-1"
                  size="lg"
                >
                  {updateSessionMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Auto-Testing & Updating Session...</>
                  ) : (
                    <><Upload className="h-4 w-4 mr-2" /> Auto-Test & Update Session</>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCurrentStep('session');
                    setSessionId('');
                    setBotInfo(null);
                    setShowPhoneEntry(false);
                  }}
                  size="lg"
                >
                  Back
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
              <TabsList className="grid w-full grid-cols-4">
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
                <TabsTrigger value="external" className="flex items-center gap-2" data-testid="tab-external-bots">
                  <ExternalLink className="h-4 w-4" />
                  External Bots
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
                            <div className="flex items-center gap-2">
                              {bot.crossServer && (
                                <Badge variant="outline" className="bg-blue-50 text-blue-700 text-xs">
                                  📡 {bot.hostingServer}
                                </Badge>
                              )}
                              {getStatusBadge(bot.status, bot.approvalStatus)}
                            </div>
                          </div>
                          <CardDescription>
                            {bot.phoneNumber}
                            {bot.crossServer && (
                              <span className="block text-xs text-blue-600 mt-1">
                                🌍 Cross-server management enabled
                              </span>
                            )}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {/* Feature toggles - with cross-server limitations notice */}
                          {bot.crossServer && (
                            <div className="bg-blue-50 border border-blue-200 rounded-md p-2 mb-3">
                              <p className="text-xs text-blue-700 font-medium">🌐 Cross-Server Bot</p>
                              <p className="text-xs text-blue-600">
                                Feature toggles require server connectivity
                              </p>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Auto Like</span>
                              <button
                                onClick={() => handleFeatureToggle('autoLike', !bot.features?.autoLike, bot)}
                                disabled={featureToggleMutation.isPending}
                                className={`w-8 h-4 rounded-full flex items-center px-1 transition-colors ${
                                  bot.features?.autoLike ? 'bg-primary justify-end' : 'bg-muted justify-start'
                                } cursor-pointer hover:opacity-80`}
                              >
                                <div className={`w-2 h-2 rounded-full ${bot.features?.autoLike ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                              </button>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Auto View</span>
                              <button
                                onClick={() => handleFeatureToggle('autoView', !bot.features?.autoView, bot)}
                                disabled={featureToggleMutation.isPending}
                                className={`w-8 h-4 rounded-full flex items-center px-1 transition-colors ${
                                  bot.features?.autoView ? 'bg-primary justify-end' : 'bg-muted justify-start'
                                } cursor-pointer hover:opacity-80`}
                              >
                                <div className={`w-2 h-2 rounded-full ${bot.features?.autoView ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                              </button>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Auto React</span>
                              <button
                                onClick={() => handleFeatureToggle('autoReact', !bot.features?.autoReact, bot)}
                                disabled={featureToggleMutation.isPending}
                                className={`w-8 h-4 rounded-full flex items-center px-1 transition-colors ${
                                  bot.features?.autoReact ? 'bg-primary justify-end' : 'bg-muted justify-start'
                                } cursor-pointer hover:opacity-80`}
                              >
                                <div className={`w-2 h-2 rounded-full ${bot.features?.autoReact ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                              </button>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">ChatGPT</span>
                              <button
                                onClick={() => handleFeatureToggle('chatGPT', !bot.features?.chatGPT, bot)}
                                disabled={featureToggleMutation.isPending}
                                className={`w-8 h-4 rounded-full flex items-center px-1 transition-colors ${
                                  bot.features?.chatGPT ? 'bg-primary justify-end' : 'bg-muted justify-start'
                                } cursor-pointer hover:opacity-80`}
                              >
                                <div className={`w-2 h-2 rounded-full ${bot.features?.chatGPT ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                              </button>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Always Online</span>
                              <button
                                onClick={() => handleFeatureToggle('alwaysOnline', !bot.features?.alwaysOnline, bot)}
                                disabled={featureToggleMutation.isPending}
                                className={`w-8 h-4 rounded-full flex items-center px-1 transition-colors ${
                                  bot.features?.alwaysOnline ? 'bg-primary justify-end' : 'bg-muted justify-start'
                                } cursor-pointer hover:opacity-80`}
                              >
                                <div className={`w-2 h-2 rounded-full ${bot.features?.alwaysOnline ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                              </button>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Typing Indicator</span>
                              <button
                                onClick={() => handleFeatureToggle('typingIndicator', !bot.features?.typingIndicator, bot)}
                                disabled={featureToggleMutation.isPending}
                                className={`w-8 h-4 rounded-full flex items-center px-1 transition-colors ${
                                  bot.features?.typingIndicator ? 'bg-primary justify-end' : 'bg-muted justify-start'
                                } cursor-pointer hover:opacity-80`}
                              >
                                <div className={`w-2 h-2 rounded-full ${bot.features?.typingIndicator ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                              </button>
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex gap-2">
                            {bot.crossServer ? (
                              <div className="flex-1 bg-blue-50 border border-blue-200 rounded-md p-2 text-center">
                                <p className="text-xs text-blue-700">
                                  🌐 Bot hosted on {bot.hostingServer}
                                </p>
                                <p className="text-xs text-blue-600 mt-1">
                                  Features can be toggled above
                                </p>
                              </div>
                            ) : (
                              <>
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
                                  title="Restart bot"
                                >
                                  <RefreshCw className="h-3 w-3" />
                                </Button>
                              </>
                            )}
                          </div>

                          {/* Bot statistics */}
                          <div className="flex justify-between text-xs text-muted-foreground pt-2 border-t">
                            <span>Messages: {bot.messagesCount || 0}</span>
                            <span>Commands: {bot.commandsCount || 0}</span>
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
                      <Card key={bot.id} className="border-gray-200 hover:shadow-lg transition-shadow">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">{bot.name}</CardTitle>
                            {getStatusBadge(bot.status, bot.approvalStatus)}
                          </div>
                          <CardDescription>{bot.phoneNumber}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {/* Feature toggles for inactive bots */}
                          <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Auto Like</span>
                              <button
                                onClick={() => handleFeatureToggle('autoLike', !bot.features?.autoLike, bot)}
                                disabled={featureToggleMutation.isPending || bot.approvalStatus !== 'approved'}
                                className={`w-8 h-4 rounded-full flex items-center px-1 transition-colors ${
                                  bot.features?.autoLike ? 'bg-primary justify-end' : 'bg-muted justify-start'
                                } ${bot.approvalStatus !== 'approved' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                              >
                                <div className={`w-2 h-2 rounded-full ${bot.features?.autoLike ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                              </button>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Auto View</span>
                              <button
                                onClick={() => handleFeatureToggle('autoViewStatus', !bot.features?.autoView, bot)}
                                disabled={featureToggleMutation.isPending || bot.approvalStatus !== 'approved'}
                                className={`w-8 h-4 rounded-full flex items-center px-1 transition-colors ${
                                  bot.features?.autoView ? 'bg-primary justify-end' : 'bg-muted justify-start'
                                } ${bot.approvalStatus !== 'approved' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                              >
                                <div className={`w-2 h-2 rounded-full ${bot.features?.autoView ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                              </button>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Auto React</span>
                              <button
                                onClick={() => handleFeatureToggle('autoReact', !bot.features?.autoReact, bot)}
                                disabled={featureToggleMutation.isPending || bot.approvalStatus !== 'approved'}
                                className={`w-8 h-4 rounded-full flex items-center px-1 transition-colors ${
                                  bot.features?.autoReact ? 'bg-primary justify-end' : 'bg-muted justify-start'
                                } ${bot.approvalStatus !== 'approved' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                              >
                                <div className={`w-2 h-2 rounded-full ${bot.features?.autoReact ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                              </button>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">ChatGPT</span>
                              <button
                                onClick={() => handleFeatureToggle('chatgptEnabled', !bot.features?.chatGPT, bot)}
                                disabled={featureToggleMutation.isPending || bot.approvalStatus !== 'approved'}
                                className={`w-8 h-4 rounded-full flex items-center px-1 transition-colors ${
                                  bot.features?.chatGPT ? 'bg-primary justify-end' : 'bg-muted justify-start'
                                } ${bot.approvalStatus !== 'approved' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                              >
                                <div className={`w-2 h-2 rounded-full ${bot.features?.chatGPT ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                              </button>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Always Online</span>
                              <button
                                onClick={() => handleFeatureToggle('alwaysOnline', !bot.features?.alwaysOnline, bot)}
                                disabled={featureToggleMutation.isPending || bot.approvalStatus !== 'approved'}
                                className={`w-8 h-4 rounded-full flex items-center px-1 transition-colors ${
                                  bot.features?.alwaysOnline ? 'bg-primary justify-end' : 'bg-muted justify-start'
                                } ${bot.approvalStatus !== 'approved' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                              >
                                <div className={`w-2 h-2 rounded-full ${bot.features?.alwaysOnline ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                              </button>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-muted-foreground">Typing Indicator</span>
                              <button
                                onClick={() => handleFeatureToggle('typingIndicator', !bot.features?.typingIndicator, bot)}
                                disabled={featureToggleMutation.isPending || bot.approvalStatus !== 'approved'}
                                className={`w-8 h-4 rounded-full flex items-center px-1 transition-colors ${
                                  bot.features?.typingIndicator ? 'bg-primary justify-end' : 'bg-muted justify-start'
                                } ${bot.approvalStatus !== 'approved' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                              >
                                <div className={`w-2 h-2 rounded-full ${bot.features?.typingIndicator ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                              </button>
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex gap-2">
                            {bot.approvalStatus === 'approved' ? (
                              <>
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
                                  onClick={() => handleBotAction('restart', bot)}
                                  disabled={botActionMutation.isPending}
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
                                title="Bot must be approved to start"
                              >
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                Pending Approval
                              </Button>
                            )}
                          </div>

                          {/* Status info */}
                          {bot.approvalStatus !== 'approved' && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-2 text-xs">
                              <p className="text-yellow-800 font-medium">⏳ Awaiting Admin Approval</p>
                              <p className="text-yellow-600">Contact admin to activate this bot</p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="external" className="space-y-4">
                <ExternalBotManager />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}