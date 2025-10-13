import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function PairingPage() {
  const [, setLocation] = useLocation();

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

      {/* Iframe container */}
      <div className="flex-1 relative">
        <iframe
          src="/pairing/pair"
          className="absolute inset-0 w-full h-full border-0"
          title="TREKKER-MD Pairing Interface"
          data-testid="iframe-pairing"
        />
      </div>
    </div>
  );
}
