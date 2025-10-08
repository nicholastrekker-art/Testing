import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { Phone, Shield, CheckCircle, AlertTriangle } from "lucide-react";

interface PhoneVerificationStep {
  step: number;
  title: string;
  description: string;
  icon: React.ReactNode;
  completed?: boolean;
}

export default function GuestPhoneVerification() {
  const { toast } = useToast();
  const [sessionId, setSessionId] = useState("");
  const [verificationStep, setVerificationStep] = useState<'session' | 'verified' | 'inactive'>('session');
  const [isVerified, setIsVerified] = useState(false);
  const [botInfo, setBotInfo] = useState<any>(null);

  const verificationSteps: PhoneVerificationStep[] = [
    {
      step: 1,
      title: "Enter Session ID",
      description: "Paste your bot's Base64 session credentials to verify ownership",
      icon: <Shield className="h-5 w-5" />,
      completed: verificationStep !== 'session'
    },
    {
      step: 2,
      title: "Check Connection", 
      description: "Verify if your bot is currently active and connected",
      icon: <Phone className="h-5 w-5" />,
      completed: verificationStep === 'verified'
    },
    {
      step: 3,
      title: "Access Granted",
      description: "Full access to bot management features",
      icon: <CheckCircle className="h-5 w-5" />,
      completed: isVerified
    }
  ];

  // Session ID verification mutation
  const verifySessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch('/api/guest/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.trim() }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Session verification failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setBotInfo(data);
      
      if (data.botActive) {
        setVerificationStep('verified');
        setIsVerified(true);
        toast({
          title: "Bot Active!",
          description: `Your bot ${data.phoneNumber} is connected and ready to manage.`,
        });
      } else {
        setVerificationStep('inactive');
        toast({
          title: "Bot Inactive",
          description: "Your bot is not currently connected. Please provide updated credentials.",
          variant: "destructive"
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Retry with new session ID
  const retryVerificationMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await fetch('/api/guest/verify-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionId.trim() }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Session verification failed');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setBotInfo(data);
      
      if (data.botActive) {
        setVerificationStep('verified');
        setIsVerified(true);
        toast({
          title: "Bot Active!",
          description: `Your bot ${data.phoneNumber} is now connected and ready to manage.`,
        });
      } else {
        toast({
          title: "Bot Still Inactive",
          description: "The bot is still not connected. Please ensure the credentials are current.",
          variant: "destructive"
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleSessionVerification = () => {
    if (!sessionId.trim()) {
      toast({
        title: "Session ID Required",
        description: "Please paste your bot's session credentials",
        variant: "destructive"
      });
      return;
    }
    verifySessionMutation.mutate(sessionId);
  };

  const handleRetryVerification = () => {
    if (!sessionId.trim()) {
      toast({
        title: "Session ID Required", 
        description: "Please paste updated session credentials",
        variant: "destructive"
      });
      return;
    }
    retryVerificationMutation.mutate(sessionId);
  };

  return (
    <div className="min-h-screen w-full p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Bot Session Verification</h1>
          <p className="text-muted-foreground">
            Verify your bot ownership with session credentials to access management features
          </p>
        </div>

        {/* Verification Steps Progress */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Verification Process
            </CardTitle>
            <CardDescription>
              Follow these steps to verify your bot session and access management features
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {verificationSteps.map((step) => (
                <div key={step.step} className="flex items-center gap-4 p-3 rounded-lg border">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                    step.completed ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {step.completed ? <CheckCircle className="h-4 w-4" /> : step.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-medium">{step.title}</h3>
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                  </div>
                  <Badge variant={step.completed ? "default" : "outline"}>
                    {step.completed ? "Completed" : "Pending"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Session ID Input */}
        {verificationStep === 'session' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Enter Session ID from WhatsApp
              </CardTitle>
              <CardDescription>
                Paste the SESSION ID you received in WhatsApp (NOT the pairing code)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-md mb-3">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  ⚠️ Important: Don't confuse the pairing code with the Session ID
                </p>
                <ul className="text-xs text-blue-800 dark:text-blue-200 mt-2 space-y-1 ml-4 list-disc">
                  <li>Pairing Code: Used ONLY for linking WhatsApp (e.g., "ABC-123")</li>
                  <li>Session ID: Long base64 string sent to WhatsApp after pairing succeeds</li>
                  <li>You need the SESSION ID here, not the pairing code</li>
                </ul>
              </div>
              
              <div>
                <Label htmlFor="session">Session ID (Base64 - from WhatsApp message)</Label>
                <textarea
                  id="session"
                  placeholder="Paste the long SESSION ID from your WhatsApp message here (starts with 'eyJ...' or similar base64)"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className="w-full h-32 p-3 border rounded-md resize-none font-mono text-sm"
                  data-testid="input-session-id"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This will verify ownership and check if your bot is currently active
                </p>
              </div>
              
              <Button
                onClick={handleSessionVerification}
                disabled={verifySessionMutation.isPending}
                className="w-full"
                data-testid="button-verify-session"
              >
                {verifySessionMutation.isPending ? "Verifying..." : "Verify Session & Check Connection"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Bot Inactive - Request New Session */}
        {verificationStep === 'inactive' && (
          <Card className="border-orange-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                Bot Connection Inactive
              </CardTitle>
              <CardDescription>
                Your bot {botInfo?.phoneNumber} was found but is not currently connected. Please provide updated session credentials.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="newSession">Updated Session ID / Base64 Credentials</Label>
                <textarea
                  id="newSession"
                  placeholder="Paste your updated base64 session credentials here..."
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className="w-full h-32 p-3 border rounded-md resize-none font-mono text-sm"
                  data-testid="input-new-session-id"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Provide fresh session credentials to reactivate your bot connection
                </p>
              </div>
              
              <div className="flex gap-2">
                <Button
                  onClick={handleRetryVerification}
                  disabled={retryVerificationMutation.isPending}
                  className="flex-1"
                  data-testid="button-retry-verification"
                >
                  {retryVerificationMutation.isPending ? "Updating..." : "Update & Verify Connection"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setVerificationStep('session');
                    setSessionId('');
                    setBotInfo(null);
                  }}
                >
                  Start Over
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Verification Complete */}
        {verificationStep === 'verified' && (
          <Card className="border-green-200">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-green-800">Bot Connection Verified!</h3>
                  <p className="text-green-600 mt-1">
                    Your bot {botInfo?.phoneNumber} is active and ready to manage.
                  </p>
                </div>
                <div className="flex gap-2 justify-center">
                  <Button asChild>
                    <a href="/guest/bot-management">Manage Your Bots</a>
                  </Button>
                  <Button variant="outline" asChild>
                    <a href="/guest/credentials">Update Credentials</a>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Warning Card */}
        <Card className="border-orange-200">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5" />
              <div>
                <h4 className="font-medium text-orange-800">Security Notice</h4>
                <p className="text-sm text-orange-700 mt-1">
                  Your session ID contains sensitive authentication information. Only enter it on trusted platforms 
                  and never share it with others. This verification ensures you have legitimate access to the bot.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}