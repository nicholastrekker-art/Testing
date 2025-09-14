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
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [verificationStep, setVerificationStep] = useState<'phone' | 'otp' | 'verified'>('phone');
  const [isVerified, setIsVerified] = useState(false);

  const verificationSteps: PhoneVerificationStep[] = [
    {
      step: 1,
      title: "Enter Phone Number",
      description: "Provide the phone number associated with your WhatsApp bot",
      icon: <Phone className="h-5 w-5" />,
      completed: verificationStep !== 'phone'
    },
    {
      step: 2,
      title: "Verify Ownership", 
      description: "Enter the session ID or credentials to verify bot ownership",
      icon: <Shield className="h-5 w-5" />,
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

  // Phone verification mutation
  const verifyPhoneMutation = useMutation({
    mutationFn: async (phoneNumber: string) => {
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      
      const response = await fetch('/api/guest/verify-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanedPhone }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to verify phone number');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Phone Verified",
        description: "Your phone number has been verified. You can now manage your bots.",
      });
      setVerificationStep('otp');
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // OTP verification mutation  
  const verifyOtpMutation = useMutation({
    mutationFn: async (data: { phoneNumber: string; otp: string }) => {
      const response = await fetch('/api/guest/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Invalid verification code');
      }
      
      return response.json();
    },
    onSuccess: () => {
      setVerificationStep('verified');
      setIsVerified(true);
      toast({
        title: "Verification Complete",
        description: "You now have full access to bot management features.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handlePhoneVerification = () => {
    if (!phoneNumber.trim()) {
      toast({
        title: "Phone Required",
        description: "Please enter your phone number",
        variant: "destructive"
      });
      return;
    }
    verifyPhoneMutation.mutate(phoneNumber);
  };

  const handleOtpVerification = () => {
    if (!otp.trim()) {
      toast({
        title: "Code Required", 
        description: "Please enter the verification code",
        variant: "destructive"
      });
      return;
    }
    verifyOtpMutation.mutate({ phoneNumber, otp });
  };

  return (
    <div className="min-h-screen w-full p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Phone Verification</h1>
          <p className="text-muted-foreground">
            Verify your phone number to access bot management features
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
              Follow these steps to verify your phone number and access your bots
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

        {/* Phone Number Input */}
        {verificationStep === 'phone' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5" />
                Enter Phone Number
              </CardTitle>
              <CardDescription>
                Enter the phone number associated with your WhatsApp bot
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+1234567890"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  data-testid="input-phone-number"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Include country code (e.g., +1 for US, +44 for UK)
                </p>
              </div>
              
              <Button
                onClick={handlePhoneVerification}
                disabled={verifyPhoneMutation.isPending}
                className="w-full"
                data-testid="button-verify-phone"
              >
                {verifyPhoneMutation.isPending ? "Verifying..." : "Verify Phone Number"}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* OTP Input */}
        {verificationStep === 'otp' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Enter Session ID
              </CardTitle>
              <CardDescription>
                Enter your bot's session ID (base64 credentials) to verify ownership
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="otp">Session ID / Base64 Credentials</Label>
                <textarea
                  id="otp"
                  placeholder="Paste your base64 session ID here..."
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  className="w-full h-32 p-3 border rounded-md resize-none font-mono text-sm"
                  data-testid="input-session-id"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  This verifies that you own the bot associated with the phone number
                </p>
              </div>
              
              <div className="flex gap-2">
                <Button
                  onClick={handleOtpVerification}
                  disabled={verifyOtpMutation.isPending}
                  className="flex-1"
                  data-testid="button-verify-session"
                >
                  {verifyOtpMutation.isPending ? "Verifying..." : "Verify Session"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setVerificationStep('phone')}
                >
                  Back
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
                  <h3 className="text-xl font-semibold text-green-800">Verification Complete!</h3>
                  <p className="text-green-600 mt-1">
                    Your phone number {phoneNumber} has been successfully verified.
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