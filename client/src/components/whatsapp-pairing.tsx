import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Smartphone, Key, CheckCircle, AlertTriangle, Copy, Server, Gift } from "lucide-react";

interface WhatsAppPairingProps {
  open: boolean;
  onClose: () => void;
}

export default function WhatsAppPairing({ open, onClose }: WhatsAppPairingProps) {
  const { toast } = useToast();

  const [step, setStep] = useState(1); // 1: server selection, 2: phone input, 3: pairing code + waiting, 4: credentials, 5: bot setup
  const [selectedServer, setSelectedServer] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingSessionId, setPairingSessionId] = useState("");
  const [credentials, setCredentials] = useState<any>(null);
  const [isWaitingForAuth, setIsWaitingForAuth] = useState(false);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const [botName, setBotName] = useState("");
  const [features, setFeatures] = useState({
    autoLike: false,
    autoReact: false,
    autoView: false,
    presenceMode: 'none' as 'none' | 'always_online' | 'always_typing' | 'always_recording' | 'auto_switch',
    intervalSeconds: 30,
    chatGPT: false
  });

  // Fetch available servers
  const { data: serversData, isLoading: serversLoading } = useQuery({
    queryKey: ['/api/servers/available'],
    enabled: open && step === 1
  });

  // Fetch offer status
  const { data: offerStatus } = useQuery({
    queryKey: ['/api/offer/status'],
    enabled: open
  });

  // Poll for authentication status
  const checkAuthStatus = async (sessionId: string) => {
    try {
      const response = await fetch(`/api/whatsapp/pairing-status/${sessionId}`);
      
      // Check if response is OK and is JSON
      if (!response.ok) {
        return; // Silently return for 404s during polling
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return; // Not JSON, skip this poll
      }

      const data = await response.json();

      if (data.status === 'authenticated') {
        // Authentication successful
        if (pollingInterval) {
          clearInterval(pollingInterval);
          setPollingInterval(null);
        }
        setIsWaitingForAuth(false);
        setCredentials(data.sessionData || data.credentials);
        setStep(4);
        toast({
          title: "Pairing Successful!",
          description: data.message || "Your WhatsApp is now linked. Credentials sent to your WhatsApp.",
        });
      } else if (data.status === 'failed') {
        // Authentication failed
        if (pollingInterval) {
          clearInterval(pollingInterval);
          setPollingInterval(null);
        }
        setIsWaitingForAuth(false);
        toast({
          title: "Authentication Failed",
          description: data.message || "Please try again",
          variant: "destructive"
        });
      }
      // If 'waiting', continue polling
    } catch (error) {
      // Silently handle polling errors
      return;
    }
  };

  // Generate pairing code using direct endpoint
  const generatePairingMutation = useMutation({
    mutationFn: async (data: { phoneNumber: string; selectedServer: string; botName?: string; features?: any }) => {
      const response = await fetch(`/code?number=${data.phoneNumber}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate pairing code');
      }
      const result = await response.json();
      return result;
    },
    onSuccess: (data) => {
      if (data.code) {
        // Pairing code generated successfully
        setPairingCode(data.code);
        const sessionId = `pair_${phoneNumber}_${Date.now()}`;
        setPairingSessionId(sessionId);
        setIsWaitingForAuth(false);
        setStep(3);

        toast({
          title: "Pairing Code Generated!",
          description: "Enter this code in WhatsApp Settings → Linked Devices. After pairing, your session ID will be sent to your WhatsApp.",
        });
      } else {
        throw new Error('No pairing code returned');
      }
    },
    onError: (error: Error) => {
      setIsWaitingForAuth(false);
      toast({
        title: "Pairing Failed",
        description: error.message || "Failed to generate pairing code. Please try again.",
        variant: "destructive"
      });
    }
  });

  // Register bot mutation - includes offer discount check
  const registerBotMutation = useMutation({
    mutationFn: async (data: any) => {
      const formData = new FormData();
      formData.append('botName', data.botName);
      formData.append('phoneNumber', data.phoneNumber);
      formData.append('credentialType', 'base64');
      formData.append('sessionId', data.sessionId);
      formData.append('features', JSON.stringify(data.features));
      formData.append('selectedServer', data.selectedServer);
      
      // Include pairing session ID for temp file cleanup
      if (data.pairingSessionId) {
        formData.append('pairingSessionId', data.pairingSessionId);
      }

      const response = await fetch('/api/guest/register-bot', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to register bot');
      }

      return response.json();
    },
    onSuccess: (data) => {
      const isAutoApproved = (offerStatus as any)?.isActive;
      
      toast({
        title: isAutoApproved ? "🎉 Bot Auto-Approved!" : "Bot Registered Successfully!",
        description: isAutoApproved 
          ? "Your bot was auto-approved due to active promotional offer!" 
          : data.message || "Your bot has been submitted for approval.",
      });
      
      // Close dialog and refresh
      setTimeout(() => {
        onClose();
        queryClient.invalidateQueries({ queryKey: ['/api/bots'] });
        queryClient.invalidateQueries({ queryKey: ['/api/bots/approved'] });
        window.location.reload();
      }, 2000);
    },
    onError: (error: Error) => {
      toast({
        title: "Bot Registration Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleServerSelect = () => {
    if (!selectedServer) {
      toast({
        title: "Server Required",
        description: "Please select a server to continue",
        variant: "destructive"
      });
      return;
    }
    setStep(2);
  };

  const handlePhoneSubmit = async () => {
    if (!phoneNumber) {
      toast({
        title: "Phone Number Required",
        description: "Please enter your WhatsApp phone number",
        variant: "destructive"
      });
      return;
    }

    // Clean phone number
    const cleaned = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
    
    if (!/^\d{10,15}$/.test(cleaned)) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid phone number with country code (e.g., 254712345678)",
        variant: "destructive"
      });
      return;
    }

    // Check if phone number is already registered
    try {
      const response = await fetch('/api/guest/check-registration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber: cleaned }),
      });

      if (response.ok) {
        const data = await response.json();
        
        if (data.registered || data.serverMismatch) {
          const serverName = data.registeredTo || 'another server';
          toast({
            title: "Phone Number Already Registered",
            description: `This phone number is already registered on ${serverName}. Please use a different number or go to Step 2 to manage your existing bot.`,
            variant: "destructive"
          });
          return;
        }
      } else {
        // Check if this is a server mismatch error
        const error = await response.json();
        if (error.registeredTo) {
          toast({
            title: "Phone Number Already Registered",
            description: `This phone number is already registered on ${error.registeredTo}. Please use a different number or go to Step 2 to manage your existing bot.`,
            variant: "destructive"
          });
          return;
        }
      }
    } catch (error) {
      console.error('Registration check error:', error);
      // Continue if check fails - don't block the user
    }

    // Update phone number state with cleaned version
    setPhoneNumber(cleaned);
    
    // Use the working /pair endpoint
    generatePairingMutation.mutate({ phoneNumber: cleaned, selectedServer });
  };

  // No longer need handleVerifyPairing - authentication happens automatically

  const handleCopyCredentials = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: "Credentials copied to clipboard",
    });
  };

  const handleBotSetup = () => {
    if (!botName) {
      toast({
        title: "Bot Name Required",
        description: "Please enter a name for your bot",
        variant: "destructive"
      });
      return;
    }

    registerBotMutation.mutate({
      botName,
      phoneNumber,
      sessionId: credentials.base64, // Send base64 credentials
      features,
      selectedServer
    });
  };

  const handleReset = () => {
    // Clean up polling interval if active
    if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
    
    setStep(1);
    setSelectedServer("");
    setPhoneNumber("");
    setPairingCode("");
    setPairingSessionId("");
    setCredentials(null);
    setIsWaitingForAuth(false);
    setBotName("");
    setFeatures({
      autoLike: false,
      autoReact: false,
      autoView: false,
      presenceMode: 'none',
      intervalSeconds: 30,
      chatGPT: false
    });
  };

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) {
        handleReset();
        onClose();
      }
    }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <Smartphone className="h-6 w-6" />
            Internal WhatsApp Authentication
          </DialogTitle>
          <DialogDescription>
            Generate your WhatsApp session credentials securely
          </DialogDescription>
        </DialogHeader>

        {/* Offer Discount Banner */}
        {(offerStatus as any)?.isActive && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-900/20">
            <Gift className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              🎉 <strong>Limited Time Offer!</strong> All new bots registered now will be auto-approved! 
              {(offerStatus as any)?.timeRemaining && ` Expires in ${(offerStatus as any).timeRemaining}`}
            </AlertDescription>
          </Alert>
        )}

        {/* Step 1: Server Selection */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Step 1: Select Server
              </CardTitle>
              <CardDescription>
                Choose which server will host your bot
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="server">Available Servers</Label>
                <Select value={selectedServer} onValueChange={setSelectedServer}>
                  <SelectTrigger data-testid="select-server">
                    <SelectValue placeholder="Select a server" />
                  </SelectTrigger>
                  <SelectContent>
                    {serversLoading ? (
                      <SelectItem value="loading" disabled>Loading servers...</SelectItem>
                    ) : (
                      (serversData as any)?.servers?.map((server: any) => (
                        <SelectItem key={server.name} value={server.name}>
                          {server.name} - {server.availableSlots} slots available
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <Button 
                onClick={handleServerSelect} 
                className="w-full"
                data-testid="button-next-server"
              >
                Next: Enter Phone Number
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Phone Number Input */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" />
                Step 2: Enter Phone Number
              </CardTitle>
              <CardDescription>
                Enter your WhatsApp phone number (with country code, no + or spaces)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="e.g., 1234567890"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  data-testid="input-phone"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Format: Country code + phone number (no + or spaces). Example: 1234567890
                </p>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setStep(1)}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button 
                  onClick={handlePhoneSubmit}
                  disabled={generatePairingMutation.isPending}
                  className="flex-1"
                  data-testid="button-generate-code"
                >
                  {generatePairingMutation.isPending ? "Generating..." : "Generate Pairing Code"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Pairing Code Display + Waiting for Authentication */}
        {step === 3 && (
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-blue-600" />
                Step 3: Enter Pairing Code in WhatsApp
              </CardTitle>
              <CardDescription>
                {generatePairingMutation.isPending 
                  ? "Waiting for WhatsApp authentication..." 
                  : "Use this code ONLY to link your WhatsApp (one-time use)"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {generatePairingMutation.isPending ? (
                // Loading state while waiting for authentication
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                  <p className="text-lg font-medium">Waiting for you to enter the pairing code in WhatsApp...</p>
                  <p className="text-sm text-muted-foreground mt-2">This may take up to 60 seconds</p>
                  <p className="text-xs text-muted-foreground mt-4">The pairing code is: <strong>{pairingCode || "Generating..."}</strong></p>
                </div>
              ) : (
                // Show pairing code (only shown if there's an error or timeout)
                <>
                  <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-lg text-center">
                    <p className="text-sm text-muted-foreground mb-2">Your Pairing Code (One-Time Use):</p>
                    <p className="text-4xl font-bold text-blue-600 dark:text-blue-400 tracking-wider">
                      {pairingCode}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyCredentials(pairingCode)}
                      className="mt-2"
                      data-testid="button-copy-code"
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      Copy Code
                    </Button>
                    <p className="text-xs text-orange-600 dark:text-orange-400 mt-2">
                      ⚠️ This pairing code is ONLY for linking WhatsApp. Don't use it anywhere else!
                    </p>
                  </div>

                  <Alert>
                    <AlertDescription>
                      <ol className="space-y-1 text-sm">
                        <li>1. Open WhatsApp on your phone</li>
                        <li>2. Go to <strong>Settings → Linked Devices</strong></li>
                        <li>3. Tap <strong>Link a Device</strong></li>
                        <li>4. Tap <strong>Link with phone number instead</strong></li>
                        <li>5. Enter the pairing code above</li>
                      </ol>
                    </AlertDescription>
                  </Alert>

                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Authentication timed out or failed. Please click "Try Again" to generate a new pairing code.
                    </AlertDescription>
                  </Alert>

                  <Button 
                    onClick={() => {
                      setStep(2);
                      setPairingCode("");
                    }}
                    className="w-full"
                    data-testid="button-retry-pairing"
                  >
                    Try Again
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 4: Credentials Display */}
        {step === 4 && credentials && (
          <Card className="border-green-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                Step 4: Pairing Successful! 🎉
              </CardTitle>
              <CardDescription>
                Your Session ID has been sent to your WhatsApp. Continue to register your bot now.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="border-green-500">
                <CheckCircle className="h-4 w-4" />
                <AlertDescription className="font-semibold">
                  ✅ Session ID sent to your WhatsApp! Check your messages for a backup copy.
                </AlertDescription>
              </Alert>

              {(offerStatus as any)?.isActive && (
                <Alert className="border-green-500 bg-green-50 dark:bg-green-900/20">
                  <Gift className="h-4 w-4 text-green-600" />
                  <AlertDescription className="text-green-800 dark:text-green-200">
                    🎉 <strong>Great news!</strong> Your bot will be auto-approved due to our active promotional offer!
                  </AlertDescription>
                </Alert>
              )}
              
              <Alert className="border-blue-500">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-semibold mb-1">📱 What Happened:</p>
                  <ul className="text-sm space-y-1 ml-4 list-disc">
                    <li>✅ Pairing code was used to link your WhatsApp</li>
                    <li>✅ Session ID was automatically generated and sent to your WhatsApp</li>
                    <li>✅ You can now configure and register your bot below</li>
                  </ul>
                </AlertDescription>
              </Alert>
              
              <Alert className="border-orange-500">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="font-semibold">
                  ⚠️ SECURITY: Never share your Session ID with anyone!
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">WhatsApp JID</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <Input 
                      value={credentials.jid} 
                      readOnly 
                      className="font-mono text-sm"
                      data-testid="text-jid"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyCredentials(credentials.jid)}
                      data-testid="button-copy-jid"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Session ID (Backup - also in WhatsApp)</Label>
                  <div className="flex items-center gap-2 mt-1">
                    <textarea 
                      value={credentials.base64} 
                      readOnly 
                      className="w-full h-24 p-2 border rounded-md font-mono text-xs resize-none"
                      data-testid="text-session-base64"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyCredentials(credentials.base64)}
                      data-testid="button-copy-session"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    💡 This same Session ID is in your WhatsApp - use either copy for Step 2
                  </p>
                </div>
              </div>

              <Button 
                onClick={() => setStep(5)}
                className="w-full"
                data-testid="button-continue-setup"
              >
                Continue to Bot Setup
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 5: Bot Setup */}
        {step === 5 && (
          <Card>
            <CardHeader>
              <CardTitle>Step 5: Configure Your Bot</CardTitle>
              <CardDescription>
                Set up your bot name and features
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="botName">Bot Name</Label>
                <Input
                  id="botName"
                  placeholder="My WhatsApp Bot"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  data-testid="input-bot-name"
                />
              </div>

              <div className="space-y-3">
                <Label>Bot Features</Label>
                
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="autoLike"
                    checked={features.autoLike}
                    onCheckedChange={(checked) => 
                      setFeatures(prev => ({ ...prev, autoLike: checked as boolean }))
                    }
                    data-testid="checkbox-auto-like"
                  />
                  <label htmlFor="autoLike" className="text-sm">Auto Like Status</label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="autoReact"
                    checked={features.autoReact}
                    onCheckedChange={(checked) => 
                      setFeatures(prev => ({ ...prev, autoReact: checked as boolean }))
                    }
                    data-testid="checkbox-auto-react"
                  />
                  <label htmlFor="autoReact" className="text-sm">Auto React to Messages</label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="autoView"
                    checked={features.autoView}
                    onCheckedChange={(checked) => 
                      setFeatures(prev => ({ ...prev, autoView: checked as boolean }))
                    }
                    data-testid="checkbox-auto-view"
                  />
                  <label htmlFor="autoView" className="text-sm">Auto View Status</label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="chatGPT"
                    checked={features.chatGPT}
                    onCheckedChange={(checked) => 
                      setFeatures(prev => ({ ...prev, chatGPT: checked as boolean }))
                    }
                    data-testid="checkbox-chatgpt"
                  />
                  <label htmlFor="chatGPT" className="text-sm">Enable ChatGPT Integration</label>
                </div>

                <div>
                  <Label htmlFor="presence">Presence Mode</Label>
                  <Select 
                    value={features.presenceMode} 
                    onValueChange={(value: any) => 
                      setFeatures(prev => ({ ...prev, presenceMode: value }))
                    }
                  >
                    <SelectTrigger data-testid="select-presence">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="always_online">Always Online</SelectItem>
                      <SelectItem value="always_typing">Always Typing</SelectItem>
                      <SelectItem value="always_recording">Always Recording</SelectItem>
                      <SelectItem value="auto_switch">Auto Switch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setStep(4)}
                  className="flex-1"
                >
                  Back
                </Button>
                <Button 
                  onClick={handleBotSetup}
                  disabled={registerBotMutation.isPending}
                  className="flex-1"
                  data-testid="button-register-bot"
                >
                  {registerBotMutation.isPending ? "Registering..." : "Register Bot"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </DialogContent>
    </Dialog>
  );
}
