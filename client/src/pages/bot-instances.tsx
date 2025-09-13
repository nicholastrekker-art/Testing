import { useQuery } from "@tanstack/react-query";
import BotCard from "@/components/bot-card";
import AddBotModal from "@/components/add-bot-modal";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useWebSocket } from "@/hooks/use-websocket";

export default function BotInstances() {
  const [showAddBotModal, setShowAddBotModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'approved'>('pending');

  // Separate queries for pending and approved bots (preload both for accurate badge counts)
  const { data: pendingBots = [], isLoading: pendingLoading } = useQuery({
    queryKey: ["/api/bots/pending"]
  });

  const { data: approvedBots = [], isLoading: approvedLoading } = useQuery({
    queryKey: ["/api/bots/approved"]
  });

  // Type cast to arrays for safe usage
  const pendingBotsArray = (pendingBots as any[]) || [];
  const approvedBotsArray = (approvedBots as any[]) || [];

  useWebSocket();

  const isLoading = activeTab === 'pending' ? pendingLoading : approvedLoading;
  const currentBots = activeTab === 'pending' ? pendingBots : approvedBots;

  return (
    <div>
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Bot Management Dashboard</h2>
            <p className="text-muted-foreground">Manage bot instances based on their approval status</p>
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
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'pending' | 'approved')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pending" className="relative" data-testid="tab-pending">
              <span className="flex items-center gap-2">
                ⏳ Pending Approval
                {pendingBotsArray.length > 0 && (
                  <Badge variant="secondary" className="ml-1 bg-yellow-100 text-yellow-800">
                    {pendingBotsArray.length}
                  </Badge>
                )}
              </span>
            </TabsTrigger>
            <TabsTrigger value="approved" className="relative" data-testid="tab-approved">
              <span className="flex items-center gap-2">
                ✅ Approved Bots
                {approvedBotsArray.length > 0 && (
                  <Badge variant="secondary" className="ml-1 bg-green-100 text-green-800">
                    {approvedBotsArray.length}
                  </Badge>
                )}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-foreground">Pending Bot Approvals</h3>
              <p className="text-sm text-muted-foreground">
                These bots are awaiting admin approval. Limited functionality is available until approved.
              </p>
            </div>
            
            {pendingLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {[...Array(3)].map((_, i) => (
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
                    </div>
                  </div>
                ))}
              </div>
            ) : pendingBotsArray.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4">
                  <i className="fas fa-clock text-muted-foreground text-2xl"></i>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">No Pending Approvals</h3>
                <p className="text-muted-foreground mb-6">All bots have been reviewed. Create a new bot to get started.</p>
                <Button 
                  onClick={() => setShowAddBotModal(true)}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="button-create-first-pending-bot"
                >
                  Add New Bot
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {pendingBotsArray.map((bot: any) => (
                  <BotCard key={bot.id} bot={{...bot, approvalStatus: 'pending'}} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="approved" className="mt-6">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-foreground">Approved Bots</h3>
              <p className="text-sm text-muted-foreground">
                These bots have been approved and have full functionality available.
              </p>
            </div>
            
            {approvedLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {[...Array(3)].map((_, i) => (
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
                    </div>
                  </div>
                ))}
              </div>
            ) : approvedBotsArray.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4">
                  <i className="fas fa-check-circle text-muted-foreground text-2xl"></i>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">No Approved Bots</h3>
                <p className="text-muted-foreground mb-6">Approve pending bots or create new ones to get started.</p>
                <Button 
                  onClick={() => setActiveTab('pending')}
                  variant="outline"
                  className="mr-2"
                  data-testid="button-view-pending"
                >
                  View Pending
                </Button>
                <Button 
                  onClick={() => setShowAddBotModal(true)}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="button-create-first-approved-bot"
                >
                  Add New Bot
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                {approvedBotsArray.map((bot: any) => (
                  <BotCard key={bot.id} bot={{...bot, approvalStatus: 'approved'}} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <AddBotModal open={showAddBotModal} onClose={() => setShowAddBotModal(false)} />
    </div>
  );
}
