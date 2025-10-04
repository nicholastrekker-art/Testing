import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift, Clock, X } from "lucide-react";

interface OfferStatus {
  isActive: boolean;
  config: {
    durationType: string;
    durationValue: number;
    startDate: string;
    endDate: string;
  } | null;
  timeRemaining: number | null;
}

export function OfferCountdownBanner() {
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const { data: offerStatus, isError, error } = useQuery<OfferStatus>({
    queryKey: ["/api/offer/status"],
    refetchInterval: 10000, // Refresh every 10 seconds
    retry: 3,
    staleTime: 5000,
  });

  // Debug logging for troubleshooting
  useEffect(() => {
    if (offerStatus) {
      console.log('Offer Status Data:', {
        isActive: offerStatus.isActive,
        timeRemaining: offerStatus.timeRemaining,
        config: offerStatus.config
      });
    }
    if (isError) {
      console.error('Offer Status Error:', error);
    }
  }, [offerStatus, isError, error]);

  useEffect(() => {
    if (offerStatus?.isActive && offerStatus?.timeRemaining && offerStatus.timeRemaining > 0) {
      setTimeRemaining(offerStatus.timeRemaining);

      // Update countdown every second
      const interval = setInterval(() => {
        setTimeRemaining((prev) => {
          if (!prev || prev <= 1000) {
            return null;
          }
          return prev - 1000;
        });
      }, 1000);

      return () => clearInterval(interval);
    } else {
      if (offerStatus?.isActive === false || (offerStatus?.timeRemaining !== undefined && offerStatus.timeRemaining <= 0)) {
        setTimeRemaining(null);
      }
    }
  }, [offerStatus]);

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    } else {
      return `${seconds}s`;
    }
  };

  if (!offerStatus?.isActive || !timeRemaining || dismissed) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-yellow-50 via-orange-50 to-yellow-50 dark:from-yellow-900/20 dark:via-orange-900/20 dark:to-yellow-900/20 border-l-4 border-orange-500 p-4 mb-6 rounded-lg shadow-lg relative" data-testid="banner-offer-countdown">
      <button 
        onClick={() => setDismissed(true)}
        className="absolute top-2 right-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        aria-label="Dismiss"
      >
        <X className="h-5 w-5" />
      </button>
      
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Gift className="h-6 w-6 text-yellow-600 dark:text-yellow-400 animate-bounce" data-testid="icon-gift" />
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100" data-testid="text-offer-title">
              🎁 Limited Time Offer - Auto-Approval Active!
            </h3>
            <p className="text-xs text-gray-700 dark:text-gray-300" data-testid="text-offer-description">
              Register your bot now for instant approval and activation!
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-center bg-white dark:bg-gray-800 rounded-lg px-3 py-1.5 border border-orange-200 dark:border-orange-800 shadow-md">
            <Clock className="h-4 w-4 text-orange-500 animate-pulse mx-auto mb-0.5" data-testid="icon-clock" />
            <p className="text-[10px] text-gray-600 dark:text-gray-400 mb-0.5">Time Remaining</p>
            <p className="text-sm font-bold text-orange-600 dark:text-orange-400" data-testid="text-countdown">
              {formatTime(timeRemaining)}
            </p>
          </div>

          <div className="hidden md:block text-xs text-gray-700 dark:text-gray-300">
            <p className="font-semibold mb-0.5 text-[11px]">✨ Benefits:</p>
            <ul className="space-y-0.5 text-[10px]">
              <li>✅ Instant approval</li>
              <li>✅ Auto-activation</li>
              <li>✅ Premium features</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
