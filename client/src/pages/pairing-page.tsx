import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { ArrowLeft, Loader2, Download, Copy, CheckCircle, ArrowRight } from "lucide-react";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PairingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sessionData, setSessionData] = useState<{
    sessionId: string;
    pairingCode: string;
    phoneNumber: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleIframeLoad = () => {
    setIsLoading(false);
    setLoadError(false);
  };

  const handleIframeError = () => {
    setIsLoading(false);
    setLoadError(true);
  };

  const handleRetry = () => {
    setIsLoading(true);
    setLoadError(false);
    const iframe = document.querySelector('iframe[data-testid="iframe-pairing"]') as HTMLIFrameElement;
    if (iframe) {
      iframe.src = iframe.src;
    }
  };

  // Listen for messages from iframe (pair.html)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Verify origin for security
      if (event.origin !== window.location.origin) return;

      if (event.data.type === 'PAIRING_SUCCESS') {
        console.log('Pairing success received:', event.data);
        setSessionData({
          sessionId: event.data.sessionId,
          pairingCode: event.data.pairingCode || '',
          phoneNumber: event.data.phoneNumber || ''
        });

        toast({
          title: "Pairing Successful!",
          description: "Your session ID is ready. You can now download or copy it.",
        });

        // Auto-save to localStorage for registration flow
        if (event.data.sessionId && event.data.phoneNumber) {
          localStorage.setItem('autoRegisterSessionId', event.data.sessionId);
          localStorage.setItem('autoRegisterPhoneNumber', event.data.phoneNumber);
          localStorage.setItem('autoRegisterFlow', 'true');
          localStorage.setItem('autoRegisterTimestamp', new Date().toISOString());
          console.log('Auto-register data saved to localStorage');
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [toast]);

  const handleCopySessionId = async () => {
    if (!sessionData?.sessionId) return;

    try {
      await navigator.clipboard.writeText(sessionData.sessionId);
      setCopied(true);
      toast({
        title: "Copied!",
        description: "Session ID copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Please copy manually",
        variant: "destructive",
      });
    }
  };

  const handleDownloadSessionId = () => {
    if (!sessionData?.sessionId) return;

    try {
      const blob = new Blob([sessionData.sessionId], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `trekker-session-${sessionData.phoneNumber || 'credentials'}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Downloaded!",
        description: "Session ID file saved successfully",
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: "Please try copying manually",
        variant: "destructive",
      });
    }
  };

  const handleCopy = async () => {
    if (!sessionData?.sessionId) {
      toast({
        title: "No Session ID",
        description: "No session data available to copy",
        variant: "destructive"
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(sessionData.sessionId);
      setCopied(true);
      toast({
        title: "✅ Copied Successfully!",
        description: "Session ID copied to clipboard. You can now paste it during bot registration.",
      });
      setTimeout(() => setCopied(false), 3000);
    } catch (error) {
      console.error('Copy error:', error);
      toast({
        title: "Copy Failed",
        description: "Please select and copy the session ID manually",
        variant: "destructive"
      });
    }
  };

  const handleDownloadCreds = () => {
    if (!sessionData?.sessionId) {
      toast({
        title: "No Session Data",
        description: "No session credentials available to download",
        variant: "destructive"
      });
      return;
    }

    try {
      let sessionId = sessionData.sessionId;

      // Remove TREKKER~ prefix if present
      if (sessionId.startsWith('TREKKER~')) {
        console.log('Removing TREKKER~ prefix from session ID');
        sessionId = sessionId.substring(8);
      }

      console.log('Decoding session ID...');
      const decoded = atob(sessionId);
      const credsData = JSON.parse(decoded);

      console.log('Creating download file...');
      // Create blob and download
      const blob = new Blob([JSON.stringify(credsData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `creds_${sessionData.phoneNumber || 'whatsapp_session'}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "✅ Download Complete!",
        description: `creds.json file saved successfully. Use this file to register your bot.`,
      });
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: "Download Failed",
        description: `Failed to generate creds.json: ${error instanceof Error ? error.message : 'Invalid session format'}`,
        variant: "destructive"
      });
    }
  };

  const handleProceedToRegistration = () => {
    // Navigate to registration with auto-fill
    setLocation('/?openRegistration=true');
  };

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-gray-950 via-gray-900 to-emerald-950">
      {/* Header with back button */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-gray-900/80 border-b border-emerald-500/20 px-4 sm:px-6 py-4 shadow-lg shadow-emerald-500/5">
        <div className="flex items-center gap-4">
          <Button
            onClick={() => setLocation("/")}
            variant="ghost"
            className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
            data-testid="button-back-dashboard"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Dashboard
          </Button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 via-green-400 to-teal-400 bg-clip-text text-transparent">
              TREKKER-MD Pairing
            </h2>
            <p className="text-sm text-gray-400">Generate your WhatsApp session credentials</p>
          </div>
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/50 z-30">
          <div className="text-center">
            <Loader2 className="w-12 h-12 animate-spin text-emerald-400 mx-auto mb-4" />
            <p className="text-gray-300 text-lg">Loading Pairing Interface...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {loadError && !isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/50 z-30">
          <div className="text-center">
            <div className="text-red-400 text-xl mb-4">Failed to load pairing interface</div>
            <Button
              onClick={handleRetry}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* Session ID Display (overlay when available) */}
      {sessionData && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/95 backdrop-blur-sm z-50 p-4">
          <Card className="w-full max-w-3xl bg-gradient-to-br from-gray-800 to-gray-900 border-2 border-emerald-500/50 shadow-2xl shadow-emerald-500/20">
            <CardHeader className="border-b border-emerald-500/30 bg-gradient-to-r from-emerald-900/30 to-green-900/30">
              <CardTitle className="text-3xl text-center text-emerald-400 flex items-center justify-center gap-3">
                <CheckCircle className="w-10 h-10 animate-pulse" />
                Pairing Successful! 🎉
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-8 space-y-6">
              <div className="text-center space-y-3 bg-emerald-500/10 p-4 rounded-lg border border-emerald-500/30">
                <p className="text-gray-200 text-lg font-medium">
                  ✅ Your WhatsApp Session ID is ready!
                </p>
                <p className="text-gray-400 text-sm">
                  Save it securely for bot registration. You can download as JSON or copy the session ID.
                </p>
                {sessionData.phoneNumber && (
                  <p className="text-sm text-gray-300 mt-2">
                    📱 Phone: <span className="text-emerald-400 font-mono font-bold">{sessionData.phoneNumber}</span>
                  </p>
                )}
              </div>

              <div className="bg-gray-900/50 border-2 border-gray-700 rounded-lg p-5 shadow-inner">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-gray-300 uppercase tracking-wide">📋 Session ID</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleCopySessionId}
                    className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/20"
                  >
                    {copied ? (
                      <>
                        <CheckCircle className="w-4 h-4 mr-1" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-1" />
                        Quick Copy
                      </>
                    )}
                  </Button>
                </div>
                <div className="bg-gray-950 border border-emerald-500/20 rounded-md p-4 max-h-48 overflow-y-auto scrollbar-thin scrollbar-thumb-emerald-500 scrollbar-track-gray-800">
                  <code className="text-xs text-emerald-400 font-mono break-all leading-relaxed">
                    {sessionData.sessionId}
                  </code>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Button
                    onClick={handleCopy}
                    className="w-full bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-700 hover:to-green-700 text-white font-semibold shadow-lg shadow-emerald-500/30"
                    size="lg"
                  >
                    {copied ? (
                      <>
                        <CheckCircle className="mr-2 h-5 w-5" />
                        Copied to Clipboard!
                      </>
                    ) : (
                      <>
                        <Copy className="mr-2 h-5 w-5" />
                        Copy Session ID
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handleDownloadCreds}
                    variant="outline"
                    className="w-full border-2 border-emerald-500 text-emerald-400 hover:bg-emerald-500/20 font-semibold shadow-lg shadow-emerald-500/20"
                    size="lg"
                  >
                    <Download className="mr-2 h-5 w-5" />
                    Download creds.json
                  </Button>
                </div>
                
                <Button
                  onClick={() => {
                    // Save to localStorage for auto-fill
                    if (sessionData.sessionId && sessionData.phoneNumber) {
                      localStorage.setItem('autoRegisterSessionId', sessionData.sessionId);
                      localStorage.setItem('autoRegisterPhoneNumber', sessionData.phoneNumber);
                      localStorage.setItem('autoRegisterFlow', 'true');
                      localStorage.setItem('autoRegisterTimestamp', new Date().toISOString());
                    }
                    setLocation('/?openRegistration=true');
                  }}
                  variant="default"
                  className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold shadow-lg shadow-blue-500/30"
                  size="lg"
                >
                  Continue to Bot Registration
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>

              <div className="text-center pt-4 border-t border-gray-700">
                <Button
                  onClick={() => {
                    f(null);
                    setLocation("/");
                  }}
                  variant="outline"
                  className="border-gray-600 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Iframe container */}
      <div className="flex-1 relative">
        <iframe
          src="/pair/pair.html"
          className="absolute inset-0 w-full h-full border-0"
          title="TREKKER-MD Pairing Interface"
          data-testid="iframe-pairing"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
      </div>
    </div>
  );
}