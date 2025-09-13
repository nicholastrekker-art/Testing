import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Search, Phone, Bot, Play, Square, RefreshCw, Settings, Trash2, Shield, AlertTriangle, ExternalLink } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface GuestBot {
  id: string;
  name: string;
  phoneNumber: string;
  status: string;
  approvalStatus: string;
  isActive: boolean;
  isApproved: boolean;
  serverName?: string;
  messagesCount?: number;
  commandsCount?: number;
  lastActivity?: string;
  expirationMonths?: number;
  crossServer?: boolean;
  message?: string;
  // Enhanced credential management fields
  nextStep?: string;
  credentialVerified?: boolean;
  invalidReason?: string;
  autoStart?: boolean;
  needsCredentials?: boolean;
  canManage?: boolean;
  credentialUploadEndpoint?: string;
}

// Helper functions for nextStep UI
function getNextStepStyling(nextStep: string): string {
  switch (nextStep) {
    case 'wait_approval': return 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800';
    case 'update_credentials': return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
    case 'authenticate': return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
    case 'authenticated': return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
    default: return 'bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800';
  }
}

function getNextStepIcon(nextStep: string) {
  switch (nextStep) {
    case 'wait_approval': return <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />;
    case 'update_credentials': return <Shield className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />;
    case 'authenticate': return <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />;
    case 'authenticated': return <Play className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />;
    default: return <Bot className="h-4 w-4 text-gray-600 dark:text-gray-400 mt-0.5 flex-shrink-0" />;
  }
}

function getNextStepTitle(nextStep: string): string {
  switch (nextStep) {
    case 'wait_approval': return 'Pending Approval';
    case 'update_credentials': return 'Credentials Required';
    case 'authenticate': return 'Ready to Authenticate';
    case 'authenticated': return 'Bot Ready';
    default: return 'Status Unknown';
  }
}

export default function GuestBotSearch() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [searchTriggered, setSearchTriggered] = useState(false);
  
  // Guest authentication state
  const [guestToken, setGuestToken] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [showOTPInput, setShowOTPInput] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpMethod, setOtpMethod] = useState<string>('');

  // Search for guest bot by phone number
  const { data: botData, isLoading, error } = useQuery({
    queryKey: ["/api/guest/search-bot", phoneNumber],
    queryFn: async () => {
      if (!phoneNumber.trim()) return null;
      
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const response = await fetch(`/api/guest/search-bot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phoneNumber: cleanedPhone }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Bot not found");
      }
      
      return await response.json() as GuestBot;
    },
    enabled: searchTriggered && !!phoneNumber.trim(),
  });

  // Guest authentication mutations
  const sendOTPMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const response = await fetch('/api/guest/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanedPhone }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to send OTP');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setOtpSent(true);
      setOtpMethod(data.method);
      setShowOTPInput(true);
      toast({ 
        title: "Verification code sent", 
        description: data.message 
      });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to send verification code", 
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const verifyOTPMutation = useMutation({
    mutationFn: async ({ phoneNumber, otp }: { phoneNumber: string, otp: string }) => {
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const response = await fetch('/api/guest/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanedPhone, otp }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Invalid verification code');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setGuestToken(data.token);
      setIsAuthenticated(true);
      setShowOTPInput(false);
      setOtp("");
      toast({ 
        title: "Authentication successful", 
        description: "You can now manage your bot" 
      });
      
      // Trigger bot search after authentication
      if (botData) {
        queryClient.invalidateQueries({ queryKey: ["/api/guest/search-bot", phoneNumber] });
      }
    },
    onError: (error: any) => {
      toast({ 
        title: "Verification failed", 
        description: error.message,
        variant: "destructive"
      });
    },
  });

  // Updated bot actions mutations to use guest endpoints
  const startBotMutation = useMutation({
    mutationFn: async (botId: string) => {
      if (!guestToken) {
        throw new Error('Authentication required');
      }
      
      const response = await fetch('/api/guest/bot/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`
        },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to start bot');
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Bot started successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/guest/search-bot", phoneNumber] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to start bot", 
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const stopBotMutation = useMutation({
    mutationFn: async (botId: string) => {
      if (!guestToken) {
        throw new Error('Authentication required');
      }
      
      const response = await fetch('/api/guest/bot/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`
        },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to stop bot');
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Bot stopped successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/guest/search-bot", phoneNumber] });
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to stop bot", 
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const deleteBotMutation = useMutation({
    mutationFn: async (botId: string) => {
      if (!guestToken) {
        throw new Error('Authentication required');
      }
      
      const response = await fetch('/api/guest/bot/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${guestToken}`
        },
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete bot');
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Bot deleted successfully" });
      // Reset all state after successful deletion
      setSearchTriggered(false);
      setPhoneNumber("");
      setGuestToken(null);
      setIsAuthenticated(false);
      setShowOTPInput(false);
      setOtp("");
      setOtpSent(false);
    },
    onError: (error: any) => {
      toast({ 
        title: "Failed to delete bot", 
        description: error.message,
        variant: "destructive"
      });
    },
  });

  const handleSearch = useCallback(() => {
    if (!phoneNumber.trim()) {
      toast({
        title: "Phone number required",
        description: "Please enter your phone number to search for your bot",
        variant: "destructive"
      });
      return;
    }
    setSearchTriggered(true);
  }, [phoneNumber, toast]);

  const handleSendOTP = useCallback(() => {
    if (!phoneNumber.trim()) {
      toast({
        title: "Phone number required",
        description: "Please enter your phone number first",
        variant: "destructive"
      });
      return;
    }
    sendOTPMutation.mutate(phoneNumber);
  }, [phoneNumber, sendOTPMutation, toast]);

  const handleVerifyOTP = useCallback(() => {
    if (!otp.trim()) {
      toast({
        title: "Verification code required",
        description: "Please enter the verification code",
        variant: "destructive"
      });
      return;
    }
    verifyOTPMutation.mutate({ phoneNumber, otp });
  }, [phoneNumber, otp, verifyOTPMutation, toast]);

  const resetAuthentication = useCallback(() => {
    setGuestToken(null);
    setIsAuthenticated(false);
    setShowOTPInput(false);
    setOtp("");
    setOtpSent(false);
    setOtpMethod('');
  }, []);

  const canPerformActions = (bot: GuestBot) => {
    return isAuthenticated && !bot.crossServer && bot.isApproved;
  };

  const getStatusBadge = (status: string, approvalStatus: string) => {
    if (approvalStatus === "approved") {
      return status === "online" ? 
        <Badge variant="default" className="bg-green-600">Online</Badge> : 
        <Badge variant="secondary">Offline</Badge>;
    }
    return <Badge variant="outline">Pending Approval</Badge>;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "Never";
    return new Date(dateString).toLocaleString();
  };

  return (
    <div className="space-y-4">
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Search className="h-4 w-4" />
            Find My Bot
          </CardTitle>
          <CardDescription className="text-xs">
            Enter your phone number to manage your bot
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Enter phone number"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="pl-9 text-sm"
                data-testid="input-phone-search"
                disabled={isAuthenticated}
              />
            </div>
            <Button 
              size="sm" 
              onClick={handleSearch}
              disabled={isLoading || !phoneNumber.trim() || isAuthenticated}
              data-testid="button-search-bot"
            >
              {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          {/* Authentication Flow */}
          {botData && !isAuthenticated && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded border border-blue-200 dark:border-blue-800 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300">
                <Shield className="h-4 w-4" />
                Secure Authentication Required
              </div>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                To manage your bot securely, please verify your phone number ownership.
              </p>
              
              {!showOTPInput ? (
                <Button 
                  size="sm" 
                  onClick={handleSendOTP}
                  disabled={sendOTPMutation.isPending}
                  className="w-full"
                  data-testid="button-send-otp"
                >
                  {sendOTPMutation.isPending ? (
                    <><RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Sending...</>
                  ) : (
                    <><Shield className="h-3 w-3 mr-1" /> Send Verification Code</>
                  )}
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs text-green-600 dark:text-green-400">
                    ✓ Verification code sent {otpMethod === 'whatsapp' ? 'to your WhatsApp' : '(check server logs)'}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter 6-digit code"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      onKeyDown={(e) => e.key === 'Enter' && handleVerifyOTP()}
                      className="text-sm text-center font-mono"
                      data-testid="input-otp"
                      maxLength={6}
                    />
                    <Button 
                      size="sm" 
                      onClick={handleVerifyOTP}
                      disabled={verifyOTPMutation.isPending || otp.length !== 6}
                      data-testid="button-verify-otp"
                    >
                      {verifyOTPMutation.isPending ? (
                        <RefreshCw className="h-3 w-3 animate-spin" />
                      ) : (
                        'Verify'
                      )}
                    </Button>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleSendOTP}
                    disabled={sendOTPMutation.isPending}
                    className="w-full text-xs"
                    data-testid="button-resend-otp"
                  >
                    Resend Code
                  </Button>
                </div>
              )}
            </div>
          )}

          {isAuthenticated && (
            <div className="bg-green-50 dark:bg-green-900/20 p-2 rounded border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-300">
                <Shield className="h-3 w-3" />
                Authenticated successfully - You can now manage your bot
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={resetAuthentication}
                  className="ml-auto text-xs h-6 px-2"
                >
                  Logout
                </Button>
              </div>
            </div>
          )}
          
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 p-2 rounded border" data-testid="error-search">
              {error.message}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bot Results */}
      {botData && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Bot className="h-4 w-4" />
                {botData.name}
              </CardTitle>
              {getStatusBadge(botData.status, botData.approvalStatus)}
            </div>
            <CardDescription className="text-xs">
              {botData.phoneNumber} • {botData.serverName ? `Server: ${botData.serverName}` : 'No server assigned'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3" data-testid={`bot-card-${botData.phoneNumber}`}>
            {/* Bot Statistics */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-muted/50 p-2 rounded">
                <div className="font-medium">Messages</div>
                <div className="text-muted-foreground" data-testid={`bot-messages-${botData.phoneNumber}`}>
                  {botData.messagesCount || 0}
                </div>
              </div>
              <div className="bg-muted/50 p-2 rounded">
                <div className="font-medium">Commands</div>
                <div className="text-muted-foreground" data-testid={`bot-commands-${botData.phoneNumber}`}>
                  {botData.commandsCount || 0}
                </div>
              </div>
            </div>

            {botData.lastActivity && (
              <div className="text-xs text-muted-foreground">
                Last activity: {formatDate(botData.lastActivity)}
              </div>
            )}

            <Separator />

            {/* Cross-server guidance */}
            {botData.crossServer && (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded border border-yellow-200 dark:border-yellow-800">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                      Cross-Server Bot Detected
                    </div>
                    <p className="text-xs text-yellow-600 dark:text-yellow-400">
                      {botData.message || `Your bot is registered on ${botData.serverName}. To manage it, please visit that server.`}
                    </p>
                    <Button 
                      size="sm" 
                      variant="outline"
                      className="text-xs h-7"
                      data-testid={`button-switch-server-${botData.phoneNumber}`}
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Switch to {botData.serverName}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Enhanced Bot Status and Actions */}
            {!botData.crossServer && (
              <div className="space-y-3">
                {/* Status Message based on nextStep */}
                {botData.nextStep && (
                  <div className={`p-3 rounded border ${getNextStepStyling(botData.nextStep)}`}>
                    <div className="flex items-start gap-2">
                      {getNextStepIcon(botData.nextStep)}
                      <div className="space-y-1 flex-1">
                        <div className="text-sm font-medium">{getNextStepTitle(botData.nextStep)}</div>
                        <p className="text-xs">{botData.message}</p>
                        {botData.invalidReason && (
                          <p className="text-xs opacity-75">Reason: {botData.invalidReason}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Conditional Actions based on nextStep */}
                <div className="flex gap-2">
                  {!isAuthenticated && botData.nextStep !== 'wait_approval' ? (
                    <div className="w-full bg-gray-50 dark:bg-gray-900/50 p-3 rounded border border-gray-200 dark:border-gray-700 text-center">
                      <div className="text-xs text-gray-600 dark:text-gray-400">
                        Authentication required to manage bot actions
                      </div>
                    </div>
                  ) : botData.nextStep === 'wait_approval' ? (
                    <div className="w-full bg-amber-50 dark:bg-amber-900/20 p-3 rounded border border-amber-200 dark:border-amber-800 text-center">
                      <div className="text-xs text-amber-700 dark:text-amber-300">
                        Waiting for admin approval - check back later
                      </div>
                    </div>
                  ) : botData.nextStep === 'update_credentials' ? (
                    <div className="w-full space-y-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs"
                        onClick={() => {/* TODO: Add credential upload modal */}}
                        data-testid={`button-upload-credentials-${botData.phoneNumber}`}
                      >
                        <Shield className="h-3 w-3 mr-1" />
                        Upload New Credentials
                      </Button>
                      <div className="text-xs text-center text-muted-foreground">
                        Upload your creds.json file to reactivate your bot
                      </div>
                    </div>
                  ) : botData.nextStep === 'authenticated' && isAuthenticated ? (
                    <>
                      {botData.status === "online" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => stopBotMutation.mutate(botData.id)}
                          disabled={stopBotMutation.isPending || !canPerformActions(botData)}
                          className="flex-1 text-xs"
                          data-testid={`button-stop-${botData.phoneNumber}`}
                        >
                          {stopBotMutation.isPending ? (
                            <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Square className="h-3 w-3 mr-1" />
                          )}
                          Stop
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => startBotMutation.mutate(botData.id)}
                          disabled={startBotMutation.isPending || !canPerformActions(botData)}
                          className="flex-1 text-xs"
                          data-testid={`button-start-${botData.phoneNumber}`}
                        >
                          {startBotMutation.isPending ? (
                            <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Play className="h-3 w-3 mr-1" />
                          )}
                          Start
                        </Button>
                      )}
                      
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="text-xs"
                            data-testid={`button-delete-${botData.phoneNumber}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Bot</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete "{botData.name}"? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteBotMutation.mutate(botData.id)}
                              data-testid={`confirm-delete-${botData.phoneNumber}`}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  ) : (
                    <div className="w-full text-xs text-muted-foreground bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded border border-yellow-200 dark:border-yellow-800 text-center">
                      ⏳ Your bot is pending admin approval. Contact support for activation.
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}