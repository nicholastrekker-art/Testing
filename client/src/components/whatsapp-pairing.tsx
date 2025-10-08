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
import { Smartphone, Key, CheckCircle, AlertTriangle, Copy, Server } from "lucide-react";

interface WhatsAppPairingProps {
  open: boolean;
  onClose: () => void;
}

export default function WhatsAppPairing({ open, onClose }: WhatsAppPairingProps) {
  const { toast } = useToast();

  const [step, setStep] = useState(1); // 1: server selection, 2: phone input, 3: pairing code, 4: credentials, 5: bot setup
  const [selectedServer, setSelectedServer] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [credentials, setCredentials] = useState<any>(null);
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

  // Generate pairing code mutation
  const generatePairingMutation = useMutation({
    mutationFn: async (data: { phoneNumber: string; selectedServer: string }) => {
      const res = await apiRequest('POST', '/api/whatsapp/generate-pairing-code', data);
      return res.json();
    },
    onSuccess: (data) => {
      setPairingCode(data.pairingCode);
      setSessionId(data.sessionId);
      setStep(3); // Move to pairing code display
      toast({
        title: "Pairing Code Generated",
        description: `Your pairing code is: ${data.pairingCode}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Generate Pairing Code",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Verify pairing mutation
  const verifyPairingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/whatsapp/verify-pairing', {
        sessionId,
        phoneNumber,
        selectedServer
      });
      return res.json();
    },
    onSuccess: (data) => {
      setCredentials(data.credentials);
      setStep(4); // Move to credentials display
      toast({
        title: "Pairing Successful!",
        description: "Credentials have been sent to your WhatsApp and saved for registration.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Pairing Not Complete",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Register bot mutation
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
      toast({
        title: "Bot Registered Successfully!",
        description: data.message || "Your bot has been submitted for approval.",
      });
      
      // Close dialog and refresh
      setTimeout(() => {
        onClose();
        queryClient.invalidateQueries({ queryKey: ['/api/bots'] });
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
        description: "Please enter a valid phone number with country code (e.g., 1234567890)",
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
    generatePairingMutation.mutate({ phoneNumber: cleaned, selectedServer });
  };

  const handleVerifyPairing = async () => {
    verifyPairingMutation.mutate();
  };

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
      pairingSessionId: sessionId, // Send the original pairing session ID for file cleanup
      features,
      selectedServer
    });
  };

  const handleReset = () => {
    setStep(1);
    setSelectedServer("");
    setPhoneNumber("");
    setPairingCode("");
    setSessionId("");
    setCredentials(null);
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

        {/* Step 3: Pairing Code Display */}
        {step === 3 && (
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-blue-600" />
                Step 3: Enter Pairing Code in WhatsApp
              </CardTitle>
              <CardDescription>
                Open WhatsApp on your phone and enter the code below
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-lg text-center">
                <p className="text-sm text-muted-foreground mb-2">Your Pairing Code:</p>
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

              <Button 
                onClick={handleVerifyPairing}
                disabled={verifyPairingMutation.isPending}
                className="w-full"
                data-testid="button-verify-pairing"
              >
                {verifyPairingMutation.isPending ? "Verifying..." : "I've Entered the Code - Verify Connection"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Credentials Display */}
        {step === 4 && credentials && (
          <Card className="border-green-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                Step 4: Backup Your Credentials
              </CardTitle>
              <CardDescription>
                Save these credentials safely - you'll need them to manage your bot
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="border-green-500">
                <CheckCircle className="h-4 w-4" />
                <AlertDescription className="font-semibold">
                  ✅ Credentials have been sent to your WhatsApp! Check your messages.
                </AlertDescription>
              </Alert>
              
              <Alert className="border-orange-500">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="font-semibold">
                  ⚠️ IMPORTANT: Backup your credentials and DO NOT share with anyone!
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
                  <Label className="text-xs text-muted-foreground">Session ID (Base64)</Label>
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
