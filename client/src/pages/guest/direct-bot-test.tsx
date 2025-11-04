import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, XCircle, Bot, Gift, AlertTriangle, Key } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useQuery } from "@tanstack/react-query";

export default function DirectBotTestPage() {
  const { toast } = useToast();
  const [botName, setBotName] = useState("Trekker Bot");
  const [phoneNumber, setPhoneNumber] = useState("254704897825");
  const [sessionId, setSessionId] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isCheckingPhone, setIsCheckingPhone] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [phoneCheckResult, setPhoneCheckResult] = useState<any>(null);
  const [registrationResult, setRegistrationResult] = useState<any>(null); // State for registration outcome

  // Mock features state, assuming it's defined elsewhere or defaults are handled
  const features = {
    autoView: true,
    presenceMode: 'always_online',
    intervalSeconds: 30,
    chatGPT: false,
    typingMode: 'typing'
  };

  // Fetch promotional offer status
  const { data: offerStatus } = useQuery({
    queryKey: ["/api/offer/status"],
    refetchInterval: 10000,
  });

  // Check phone number before allowing session validation
  const checkPhoneNumber = async () => {
    if (!phoneNumber.trim()) {
      toast({
        title: "Phone Number Required",
        description: "Please enter your phone number",
        variant: "destructive",
      });
      return;
    }

    setIsCheckingPhone(true);
    setPhoneCheckResult(null);

    try {
      const cleanedPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, '');
      const response = await fetch('/api/guest/check-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanedPhone }),
      });

      if (!response.ok) {
        const error = await response.json();
        if (error.registeredTo) {
          setPhoneCheckResult({
            registered: true,
            serverMismatch: true,
            registeredTo: error.registeredTo,
            message: error.message
          });
          toast({
            title: "Phone Already Registered",
            description: `This number is registered on ${error.registeredTo}`,
            variant: "destructive"
          });
          return;
        }
        throw new Error(error.message || 'Failed to check phone number');
      }

      const data = await response.json();
      setPhoneCheckResult(data);

      if (data.registered && !data.currentServer) {
        toast({
          title: "Phone Registered Elsewhere",
          description: `This number is registered on ${data.registeredTo}`,
          variant: "destructive"
        });
      } else if (data.registered && data.hasBot) {
        toast({
          title: "Phone Already Has Bot",
          description: "This number already has a bot registered",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Phone Number Available",
          description: "You can proceed with registration",
        });
      }
    } catch (error: any) {
      toast({
        title: "Check Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsCheckingPhone(false);
    }
  };

  // Auto-check phone on blur
  useEffect(() => {
    if (phoneNumber && phoneNumber.length >= 10) {
      const timer = setTimeout(() => {
        checkPhoneNumber();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [phoneNumber]);

  const testSessionId = async () => {
    // First check phone number
    if (!phoneCheckResult || phoneCheckResult.registered) {
      toast({
        title: "Phone Check Required",
        description: "Please verify phone number availability first",
        variant: "destructive",
      });
      return;
    }

    if (!sessionId.trim()) {
      toast({
        title: "Session ID Required",
        description: "Please paste the session ID",
        variant: "destructive",
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/whatsapp/validate-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId.trim(),
          phoneNumber: phoneNumber.replace(/[\s\-\(\)\+]/g, '')
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setTestResult({ success: true, data });
        toast({
          title: "Session Validated!",
          description: data.messageSent
            ? `✅ Validation message sent to ${data.phoneNumber}! Check your WhatsApp.`
            : `✅ Session is valid for ${data.phoneNumber}`,
        });
      } else {
        setTestResult({ success: false, error: data.error || 'Validation failed' });
        toast({
          title: "Validation Failed",
          description: data.error || 'Invalid credentials',
          variant: "destructive",
        });
      }
    } catch (error: any) {
      setTestResult({ success: false, error: error.message });
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const registerBot = async () => {
    // Comprehensive validation
    if (!sessionId.trim()) {
      toast({
        title: "Session ID Required",
        description: "Please enter your session ID to register",
        variant: "destructive",
      });
      return;
    }

    if (!botName.trim()) {
      toast({
        title: "Bot Name Required",
        description: "Please enter a name for your bot",
        variant: "destructive",
      });
      return;
    }

    if (!phoneNumber.trim()) {
      toast({
        title: "Phone Number Required",
        description: "Please enter your phone number",
        variant: "destructive",
      });
      return;
    }

    if (!phoneCheckResult || phoneCheckResult.registered) {
      toast({
        title: "Phone Validation Required",
        description: "Please validate your phone number first",
        variant: "destructive",
      });
      return;
    }

    setIsRegistering(true);

    try {
      const formData = new FormData();
      formData.append('botName', botName.trim());
      formData.append('phoneNumber', phoneNumber.replace(/\D/g, ''));
      formData.append('credentialType', 'base64');
      formData.append('sessionId', sessionId.trim());

      // Enhanced features configuration
      formData.append('features', JSON.stringify({
        autoLike: false,
        autoReact: false,
        autoView: features.autoView,
        presenceMode: features.presenceMode,
        intervalSeconds: features.intervalSeconds,
        chatGPT: features.chatGPT,
        typingMode: features.typingMode
      }));

      const response = await fetch('/api/guest/register-bot', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        const isAutoApproved = (offerStatus as any)?.isActive;

        // Enhanced success messaging
        const successTitle = isAutoApproved
          ? "🎉 Bot Auto-Approved & Live!"
          : "✅ Bot Registered Successfully!";

        const successMessage = isAutoApproved
          ? `${botName} is now ACTIVE and ready to use! All features enabled instantly.`
          : `${botName} registered successfully. Awaiting admin approval - you'll be notified.`;

        toast({
          title: successTitle,
          description: successMessage,
          duration: 5000,
        });

        // Clear form
        setSessionId('');
        setBotName('');
        setPhoneNumber('');
        setPhoneCheckResult(null);

        setRegistrationResult({
          success: true,
          registered: true,
          data,
          autoApproved: isAutoApproved,
          botName,
          phoneNumber
        });
      } else {
        toast({
          title: "Registration Failed",
          description: data.error || data.message || "Failed to register bot. Please try again.",
          variant: "destructive",
        });
        setRegistrationResult({
          success: false,
          error: data.error || data.message
        });
      }
    } catch (error: any) {
      toast({
        title: "Connection Error",
        description: error.message || "Unable to connect to server. Please check your connection.",
        variant: "destructive",
      });
      setRegistrationResult({
        success: false,
        error: error.message
      });
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4">
      <div className="max-w-2xl mx-auto space-y-6 py-8">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Bot className="w-8 h-8 text-green-500" />
            <h1 className="text-3xl font-bold text-white">Direct Bot Registration</h1>
          </div>
          <p className="text-gray-400">Test and register your WhatsApp bot instantly</p>
        </div>

        {/* Promotional Offer Banner */}
        {(offerStatus as any)?.isActive && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-900/20">
            <Gift className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              🎉 <strong>Promotional Offer Active!</strong> Your bot will be AUTO-APPROVED instantly when registered!
            </AlertDescription>
          </Alert>
        )}

        {/* Phone Check Alert */}
        {phoneCheckResult && phoneCheckResult.registered && (
          <Alert className="border-red-500 bg-red-50 dark:bg-red-900/20">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800 dark:text-red-200">
              {phoneCheckResult.serverMismatch
                ? `⚠️ This phone number is already registered on ${phoneCheckResult.registeredTo}. Please use a different number.`
                : `⚠️ This phone number already has a bot registered. Please use a different number.`
              }
            </AlertDescription>
          </Alert>
        )}

        {phoneCheckResult && !phoneCheckResult.registered && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-900/20">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              ✅ Phone number is available for registration!
            </AlertDescription>
          </Alert>
        )}

        {/* Registration Result Alert */}
        {registrationResult && registrationResult.registered && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-900/20">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800 dark:text-green-200">
              {registrationResult.autoApproved ? (
                <div className="space-y-2">
                  <p className="font-bold text-lg">🎉 Bot Auto-Approved & Live!</p>
                  <p>✅ <strong>{registrationResult.botName}</strong> is now active and ready to use</p>
                  <p>📱 Phone: {registrationResult.phoneNumber}</p>
                  <p className="text-sm mt-2">All premium features are enabled. Your bot will start automatically.</p>
                  <div className="mt-3 pt-3 border-t border-green-300">
                    <Button
                      onClick={() => window.location.href = '/'}
                      className="w-full bg-green-600 hover:bg-green-700"
                    >
                      Go to Dashboard
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="font-bold">✅ Bot Registered Successfully!</p>
                  <p><strong>{registrationResult.botName}</strong> is awaiting admin approval</p>
                  <p>📱 Phone: {registrationResult.phoneNumber}</p>
                  <p className="text-sm mt-2">Contact +254704897825 to activate your bot. You'll receive hourly status updates.</p>
                  <div className="mt-3 pt-3 border-t border-green-300">
                    <Button
                      onClick={() => window.location.href = '/'}
                      variant="outline"
                      className="w-full"
                    >
                      Return to Dashboard
                    </Button>
                  </div>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">Bot Information</CardTitle>
            <CardDescription className="text-gray-400">
              Enter your bot details and session credentials
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="input-bot-name" className="text-gray-200">Bot Name</Label>
              <Input
                id="input-bot-name"
                data-testid="input-bot-name"
                placeholder="My WhatsApp Bot"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="input-phone-number" className="text-gray-200">
                Phone Number {isCheckingPhone && <span className="text-xs text-blue-400">(Checking...)</span>}
              </Label>
              <Input
                id="input-phone-number"
                data-testid="input-phone-number"
                placeholder="254704897825"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                onBlur={checkPhoneNumber}
                className="bg-gray-700 border-gray-600 text-white"
                disabled={isCheckingPhone}
              />
              {phoneCheckResult && !phoneCheckResult.registered && (
                <p className="text-xs text-green-400">✓ Available</p>
              )}
              {phoneCheckResult && phoneCheckResult.registered && (
                <p className="text-xs text-red-400">✗ Already registered</p>
              )}
            </div>

            <div>
              <Label htmlFor="sessionId">Session ID (Base64) *</Label>
              <Textarea
                id="sessionId"
                data-testid="textarea-session-id"
                placeholder="Paste your base64 session ID here... (starts with TREKKER~ or long alphanumeric string)"
                value={sessionId}
                onChange={(e) => {
                  const value = e.target.value.trim();
                  setSessionId(value);
                }}
                className="min-h-[120px] font-mono text-sm"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                {sessionId.length > 0 ? (
                  <span className="text-green-600">
                    ✓ Session ID loaded ({sessionId.length} characters)
                  </span>
                ) : (
                  "Get this from the pairing site after linking your WhatsApp"
                )}
              </p>
            </div>

            <div className="flex gap-3">
              <Button
                data-testid="button-test-session"
                onClick={testSessionId}
                disabled={isTesting || !sessionId.trim() || !phoneCheckResult || phoneCheckResult.registered || isCheckingPhone}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  "Test Session"
                )}
              </Button>

              <Button
                data-testid="button-register-bot"
                onClick={registerBot}
                disabled={isRegistering || !sessionId.trim() || !botName.trim() || !phoneNumber.trim() || !phoneCheckResult || phoneCheckResult.registered || isCheckingPhone}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {isRegistering ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Registering...
                  </>
                ) : (offerStatus as any)?.isActive ? (
                  <>
                    <Gift className="mr-2 h-4 w-4" />
                    Auto-Approve & Register
                  </>
                ) : (
                  "Register Bot"
                )}
              </Button>
            </div>

            {testResult && (
              <Alert
                data-testid="alert-test-result"
                className={testResult.success ? "bg-green-900/20 border-green-700" : "bg-red-900/20 border-red-700"}
              >
                <div className="flex items-start gap-2">
                  {testResult.success ? (
                    <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
                  )}
                  <AlertDescription className={testResult.success ? "text-green-200" : "text-red-200"}>
                    {testResult.success ? (
                      <div>
                        <p className="font-semibold">
                          {testResult.registered ? (testResult.autoApproved ? "🎉 Bot Auto-Approved!" : "Bot Registered!") : "✅ Session Valid!"}
                        </p>
                        {testResult.data?.phoneNumber && (
                          <p className="text-sm mt-1">Phone: {testResult.data.phoneNumber}</p>
                        )}
                        {testResult.data?.messageSent && !testResult.registered && (
                          <p className="text-sm mt-1 text-green-600">
                            📱 Validation message sent to WhatsApp!
                          </p>
                        )}
                        {testResult.registered && (
                          <p className="text-sm mt-1">
                            Status: {testResult.autoApproved ? "✅ APPROVED & ACTIVE (Promotional Offer)" : "Pending Admin Approval"}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div>
                        <p className="font-semibold">Error</p>
                        <p className="text-sm mt-1">{testResult.error}</p>
                      </div>
                    )}
                  </AlertDescription>
                </div>
              </Alert>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gray-800 border-gray-700">
          <CardHeader>
            <CardTitle className="text-white">Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-gray-300 text-sm">
            <ol className="list-decimal list-inside space-y-2">
              <li>Enter your phone number (auto-checks availability)</li>
              <li>Paste your session ID (with or without TREKKER~ prefix)</li>
              <li>Click "Test Session" to validate the credentials</li>
              <li>If valid, click "Register Bot" to add it to the system</li>
              {(offerStatus as any)?.isActive ? (
                <li className="text-green-400 font-semibold">🎁 Promotional offer active - Your bot will be AUTO-APPROVED instantly!</li>
              ) : (
                <li>Wait for admin approval to activate your bot</li>
              )}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}