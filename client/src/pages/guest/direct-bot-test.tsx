import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, XCircle, Bot } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export default function DirectBotTestPage() {
  const { toast } = useToast();
  const [botName, setBotName] = useState("Trekker Bot");
  const [phoneNumber, setPhoneNumber] = useState("254704897825");
  const [sessionId, setSessionId] = useState("");
  const [isTesting, setIsTesting] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  const testSessionId = async () => {
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
        body: JSON.stringify({ credentials: sessionId.trim() }),
      });

      const data = await response.json();

      if (response.ok) {
        setTestResult({ success: true, data });
        toast({
          title: "Session Validated!",
          description: `Phone: ${data.phoneNumber || 'Unknown'}`,
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
    if (!sessionId.trim() || !botName.trim() || !phoneNumber.trim()) {
      toast({
        title: "Missing Information",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    setIsRegistering(true);

    try {
      const response = await fetch('/api/guest/register-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botName,
          phoneNumber: phoneNumber.replace(/[\s\-\(\)\+]/g, ''),
          credentialType: 'base64',
          sessionId: sessionId.trim(),
          features: {
            autoView: true,
            typingMode: 'typing',
            presenceMode: 'always_online',
            intervalSeconds: 30,
            chatGPT: false
          }
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: "Bot Registered Successfully!",
          description: `${botName} is now registered and pending approval`,
        });
        setSessionId("");
        setTestResult({ success: true, registered: true, data });
      } else {
        toast({
          title: "Registration Failed",
          description: data.error || 'Failed to register bot',
          variant: "destructive",
        });
        setTestResult({ success: false, error: data.error });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
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
              <Label htmlFor="input-phone-number" className="text-gray-200">Phone Number</Label>
              <Input
                id="input-phone-number"
                data-testid="input-phone-number"
                placeholder="254704897825"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="bg-gray-700 border-gray-600 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="textarea-session-id" className="text-gray-200">Session ID (Base64 with TREKKER~ prefix)</Label>
              <Textarea
                id="textarea-session-id"
                data-testid="textarea-session-id"
                placeholder="TREKKER~eyJub2lzZUtleSI6eyJwcml2YXRlIjp7InR5cGUiOiJCdWZ..."
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="bg-gray-700 border-gray-600 text-white min-h-[120px] font-mono text-sm"
              />
            </div>

            <div className="flex gap-3">
              <Button
                data-testid="button-test-session"
                onClick={testSessionId}
                disabled={isTesting || !sessionId.trim()}
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
                disabled={isRegistering || !sessionId.trim() || !botName.trim() || !phoneNumber.trim()}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {isRegistering ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Registering...
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
                          {testResult.registered ? "Bot Registered!" : "Session Valid!"}
                        </p>
                        {testResult.data?.phoneNumber && (
                          <p className="text-sm mt-1">Phone: {testResult.data.phoneNumber}</p>
                        )}
                        {testResult.registered && (
                          <p className="text-sm mt-1">Status: Pending Admin Approval</p>
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
              <li>Paste your session ID (with or without TREKKER~ prefix)</li>
              <li>Click "Test Session" to validate the credentials</li>
              <li>If valid, click "Register Bot" to add it to the system</li>
              <li>Wait for admin approval to activate your bot</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
