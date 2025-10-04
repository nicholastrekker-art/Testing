import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Gift, Clock, Calendar, Settings } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface OfferConfig {
  id: string;
  isActive: boolean;
  durationType: string;
  durationValue: number;
  startDate: string;
  endDate: string;
}

interface OfferStatus {
  isActive: boolean;
  config: OfferConfig | null;
  timeRemaining: number | null;
}

export function OfferManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [durationType, setDurationType] = useState<string>("days");
  const [durationValue, setDurationValue] = useState<string>("7");

  const { data: offerStatus, isLoading } = useQuery<OfferStatus>({
    queryKey: ["/api/offer/status"],
    refetchInterval: 10000,
  });

  const updateOfferMutation = useMutation({
    mutationFn: async (data: { durationType?: string; durationValue?: number; isActive?: boolean }) => {
      const response = await fetch("/api/offer/configure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("auth_token")}`,
        },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error("Failed to update offer");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offer/status"] });
      toast({ 
        title: "Offer updated successfully", 
        description: "The promotional offer settings have been updated." 
      });
    },
    onError: () => {
      toast({ 
        title: "Failed to update offer", 
        variant: "destructive" 
      });
    },
  });

  const handleActivateOffer = () => {
    const value = parseInt(durationValue);
    if (isNaN(value) || value <= 0) {
      toast({
        title: "Invalid duration",
        description: "Please enter a valid duration value",
        variant: "destructive",
      });
      return;
    }

    updateOfferMutation.mutate({
      durationType,
      durationValue: value,
      isActive: true,
    });
  };

  const handleDeactivateOffer = () => {
    updateOfferMutation.mutate({ isActive: false });
  };

  const formatTimeRemaining = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const envOfferEnabled = process.env.OFFER?.toLowerCase() === 'true';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-6 w-6 text-yellow-500" data-testid="icon-gift-header" />
            Promotional Offer Management
          </CardTitle>
          <CardDescription>
            Configure auto-approval offers for bot registrations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Environment Variable Status */}
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-blue-800 dark:text-blue-200" data-testid="text-env-status">
                  Environment Variable: OFFER
                </p>
                <p className="text-sm text-blue-700 dark:text-blue-300" data-testid="text-env-value">
                  Current Value: {envOfferEnabled ? "true" : "false"}
                </p>
              </div>
              <Badge 
                variant={envOfferEnabled ? "default" : "outline"}
                className={envOfferEnabled ? "bg-green-500" : ""}
                data-testid="badge-env-status"
              >
                {envOfferEnabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
            {!envOfferEnabled && (
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-2" data-testid="text-env-warning">
                ⚠️ Set OFFER=true in environment variables to enable promotional offers
              </p>
            )}
          </div>

          {/* Current Offer Status */}
          {offerStatus?.config && (
            <div className={`p-4 rounded-lg border ${
              offerStatus.isActive 
                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                : "bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800"
            }`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Clock className={`h-5 w-5 ${offerStatus.isActive ? "text-green-600 animate-pulse" : "text-gray-500"}`} data-testid="icon-clock-status" />
                  <p className="font-medium" data-testid="text-offer-status-title">
                    Offer Status: {offerStatus.isActive ? "Active" : "Inactive"}
                  </p>
                </div>
                <Badge 
                  variant={offerStatus.isActive ? "default" : "outline"}
                  className={offerStatus.isActive ? "bg-green-500" : ""}
                  data-testid="badge-offer-status"
                >
                  {offerStatus.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div data-testid="text-offer-duration">
                  <p className="text-muted-foreground">Duration:</p>
                  <p className="font-medium">{offerStatus.config.durationValue} {offerStatus.config.durationType}</p>
                </div>
                <div data-testid="text-offer-start">
                  <p className="text-muted-foreground">Start Date:</p>
                  <p className="font-medium">{formatDate(offerStatus.config.startDate)}</p>
                </div>
                <div data-testid="text-offer-end">
                  <p className="text-muted-foreground">End Date:</p>
                  <p className="font-medium">{formatDate(offerStatus.config.endDate)}</p>
                </div>
                {offerStatus.timeRemaining && (
                  <div data-testid="text-offer-remaining">
                    <p className="text-muted-foreground">Time Remaining:</p>
                    <p className="font-medium text-orange-600">{formatTimeRemaining(offerStatus.timeRemaining)}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Offer Configuration */}
          <div className="space-y-4">
            <h3 className="font-medium flex items-center gap-2" data-testid="text-config-title">
              <Settings className="h-5 w-5" />
              Configure New Offer
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="duration-type" data-testid="label-duration-type">Duration Type</Label>
                <Select value={durationType} onValueChange={setDurationType}>
                  <SelectTrigger id="duration-type" data-testid="select-duration-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="days" data-testid="option-days">Days</SelectItem>
                    <SelectItem value="months" data-testid="option-months">Months</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="duration-value" data-testid="label-duration-value">Duration Value</Label>
                <Input
                  id="duration-value"
                  type="number"
                  min="1"
                  value={durationValue}
                  onChange={(e) => setDurationValue(e.target.value)}
                  placeholder="Enter duration"
                  data-testid="input-duration-value"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleActivateOffer}
                disabled={!envOfferEnabled || updateOfferMutation.isPending || offerStatus?.isActive}
                className="flex-1"
                data-testid="button-activate-offer"
              >
                {updateOfferMutation.isPending ? "Activating..." : "Activate Offer"}
              </Button>

              {offerStatus?.isActive && (
                <Button
                  variant="outline"
                  onClick={handleDeactivateOffer}
                  disabled={updateOfferMutation.isPending}
                  className="flex-1"
                  data-testid="button-deactivate-offer"
                >
                  {updateOfferMutation.isPending ? "Deactivating..." : "Deactivate Offer"}
                </Button>
              )}
            </div>

            <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg border border-yellow-200 dark:border-yellow-800">
              <p className="text-sm text-yellow-800 dark:text-yellow-200" data-testid="text-auto-approval-info">
                <strong>Auto-Approval:</strong> When an offer is active, all bot registrations will be automatically approved and placed in the selected server's approved bots list. Bots will auto-start on server restart.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
