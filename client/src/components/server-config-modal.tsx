import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Server, AlertTriangle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ServerConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentServerName: string;
  hasSecretConfig: boolean;
}

export default function ServerConfigModal({ 
  open, 
  onOpenChange, 
  currentServerName, 
  hasSecretConfig 
}: ServerConfigModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [serverName, setServerName] = useState(currentServerName || "");
  const [description, setDescription] = useState("");

  const configureServerMutation = useMutation({
    mutationFn: async (data: { serverName: string; description?: string }) => {
      return apiRequest("/api/server/configure", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: () => {
      toast({
        title: "Server configured successfully",
        description: "Your server name has been saved.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/server/info"] });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: "Configuration failed",
        description: error.message || "Failed to configure server",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverName.trim()) {
      toast({
        title: "Server name required",
        description: "Please enter a server name",
        variant: "destructive",
      });
      return;
    }
    configureServerMutation.mutate({
      serverName: serverName.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]" data-testid="dialog-server-config">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Server Configuration
          </DialogTitle>
          <DialogDescription>
            Configure your server name and description. This will be used to identify this server instance.
          </DialogDescription>
        </DialogHeader>

        {hasSecretConfig && (
          <Alert data-testid="alert-secret-configured">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Server name is configured via environment secrets (SERVER_NAME) and cannot be changed through the UI.
            </AlertDescription>
          </Alert>
        )}

        {!hasSecretConfig && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="serverName" data-testid="label-server-name">
                Server Name *
              </Label>
              <Input
                id="serverName"
                data-testid="input-server-name"
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                placeholder="e.g., SERVER1, PRODUCTION, TESTING"
                disabled={configureServerMutation.isPending}
                required
              />
              <p className="text-sm text-muted-foreground">
                Choose a unique name to identify this server instance.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" data-testid="label-description">
                Description (Optional)
              </Label>
              <Textarea
                id="description"
                data-testid="textarea-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the purpose of this server..."
                disabled={configureServerMutation.isPending}
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={configureServerMutation.isPending}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={configureServerMutation.isPending || !serverName.trim()}
                data-testid="button-save-config"
              >
                {configureServerMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save Configuration
              </Button>
            </div>
          </form>
        )}

        {hasSecretConfig && (
          <div className="flex justify-end">
            <Button
              onClick={() => onOpenChange(false)}
              data-testid="button-close"
            >
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}