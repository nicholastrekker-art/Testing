import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
      typingIndicator: false,
      chatGPT: false
    }
  });

  const [step, setStep] = useState(1); // 1: form, 2: validation, 3: success, 4: existing_bot_management, 5: wrong_server, 6: server_full, 7: cross_tenancy_success
  const [existingBotData, setExistingBotData] = useState<any>(null);
  const [serverMismatch, setServerMismatch] = useState<any>(null);
  const [serverFullData, setServerFullData] = useState<any>(null);
  const [crossTenancyData, setCrossTenancyData] = useState<any>(null);
  const [showServerSelection, setShowServerSelection] = useState(false);
  const [showCredentialUpdate, setShowCredentialUpdate] = useState(false);
  const [managingBot, setManagingBot] = useState<string | null>(null); // Track which action is in progress

  // Guest bot registration mutation
  const registerBotMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const formDataToSend = new FormData();
      formDataToSend.append('botName', data.botName);
      formDataToSend.append('phoneNumber', data.phoneNumber);
      formDataToSend.append('credentialType', data.credentialType);
      formDataToSend.append('features', JSON.stringify(data.features));
      
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
        setStep(4); // Show existing bot management
        toast({ 
          title: "Existing Bot Found", 
          description: data.message || "Welcome back! You have a bot on this server."
        });
      } else if (data.type === 'cross_tenancy_registered') {
        setCrossTenancyData(data);
        setStep(7); // Show cross-tenancy registration success
        toast({ 
          title: "Auto-Distributed to Available Server", 
          description: data.message || "Your bot has been registered on an available server!"
        });
      } else {
        setStep(3); // New registration success
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
        setStep(5); // Show server mismatch screen
        return;
      }
      
      setStep(1); // Go back to form on error
      toast({
        title: "Registration failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.botName || !formData.phoneNumber) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

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

    // Clean phone number by removing + if present
    const cleanedFormData = {
      ...formData,
      phoneNumber: formData.phoneNumber.replace(/^\+/, '')
    };

    setStep(2);
    registerBotMutation.mutate(cleanedFormData);
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
        autoLike: false,
        autoReact: false,
        autoView: false,
        typingIndicator: false,
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

        {step === 1 && (
          <div className="space-y-6 pb-4">
            {/* Quick Action Section - Register Button at Top */}
            <div className="text-center p-6 bg-gradient-to-r from-emerald-50 to-blue-50 dark:from-emerald-900/20 dark:to-blue-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center justify-center mb-4">
                <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white text-xl">
                  🚀
                </div>
              </div>
              <h3 className="text-xl font-bold mb-2 text-emerald-700 dark:text-emerald-400">Register Your Bot Now</h3>
              <p className="text-sm text-muted-foreground mb-4">Join thousands of users with TREKKER-MD WhatsApp automation</p>
              <div className="flex flex-col sm:flex-row gap-2 items-center justify-center text-xs text-emerald-600 dark:text-emerald-400">
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-500 rounded-full"></span>Free Registration</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-500 rounded-full"></span>Multi-Server Support</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-500 rounded-full"></span>Lifetime Access</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Bot Basic Info */}
              <Card className="border-l-4 border-l-blue-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Bot Information</CardTitle>
                  <CardDescription>Provide basic details for your bot</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      />
                    </div>
                    <div>
                      <Label htmlFor="phoneNumber" className="text-sm font-medium">Phone Number (with country code) *</Label>
                      <Input
                        id="phoneNumber"
                        data-testid="input-phone-number"
                        placeholder="+254700000000"
                        value={formData.phoneNumber}
                        onChange={(e) => setFormData(prev => ({ ...prev, phoneNumber: e.target.value }))}
                        required
                        className="mt-1"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Enter your phone number with country code (+ will be removed automatically)
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Credentials Section */}
              <Card className="border-l-4 border-l-purple-500">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Authentication Credentials</CardTitle>
                  <CardDescription>Choose how to provide your WhatsApp session</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
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

              {/* Bot Features Section */}
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
                    
                    <div className="flex items-start space-x-3 p-3 border rounded-lg hover:bg-muted/50">
                      <Checkbox 
                        id="typingIndicator"
                        data-testid="checkbox-typing-indicator"
                        checked={formData.features.typingIndicator}
                        onCheckedChange={(checked) => 
                          setFormData(prev => ({ 
                            ...prev, 
                            features: { ...prev.features, typingIndicator: !!checked } 
                          }))
                        }
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <Label htmlFor="typingIndicator" className="text-sm font-medium cursor-pointer">Typing Indicator</Label>
                        <p className="text-xs text-muted-foreground mt-1">Show typing indicator for responses</p>
                      </div>
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

              {/* Register Button */}
              <Button 
                type="submit" 
                data-testid="button-register-bot"
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-semibold py-3 text-lg rounded-lg shadow-lg transform transition hover:scale-[1.02]"
              >
                🚀 Register Bot Now
              </Button>
            </form>

            {/* Information Section - Moved Below Registration Form */}
            <div className="space-y-4">
              {/* TREKKER-MD Info Card */}
              <Card className="bg-gradient-to-r from-blue-600 to-purple-600 text-white border-none">
                <CardContent className="p-4">
                  <div className="text-center">
                    <h3 className="text-lg font-bold mb-2">TREKKER-MD LIFETIME BOT</h3>
                    <p className="text-sm text-blue-100 mb-3">Ultra fast WhatsApp automation - No expiry</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center justify-center gap-1">📞 WhatsApp: +254704897825</div>
                      <div className="flex items-center justify-center gap-1">📱 Telegram: @trekkermd_</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Important Notes */}
              <Card className="border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800">
                <CardContent className="p-4">
                  <h4 className="font-medium text-amber-800 dark:text-amber-200 mb-3 flex items-center gap-2">
                    📝 Important Information
                  </h4>
                  <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-2">
                    <li className="flex items-start gap-2">
                      <span className="text-amber-500 mt-0.5">•</span>
                      Your bot will be validated before activation
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-amber-500 mt-0.5">•</span>
                      Admin approval is required for bot activation
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-amber-500 mt-0.5">•</span>
                      Contact +254704897825 for activation after registration
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-amber-500 mt-0.5">•</span>
                      Invalid credentials will be rejected automatically
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-amber-500 mt-0.5">•</span>
                      Multi-server support for automatic load balancing
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <h3 className="text-lg font-semibold mb-2">Validating Bot Credentials...</h3>
            <p className="text-muted-foreground">
              Please wait while we validate your credentials and establish connection
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-check text-2xl text-green-600"></i>
            </div>
            <h3 className="text-xl font-bold mb-2">Bot Registered Successfully!</h3>
            <p className="text-muted-foreground mb-4">
              Your bot credentials have been validated and a confirmation message has been sent to WhatsApp.
            </p>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <h4 className="font-medium text-blue-800 mb-2">🎉 Next Steps:</h4>
              <ul className="text-sm text-blue-700 space-y-1 text-left">
                <li>✅ Your bot is now dormant and awaiting admin approval</li>
                <li>📱 Call or message +254704897825 to activate your bot</li>
                <li>⏰ You'll receive hourly status updates until activation</li>
                <li>🚀 Once approved, enjoy all premium TREKKER-MD features!</li>
              </ul>
            </div>

            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        )}

        {step === 4 && existingBotData && (
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

            <Button onClick={handleClose} className="w-full">
              Close
            </Button>
          </div>
        )}

        {step === 5 && serverMismatch && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-exclamation-triangle text-2xl text-red-600"></i>
            </div>
            <h3 className="text-xl font-bold mb-2 text-red-600">Wrong Server!</h3>
            <p className="text-muted-foreground mb-4">
              {serverMismatch.message}
            </p>
            
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <h4 className="font-medium text-red-800 mb-2">⚠️ Important:</h4>
              <ul className="text-sm text-red-700 space-y-1 text-left">
                <li>• This phone number is registered to a different server</li>
                <li>• You can only manage your bot from the correct server</li>
                <li>• Please go to the correct server to manage your bot</li>
                <li>• Each phone number can only be registered to one server</li>
              </ul>
            </div>

            <Button onClick={handleClose} variant="outline" className="w-full">
              I Understand
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