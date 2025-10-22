import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useState } from "react";

export default function PairingPage() {
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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
    // Force iframe reload by changing the key
    const iframe = document.querySelector('iframe[data-testid="iframe-pairing"]') as HTMLIFrameElement;
    if (iframe) {
      iframe.src = iframe.src;
    }
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
