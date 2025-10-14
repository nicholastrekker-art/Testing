import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AdminBotManagementProps {
  open: boolean;
  onClose: () => void;
}

// Assuming GodRegistryEntry and related states/mutations are defined elsewhere or not relevant to the provided snippet.
// For the purpose of this fix, we'll focus on the dialog structure.
// If these were present, they would be integrated here.
// const [showGodRegistry, setShowGodRegistry] = useState(false);
// const [godRegistry, setGodRegistry] = useState([]);
// const { data: godRegistry = [], isLoading: registryLoading } = useQuery(...);
// const [editingRegistration, setEditingRegistration] = useState<any>(null);

export default function AdminBotManagement({ open, onClose }: AdminBotManagementProps) {
  const [activeTab, setActiveTab] = useState<"pending" | "approved">("pending");
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [selectedBot, setSelectedBot] = useState<any>(null);
  const [approvalDuration, setApprovalDuration] = useState<string>("3");
  const [adminMessage, setAdminMessage] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const queryClient = useQueryClient();

  // Mock states and functions for God Registry Management to make the code runnable
  const [showGodRegistry, setShowGodRegistry] = useState(false);
  const [godRegistry, setGodRegistry] = useState([]); // Assuming this would be populated by a query
  const registryLoading = false; // Assuming this would be from a query
  const [editingRegistration, setEditingRegistration] = useState<any>(null); // Assuming this would be for editing

  // Fetch pending bots
  const { data: pendingBots = [], isLoading: pendingLoading } = useQuery({
    queryKey: ["/api/bots/pending"],
    enabled: open && activeTab === "pending"
  });

  // Fetch approved bots
  const { data: approvedBots = [], isLoading: approvedLoading } = useQuery({
    queryKey: ["/api/bots/approved"],
    enabled: open && activeTab === "approved"
  });

  // Approve bot mutation
  const approveMutation = useMutation({
    mutationFn: async ({ botId, duration }: { botId: string; duration: number }) => {
      const response = await apiRequest("POST", `/api/bots/${botId}/approve`, { expirationMonths: duration });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots/approved"] });
      setShowApprovalModal(false);
      setSelectedBot(null);
    }
  });

  // Reject bot mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ botId, reason }: { botId: string; reason: string }) => {
      const response = await apiRequest("POST", `/api/bots/${botId}/reject`, { reason });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots/pending"] });
      setRejectionReason("");
    }
  });

  // Send message mutation
  const messageMutation = useMutation({
    mutationFn: async ({ botId, message }: { botId: string; message: string }) => {
      const response = await apiRequest("POST", `/api/admin/send-message/${botId}`, { message });
      return response.json();
    },
    onSuccess: () => {
      setShowMessageModal(false);
      setAdminMessage("");
      setSelectedBot(null);
    }
  });

  const handleApprove = (bot: any) => {
    setSelectedBot(bot);
    setShowApprovalModal(true);
  };

  const confirmApproval = () => {
    if (selectedBot && approvalDuration) {
      approveMutation.mutate({
        botId: selectedBot.id,
        duration: parseInt(approvalDuration)
      });
    }
  };

  const handleReject = (bot: any, reason: string) => {
    rejectMutation.mutate({ botId: bot.id, reason });
  };

  const handleSendMessage = (bot: any) => {
    setSelectedBot(bot);
    setShowMessageModal(true);
  };

  const confirmSendMessage = () => {
    if (selectedBot && adminMessage.trim()) {
      messageMutation.mutate({
        botId: selectedBot.id,
        message: adminMessage
      });
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const calculateExpirationDate = (approvalDate: string, months: number) => {
    const date = new Date(approvalDate);
    date.setMonth(date.getMonth() + months);
    return date.toLocaleDateString();
  };

  const isExpiringSoon = (approvalDate: string, months: number) => {
    const expirationDate = new Date(approvalDate);
    expirationDate.setMonth(expirationDate.getMonth() + months);
    const daysUntilExpiry = (expirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return daysUntilExpiry <= 7; // Expires within 7 days
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">🔧 Admin Bot Management</DialogTitle>
          </DialogHeader>

          {/* Tab Navigation */}
          <div className="flex space-x-1 bg-muted/30 p-1 rounded-lg mb-6">
            <button
              onClick={() => setActiveTab("pending")}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === "pending"
                  ? "bg-blue-600 text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              🔄 Pending Bots ({(pendingBots as any[]).length})
            </button>
            <button
              onClick={() => setActiveTab("approved")}
              className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === "approved"
                  ? "bg-green-600 text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              ✅ Approved Bots ({(approvedBots as any[]).length})
            </button>
          </div>

          {/* Pending Bots Tab */}
          {activeTab === "pending" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Pending Bot Registrations</h3>
              {pendingLoading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              ) : (pendingBots as any[]).length === 0 ? (
                <Card>
                  <CardContent className="text-center py-8">
                    <p className="text-muted-foreground">No pending bot registrations</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {(pendingBots as any[]).map((bot: any) => (
                    <Card key={bot.id} className="border-orange-200">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                              <i className="fas fa-clock text-orange-600"></i>
                            </div>
                            <div>
                              <h4 className="font-medium">{bot.name}</h4>
                              <p className="text-sm text-muted-foreground">
                                📱 {bot.phoneNumber || "No phone number"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Registered: {formatDate(bot.createdAt)}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge variant="secondary" className="text-orange-600 bg-orange-100">
                              Pending
                            </Badge>
                            <div className="flex space-x-2">
                              <Button
                                size="sm"
                                onClick={() => handleApprove(bot)}
                                className="bg-green-600 hover:bg-green-700 text-white"
                              >
                                <i className="fas fa-check mr-1"></i>
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const reason = prompt("Rejection reason:");
                                  if (reason) handleReject(bot, reason);
                                }}
                                className="text-red-600 border-red-600 hover:bg-red-50"
                              >
                                <i className="fas fa-times mr-1"></i>
                                Reject
                              </Button>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Approved Bots Tab */}
          {activeTab === "approved" && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Approved & Active Bots</h3>
              {approvedLoading ? (
                <div className="text-center py-8">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                </div>
              ) : (approvedBots as any[]).length === 0 ? (
                <Card>
                  <CardContent className="text-center py-8">
                    <p className="text-muted-foreground">No approved bots yet</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4">
                  {(approvedBots as any[]).map((bot: any) => (
                    <Card key={bot.id} className="border-green-200">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                              <i className="fas fa-check-circle text-green-600"></i>
                            </div>
                            <div>
                              <h4 className="font-medium">{bot.name}</h4>
                              <p className="text-sm text-muted-foreground">
                                📱 {bot.phoneNumber || "No phone number"}
                              </p>
                              <div className="flex items-center space-x-4 text-xs text-muted-foreground mt-1">
                                <span>✅ Approved: {formatDate(bot.approvalDate)}</span>
                                <span>⏰ Expires: {calculateExpirationDate(bot.approvalDate, bot.expirationMonths)}</span>
                                <span>📅 Duration: {bot.expirationMonths} months</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            <Badge
                              variant={bot.status === 'online' ? 'default' : 'secondary'}
                              className={
                                bot.status === 'online' ? 'bg-green-600 text-white' :
                                'text-gray-600 bg-gray-100'
                              }
                            >
                              {bot.status === 'online' ? '🟢 Online' : '⚪ Offline'}
                            </Badge>
                            {isExpiringSoon(bot.approvalDate, bot.expirationMonths) && (
                              <Badge variant="destructive" className="text-red-600 bg-red-100">
                                ⚠️ Expiring Soon
                              </Badge>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleSendMessage(bot)}
                              className="text-blue-600 border-blue-600 hover:bg-blue-50"
                            >
                              <i className="fas fa-message mr-1"></i>
                              Message
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Approval Modal */}
      <Dialog open={showApprovalModal} onOpenChange={setShowApprovalModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>✅ Approve Bot Registration</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Bot Name</Label>
              <p className="font-medium">{selectedBot?.name}</p>
            </div>
            <div>
              <Label>Phone Number</Label>
              <p className="font-medium">{selectedBot?.phoneNumber}</p>
            </div>
            <div>
              <Label htmlFor="duration">Approval Duration *</Label>
              <Select value={approvalDuration} onValueChange={setApprovalDuration}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 Month</SelectItem>
                  <SelectItem value="2">2 Months</SelectItem>
                  <SelectItem value="3">3 Months</SelectItem>
                  <SelectItem value="6">6 Months</SelectItem>
                  <SelectItem value="12">12 Months</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Bot will expire and return to pending after this duration
              </p>
            </div>
            <div className="flex space-x-2">
              <Button
                onClick={confirmApproval}
                disabled={approveMutation.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                {approveMutation.isPending ? "Approving..." : "Approve Bot"}
              </Button>
              <Button variant="outline" onClick={() => setShowApprovalModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Message Modal */}
      <Dialog open={showMessageModal} onOpenChange={setShowMessageModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>📱 Send Message to Bot User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Bot</Label>
              <p className="font-medium">{selectedBot?.name} ({selectedBot?.phoneNumber})</p>
            </div>
            <div>
              <Label htmlFor="message">Message *</Label>
              <Textarea
                id="message"
                value={adminMessage}
                onChange={(e) => setAdminMessage(e.target.value)}
                placeholder="Enter your message to the bot user..."
                rows={4}
              />
            </div>
            <div className="flex space-x-2">
              <Button
                onClick={confirmSendMessage}
                disabled={messageMutation.isPending || !adminMessage.trim()}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {messageMutation.isPending ? "Sending..." : "Send Message"}
              </Button>
              <Button variant="outline" onClick={() => setShowMessageModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* God Registry Management Modal */}
      {showGodRegistry && (
        <Dialog open={showGodRegistry} onOpenChange={setShowGodRegistry}>
          <DialogContent className="max-w-4xl max-h-[90vh] bg-gray-900 border-gray-700 flex flex-col">
            <DialogHeader>
              <DialogTitle className="text-white">📱 God Registry Management</DialogTitle>
              <DialogDescription className="text-gray-400">
                Manage global phone number registrations across all tenants
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 overflow-y-auto flex-1 pr-2">
              {registryLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : godRegistry.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  No registrations found
                </div>
              ) : (
                <div className="space-y-2">
                  {(godRegistry as any[]).map((registration: any) => (
                    <div key={registration.phoneNumber} className="border border-gray-700 rounded-lg p-4 bg-gray-800/50">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-white">
                            📱 {registration.phoneNumber}
                          </p>
                          <p className="text-sm text-gray-400">
                            Tenant: {registration.tenancyName}
                          </p>
                          <p className="text-xs text-gray-500">
                            Registered: {new Date(registration.registeredAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingRegistration(registration)}
                          className="text-blue-400 border-blue-400 hover:bg-blue-900/20"
                        >
                          <i className="fas fa-edit mr-1"></i>
                          Edit
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-700">
              <Button onClick={() => setShowGodRegistry(false)} className="bg-emerald-600 hover:bg-emerald-700">
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}