import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export function useWebSocket() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    };

    const handleWebSocketMessage = (data: any) => {
      switch (data.type) {
        case 'BOT_CREATED':
        case 'BOT_UPDATED':
        case 'BOT_DELETED':
        case 'BOT_STATUS_CHANGED':
          queryClient.invalidateQueries({ queryKey: ["/api/bot-instances"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
          break;
          
        case 'COMMAND_CREATED':
        case 'COMMAND_UPDATED':
        case 'COMMAND_DELETED':
          queryClient.invalidateQueries({ queryKey: ["/api/commands"] });
          break;
          
        case 'ACTIVITY_CREATED':
          queryClient.invalidateQueries({ queryKey: ["/api/activities"] });
          break;
          
        case 'BOT_ERROR':
          toast({
            title: "Bot Error",
            description: data.message || "A bot encountered an error",
            variant: "destructive",
          });
          break;
          
        case 'BOT_CONNECTED':
          toast({
            title: "Bot Connected",
            description: `${data.botName} is now online`,
          });
          break;
          
        default:
          console.log("Unknown WebSocket message type:", data.type);
      }
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [queryClient, toast]);

  return wsRef.current;
}
