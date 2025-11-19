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
  // Session ID input removed - credentials can only be set during pairing, not for existing bots
  const [verificationStep, setVerificationStep] = useState<'session' | 'verified' | 'inactive'>('session');
  const [isVerified, setIsVerified] = useState(false);
  const [botInfo, setBotInfo] = useState<any>(null);

  // Verification steps updated - credentials can only be set during pairing
  const verificationSteps: PhoneVerificationStep[] = [
    {
      step: 1,
      title: "Contact Support",
      description: "Credentials can only be set during the initial pairing process",
      icon: <AlertTriangle className="h-5 w-5" />,
      completed: false
    },
    {
      step: 2,
      title: "Get Help",
      description: "Admin support can assist with bot issues",
      icon: <Phone className="h-5 w-5" />,
      completed: false
    }
  ];

  // Session ID verification removed - credentials can only be set during pairing, not for existing bots
  // Guests should contact admin support if their bot needs assistance

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

        {/* Credential Update Not Allowed */}
        <Card className="border-amber-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Credential Updates Not Available
            </CardTitle>
            <CardDescription>
              Credentials can only be set during the initial pairing process
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-md">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100 mb-2">
                Important: Security Policy
              </p>
              <p className="text-sm text-amber-800 dark:text-amber-200">
                For security reasons, bot credentials can only be set during the initial pairing process (via the panel landing page step 1 or .pair command). Existing bots cannot have their credentials updated through this interface.
              </p>
            </div>
            
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-md">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
                Need Help?
              </p>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                If your bot is offline or needs assistance, please contact admin support. They can help you resolve any issues with your bot.
              </p>
            </div>

            <div className="flex gap-2">
              <Button asChild variant="default">
                <a href="/guest/bot-management">View Bot Management</a>
              </Button>
              <Button asChild variant="outline">
                <a href="/">Return to Home</a>
              </Button>
            </div>
          </CardContent>
        </Card>

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