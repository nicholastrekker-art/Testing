import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";

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
    credsFile: null as File | null
  });

  const [step, setStep] = useState(1); // 1: form, 2: validation, 3: success

  // Guest bot registration mutation
  const registerBotMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const formDataToSend = new FormData();
      formDataToSend.append('botName', data.botName);
      formDataToSend.append('phoneNumber', data.phoneNumber);
      formDataToSend.append('credentialType', data.credentialType);
      
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
      setStep(3);
      toast({ 
        title: "Bot registration submitted", 
        description: data.message || "Your bot is being validated..."
      });
    },
    onError: (error) => {
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

    setStep(2);
    registerBotMutation.mutate(formData);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData(prev => ({ ...prev, credsFile: file }));
    }
  };

  const resetForm = () => {
    setFormData({
      botName: '',
      phoneNumber: '',
      credentialType: 'base64',
      sessionId: '',
      credsFile: null
    });
    setStep(1);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center">
            🚀 Register Your TREKKER-MD Bot
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-6">
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
      </DialogContent>
    </Dialog>
  );
}