
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Smartphone, Key, CheckCircle, AlertTriangle, Copy, Server, Gift, ArrowLeft } from "lucide-react";

export default function WhatsAppPairingPage() {
  const { toast } = useToast();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
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
    enabled: step === 1
  });

  // Fetch offer status
  const { data: offerStatus } = useQuery({
    queryKey: ['/api/offer/status']
  });

  // Generate pairing code
  const generatePairingMutation = useMutation({
    mutationFn: async (data: { phoneNumber: string; selectedServer: string }) => {
      const response = await fetch(`/api/whatsapp/pairing-code?number=${data.phoneNumber}`, {
        method: 'GET',
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to generate pairing code' }));
        throw new Error(error.message || 'Failed to generate pairing code');
      }
      
      return await response.json();
    },
    onSuccess: (data) => {
      if (data.code || data.pairingCode) {
        const code = data.code || data.pairingCode;
        setPairingCode(code);
        const sessionId = data.sessionId || `pair_${phoneNumber}_${Date.now()}`;
        setPairingSessionId(sessionId);
        setIsWaitingForAuth(false);
        setStep(3);

        toast({
          title: "Pairing Code Generated!",
          description: "Enter this code in WhatsApp Settings → Linked Devices. Your session ID will be sent directly to your WhatsApp - check your messages!",
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
      
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/bots'] });
        queryClient.invalidateQueries({ queryKey: ['/api/bots/approved'] });
        navigate('/guest/dashboard');
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

    const cleaned = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
    
    if (!/^\d{10,15}$/.test(cleaned)) {
      toast({
        title: "Invalid Phone Number",
        description: "Please enter a valid phone number with country code (e.g., 254712345678)",
        variant: "destructive"
      });
      return;
    }

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
      }
    } catch (error) {
      console.error('Registration check error:', error);
    }

    setPhoneNumber(cleaned);
    generatePairingMutation.mutate({ phoneNumber: cleaned, selectedServer });
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
      sessionId: credentials.base64,
      features,
      selectedServer
    });
  };

  const handleReset = () => {
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
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6 flex items-center gap-4">
          <Button variant="outline" onClick={() => navigate('/guest/dashboard')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Smartphone className="h-8 w-8" />
            WhatsApp Authentication
          </h1>
        </div>

        {/* Offer Discount Banner */}
        {(offerStatus as any)?.isActive && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-900/20 mb-6">
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
                  <SelectTrigger>
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
              <Button onClick={handleServerSelect} className="w-full">
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
                Session ID will be sent automatically to your WhatsApp
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
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copy Code
                </Button>
              </div>

              <Alert className="border-green-500">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <AlertDescription>
                  <ol className="space-y-1 text-sm">
                    <li>1. Open WhatsApp on your phone</li>
                    <li>2. Go to <strong>Settings → Linked Devices</strong></li>
                    <li>3. Tap <strong>Link a Device</strong></li>
                    <li>4. Tap <strong>Link with phone number instead</strong></li>
                    <li>5. Enter the pairing code above</li>
                    <li>6. <strong>Check your WhatsApp messages</strong> - Session ID will arrive automatically!</li>
                  </ol>
                </AlertDescription>
              </Alert>

              <Alert className="border-blue-500">
                <AlertDescription className="text-sm">
                  <strong>📱 What happens next:</strong>
                  <ul className="mt-2 space-y-1 ml-4 list-disc">
                    <li>Enter the code above in WhatsApp</li>
                    <li>Session ID will be sent to your WhatsApp automatically</li>
                    <li>Copy that Session ID and continue to Step 2 (Guest Dashboard)</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="flex gap-2">
                <Button 
                  variant="outline"
                  onClick={() => {
                    setStep(2);
                    setPairingCode("");
                  }}
                  className="flex-1"
                >
                  Try Again
                </Button>
                <Button 
                  onClick={() => navigate('/guest/dashboard')}
                  className="flex-1"
                >
                  Done - Go to Dashboard
                </Button>
              </div>
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
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyCredentials(credentials.jid)}
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
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyCredentials(credentials.base64)}
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
                    <SelectTrigger>
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
                >
                  {registerBotMutation.isPending ? "Registering..." : "Register Bot"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
