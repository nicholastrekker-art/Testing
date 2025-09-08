import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertCommandSchema } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { z } from "zod";

const formSchema = insertCommandSchema;
type FormData = z.infer<typeof formSchema>;

export default function Commands() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedBotFilter, setSelectedBotFilter] = useState<string>("all");

  const { data: commands = [], isLoading: commandsLoading } = useQuery({
    queryKey: ["/api/commands"],
  });

  const { data: botInstances = [] } = useQuery({
    queryKey: ["/api/bot-instances"],
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      response: "",
      isActive: true,
      useChatGPT: false,
      botInstanceId: null,
    },
  });

  const createCommandMutation = useMutation({
    mutationFn: (data: FormData) => apiRequest("POST", "/api/commands", data),
    onSuccess: () => {
      toast({ title: "Command created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/commands"] });
      form.reset();
      setShowAddModal(false);
    },
    onError: (error) => {
      toast({ 
        title: "Failed to create command", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    },
  });

  const toggleCommandMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => 
      apiRequest("PATCH", `/api/commands/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commands"] });
    },
  });

  const syncCommandsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/commands/sync"),
    onSuccess: (data: any) => {
      toast({ 
        title: "Commands synced successfully", 
        description: `${data.addedCount} new commands added`
      });
      queryClient.invalidateQueries({ queryKey: ["/api/commands"] });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to sync commands", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    },
  });

  const deleteCommandMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/commands/${id}`),
    onSuccess: () => {
      toast({ title: "Command deleted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/commands"] });
    },
    onError: () => {
      toast({ title: "Failed to delete command", variant: "destructive" });
    },
  });

  const onSubmit = (data: FormData) => {
    createCommandMutation.mutate(data);
  };

  const filteredCommands = (commands as any[]).filter((command: any) => {
    if (selectedBotFilter === "all") return true;
    if (selectedBotFilter === "global") return !command.botInstanceId;
    return command.botInstanceId === selectedBotFilter;
  });

  return (
    <div>
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Commands</h2>
            <p className="text-muted-foreground">Manage bot commands with prefix (.)</p>
          </div>
          <div className="flex items-center space-x-4">
            <Select value={selectedBotFilter} onValueChange={setSelectedBotFilter}>
              <SelectTrigger className="w-48 bg-input border-border text-foreground" data-testid="select-bot-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="all">All Commands</SelectItem>
                <SelectItem value="global">Global Commands</SelectItem>
                {(botInstances as any[]).map((bot: any) => (
                  <SelectItem key={bot.id} value={bot.id}>{bot.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Button 
              onClick={() => syncCommandsMutation.mutate()} 
              disabled={syncCommandsMutation.isPending}
              variant="outline" 
              className="bg-secondary text-secondary-foreground hover:bg-secondary/90" 
              data-testid="button-sync-commands"
            >
              <i className="fas fa-sync mr-2"></i>
              {syncCommandsMutation.isPending ? "Syncing..." : "Sync Commands"}
            </Button>
            
            <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
              <DialogTrigger asChild>
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90" data-testid="button-add-command">
                  <i className="fas fa-plus mr-2"></i>
                  Add Command
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border max-w-2xl" data-testid="modal-add-command">
                <DialogHeader>
                  <DialogTitle className="text-lg font-semibold text-foreground">Add New Command</DialogTitle>
                </DialogHeader>
                
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="command-name">Command Name</Label>
                      <Input
                        id="command-name"
                        placeholder="help, status, info..."
                        {...form.register("name")}
                        data-testid="input-command-name"
                      />
                      {form.formState.errors.name && (
                        <p className="text-sm text-destructive mt-1">{form.formState.errors.name.message}</p>
                      )}
                    </div>
                    
                    <div>
                      <Label htmlFor="bot-instance">Bot Instance</Label>
                      <Select value={form.watch("botInstanceId") || ""} onValueChange={(value) => form.setValue("botInstanceId", value || null)}>
                        <SelectTrigger data-testid="select-command-bot">
                          <SelectValue placeholder="Global command" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">Global command</SelectItem>
                          {(botInstances as any[]).map((bot: any) => (
                            <SelectItem key={bot.id} value={bot.id}>{bot.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="description">Description</Label>
                    <Input
                      id="description"
                      placeholder="What does this command do?"
                      {...form.register("description")}
                      data-testid="input-command-description"
                    />
                    {form.formState.errors.description && (
                      <p className="text-sm text-destructive mt-1">{form.formState.errors.description.message}</p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="response">Response</Label>
                    <Textarea
                      id="response"
                      placeholder="Static response text (leave empty if using ChatGPT)"
                      {...form.register("response")}
                      rows={3}
                      data-testid="textarea-command-response"
                    />
                  </div>

                  <div className="flex items-center space-x-6">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="use-chatgpt"
                        checked={form.watch("useChatGPT") || false}
                        onCheckedChange={(checked) => form.setValue("useChatGPT", checked as boolean)}
                        data-testid="checkbox-use-chatgpt"
                      />
                      <Label htmlFor="use-chatgpt">Use ChatGPT</Label>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="is-active"
                        checked={form.watch("isActive") || false}
                        onCheckedChange={(checked) => form.setValue("isActive", checked as boolean)}
                        data-testid="checkbox-command-active"
                      />
                      <Label htmlFor="is-active">Active</Label>
                    </div>
                  </div>

                  <div className="flex justify-end space-x-3 pt-4">
                    <Button type="button" variant="ghost" onClick={() => setShowAddModal(false)} data-testid="button-cancel-command">
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={createCommandMutation.isPending}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                      data-testid="button-save-command"
                    >
                      {createCommandMutation.isPending ? "Creating..." : "Create Command"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <div className="p-6">
        {commandsLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="mt-4 text-muted-foreground">Loading commands...</p>
          </div>
        ) : filteredCommands.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-terminal text-muted-foreground text-2xl"></i>
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No Commands Found</h3>
            <p className="text-muted-foreground mb-6">Create your first command to get started</p>
            <Button 
              onClick={() => setShowAddModal(true)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              data-testid="button-create-first-command"
            >
              Create Your First Command
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCommands.map((command: any) => (
              <Card key={command.id} className="bg-card border-border" data-testid={`command-card-${command.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <code className="bg-primary/10 text-primary px-2 py-1 rounded text-sm font-mono">
                        .{command.name}
                      </code>
                      {command.useChatGPT && (
                        <span className="bg-purple-500/10 text-purple-400 px-2 py-1 rounded text-xs">
                          <i className="fas fa-brain mr-1"></i>GPT
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => toggleCommandMutation.mutate({ id: command.id, isActive: !command.isActive })}
                        className={`w-8 h-4 rounded-full flex items-center px-1 ${command.isActive ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}
                        data-testid={`toggle-command-${command.id}`}
                      >
                        <div className={`w-2 h-2 rounded-full ${command.isActive ? 'bg-white' : 'bg-muted-foreground'}`}></div>
                      </button>
                      <button
                        onClick={() => deleteCommandMutation.mutate(command.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        data-testid={`button-delete-command-${command.id}`}
                      >
                        <i className="fas fa-trash text-sm"></i>
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-foreground mb-3" data-testid={`command-description-${command.id}`}>
                    {command.description}
                  </p>
                  {command.response && (
                    <div className="bg-muted/50 rounded-md p-3">
                      <p className="text-xs text-muted-foreground mb-1">Response:</p>
                      <p className="text-sm text-foreground" data-testid={`command-response-${command.id}`}>
                        {command.response.length > 100 ? `${command.response.substring(0, 100)}...` : command.response}
                      </p>
                    </div>
                  )}
                  {command.botInstanceId && (
                    <div className="mt-3">
                      <span className="text-xs text-muted-foreground">
                        Bot: {(botInstances as any[]).find((bot: any) => bot.id === command.botInstanceId)?.name || 'Unknown'}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
