import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Gift, Clock } from "lucide-react";

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

export function OfferCountdownDialog() {
  const [open, setOpen] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);

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
      setOpen(true);

      // Update countdown every second
      const interval = setInterval(() => {
        setTimeRemaining((prev) => {
          if (!prev || prev <= 1000) {
            setOpen(false);
            return null;
          }
          return prev - 1000;
        });
      }, 1000);

      return () => clearInterval(interval);
    } else {
      // Only close if we're sure there's no active offer
      if (offerStatus?.isActive === false || (offerStatus?.timeRemaining !== undefined && offerStatus.timeRemaining <= 0)) {
        setOpen(false);
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

  if (!offerStatus?.isActive || !timeRemaining) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-offer-countdown">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Gift className="h-6 w-6 text-yellow-500" data-testid="icon-gift" />
            <span className="bg-gradient-to-r from-yellow-500 to-orange-500 bg-clip-text text-transparent">
              🎁 Limited Time Offer!
            </span>
          </DialogTitle>
          <DialogDescription className="text-base">
            Register your bot now to get instant approval!
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 p-6 rounded-lg border border-yellow-200 dark:border-yellow-800">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Clock className="h-8 w-8 text-orange-500 animate-pulse" data-testid="icon-clock" />
              <h3 className="text-3xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-countdown">
                {formatTime(timeRemaining)}
              </h3>
            </div>
            
            <div className="text-center space-y-2">
              <p className="text-lg font-semibold text-gray-800 dark:text-gray-200" data-testid="text-offer-title">
                🚀 Auto-Approval Active!
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-400" data-testid="text-offer-description">
                All bot registrations will be automatically approved and activated instantly during this promotional period.
              </p>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
            <h4 className="font-semibold text-blue-800 dark:text-blue-200 mb-2" data-testid="text-benefits-title">
              ✨ What You Get:
            </h4>
            <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
              <li data-testid="text-benefit-1">✅ Instant bot approval - no waiting!</li>
              <li data-testid="text-benefit-2">✅ Immediate activation and access</li>
              <li data-testid="text-benefit-3">✅ All premium features enabled</li>
              <li data-testid="text-benefit-4">✅ Lifetime bot access</li>
            </ul>
          </div>

          <div className="text-center">
            <p className="text-xs text-muted-foreground" data-testid="text-hurry">
              ⏰ Hurry! Offer ends in {formatTime(timeRemaining)}
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
