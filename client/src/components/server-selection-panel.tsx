import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Users, CheckCircle } from "lucide-react";

interface ServerSelectionPanelProps {
  open: boolean;
  onClose: () => void;
  currentServerFull?: boolean;
  onServerSelected?: (serverName: string) => void;
}

interface AlternativeServer {
  name: string;
  botCount: number;
  capacity: string;
  availableSlots: number;
  isFull: boolean;
}

interface ServerInfoResponse {
  currentServer: {
    name: string;
    capacity: string;
    isFull: boolean;
  };
  alternativeServers: AlternativeServer[];
}

export default function ServerSelectionPanel({ 
  open, 
  onClose, 
  currentServerFull = false,
  onServerSelected 
}: ServerSelectionPanelProps) {
  const { toast } = useToast();
  
  // Fetch alternative servers when current server is full
  const { data: serverInfo, isLoading } = useQuery<ServerInfoResponse>({
    queryKey: ['/api/guest/alternative-servers'],
    enabled: open && currentServerFull
  });

  const handleServerSelect = (serverName: string) => {
    // Generate server URL based on server name
    const serverUrl = `https://${serverName.toLowerCase()}.your-domain.com`; // You can customize this pattern
    
    toast({
      title: "Server Selected",
      description: `Redirecting to ${serverName} server...`,
    });

    if (onServerSelected) {
      onServerSelected(serverName);
    }
    
    // Open in new tab to redirect to the selected server
    window.open(serverUrl, '_blank');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2">
            🚀 Choose Alternative Server
          </DialogTitle>
        </DialogHeader>

        {currentServerFull && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <h4 className="font-medium text-red-800 mb-2">⚠️ Current Server Full</h4>
            <p className="text-sm text-red-700">
              {serverInfo?.currentServer?.name || 'This server'} is at full capacity 
              ({serverInfo?.currentServer?.capacity || '?/?'}). 
              Please choose an alternative server below to deploy your bot.
            </p>
          </div>
        )}

        <div className="space-y-4">
          <div className="text-center">
            <h3 className="text-lg font-medium mb-2">Available Servers</h3>
            <p className="text-sm text-muted-foreground">
              Choose from the available TREKKER-MD bot deployment servers
            </p>
          </div>

          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
              <p className="mt-2 text-sm text-muted-foreground">Loading available servers...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(serverInfo?.alternativeServers?.length || 0) > 0 ? (
                (serverInfo?.alternativeServers || []).map((server: AlternativeServer) => (
                  <Card key={server.name} className="hover:shadow-md transition-shadow cursor-pointer border-2 hover:border-blue-300">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          🖥️ {server.name}
                          <Badge variant="outline" className="text-green-600 border-green-600">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Available
                          </Badge>
                        </div>
                      </CardTitle>
                      <CardDescription>
                        TREKKER-MD Bot Server
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-sm">Capacity:</span>
                          <Badge variant="secondary" className="bg-green-100 text-green-800">
                            {server.capacity}
                          </Badge>
                        </div>
                        
                        <div className="flex justify-between items-center">
                          <span className="text-sm">Available Slots:</span>
                          <span className="font-medium text-green-600">
                            <Users className="w-4 h-4 inline mr-1" />
                            {server.availableSlots}
                          </span>
                        </div>
                        
                        <Button
                          className="w-full mt-4"
                          onClick={() => handleServerSelect(server.name)}
                          data-testid={`button-select-server-${server.name}`}
                        >
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Deploy on {server.name}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <div className="col-span-full text-center py-8">
                  <p className="text-muted-foreground mb-4">
                    No alternative servers available at the moment.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Please try again later or contact support.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-medium text-blue-800 mb-2">💡 How Server Selection Works:</h4>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• Each server (SERVER1, SERVER2, etc.) has a capacity limit</li>
              <li>• When one server is full, you can deploy on alternative servers</li>
              <li>• Your bot data and credentials are isolated per server</li>
              <li>• Each server provides the same TREKKER-MD features and capabilities</li>
              <li>• You'll be redirected to the selected server to complete registration</li>
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}