
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle, Smartphone, Server, Key, Settings, Rocket } from "lucide-react";

export default function BotRegistration() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Check for auto-register data from localStorage
  const autoSessionId = localStorage.getItem('autoRegisterSessionId') || '';
  const autoPhoneNumber = localStorage.getItem('autoRegisterPhoneNumber') || '';

  const [formData, setFormData] = useState({
    botName: '',
    phoneNumber: autoPhoneNumber,
    credentialType: 'base64',
    sessionId: autoSessionId,
    credsFile: null as File | null,
    features: {
      autoView: false,
      typingMode: 'none' as 'none' | 'typing' | 'recording' | 'both',
      presenceMode: 'none' as 'none' | 'always_online' | 'always_typing' | 'always_recording' | 'auto_switch',
      intervalSeconds: 30,
      chatGPT: false
    },
    selectedServer: ''
  });

  const [step, setStep] = useState(1);
  const [phoneCheckResult, setPhoneCheckResult] = useState<any>(null);
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [availableServers, setAvailableServers] = useState<any[]>([]);

  // Clear auto-register data after use
  useEffect(() => {
    if (autoSessionId && autoPhoneNumber) {
      console.log('Bot registration opened with auto-filled data');
      toast({
        title: "Credentials Auto-Filled!",
        description: `Session ID and phone number (${autoPhoneNumber}) have been automatically filled.`,
      });
      setStep(4);
      localStorage.removeItem('autoRegisterSessionId');
      localStorage.removeItem('autoRegisterPhoneNumber');
      localStorage.removeItem('autoRegisterFlow');
      localStorage.removeItem('autoRegisterTimestamp');
    }
  }, [autoSessionId, autoPhoneNumber, toast]);

  // Fetch available servers
  const fetchAvailableServers = async () => {
    try {
      const response = await fetch('/api/servers/available');
      if (response.ok) {
        const data = await response.json();
        setAvailableServers(data.servers || []);
      }
    } catch (error) {
      console.error('Error fetching servers:', error);
    }
  };

  // Phone number check mutation
  const phoneCheckMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const response = await fetch('/api/guest/check-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanedPhone }),
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.registeredTo && error.message) {
          return {
            registered: true,
            currentServer: false,
            registeredTo: error.registeredTo,
            message: error.message,
            serverMismatch: true
          };
        }
        throw new Error(error.message || 'Failed to check phone number');
      }

      return response.json();
    },
    onSuccess: (data) => {
      setPhoneCheckResult(data);
      if (data.registered && !data.currentServer) {
        toast({
          title: "Phone Number Registered",
          description: `This number is registered on ${data.registeredTo}. Please use a different number.`,
          variant: "destructive"
        });
        return;
      }
      fetchAvailableServers();
      setStep(3);
    },
    onError: (error: Error) => {
      toast({
        title: "Phone Check Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Bot registration mutation
  const registerBotMutation = useMutation({
    mutationFn: async (data: typeof formData & { selectedServer?: string }) => {
      const formDataToSend = new FormData();
      formDataToSend.append('botName', data.botName);
      formDataToSend.append('phoneNumber', data.phoneNumber);
      formDataToSend.append('credentialType', data.credentialType);
      formDataToSend.append('features', JSON.stringify(data.features));

      if (data.selectedServer) {
        formDataToSend.append('selectedServer', data.selectedServer);
      }

      if (data.credentialType === 'base64' && data.sessionId) {
        try {
          const decoded = atob(data.sessionId.trim());
          JSON.parse(decoded);
          formDataToSend.append('sessionId', data.sessionId);
        } catch (error) {
          throw new Error('Invalid session ID format');
        }
      } else if (data.credsFile) {
        formDataToSend.append('credsFile', data.credsFile);
      }

      const response = await fetch('/api/guest/register-bot', {
        method: 'POST',
        body: formDataToSend,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to register bot');
      }

      return response.json();
    },
    onSuccess: () => {
      setStep(7);
      toast({
        title: "Bot Registered Successfully!",
        description: "Your bot has been submitted for approval.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Registration Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handlePhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.phoneNumber) {
      toast({ title: "Validation Error", description: "Please enter your phone number", variant: "destructive" });
      return;
    }
    setStep(2);
    phoneCheckMutation.mutate(formData.phoneNumber);
  };

  const handleServerSelection = (server: any) => {
    setSelectedServer(server.name);
    setFormData(prev => ({ ...prev, selectedServer: server.name }));
    setStep(4);
  };

  const handleFinalSubmit = () => {
    if (!formData.botName) {
      toast({ title: "Validation Error", description: "Please enter a bot name", variant: "destructive" });
      return;
    }
    setStep(6);
    registerBotMutation.mutate({ ...formData, selectedServer: selectedServer || formData.selectedServer });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-emerald-950">
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-gray-900/80 border-b border-emerald-500/20 px-4 sm:px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <Button variant="ghost" onClick={() => setLocation('/')} className="text-emerald-400 hover:text-emerald-300">
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back to Dashboard
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-green-400 bg-clip-text text-transparent">
              Register Your Bot
            </h1>
            <p className="text-sm text-gray-400">Step-by-step bot registration process</p>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Progress Steps */}
        <Card className="border-emerald-500/30 bg-gray-800/50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              {[
                { step: 1, title: "Phone Number", icon: Smartphone, active: step === 1, completed: step > 1 },
                { step: 2, title: "Checking", icon: Server, active: step === 2, completed: step > 2 },
                { step: 3, title: "Select Server", icon: Server, active: step === 3, completed: step > 3 },
                { step: 4, title: "Credentials", icon: Key, active: step === 4, completed: step > 4 },
                { step: 5, title: "Features", icon: Settings, active: step === 5, completed: step > 5 },
                { step: 6, title: "Complete", icon: Rocket, active: step >= 6, completed: step === 7 },
              ].map((item, index) => (
                <div key={item.step} className="flex items-center">
                  <div className={`flex flex-col items-center ${index < 5 ? 'mr-2' : ''}`}>
                    <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all ${
                      item.completed ? 'bg-green-500 border-green-500 text-white' :
                      item.active ? 'bg-emerald-500 border-emerald-500 text-white' :
                      'bg-gray-700 border-gray-600 text-gray-400'
                    }`}>
                      {item.completed ? <CheckCircle className="h-5 w-5" /> : <item.icon className="h-5 w-5" />}
                    </div>
                    <p className="text-xs mt-1 hidden sm:block text-gray-400">{item.title}</p>
                  </div>
                  {index < 5 && (
                    <div className={`hidden sm:block w-12 h-0.5 ${item.completed ? 'bg-green-500' : 'bg-gray-700'}`} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Step 1: Phone Number */}
        {step === 1 && (
          <Card className="border-emerald-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-6 w-6 text-emerald-400" />
                Enter Your Phone Number
              </CardTitle>
              <CardDescription>We'll check if you have an existing bot or help you register a new one</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePhoneSubmit} className="space-y-4">
                <div>
                  <Label>Phone Number (with country code)</Label>
                  <Input
                    placeholder="+254700000000"
                    value={formData.phoneNumber}
                    onChange={(e) => setFormData(prev => ({ ...prev, phoneNumber: e.target.value.replace(/[\s\-\(\)]/g, '') }))}
                    className="mt-1"
                    autoFocus
                    readOnly={!!autoPhoneNumber}
                  />
                </div>
                <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700">
                  Continue
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Loading */}
        {step === 2 && (
          <Card className="border-blue-500/30">
            <CardContent className="pt-6 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
              <h3 className="text-xl font-bold text-blue-400">Checking Your Phone Number</h3>
              <p className="text-gray-400 mt-2">Please wait...</p>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Server Selection */}
        {step === 3 && (
          <Card className="border-purple-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-6 w-6 text-purple-400" />
                Select Your Server
              </CardTitle>
              <CardDescription>Choose a server with available bot slots</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3">
                {availableServers.map((server) => (
                  <div
                    key={server.id}
                    onClick={() => handleServerSelection(server)}
                    className="p-4 border border-gray-700 rounded-lg hover:bg-gray-800 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-medium text-white">{server.name}</h4>
                        <p className="text-sm text-gray-400">{server.description}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-green-400">{server.availableSlots} slots available</p>
                        <p className="text-xs text-gray-500">{server.currentBots}/{server.maxBots} bots</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Credentials */}
        {step === 4 && (
          <Card className="border-amber-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-6 w-6 text-amber-400" />
                Bot Credentials
              </CardTitle>
              <CardDescription>Provide your bot name and session credentials</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Bot Name</Label>
                <Input
                  placeholder="My WhatsApp Bot"
                  value={formData.botName}
                  onChange={(e) => setFormData(prev => ({ ...prev, botName: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Credential Type</Label>
                <RadioGroup
                  value={formData.credentialType}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, credentialType: value }))}
                  className="mt-2"
                >
                  <div className="flex items-center space-x-2 p-3 border rounded-lg">
                    <RadioGroupItem value="base64" id="base64" />
                    <Label htmlFor="base64" className="cursor-pointer">Paste Base64 Session ID</Label>
                  </div>
                  <div className="flex items-center space-x-2 p-3 border rounded-lg">
                    <RadioGroupItem value="file" id="file" />
                    <Label htmlFor="file" className="cursor-pointer">Upload creds.json File</Label>
                  </div>
                </RadioGroup>
              </div>
              {formData.credentialType === 'base64' ? (
                <div>
                  <Label>Base64 Session ID</Label>
                  <Textarea
                    placeholder="Paste your base64 encoded session ID here..."
                    value={formData.sessionId}
                    onChange={(e) => setFormData(prev => ({ ...prev, sessionId: e.target.value }))}
                    className="min-h-[100px] font-mono text-sm mt-1"
                  />
                </div>
              ) : (
                <div>
                  <Label>Upload creds.json File</Label>
                  <Input
                    type="file"
                    accept=".json"
                    onChange={(e) => setFormData(prev => ({ ...prev, credsFile: e.target.files?.[0] || null }))}
                    className="mt-1"
                  />
                </div>
              )}
              <Button onClick={() => setStep(5)} className="w-full bg-amber-600 hover:bg-amber-700">
                Continue to Features
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 5: Features */}
        {step === 5 && (
          <Card className="border-green-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-6 w-6 text-green-400" />
                Bot Features
              </CardTitle>
              <CardDescription>Configure your bot's automation features</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="autoView"
                    checked={formData.features.autoView}
                    onCheckedChange={(checked) => setFormData(prev => ({
                      ...prev,
                      features: { ...prev.features, autoView: !!checked }
                    }))}
                  />
                  <Label htmlFor="autoView" className="cursor-pointer">Auto View Status</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="chatGPT"
                    checked={formData.features.chatGPT}
                    onCheckedChange={(checked) => setFormData(prev => ({
                      ...prev,
                      features: { ...prev.features, chatGPT: !!checked }
                    }))}
                  />
                  <Label htmlFor="chatGPT" className="cursor-pointer">ChatGPT Integration</Label>
                </div>
              </div>
              <div>
                <Label>Presence Mode</Label>
                <Select
                  value={formData.features.presenceMode}
                  onValueChange={(value: any) => setFormData(prev => ({
                    ...prev,
                    features: { ...prev.features, presenceMode: value }
                  }))}
                >
                  <SelectTrigger className="mt-1">
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
              <Button onClick={handleFinalSubmit} className="w-full bg-green-600 hover:bg-green-700">
                <Rocket className="h-4 w-4 mr-2" />
                Register Bot Now
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Step 6: Loading */}
        {step === 6 && (
          <Card className="border-blue-500/30">
            <CardContent className="pt-6 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
              <h3 className="text-xl font-bold text-blue-400">Registering Your Bot</h3>
              <p className="text-gray-400 mt-2">Please wait while we set up your WhatsApp bot...</p>
            </CardContent>
          </Card>
        )}

        {/* Step 7: Success */}
        {step === 7 && (
          <Card className="border-green-500/30">
            <CardContent className="pt-6 text-center">
              <CheckCircle className="h-16 w-16 text-green-400 mx-auto mb-4" />
              <h3 className="text-2xl font-bold text-green-400">Bot Registered Successfully!</h3>
              <p className="text-gray-400 mt-2">Your bot is now awaiting admin approval</p>
              <div className="mt-6 space-y-2 text-left bg-gray-800/50 p-4 rounded-lg">
                <p className="text-sm text-gray-300">✅ Your bot is dormant and awaiting approval</p>
                <p className="text-sm text-gray-300">📱 Contact +254704897825 to activate your bot</p>
                <p className="text-sm text-gray-300">⏰ You'll receive hourly status updates</p>
                <p className="text-sm text-gray-300">🚀 Once approved, enjoy all premium features!</p>
              </div>
              <Button onClick={() => setLocation('/')} className="w-full mt-6 bg-emerald-600 hover:bg-emerald-700">
                Return to Dashboard
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
