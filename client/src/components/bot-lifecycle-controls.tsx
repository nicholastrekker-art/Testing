import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {  Play, Square, RotateCw, MoreVertical, ArrowLeftCircle } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface BotLifecycleControlsProps {
  botId: string;
  botName: string;
  botStatus: string;
  approvalStatus: string;
  tenancy: string;
  variant?: "compact" | "full";
}

export function BotLifecycleControls({
  botId,
  botName,
  botStatus,
  approvalStatus,
  tenancy,
  variant = "full"
}: BotLifecycleControlsProps) {
  const { toast } = useToast();
  const [showReturnToPendingDialog, setShowReturnToPendingDialog] = useState(false);

  const isOnline = botStatus === "online";
  const isApproved = approvalStatus === "approved";

  const startMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/master/bot-action", {
        action: "start",
        botId,
        tenancy
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots/approved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bot-instances"] });
      toast({
        title: "Bot started",
        description: `${botName} is starting up`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to start bot",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/master/bot-action", {
        action: "stop",
        botId,
        tenancy
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots/approved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bot-instances"] });
      toast({
        title: "Bot stopped",
        description: `${botName} has been stopped`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to stop bot",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const restartMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/master/bot-action", {
        action: "restart",
        botId,
        tenancy
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots/approved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bot-instances"] });
      toast({
        title: "Bot restarting",
        description: `${botName} is restarting`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to restart bot",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const returnToPendingMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/master/bot-action", {
        action: "return-to-pending",
        botId,
        tenancy
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots/approved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bot-instances"] });
      toast({
        title: "Bot returned to pending",
        description: `${botName} has been returned to pending status`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to return bot to pending",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const handleReturnToPending = () => {
    returnToPendingMutation.mutate();
    setShowReturnToPendingDialog(false);
  };

  if (variant === "compact") {
    return (
      <>
        <div className="flex items-center gap-1">
          {!isOnline && isApproved && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              data-testid={`button-start-${botId}`}
            >
              <Play className="w-3 h-3" />
            </Button>
          )}
          {isOnline && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              data-testid={`button-stop-${botId}`}
            >
              <Square className="w-3 h-3" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                data-testid={`button-more-${botId}`}
              >
                <MoreVertical className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isOnline && (
                <DropdownMenuItem
                  onClick={() => restartMutation.mutate()}
                  disabled={restartMutation.isPending}
                  data-testid={`menu-restart-${botId}`}
                >
                  <RotateCw className="w-4 h-4 mr-2" />
                  Restart
                </DropdownMenuItem>
              )}
              {isApproved && (
                <>
                  {isOnline && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onClick={() => setShowReturnToPendingDialog(true)}
                    disabled={returnToPendingMutation.isPending}
                    className="text-orange-600"
                    data-testid={`menu-return-pending-${botId}`}
                  >
                    <ArrowLeftCircle className="w-4 h-4 mr-2" />
                    Return to Pending
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <AlertDialog open={showReturnToPendingDialog} onOpenChange={setShowReturnToPendingDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Return Bot to Pending?</AlertDialogTitle>
              <AlertDialogDescription>
                This will stop the bot (if running) and return it to pending status. The bot will need to be approved again to run.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleReturnToPending}>
                Return to Pending
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {!isOnline && isApproved && (
          <Button
            size="sm"
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            data-testid={`button-start-${botId}`}
          >
            <Play className="w-4 h-4 mr-2" />
            Start
          </Button>
        )}
        {isOnline && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              data-testid={`button-stop-${botId}`}
            >
              <Square className="w-4 h-4 mr-2" />
              Stop
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => restartMutation.mutate()}
              disabled={restartMutation.isPending}
              data-testid={`button-restart-${botId}`}
            >
              <RotateCw className="w-4 h-4 mr-2" />
              Restart
            </Button>
          </>
        )}
        {isApproved && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowReturnToPendingDialog(true)}
            disabled={returnToPendingMutation.isPending}
            className="text-orange-600 border-orange-300 hover:bg-orange-50"
            data-testid={`button-return-pending-${botId}`}
          >
            <ArrowLeftCircle className="w-4 h-4 mr-2" />
            Return to Pending
          </Button>
        )}
      </div>

      <AlertDialog open={showReturnToPendingDialog} onOpenChange={setShowReturnToPendingDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Return Bot to Pending?</AlertDialogTitle>
            <AlertDialogDescription>
              This will stop the bot (if running) and return "{botName}" to pending status. 
              The bot will need to be approved again before it can run.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReturnToPending}>
              Return to Pending
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
