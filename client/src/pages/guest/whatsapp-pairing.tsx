import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Smartphone, Copy, CheckCircle, ArrowRight, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function WhatsAppPairingPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  const generatePairingCode = async () => {
    if (!phoneNumber) {
      toast({
        title: "Phone Number Required",
        description: "Please enter your phone number first",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch(`/api/whatsapp/pairing-code?number=${phoneNumber.replace(/[\s\-\(\)\+]/g, '')}`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error('Failed to generate pairing code');
      }

      const data = await response.json();
      setPairingCode(data.code);

      // Start polling for session ID
      startPollingForSessionId(data.code, phoneNumber);

      toast({
        title: "Pairing Code Generated!",
        description: "Use this code in WhatsApp to link your device",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate pairing code. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const startPollingForSessionId = (code: string, phoneNumber: string) => {
    // Clear any existing interval
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }

    // Poll every 3 seconds for the session ID from the database
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/guest/session/${phoneNumber.replace(/[\s\-\(\)\+]/g, '')}`);
        if (response.ok) {
          const data = await response.json();
          if (data.found && data.sessionId) {
            setSessionId(data.sessionId);
            clearInterval(interval);
            setPollingInterval(null);
            toast({
              title: "Session ID Received!",
              description: "Your session ID has been saved and is ready to use.",
            });
            // Auto-proceed to step 2
            setCurrentStep(2);
          }
        }
      } catch (error) {
        console.error('Error polling for session ID:', error);
      }
    }, 3000);

    setPollingInterval(interval);

    // Stop polling after 2 minutes
    setTimeout(() => {
      if (interval) {
        clearInterval(interval);
        setPollingInterval(null);
      }
    }, 120000);
  };

  // Cleanup polling on unmount
  React.useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied!",
      description: "Pairing code copied to clipboard",
    });
  };

  const handleSessionIdReceived = (id: string) => {
    setSessionId(id);
    toast({
      title: "Session ID Received!",
      description: "Your WhatsApp session has been successfully linked.",
    });
  };

  return (
    <div className="min-h-screen w-full p-6 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <Smartphone className="h-10 w-10 text-blue-600" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              WhatsApp Bot Setup
            </h1>
          </div>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Generate your session credentials to manage your WhatsApp bot
          </p>
        </div>

        {/* Progress Steps */}
        <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-900/20">
          <CardContent className="pt-6">
            <div className="flex items-center justify-center gap-4">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                currentStep >= 1 ? 'bg-blue-500 border-blue-500 text-white' : 'bg-gray-200 border-gray-300 text-gray-500'
              }`}>
                1
              </div>
              <div className={`w-24 h-0.5 ${currentStep >= 2 ? 'bg-blue-500' : 'bg-gray-300'}`} />
              <div className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                currentStep >= 2 ? 'bg-blue-500 border-blue-500 text-white' : 'bg-gray-200 border-gray-300 text-gray-500'
              }`}>
                2
              </div>
            </div>
            <div className="flex justify-between mt-2 text-sm">
              <span className={currentStep >= 1 ? 'text-blue-600 font-medium' : 'text-gray-500'}>
                Generate Pairing Code
              </span>
              <span className={currentStep >= 2 ? 'text-blue-600 font-medium' : 'text-gray-500'}>
                Link WhatsApp
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Step 1: Generate Pairing Code */}
        {currentStep === 1 && (
          <Card className="border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-6 w-6 text-blue-600" />
                Step 1: Generate Session ID
              </CardTitle>
              <CardDescription>
                Enter your phone number to generate a pairing code and session ID for your WhatsApp bot
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!pairingCode ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone Number (with country code)</Label>
                    <Input
                      id="phone"
                      data-testid="input-phone"
                      type="tel"
                      placeholder="+254700000000"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      className="text-lg"
                    />
                    <p className="text-xs text-muted-foreground">
                      Enter your WhatsApp number with country code
                    </p>
                  </div>
                  <Button 
                    onClick={generatePairingCode}
                    disabled={isGenerating || !phoneNumber}
                    size="lg"
                    className="w-full"
                    data-testid="button-generate-code"
                  >
                    {isGenerating ? "Generating..." : "Generate Pairing Code"}
                  </Button>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="text-center p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200">
                    <p className="text-sm text-muted-foreground mb-2">Your Pairing Code:</p>
                    <p className="text-4xl font-bold text-blue-600 dark:text-blue-400 tracking-wider">
                      {pairingCode}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(pairingCode)}
                      className="mt-2"
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      Copy Code
                    </Button>
                  </div>

                  <Alert className="border-blue-500">
                    <AlertDescription>
                      <p className="text-sm font-medium mb-2">📱 This code is valid for linking your WhatsApp account</p>
                      <p className="text-xs text-muted-foreground">
                        Keep this code ready for the next step where you'll enter it in WhatsApp
                      </p>
                    </AlertDescription>
                  </Alert>

                  <Button 
                    onClick={() => setCurrentStep(2)}
                    size="lg"
                    className="w-full"
                  >
                    Continue to WhatsApp Linking
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Step 2: Link WhatsApp */}
        {currentStep === 2 && (
          <Card className="border-green-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-6 w-6 text-green-600" />
                Step 2: Link Your WhatsApp
              </CardTitle>
              <CardDescription>
                Follow these instructions to link your WhatsApp account using the pairing code
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center p-6 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200">
                <p className="text-sm text-muted-foreground mb-2">Your Pairing Code:</p>
                <p className="text-4xl font-bold text-blue-600 dark:text-blue-400 tracking-wider">
                  {pairingCode}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(pairingCode)}
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

              {sessionId && (
                <Card className="border-purple-200">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Smartphone className="h-6 w-6 text-purple-600" />
                      Session ID Received
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 text-center">
                    <p className="text-sm text-muted-foreground mb-2">Your Session ID:</p>
                    <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 tracking-wide break-all">
                      {sessionId}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(sessionId);
                        toast({
                          title: "Session ID Copied!",
                          description: "Session ID copied to clipboard",
                        });
                      }}
                      className="mt-2"
                    >
                      <Copy className="h-4 w-4 mr-1" />
                      Copy Session ID
                    </Button>
                  </CardContent>
                </Card>
              )}


              {sessionId && (
                <Card className="border-purple-200 bg-purple-50 dark:bg-purple-900/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-300">
                      <Smartphone className="h-6 w-6" />
                      Session ID Received!
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border-2 border-purple-300">
                      <p className="text-xs text-muted-foreground mb-2">Your Session ID:</p>
                      <div className="bg-gray-100 dark:bg-gray-900 p-3 rounded font-mono text-sm break-all max-h-32 overflow-y-auto">
                        {sessionId}
                      </div>
                    </div>
                    <Button
                      onClick={() => {
                        navigator.clipboard.writeText(sessionId);
                        toast({
                          title: "Session ID Copied!",
                          description: "Session ID has been copied to clipboard",
                        });
                      }}
                      className="w-full bg-purple-600 hover:bg-purple-700"
                      size="lg"
                    >
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Session ID
                    </Button>
                    <Alert className="border-green-500 bg-green-50 dark:bg-green-900/20">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <AlertDescription className="text-green-800 dark:text-green-200">
                        ✅ Session ID also sent to your WhatsApp! Use either copy to continue.
                      </AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              )}

              <Alert className="border-blue-500">
                <AlertDescription className="text-sm">
                  <strong>📱 What happens next:</strong>
                  <ul className="mt-2 space-y-1 ml-4 list-disc">
                    <li>Enter the code above in WhatsApp</li>
                    <li>Session ID will be sent to your WhatsApp automatically</li>
                    <li>Copy the Session ID from above or from WhatsApp</li>
                    <li>Continue to Step 2 (Guest Dashboard) to use it</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setCurrentStep(1);
                    setPairingCode("");
                    setSessionId("");
                  }}
                  size="lg"
                  className="flex-1"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Try Again
                </Button>
                <Button
                  onClick={() => {
                    // Store session ID in localStorage for auto-fill in bot registration
                    if (sessionId) {
                      localStorage.setItem('pendingSessionId', sessionId);
                      localStorage.setItem('pendingPhoneNumber', phoneNumber);
                    }
                    setLocation('/guest/bot-management');
                  }}
                  size="lg"
                  className="flex-1"
                  disabled={!sessionId} 
                  data-testid="button-proceed-step2"
                >
                  Proceed to Bot Registration
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Help Section */}
        <Card className="border-orange-200">
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Need help? The Session ID will be automatically sent to your WhatsApp after successful pairing.
              </p>
              <p className="text-xs text-muted-foreground">
                Make sure to save the Session ID securely - you'll need it to access your bot dashboard.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}