import { useQuery } from "@tanstack/react-query";
import BotCard from "@/components/bot-card";
import AddBotModal from "@/components/add-bot-modal";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useWebSocket } from "@/hooks/use-websocket";

export default function BotInstances() {
  const [showAddBotModal, setShowAddBotModal] = useState(false);

  const { data: botInstances = [], isLoading } = useQuery({
    queryKey: ["/api/bot-instances"],
  });

  useWebSocket();

  return (
    <div>
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Bot Instances</h2>
            <p className="text-muted-foreground">Manage all your WhatsApp bot instances</p>
          </div>
          <Button 
            onClick={() => setShowAddBotModal(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            data-testid="button-add-new-bot"
          >
            <i className="fas fa-plus mr-2"></i>
            Add New Bot
          </Button>
        </div>
      </header>

      <div className="p-6">
        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-lg p-6 animate-pulse">
                <div className="flex items-center space-x-3 mb-4">
                  <div className="w-12 h-12 bg-muted rounded-lg"></div>
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded w-24"></div>
                    <div className="h-3 bg-muted rounded w-32"></div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="h-3 bg-muted rounded"></div>
                  <div className="h-3 bg-muted rounded"></div>
                  <div className="h-3 bg-muted rounded"></div>
                </div>
              </div>
            ))}
          </div>
        ) : (botInstances as any[]).length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-robot text-muted-foreground text-2xl"></i>
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No Bot Instances</h3>
            <p className="text-muted-foreground mb-6">Get started by creating your first WhatsApp bot instance</p>
            <Button 
              onClick={() => setShowAddBotModal(true)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              data-testid="button-create-first-bot"
            >
              Create Your First Bot
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {(botInstances as any[]).map((bot: any) => (
              <BotCard key={bot.id} bot={bot} />
            ))}
          </div>
        )}
      </div>

      <AddBotModal open={showAddBotModal} onClose={() => setShowAddBotModal(false)} />
    </div>
  );
}
