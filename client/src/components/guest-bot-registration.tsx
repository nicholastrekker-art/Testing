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
import CredentialUpdateModal from "./credential-update-modal";

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

  const [step, setStep] = useState(1); // 1: form, 2: validation, 3: success, 4: existing_bot_management, 5: wrong_server
  const [existingBotData, setExistingBotData] = useState<any>(null);
  const [serverMismatch, setServerMismatch] = useState<any>(null);
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
          <div className="space-y-4 pb-4">
            {/* TREKKER-MD Info Card */}
            <Card className="bg-gradient-to-r from-blue-600 to-purple-600 text-white border-none">
              <CardContent className="p-4">
                <div className="text-center">
                  <h3 className="text-lg font-bold mb-2">TREKKER-MD LIFETIME BOT</h3>
                  <p className="text-sm text-blue-100 mb-3">Ultra fast WhatsApp automation - No expiry</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>📞 WhatsApp: +254704897825</div>
                    <div>📱 Telegram: @trekkermd_</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="botName">Bot Name *</Label>
                  <Input
                    id="botName"
                    placeholder="My WhatsApp Bot"
                    value={formData.botName}
                    onChange={(e) => setFormData(prev => ({ ...prev, botName: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="phoneNumber">Phone Number (with country code) *</Label>
                  <Input
                    id="phoneNumber"
                    placeholder="+254700000000"
                    value={formData.phoneNumber}
                    onChange={(e) => setFormData(prev => ({ ...prev, phoneNumber: e.target.value }))}
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Enter your phone number with country code (+ will be removed automatically)
                  </p>
                </div>
              </div>

              <div>
                <Label className="text-base font-medium">Choose Credential Type *</Label>
                <RadioGroup 
                  value={formData.credentialType} 
                  onValueChange={(value) => setFormData(prev => ({ ...prev, credentialType: value }))}
                  className="mt-2"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="base64" id="base64" />
                    <Label htmlFor="base64">Paste Base64 Session ID</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="file" id="file" />
                    <Label htmlFor="file">Upload creds.json File</Label>
                  </div>
                </RadioGroup>
              </div>

              {formData.credentialType === 'base64' ? (
                <div>
                  <Label htmlFor="sessionId">Base64 Session ID *</Label>
                  <Textarea
                    id="sessionId"
                    placeholder="Paste your base64 encoded session ID here..."
                    value={formData.sessionId}
                    onChange={(e) => setFormData(prev => ({ ...prev, sessionId: e.target.value }))}
                    className="min-h-[100px] font-mono text-sm"
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Get your session ID from the pairing site
                  </p>
                </div>
              ) : (
                <div>
                  <Label htmlFor="credsFile">Upload creds.json File *</Label>
                  <Input
                    id="credsFile"
                    type="file"
                    accept=".json"
                    onChange={handleFileChange}
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload the creds.json file from your WhatsApp session
                  </p>
                </div>
              )}

              {/* Bot Features Selection */}
              <div className="space-y-4">
                <Label className="text-base font-medium">Bot Features (Optional)</Label>
                <p className="text-sm text-muted-foreground">Select the automation features you want for your bot</p>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="autoLike"
                      checked={formData.features.autoLike}
                      onCheckedChange={(checked) => 
                        setFormData(prev => ({ 
                          ...prev, 
                          features: { ...prev.features, autoLike: !!checked } 
                        }))
                      }
                    />
                    <Label htmlFor="autoLike" className="text-sm">
                      <span className="font-medium">Auto Like Status</span>
                      <br />
                      <span className="text-xs text-muted-foreground">Automatically like WhatsApp status updates</span>
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="autoReact"
                      checked={formData.features.autoReact}
                      onCheckedChange={(checked) => 
                        setFormData(prev => ({ 
                          ...prev, 
                          features: { ...prev.features, autoReact: !!checked } 
                        }))
                      }
                    />
                    <Label htmlFor="autoReact" className="text-sm">
                      <span className="font-medium">Auto React</span>
                      <br />
                      <span className="text-xs text-muted-foreground">Automatically react to messages</span>
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="autoView"
                      checked={formData.features.autoView}
                      onCheckedChange={(checked) => 
                        setFormData(prev => ({ 
                          ...prev, 
                          features: { ...prev.features, autoView: !!checked } 
                        }))
                      }
                    />
                    <Label htmlFor="autoView" className="text-sm">
                      <span className="font-medium">Auto View Status</span>
                      <br />
                      <span className="text-xs text-muted-foreground">Automatically view WhatsApp status</span>
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="typingIndicator"
                      checked={formData.features.typingIndicator}
                      onCheckedChange={(checked) => 
                        setFormData(prev => ({ 
                          ...prev, 
                          features: { ...prev.features, typingIndicator: !!checked } 
                        }))
                      }
                    />
                    <Label htmlFor="typingIndicator" className="text-sm">
                      <span className="font-medium">Typing Indicator</span>
                      <br />
                      <span className="text-xs text-muted-foreground">Show typing indicator for responses</span>
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2 col-span-2">
                    <Checkbox 
                      id="chatGPT"
                      checked={formData.features.chatGPT}
                      onCheckedChange={(checked) => 
                        setFormData(prev => ({ 
                          ...prev, 
                          features: { ...prev.features, chatGPT: !!checked } 
                        }))
                      }
                    />
                    <Label htmlFor="chatGPT" className="text-sm">
                      <span className="font-medium">ChatGPT Integration</span>
                      <br />
                      <span className="text-xs text-muted-foreground">Enable AI responses for conversations</span>
                    </Label>
                  </div>
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h4 className="font-medium text-yellow-800 mb-2">📝 Important Notes:</h4>
                <ul className="text-sm text-yellow-700 space-y-1">
                  <li>• Your bot will be validated before activation</li>
                  <li>• Admin approval is required for bot activation</li>
                  <li>• Contact +254704897825 for activation after registration</li>
                  <li>• Invalid credentials will be rejected automatically</li>
                </ul>
              </div>

              <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700">
                Register Bot
              </Button>
            </form>
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
      </DialogContent>
      
      {/* Credential Update Modal */}
      {existingBotData && (
        <CredentialUpdateModal
          open={showCredentialUpdate}
          onClose={() => setShowCredentialUpdate(false)}
          botId={existingBotData.id}
          phoneNumber={existingBotData.phoneNumber}
          onSuccess={() => {
            // Could refresh bot status here if needed
            refreshBotStatus();
          }}
        />
      )}
    </Dialog>
  );
}