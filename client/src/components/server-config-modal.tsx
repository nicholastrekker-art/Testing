import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Loader2, Server, AlertTriangle, ChevronDown, Search, Database } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ServerInfo {
  name: string;
  totalBots: number;
  currentBots: number;
  remainingBots: number;
  description: string | null;
  status: string;
}

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
  const [selectedServer, setSelectedServer] = useState(currentServerName || "");
  const [description, setDescription] = useState("");
  const [isComboboxOpen, setIsComboboxOpen] = useState(false);

  // Fetch all available servers with bot counts
  const { data: serverList = [], isLoading: isLoadingServers } = useQuery<ServerInfo[]>({
    queryKey: ["/api/servers/list"],
    enabled: open && !hasSecretConfig, // Only fetch when modal is open and not using secrets
  });

  const configureServerMutation = useMutation({
    mutationFn: async (data: { serverName: string; description?: string }) => {
      const response = await apiRequest("POST", "/api/server/configure", data);
      return await response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Server configured successfully",
        description: "Your server name has been saved.",
      });
      
      // If server context switched, refresh entire application
      if (data && data.requiresRefresh) {
        toast({
          title: "Server context switched",
          description: "Refreshing to load new server data...",
        });
        // Invalidate all queries and refresh the page to load new server context
        queryClient.clear();
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        // Just refresh server info for description updates
        queryClient.invalidateQueries({ queryKey: ["/api/server/info"] });
      }
      
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
    if (!selectedServer.trim()) {
      toast({
        title: "Server required",
        description: "Please select a server",
        variant: "destructive",
      });
      return;
    }
    configureServerMutation.mutate({
      serverName: selectedServer.trim(),
      description: description.trim() || undefined,
    });
  };

  // Get selected server info for display
  const selectedServerInfo = serverList.find(server => server.name === selectedServer);

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
              <Label data-testid="label-server-name">
                Select Server *
              </Label>
              
              {isLoadingServers ? (
                <div className="flex items-center justify-center p-4 border rounded-md">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm text-muted-foreground">Loading servers...</span>
                </div>
              ) : (
                <Popover open={isComboboxOpen} onOpenChange={setIsComboboxOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={isComboboxOpen}
                      className="w-full justify-between"
                      disabled={configureServerMutation.isPending}
                      data-testid="button-server-select"
                    >
                      {selectedServer ? (
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4" />
                          <span>{selectedServer}</span>
                          {selectedServerInfo && (
                            <Badge variant="secondary" className="ml-auto">
                              {selectedServerInfo.currentBots}/{selectedServerInfo.totalBots}
                            </Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Select a server...</span>
                      )}
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command>
                      <CommandInput 
                        placeholder="Search servers..." 
                        className="h-9"
                      />
                      <CommandEmpty>No servers found.</CommandEmpty>
                      <CommandList className="max-h-[200px]">
                        <CommandGroup>
                          {serverList.map((server) => (
                            <CommandItem
                              key={server.name}
                              value={server.name}
                              onSelect={() => {
                                setSelectedServer(server.name);
                                setIsComboboxOpen(false);
                              }}
                              className="flex items-center justify-between"
                              data-testid={`option-${server.name}`}
                            >
                              <div className="flex items-center gap-2">
                                <Database className="h-4 w-4" />
                                <span>{server.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge 
                                  variant={server.currentBots === 0 ? "secondary" : 
                                          server.remainingBots === 0 ? "destructive" : "default"}
                                  className="text-xs"
                                >
                                  {server.currentBots}/{server.totalBots}
                                </Badge>
                                {server.remainingBots > 0 && (
                                  <span className="text-xs text-green-600">
                                    {server.remainingBots} free
                                  </span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
              
              {selectedServerInfo && (
                <div className="text-sm text-muted-foreground p-2 bg-muted rounded">
                  <div className="flex items-center justify-between">
                    <span>Bot Usage: {selectedServerInfo.currentBots}/{selectedServerInfo.totalBots}</span>
                    <span className={selectedServerInfo.remainingBots > 0 ? "text-green-600" : "text-red-600"}>
                      {selectedServerInfo.remainingBots} slots available
                    </span>
                  </div>
                </div>
              )}
              
              <p className="text-sm text-muted-foreground">
                Choose from Server1 to Server100. Servers with fewer bots are shown first.
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
                disabled={configureServerMutation.isPending || !selectedServer.trim()}
                data-testid="button-save-config"
              >
                {configureServerMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Switch to {selectedServer}
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