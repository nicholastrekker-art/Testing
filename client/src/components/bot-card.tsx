import { Card, CardContent } from "@/components/ui/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface BotCardProps {
  bot: {
    id: string;
    name: string;
    phoneNumber?: string;
    status: string;
    autoLike: boolean;
    autoViewStatus: boolean;
    autoReact: boolean;
    messagesCount: number;
    commandsCount: number;
  };
}

export default function BotCard({ bot }: BotCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin, token } = useAuth();

  const startBotMutation = useMutation({
    mutationFn: () => {
      if (!isAdmin) {
        throw new Error("Admin access required");
      }
      return fetch(`/api/bot-instances/${bot.id}/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }).then(res => {
        if (!res.ok) throw new Error('Failed to start bot');
        return res.json();
      });
    },
    onSuccess: () => {
      toast({ title: "Bot started successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances"] });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to start bot", 
        description: error.message.includes("Admin") ? "Admin access required" : "Server error",
        variant: "destructive" 
      });
    },
  });

  const stopBotMutation = useMutation({
    mutationFn: () => {
      if (!isAdmin) {
        throw new Error("Admin access required");
      }
      return fetch(`/api/bot-instances/${bot.id}/stop`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }).then(res => {
        if (!res.ok) throw new Error('Failed to stop bot');
        return res.json();
      });
    },
    onSuccess: () => {
      toast({ title: "Bot stopped successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances"] });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to stop bot", 
        description: error.message.includes("Admin") ? "Admin access required" : "Server error",
        variant: "destructive" 
      });
    },
  });

  const restartBotMutation = useMutation({
    mutationFn: () => {
      if (!isAdmin) {
        throw new Error("Admin access required");
      }
      return fetch(`/api/bot-instances/${bot.id}/restart`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }).then(res => {
        if (!res.ok) throw new Error('Failed to restart bot');
        return res.json();
      });
    },
    onSuccess: () => {
      toast({ title: "Bot restarted successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/bot-instances"] });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to restart bot", 
        description: error.message.includes("Admin") ? "Admin access required" : "Server error",
        variant: "destructive" 
      });
    },
  });

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'online': return 'status-online';
      case 'offline': return 'status-offline';
      case 'error': return 'status-error';
      case 'loading': return 'status-loading';
      default: return 'status-offline';
    }
  };

  const getActionButton = () => {
    if (!isAdmin) {
      return (
        <button
          disabled
          className="flex-1 bg-muted text-muted-foreground py-2 px-3 rounded-md text-sm cursor-not-allowed"
          title="Admin access required"
        >
          🔒 Admin Only
        </button>
      );
    }
    
    if (bot.status === 'online') {
      return (
        <button
          onClick={() => stopBotMutation.mutate()}
          disabled={stopBotMutation.isPending}
          className="flex-1 bg-red-600 text-white py-2 px-3 rounded-md text-sm hover:bg-red-700 transition-colors disabled:opacity-50"
          data-testid={`button-stop-bot-${bot.id}`}
        >
          {stopBotMutation.isPending ? 'Stopping...' : 'Stop'}
        </button>
      );
    } else if (bot.status === 'error') {
      return (
        <button
          onClick={() => restartBotMutation.mutate()}
          disabled={restartBotMutation.isPending}
          className="flex-1 bg-destructive text-destructive-foreground py-2 px-3 rounded-md text-sm hover:bg-destructive/90 transition-colors disabled:opacity-50"
          data-testid={`button-restart-bot-${bot.id}`}
        >
          {restartBotMutation.isPending ? 'Restarting...' : 'Restart'}
        </button>
      );
    } else {
      return (
        <button
          onClick={() => startBotMutation.mutate()}
          disabled={startBotMutation.isPending}
          className="flex-1 bg-green-600 text-white py-2 px-3 rounded-md text-sm hover:bg-green-700 transition-colors disabled:opacity-50"
          data-testid={`button-start-bot-${bot.id}`}
        >
          {startBotMutation.isPending ? 'Starting...' : 'Start'}
        </button>
      );
    }
  };

  return (
    <Card className="bg-card border-border" data-testid={`bot-card-${bot.id}`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
              bot.status === 'online' ? 'bg-primary' : 
              bot.status === 'error' ? 'bg-yellow-500/20' : 'bg-muted'
            }`}>
              <i className={`fab fa-whatsapp text-xl ${
                bot.status === 'online' ? 'text-primary-foreground' :
                bot.status === 'error' ? 'text-yellow-400 pulse-animation' : 'text-muted-foreground'
              }`}></i>
            </div>
            <div>
              <h3 className="font-semibold text-foreground" data-testid={`bot-name-${bot.id}`}>{bot.name}</h3>
              <p className="text-sm text-muted-foreground" data-testid={`bot-phone-${bot.id}`}>
                {bot.phoneNumber || 'Not connected'}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span className={`px-2 py-1 rounded-full text-xs border ${getStatusClass(bot.status)}`} data-testid={`bot-status-${bot.id}`}>
              {bot.status.charAt(0).toUpperCase() + bot.status.slice(1)}
            </span>
            <button className="w-8 h-8 bg-muted rounded-md flex items-center justify-center hover:bg-muted/80" data-testid={`button-bot-menu-${bot.id}`}>
              <i className="fas fa-ellipsis-v text-muted-foreground"></i>
            </button>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Auto Like</span>
            <div className={`w-10 h-5 rounded-full flex items-center px-1 ${bot.autoLike ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}>
              <div className={`w-3 h-3 rounded-full ${bot.autoLike ? 'bg-white' : 'bg-muted-foreground'}`}></div>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Auto View Status</span>
            <div className={`w-10 h-5 rounded-full flex items-center px-1 ${bot.autoViewStatus ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}>
              <div className={`w-3 h-3 rounded-full ${bot.autoViewStatus ? 'bg-white' : 'bg-muted-foreground'}`}></div>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Auto React</span>
            <div className={`w-10 h-5 rounded-full flex items-center px-1 ${bot.autoReact ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}>
              <div className={`w-3 h-3 rounded-full ${bot.autoReact ? 'bg-white' : 'bg-muted-foreground'}`}></div>
            </div>
          </div>
        </div>

        {bot.status === 'error' && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 mb-4">
            <p className="text-sm text-destructive">Connection timeout - attempting restart</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="text-center">
            <p className="text-lg font-semibold text-foreground" data-testid={`bot-messages-${bot.id}`}>{bot.messagesCount}</p>
            <p className="text-xs text-muted-foreground">Messages</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-foreground" data-testid={`bot-commands-${bot.id}`}>{bot.commandsCount}</p>
            <p className="text-xs text-muted-foreground">Commands</p>
          </div>
        </div>

        <div className="flex space-x-2">
          {getActionButton()}
          <button className="bg-muted text-muted-foreground py-2 px-3 rounded-md text-sm hover:bg-muted/80 transition-colors" data-testid={`button-analytics-${bot.id}`}>
            <i className="fas fa-chart-line"></i>
          </button>
          <button className="bg-muted text-muted-foreground py-2 px-3 rounded-md text-sm hover:bg-muted/80 transition-colors" data-testid={`button-settings-${bot.id}`}>
            <i className="fas fa-cog"></i>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
