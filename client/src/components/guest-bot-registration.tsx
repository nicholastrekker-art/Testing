import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import CredentialUpdateModal from "./credential-update-modal"; import ServerSelectionPanel from "./server-selection-panel";

interface GuestBotRegistrationProps {
  open: boolean;
  onClose: () => void;
}

export default function GuestBotRegistration({ open, onClose }: GuestBotRegistrationProps) {
  const { toast } = useToast();
  
  const [formData, setFormData] = useState({
    botName: '',
    phoneNumber: '',
    credentialType: 'base64', // 'base64' or 'file'
    sessionId: '',
    credsFile: null as File | null,
    features: {
      autoLike: false,
      autoReact: false,
      autoView: false,
      presenceMode: 'none' as 'none' | 'always_online' | 'always_typing' | 'always_recording' | 'auto_switch',
      intervalSeconds: 30, // for auto_switch mode
      chatGPT: false
    }
  });

  const [step, setStep] = useState(1); // 1: phone_number, 2: god_registry_check, 3: server_selection, 4: credentials, 5: features, 6: validation, 7: success, 8: existing_bot_management, 9: wrong_server, 10: server_full, 11: cross_tenancy_success
  const [existingBotData, setExistingBotData] = useState<any>(null);
  const [serverMismatch, setServerMismatch] = useState<any>(null);
  const [serverFullData, setServerFullData] = useState<any>(null);
  const [crossTenancyData, setCrossTenancyData] = useState<any>(null);
  const [showServerSelection, setShowServerSelection] = useState(false);
  const [showCredentialUpdate, setShowCredentialUpdate] = useState(false);
  const [managingBot, setManagingBot] = useState<string | null>(null); // Track which action is in progress
  
  // Sequential registration state
  const [phoneCheckResult, setPhoneCheckResult] = useState<any>(null);
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [availableServers, setAvailableServers] = useState<any[]>([]);

  // Function to fetch available servers
  const fetchAvailableServers = async () => {
    try {
      const response = await fetch('/api/servers/available');
      if (response.ok) {
        const data = await response.json();
        setAvailableServers(data.servers || []);
      } else {
        console.error('Failed to fetch available servers');
        setAvailableServers([]);
      }
    } catch (error) {
      console.error('Error fetching servers:', error);
      setAvailableServers([]);
    }
  };

  // Phone number check against God registry
  const phoneCheckMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      // Clean phone number - remove spaces, dashes, parentheses, and leading +
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      
      const response = await fetch('/api/guest/check-registration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber: cleanedPhone }),
      });
      
      if (!response.ok) {
        let errorMessage = 'Failed to check phone number';
        try {
          const error = await response.json();
          
          // Check if this is a server mismatch (not a real error)
          if (error.registeredTo && error.message) {
            // This is a server mismatch - treat as success with mismatch data
            return {
              registered: true,
              currentServer: false,
              registeredTo: error.registeredTo,
              message: error.message,
              serverMismatch: true
            };
          }
          
          errorMessage = error.message || errorMessage;
        } catch (e) {
          // If response is not JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Invalid response format from server');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setPhoneCheckResult(data);
      if (data.registered || data.serverMismatch) {
        if (data.serverMismatch || (!data.currentServer && data.registeredTo)) {
          // Phone number exists on different server - enhanced handling
          setServerMismatch({
            details: { registeredTo: data.registeredTo },
            message: data.message,
            registeredTo: data.registeredTo,
            botDetails: data.botDetails || null
          });
          setStep(9); // Show server mismatch with enhanced switching options
        } else if (data.currentServer) {
          // Phone number exists on current server
          if (data.hasBot) {
            setExistingBotData(data.bot);
            setStep(8); // Go to existing bot management
          } else {
            // Registered to this server but no bot found - proceed to create bot
            // Fetch available servers first
            fetchAvailableServers();
            setStep(3); // Go to server selection (will show current server)
          }
        }
      } else {
        // Phone number not found in any server, show server selection
        // Fetch available servers
        fetchAvailableServers();
        setStep(3); // Go to server selection
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Phone Check Failed",
        description: error.message,
        variant: "destructive"
      });
      setStep(1); // Go back to phone input
    }
  });

  // Guest bot registration mutation
  const registerBotMutation = useMutation({
    mutationFn: async (data: typeof formData & { selectedServer?: string }) => {
      const formDataToSend = new FormData();
      formDataToSend.append('botName', data.botName);
      formDataToSend.append('phoneNumber', data.phoneNumber);
      formDataToSend.append('credentialType', data.credentialType);
      formDataToSend.append('features', JSON.stringify(data.features));
      
      // CRITICAL: Add selectedServer to payload
      if (data.selectedServer) {
        formDataToSend.append('selectedServer', data.selectedServer);
      }
      
      if (data.credentialType === 'base64') {
        formDataToSend.append('sessionId', data.sessionId);
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
    onSuccess: (data) => {
      if (data.type === 'existing_bot_found') {
        setExistingBotData(data.botDetails);
        setStep(8); // FIXED: Show existing bot management (step 8, not 4)
        toast({ 
          title: "Existing Bot Found", 
          description: data.message || "Welcome back! You have a bot on this server."
        });
      } else if (data.type === 'cross_tenancy_registered') {
        setCrossTenancyData(data);
        setStep(11); // FIXED: Show cross-tenancy registration success (step 11, not 7)
        toast({ 
          title: "Auto-Distributed to Available Server", 
          description: data.message || "Your bot has been registered on an available server!"
        });
      } else {
        setStep(7); // FIXED: New registration success (step 7, not 3)
        toast({ 
          title: "Bot registration submitted", 
          description: data.message || "Your bot is being validated..."
        });
      }
    },
    onError: (error: any) => {
      const errorData = error.message;
      
      // Check if it's a server mismatch error
      if (errorData?.includes('server') && errorData?.includes('registered to')) {
        setServerMismatch({ message: errorData });
        setStep(9); // FIXED: Show server mismatch screen (step 9, not 5)
        return;
      }
      
      // IMPROVED: Preserve user context instead of bouncing back to step 1
      // If user was in features step, go back to features
      if (step === 6) {
        setStep(5); // Go back to features step
      } else {
        setStep(4); // Go back to credentials step
      }
      
      toast({
        title: "Registration failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  // Step 1: Phone number validation and check
  const handlePhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.phoneNumber) {
      toast({
        title: "Validation Error",
        description: "Please enter your phone number",
        variant: "destructive"
      });
      return;
    }

    setStep(2); // Show loading state
    phoneCheckMutation.mutate(formData.phoneNumber);
  };

  // Step 3: Server selection
  const handleServerSelection = (serverId: string) => {
    setSelectedServer(serverId);
    setStep(4); // Go to credentials step
  };

  // Step 4-5: Continue to next step
  const handleNextStep = () => {
    if (step === 4) {
      // Validate credentials
      if (formData.credentialType === 'base64' && !formData.sessionId) {
        toast({
          title: "Validation Error",
          description: "Please provide the base64 session ID",
          variant: "destructive"
        });
        return;
      }
      if (formData.credentialType === 'file' && !formData.credsFile) {
        toast({
          title: "Validation Error",
          description: "Please upload the creds.json file",
          variant: "destructive"
        });
        return;
      }
      setStep(5); // Go to features step
    } else if (step === 5) {
      handleFinalSubmit();
    }
  };

  // Final registration submission
  const handleFinalSubmit = () => {
    if (!formData.botName) {
      toast({
        title: "Validation Error",
        description: "Please enter a bot name",
        variant: "destructive"
      });
      return;
    }

    // Clean phone number and add server selection
    const cleanedFormData = {
      ...formData,
      phoneNumber: formData.phoneNumber.replace(/^\+/, ''),
      selectedServer: selectedServer
    };

    setStep(6); // Show loading state
    registerBotMutation.mutate(cleanedFormData);
  };

  // Legacy submit handler (kept for compatibility)
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleFinalSubmit();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData(prev => ({ ...prev, credsFile: file }));
    }
  };

  // Bot management functions
  const manageBotMutation = useMutation({
    mutationFn: async ({ action, botId, phoneNumber }: { action: string; botId: string; phoneNumber: string }) => {
      const formData = new FormData();
      formData.append('phoneNumber', phoneNumber);
      formData.append('action', action);
      formData.append('botId', botId);
      
      const response = await fetch('/api/guest/manage-bot', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || `Failed to ${action} bot`);
      }
      
      return response.json();
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Success!",
        description: data.message
      });
      setManagingBot(null);
      
      // Refresh bot status after successful action
      if (variables.action !== 'update_credentials') {
        refreshBotStatus();
      }
    },
    onError: (error: Error, variables) => {
      toast({
        title: `${variables.action.charAt(0).toUpperCase() + variables.action.slice(1)} Failed`,
        description: error.message,
        variant: "destructive"
      });
      setManagingBot(null);
    }
  });

  const refreshBotStatus = () => {
    // This would typically refetch bot data, but for now we'll just refresh the page section
    // In a real implementation, you'd want to refetch the existing bot data
    toast({
      title: "Status Updated",
      description: "Bot status has been updated. Please check the bot status."
    });
  };

  const handleBotAction = (action: string) => {
    if (!existingBotData) return;
    
    setManagingBot(action);
    manageBotMutation.mutate({
      action,
      botId: existingBotData.id,
      phoneNumber: existingBotData.phoneNumber
    });
  };

  const resetForm = () => {
    setFormData({
      botName: '',
      phoneNumber: '',
      credentialType: 'base64',
      sessionId: '',
      credsFile: null,
      features: {
        autoLike: true,
        autoReact: false,
        autoView: true,
        presenceMode: 'none' as 'none' | 'always_online' | 'always_typing' | 'always_recording' | 'auto_switch',
        intervalSeconds: 30,
        chatGPT: false
      }
    });
    setStep(1);
  };

  const handleClose = () => {
    resetForm();
    setExistingBotData(null);
    setServerMismatch(null);
    setCrossTenancyData(null);
    setShowCredentialUpdate(false);
    setManagingBot(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            🚀 Register Your TREKKER-MD Bot
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Phone Number Input */}
        {step === 1 && (
          <div className="space-y-6 pb-4">
            {/* Progress Indicator */}
            <div className="flex items-center justify-center mb-6">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">1</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center text-sm font-medium">2</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center text-sm font-medium">3</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center text-sm font-medium">4</div>
              </div>
            </div>

            {/* Welcome Section */}
            <div className="text-center p-6 bg-gradient-to-r from-emerald-50 to-blue-50 dark:from-emerald-900/20 dark:to-blue-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center justify-center mb-4">
                <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white text-xl">
                  📱
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2 text-emerald-700 dark:text-emerald-400">Enter Your Phone Number</h3>
              <p className="text-sm text-muted-foreground mb-4">We'll check if you have an existing bot or help you register a new one</p>
            </div>

            <form onSubmit={handlePhoneSubmit} className="space-y-6">
              <Card className="border-l-4 border-l-blue-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Phone Number Verification</CardTitle>
                  <CardDescription>Enter your WhatsApp phone number to begin registration</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="phoneNumber" className="text-sm font-medium">Phone Number (with country code) *</Label>
                    <Input
                      id="phoneNumber"
                      data-testid="input-phone-number"
                      placeholder="+254700000000"
                      value={formData.phoneNumber}
                      onChange={(e) => {
                        // Clean phone number in real-time - remove spaces, dashes, parentheses
                        const cleaned = e.target.value.replace(/[\s\-\(\)]/g, '');
                        setFormData(prev => ({ ...prev, phoneNumber: cleaned }));
                      }}
                      onPaste={(e) => {
                        // Handle paste event to clean the pasted content
                        e.preventDefault();
                        const paste = e.clipboardData.getData('text');
                        const cleaned = paste.replace(/[\s\-\(\)]/g, '');
                        setFormData(prev => ({ ...prev, phoneNumber: cleaned }));
                      }}
                      required
                      className="mt-1 text-lg"
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Enter your phone number with country code (+ will be removed automatically)
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Button 
                type="submit" 
                data-testid="button-check-phone"
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold py-3 text-lg rounded-lg shadow-lg transform transition hover:scale-[1.02]"
                disabled={phoneCheckMutation.isPending}
              >
                {phoneCheckMutation.isPending ? '🔍 Checking...' : '🔍 Check Phone Number'}
              </Button>
            </form>
          </div>
        )}

        {/* Step 2: Loading - God Registry Check */}
        {step === 2 && (
          <div className="space-y-6 pb-4">
            <div className="flex items-center justify-center mb-6">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-medium">✓</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">2</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center text-sm font-medium">3</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center text-sm font-medium">4</div>
              </div>
            </div>

            <div className="text-center p-8 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-center mb-4">
                <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center text-white text-2xl animate-spin">
                  🔍
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2 text-blue-700 dark:text-blue-400">Checking Your Phone Number</h3>
              <p className="text-sm text-muted-foreground mb-4">Searching the God Registry for existing bot registrations...</p>
              <div className="flex items-center justify-center space-x-2 text-sm text-blue-600 dark:text-blue-400">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Server Selection */}
        {step === 3 && (
          <div className="space-y-6 pb-4">
            <div className="flex items-center justify-center mb-6">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-medium">✓</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-medium">✓</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">3</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-gray-200 text-gray-600 rounded-full flex items-center justify-center text-sm font-medium">4</div>
              </div>
            </div>

            <div className="text-center p-6 bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-900/20 dark:to-blue-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center justify-center mb-4">
                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white text-xl">
                  🌍
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2 text-green-700 dark:text-green-400">Select Your Server</h3>
              <p className="text-sm text-muted-foreground mb-4">Your phone number is not registered. Choose a server to register your bot on.</p>
            </div>

            <Card className="border-l-4 border-l-green-500">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Available Servers</CardTitle>
                <CardDescription>Select a server with available bot slots</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3">
                  {availableServers.map((server) => (
                    <div
                      key={server.id}
                      onClick={() => handleServerSelection(server.id)}
                      className="p-4 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                      data-testid={`server-option-${server.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">{server.name}</h4>
                          <p className="text-sm text-muted-foreground">{server.description}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-green-600">
                            {server.availableSlots} slots available
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {server.currentBots}/{server.maxBots} bots
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 4: Credentials */}
        {step === 4 && (
          <div className="space-y-6 pb-4">
            <div className="flex items-center justify-center mb-6">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-medium">✓</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-medium">✓</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-medium">✓</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">4</div>
              </div>
            </div>

            <div className="text-center p-6 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
              <div className="flex items-center justify-center mb-4">
                <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center text-white text-xl">
                  🔐
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2 text-purple-700 dark:text-purple-400">Authentication Credentials</h3>
              <p className="text-sm text-muted-foreground mb-4">Provide your WhatsApp session credentials to connect your bot</p>
            </div>

            <div className="space-y-6">
              <Card className="border-l-4 border-l-purple-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Bot Information</CardTitle>
                  <CardDescription>Enter your bot name and choose credential type</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="botName" className="text-sm font-medium">Bot Name *</Label>
                    <Input
                      id="botName"
                      data-testid="input-bot-name"
                      placeholder="My WhatsApp Bot"
                      value={formData.botName}
                      onChange={(e) => setFormData(prev => ({ ...prev, botName: e.target.value }))}
                      required
                      className="mt-1"
                      autoFocus
                    />
                  </div>
                  
                  <div>
                    <Label className="text-sm font-medium">Choose Credential Type *</Label>
                    <RadioGroup 
                      value={formData.credentialType} 
                      onValueChange={(value) => setFormData(prev => ({ ...prev, credentialType: value }))}
                      className="mt-2"
                    >
                      <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-muted/50">
                        <RadioGroupItem value="base64" id="base64" />
                        <Label htmlFor="base64" className="cursor-pointer">Paste Base64 Session ID</Label>
                      </div>
                      <div className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-muted/50">
                        <RadioGroupItem value="file" id="file" />
                        <Label htmlFor="file" className="cursor-pointer">Upload creds.json File</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {formData.credentialType === 'base64' ? (
                    <div>
                      <Label htmlFor="sessionId" className="text-sm font-medium">Base64 Session ID *</Label>
                      <Textarea
                        id="sessionId"
                        data-testid="textarea-session-id"
                        placeholder="Paste your base64 encoded session ID here..."
                        value={formData.sessionId}
                        onChange={(e) => setFormData(prev => ({ ...prev, sessionId: e.target.value }))}
                        className="min-h-[100px] font-mono text-sm mt-1"
                        required
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Get your session ID from the pairing site
                      </p>
                    </div>
                  ) : (
                    <div>
                      <Label htmlFor="credsFile" className="text-sm font-medium">Upload creds.json File *</Label>
                      <Input
                        id="credsFile"
                        data-testid="input-creds-file"
                        type="file"
                        accept=".json"
                        onChange={handleFileChange}
                        required
                        className="mt-1"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Upload the creds.json file from your WhatsApp session
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Button 
                onClick={handleNextStep}
                data-testid="button-next-step"
                className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-semibold py-3 text-lg rounded-lg shadow-lg transform transition hover:scale-[1.02]"
              >
                Continue to Features →
              </Button>
            </div>
          </div>
        )}

        {/* Step 5: Features Selection */}
        {step === 5 && (
          <div className="space-y-6 pb-4">
            <div className="flex items-center justify-center mb-6">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-medium">✓</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-medium">✓</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-medium">✓</div>
                <div className="text-sm text-muted-foreground">→</div>
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-medium">✓</div>
              </div>
            </div>

            <div className="text-center p-6 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center justify-center mb-4">
                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white text-xl">
                  ⚡
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2 text-green-700 dark:text-green-400">Bot Features</h3>
              <p className="text-sm text-muted-foreground mb-4">Choose the automation features for your bot (optional)</p>
            </div>

            <Card className="border-l-4 border-l-green-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Bot Features (Optional)</CardTitle>
                  <CardDescription>Select the automation features you want for your bot</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50">
                      <Checkbox 
                        id="autoLike"
                        data-testid="checkbox-auto-like"
                        checked={formData.features.autoLike}
                        onCheckedChange={(checked) => 
                          setFormData(prev => ({ 
                            ...prev, 
                            features: { ...prev.features, autoLike: !!checked } 
                          }))
                        }
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <Label htmlFor="autoLike" className="text-sm font-medium cursor-pointer">Auto Like Status</Label>
                        <p className="text-xs text-muted-foreground mt-1">Automatically like WhatsApp status updates</p>
                      </div>
                    </div>
                    
                    <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50">
                      <Checkbox 
                        id="autoReact"
                        data-testid="checkbox-auto-react"
                        checked={formData.features.autoReact}
                        onCheckedChange={(checked) => 
                          setFormData(prev => ({ 
                            ...prev, 
                            features: { ...prev.features, autoReact: !!checked } 
                          }))
                        }
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <Label htmlFor="autoReact" className="text-sm font-medium cursor-pointer">Auto React</Label>
                        <p className="text-xs text-muted-foreground mt-1">Automatically react to messages</p>
                      </div>
                    </div>
                    
                    <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50">
                      <Checkbox 
                        id="autoView"
                        data-testid="checkbox-auto-view"
                        checked={formData.features.autoView}
                        onCheckedChange={(checked) => 
                          setFormData(prev => ({ 
                            ...prev, 
                            features: { ...prev.features, autoView: !!checked } 
                          }))
                        }
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <Label htmlFor="autoView" className="text-sm font-medium cursor-pointer">Auto View Status</Label>
                        <p className="text-xs text-muted-foreground mt-1">Automatically view WhatsApp status</p>
                      </div>
                    </div>
                    
                    <div className="p-3 border rounded-lg hover:bg-muted/50">
                      <div className="mb-3">
                        <Label className="text-sm font-medium">Presence Configuration</Label>
                        <p className="text-xs text-muted-foreground mt-1">Configure how the bot appears online to other users</p>
                      </div>
                      <Select
                        value={formData.features.presenceMode}
                        onValueChange={(value: 'none' | 'always_online' | 'always_typing' | 'always_recording' | 'auto_switch') => 
                          setFormData(prev => ({ 
                            ...prev, 
                            features: { ...prev.features, presenceMode: value } 
                          }))
                        }
                      >
                        <SelectTrigger data-testid="select-presence-mode">
                          <SelectValue placeholder="Select presence mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None - Appear as normal</SelectItem>
                          <SelectItem value="always_online">Always Online</SelectItem>
                          <SelectItem value="always_typing">Always Typing</SelectItem>
                          <SelectItem value="always_recording">Always Recording</SelectItem>
                          <SelectItem value="auto_switch">Auto Switch (Recording & Typing)</SelectItem>
                        </SelectContent>
                      </Select>
                      
                      {formData.features.presenceMode === 'auto_switch' && (
                        <div className="mt-3">
                          <Label className="text-xs text-muted-foreground">Switch Interval (seconds)</Label>
                          <Input
                            type="number"
                            min="5"
                            max="120"
                            value={formData.features.intervalSeconds}
                            onChange={(e) => setFormData(prev => ({
                              ...prev,
                              features: { ...prev.features, intervalSeconds: parseInt(e.target.value) || 30 }
                            }))}
                            className="mt-1"
                            data-testid="input-interval-seconds"
                          />
                        </div>
                      )}
                    </div>
                    
                    <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50 md:col-span-2">
                      <Checkbox 
                        id="chatGPT"
                        data-testid="checkbox-chatgpt"
                        checked={formData.features.chatGPT}
                        onCheckedChange={(checked) => 
                          setFormData(prev => ({ 
                            ...prev, 
                            features: { ...prev.features, chatGPT: !!checked } 
                          }))
                        }
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <Label htmlFor="chatGPT" className="text-sm font-medium cursor-pointer">ChatGPT Integration</Label>
                        <p className="text-xs text-muted-foreground mt-1">Enable AI responses for conversations</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Button 
                onClick={handleNextStep}
                data-testid="button-register-bot-final"
                className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold py-3 text-lg rounded-lg shadow-lg transform transition hover:scale-[1.02]"
              >
                🚀 Register Bot Now
              </Button>
          </div>
        )}

        {/* Step 6: Registration Loading */}
        {step === 6 && (
          <div className="space-y-6 pb-4">
            <div className="text-center p-8 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-center mb-4">
                <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center text-white text-2xl animate-spin">
                  🚀
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2 text-blue-700 dark:text-blue-400">Registering Your Bot</h3>
              <p className="text-sm text-muted-foreground mb-4">Please wait while we set up your WhatsApp bot...</p>
              <div className="flex items-center justify-center space-x-2 text-sm text-blue-600 dark:text-blue-400">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
              </div>
            </div>
          </div>
        )}

        {/* Step 7: Registration Success */}
        {step === 7 && (
          <div className="space-y-6 pb-4">
            <div className="text-center p-8 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center justify-center mb-4">
                <div className="w-16 h-16 bg-green-500 rounded-full flex items-center justify-center text-white text-2xl">
                  ✅
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2 text-green-700 dark:text-green-400">Bot Registered Successfully!</h3>
              <p className="text-sm text-muted-foreground mb-4">Your bot credentials have been validated and registered</p>
            </div>

            <Card className="border-l-4 border-l-green-500">
              <CardHeader>
                <CardTitle className="text-lg">🎉 Next Steps</CardTitle>
                <CardDescription>Your bot is now awaiting admin approval</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">✅</span>
                    Your bot is now dormant and awaiting admin approval
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-500 mt-0.5">📱</span>
                    Contact +254704897825 to activate your bot
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-500 mt-0.5">⏰</span>
                    You'll receive hourly status updates until activation
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-orange-500 mt-0.5">🚀</span>
                    Once approved, enjoy all premium TREKKER-MD features!
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Button onClick={handleClose} className="w-full" data-testid="button-close-success">
              Done
            </Button>
          </div>
        )}

        {/* Step 8: Existing Bot Management */}
        {step === 8 && existingBotData && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-robot text-2xl text-blue-600"></i>
              </div>
              <h3 className="text-xl font-bold mb-2">Welcome Back!</h3>
              <p className="text-muted-foreground">
                You have an existing bot on this server. Here's what you can do:
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>🤖</span>
                  {existingBotData.name}
                </CardTitle>
                <CardDescription>
                  Phone: {existingBotData.phoneNumber}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Status:</span>
                    <div className={`inline-block ml-2 px-2 py-1 rounded-full text-xs ${
                      existingBotData.isActive 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {existingBotData.status}
                    </div>
                  </div>
                  <div>
                    <span className="font-medium">Approval:</span>
                    <div className={`inline-block ml-2 px-2 py-1 rounded-full text-xs ${
                      existingBotData.isApproved 
                        ? 'bg-blue-100 text-blue-800' 
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {existingBotData.approvalStatus}
                    </div>
                  </div>
                </div>

                {existingBotData.isApproved && existingBotData.timeRemaining && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <p className="text-sm text-green-800">
                      ⏰ <strong>{existingBotData.timeRemaining} days</strong> remaining until expiry
                    </p>
                  </div>
                )}

                {existingBotData.isExpired && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm text-red-800">
                      ⚠️ Your bot has expired. Please contact admin for renewal.
                    </p>
                  </div>
                )}

                <div className="space-y-3">
                  <h4 className="font-medium">Available Actions:</h4>
                  
                  {existingBotData.isApproved && !existingBotData.isExpired && (
                    <div className="grid grid-cols-3 gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleBotAction('start')}
                        disabled={managingBot === 'start' || existingBotData.status === 'online'}
                      >
                        {managingBot === 'start' ? '🔄' : '▶️'} {existingBotData.status === 'online' ? 'Online' : 'Start'}
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleBotAction('stop')}
                        disabled={managingBot === 'stop' || existingBotData.status === 'offline'}
                      >
                        {managingBot === 'stop' ? '🔄' : '⏸️'} {existingBotData.status === 'offline' ? 'Offline' : 'Stop'}
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleBotAction('restart')}
                        disabled={managingBot === 'restart'}
                      >
                        {managingBot === 'restart' ? '🔄' : '🔄'} Restart
                      </Button>
                    </div>
                  )}

                  {!existingBotData.isApproved && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-3">
                      <p className="text-sm text-yellow-800">
                        ⚠️ Your bot is not approved yet. You can only update credentials until it's approved.
                      </p>
                    </div>
                  )}

                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={() => setShowCredentialUpdate(true)}
                  >
                    🔑 Update Credentials
                  </Button>
                  
                  {!existingBotData.isApproved && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <p className="text-sm text-blue-800">
                        📞 Contact +254704897825 to get your bot approved and access all features
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Button onClick={handleClose} className="w-full" data-testid="button-close-existing-bot">
              Close
            </Button>
          </div>
        )}

        {/* Step 9: Server Mismatch/Switching */}
        {step === 9 && serverMismatch && (
          <div className="space-y-6 pb-4">
            <div className="text-center p-6 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex items-center justify-center mb-4">
                <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center text-white text-xl">
                  🔄
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2 text-amber-700 dark:text-amber-400">Phone Number Found on Different Server</h3>
              <p className="text-sm text-muted-foreground mb-4">Your phone number is registered on a different server</p>
            </div>

            <Card className="border-l-4 border-l-amber-500">
              <CardHeader>
                <CardTitle className="text-lg">Server Information</CardTitle>
                <CardDescription>Current vs. Registered Server</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-900">
                    <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-2">Current Server</h4>
                    <p className="text-lg font-bold">default-server</p>
                    <p className="text-sm text-muted-foreground">Where you're trying to register</p>
                  </div>
                  <div className="p-4 border rounded-lg bg-blue-50 dark:bg-blue-900">
                    <h4 className="font-medium text-blue-700 dark:text-blue-300 mb-2">Registered Server</h4>
                    <p className="text-lg font-bold text-blue-600">{serverMismatch.registeredTo}</p>
                    <p className="text-sm text-blue-600 dark:text-blue-400">Where your bot exists</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="font-medium">Choose Your Action:</h4>
                  <div className="grid gap-3">
                    <Button 
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        console.log('Server switch button clicked!');
                        console.log('ServerMismatch data:', serverMismatch);
                        
                        try {
                          // Switch to the registered server on the backend
                          toast({
                            title: "Switching Server",
                            description: `Switching to ${serverMismatch.registeredTo}...`,
                          });
                          
                          console.log('Making server configure call...');
                          const response = await fetch('/api/server/configure', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                              serverName: serverMismatch.registeredTo,
                              description: `Switched to ${serverMismatch.registeredTo} for bot management`
                            }),
                          });
                          
                          console.log('Server configure response:', response.status);
                          
                          if (!response.ok) {
                            const error = await response.json();
                            console.error('Server configure error:', error);
                            throw new Error(error.message || 'Failed to switch server');
                          }
                          
                          const result = await response.json();
                          console.log('Server configure result:', result);
                          
                          toast({
                            title: "Server Switched",
                            description: `Successfully switched to ${serverMismatch.registeredTo}`,
                          });
                          
                          // Wait a moment for server to fully switch
                          await new Promise(resolve => setTimeout(resolve, 1000));
                          
                          // Now make a call to get the bot data on the new server
                          console.log('Checking registration on new server...');
                          const checkResponse = await fetch('/api/guest/check-registration', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ phoneNumber: formData.phoneNumber }),
                          });
                          
                          console.log('Check registration response:', checkResponse.status);
                          
                          if (checkResponse.ok) {
                            const checkData = await checkResponse.json();
                            console.log('Check registration data:', checkData);
                            
                            if (checkData.hasBot && checkData.bot) {
                              setExistingBotData(checkData.bot);
                              setSelectedServer(serverMismatch.registeredTo);
                              setStep(8); // Go to existing bot management
                              console.log('Successfully switched to existing bot management');
                            } else {
                              console.log('No bot found on registered server');
                              toast({
                                title: "Bot Not Found",
                                description: "Could not find your bot on the registered server",
                                variant: "destructive"
                              });
                            }
                          } else {
                            const errorText = await checkResponse.text();
                            console.error('Check registration failed:', errorText);
                            toast({
                              title: "Error",
                              description: "Failed to verify bot on registered server",
                              variant: "destructive"
                            });
                          }
                        } catch (error) {
                          console.error('Server switch error:', error);
                          toast({
                            title: "Server Switch Failed",
                            description: error instanceof Error ? error.message : "Unknown error",
                            variant: "destructive"
                          });
                        }
                      }}
                      className="justify-start text-left h-auto p-4"
                      data-testid="button-switch-to-registered-server"
                    >
                      <div>
                        <div className="font-medium">🔄 Switch to Registered Server</div>
                        <div className="text-sm opacity-80 mt-1">Manage your existing bot on {serverMismatch.registeredTo}</div>
                      </div>
                    </Button>
                    
                    <Button 
                      variant="outline"
                      onClick={() => {
                        // Stay on current server but show server selection for new registration
                        setStep(3); // Go back to server selection
                      }}
                      className="justify-start text-left h-auto p-4"
                      data-testid="button-stay-current-server"
                    >
                      <div>
                        <div className="font-medium">📱 Use Different Phone Number</div>
                        <div className="text-sm opacity-80 mt-1">Register a new bot with different phone number on this server</div>
                      </div>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Step 11: Cross Tenancy Success */}
        {step === 11 && crossTenancyData && (
          <div className="space-y-6 pb-4">
            <div className="text-center p-8 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
              <div className="flex items-center justify-center mb-4">
                <div className="w-16 h-16 bg-purple-500 rounded-full flex items-center justify-center text-white text-2xl">
                  🌍
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2 text-purple-700 dark:text-purple-400">Auto-Distributed to Available Server!</h3>
              <p className="text-sm text-muted-foreground mb-4">Your bot has been automatically assigned to the best available server</p>
            </div>

            <Card className="border-l-4 border-l-purple-500">
              <CardHeader>
                <CardTitle className="text-lg">🎯 Server Assignment</CardTitle>
                <CardDescription>Your bot has been optimally placed</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 border rounded-lg bg-purple-50 dark:bg-purple-900/20">
                  <h4 className="font-medium text-purple-700 dark:text-purple-300 mb-2">Assigned Server</h4>
                  <p className="text-lg font-bold text-purple-600">{crossTenancyData.assignedServer}</p>
                  <p className="text-sm text-purple-600 dark:text-purple-400">Optimized for your location and performance</p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium">✅ What happens next:</h4>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <span className="text-green-500 mt-0.5">✅</span>
                      Your bot is registered on {crossTenancyData.assignedServer}
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5">📱</span>
                      Contact +254704897825 for activation
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-purple-500 mt-0.5">🔄</span>
                      Switch to {crossTenancyData.assignedServer} to manage your bot
                    </li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Button 
              onClick={() => {
                // Switch to the assigned server context
                setSelectedServer(crossTenancyData.assignedServer);
                handleClose();
                // The user will need to switch server context to manage their bot
              }}
              className="w-full"
              data-testid="button-switch-to-assigned-server"
            >
              🔄 Switch to {crossTenancyData.assignedServer}
            </Button>
          </div>
        )}


        {step === 7 && crossTenancyData && (
          <div className="space-y-6 py-4">
            <div className="text-center">
              <div className="w-16 h-16 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-white">🔄</span>
              </div>
              <h3 className="text-xl font-bold mb-2 text-emerald-700 dark:text-emerald-400">Auto-Distributed Successfully!</h3>
              <p className="text-muted-foreground">
                {crossTenancyData.message}
              </p>
            </div>

            <Card className="border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <span>🤖</span>
                  {crossTenancyData.botDetails?.name}
                </CardTitle>
                <CardDescription>
                  Phone: {crossTenancyData.botDetails?.phoneNumber}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-medium">Original Server:</span>
                    <div className="text-muted-foreground">{crossTenancyData.originalServer}</div>
                  </div>
                  <div>
                    <span className="font-medium">Assigned To:</span>
                    <div className="text-emerald-600 dark:text-emerald-400 font-medium">{crossTenancyData.assignedServer}</div>
                  </div>
                  <div>
                    <span className="font-medium">Available Slots:</span>
                    <div className="text-blue-600 dark:text-blue-400">{crossTenancyData.botDetails?.availableSlots} remaining</div>
                  </div>
                  <div>
                    <span className="font-medium">Registration Type:</span>
                    <div className="text-purple-600 dark:text-purple-400">Auto-Distribution</div>
                  </div>
                </div>

                {crossTenancyData.serverUrl && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 dark:bg-blue-900/20 dark:border-blue-800">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      🌐 <strong>Server URL:</strong> {crossTenancyData.serverUrl}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800">
              <CardContent className="p-4">
                <h4 className="font-medium text-blue-800 dark:text-blue-200 mb-3 flex items-center gap-2">
                  🎯 Next Steps
                </h4>
                <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-2">
                  {crossTenancyData.nextSteps?.map((step: string, index: number) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-blue-500 mt-0.5">•</span>
                      {step}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 dark:bg-emerald-900/20 dark:border-emerald-800">
              <h4 className="font-medium text-emerald-800 dark:text-emerald-200 mb-2 flex items-center gap-2">
                ✨ Cross-Tenancy Benefits
              </h4>
              <ul className="text-sm text-emerald-700 dark:text-emerald-300 space-y-1">
                <li className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                  Automatic load balancing across servers
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                  Seamless bot management from any approved server
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                  Enhanced reliability and availability
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                  Global bot registry synchronization
                </li>
              </ul>
            </div>

            <Button 
              onClick={handleClose} 
              className="w-full bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-700 hover:to-blue-700"
              data-testid="button-close-cross-tenancy"
            >
              🚀 Awesome! Let's Go
            </Button>
          </div>
        )}
      </DialogContent>
      
      {/* Credential Update Modal */}
      {existingBotData && (
        <CredentialUpdateModal
          open={showCredentialUpdate}
          onClose={() => setShowCredentialUpdate(false)}
          botId={existingBotData.id}
          phoneNumber={existingBotData.phoneNumber}
          crossTenancyMode={!!serverMismatch}
          targetServer={serverMismatch?.details?.registeredTo}
          onSuccess={() => {
            // Could refresh bot status here if needed
            refreshBotStatus();
          }}
        />
      )}
    </Dialog>
  );
}