import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export function useWebSocket() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectingRef = useRef<boolean>(false);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionAttemptsRef = useRef<number>(0);
  const lastDisconnectTimeRef = useRef<number>(0);

  useEffect(() => {
    const connect = () => {
      connectionAttemptsRef.current++;

      // Prevent multiple connection attempts
      if (isConnectingRef.current || (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING)) {
        console.log("⏸️ WebSocket connection already in progress, skipping...", {
          isConnecting: isConnectingRef.current,
          currentReadyState: wsRef.current?.readyState,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Close existing connection if any
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log("🔄 Closing existing WebSocket connection");
        wsRef.current.close();
      }

      isConnectingRef.current = true;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      console.log("🔌 Attempting to connect to WebSocket:", {
        url: wsUrl,
        protocol,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        connectionType: (navigator as any).connection?.effectiveType || 'unknown'
      });

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("🟢 WebSocket connected successfully", {
          url: wsUrl,
          readyState: ws.readyState,
          protocol: ws.protocol,
          timestamp: new Date().toISOString(),
          connectionAttempt: connectionAttemptsRef.current
        });
        isConnectingRef.current = false;
        connectionAttemptsRef.current = 0; // Reset on successful connection

        // Clear any pending reconnection attempts
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
          console.log("🔄 Cleared pending reconnection timeout");
        }

        // Start heartbeat to keep connection alive
        heartbeatIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            console.log("💓 Sending heartbeat ping");
            ws.send(JSON.stringify({ type: 'ping' }));
          } else {
            console.warn("❌ Cannot send heartbeat - WebSocket not in OPEN state:", ws.readyState);
          }
        }, 30000); // Send ping every 30 seconds
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      ws.onclose = (event) => {
        const closeReasons = {
          1000: 'Normal Closure',
          1001: 'Going Away',
          1002: 'Protocol Error',
          1003: 'Unsupported Data',
          1005: 'No Status Received',
          1006: 'Abnormal Closure',
          1007: 'Invalid frame payload data',
          1008: 'Policy Violation',
          1009: 'Message too big',
          1010: 'Missing Extension',
          1011: 'Internal Error',
          1012: 'Service Restart',
          1013: 'Try Again Later',
          1014: 'Bad Gateway',
          1015: 'TLS Handshake'
        };

        const now = Date.now();
        const timeSinceLastDisconnect = now - lastDisconnectTimeRef.current;
        lastDisconnectTimeRef.current = now;

        console.log("🔴 WebSocket disconnected", {
          code: event.code,
          reason: event.reason || closeReasons[event.code] || 'Unknown',
          wasClean: event.wasClean,
          timestamp: new Date().toISOString(),
          readyState: ws.readyState,
          url: wsUrl,
          timeSinceLastDisconnect: timeSinceLastDisconnect + 'ms',
          connectionAttempts: connectionAttemptsRef.current,
          networkOnline: navigator.onLine
        });

        // Check for frequent disconnections
        if (timeSinceLastDisconnect < 10000) {
          console.warn("⚠️ Frequent disconnections detected! Time since last:", timeSinceLastDisconnect + 'ms');
        }

        isConnectingRef.current = false;

        // Clear heartbeat
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
          console.log("💓 Heartbeat cleared");
        }

        // Only reconnect if it wasn't a clean close and we're not intentionally disconnecting
        if (!event.wasClean && event.code !== 1000 && event.code !== 1001) {
          console.log("🔄 Scheduling reconnection in 3 seconds...", {
            code: event.code,
            reason: closeReasons[event.code] || 'Unknown'
          });
          reconnectTimeoutRef.current = setTimeout(connect, 3000);
        } else {
          console.log("✅ Clean disconnect - not reconnecting");
        }
      };

      ws.onerror = (error) => {
        console.error("❌ WebSocket error occurred:", {
          error,
          readyState: ws.readyState,
          readyStateText: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState],
          url: wsUrl,
          timestamp: new Date().toISOString()
        });

        // Close the connection to trigger reconnection logic
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          console.log("🔧 Forcing WebSocket close due to error");
          ws.close();
        }
      };

      const handleOnline = () => {
        console.log("🌐 Network status changed: Online. Attempting to reconnect WebSocket.");
        connect();
      };

      const handleOffline = () => {
        console.warn("🌐 Network status changed: Offline. WebSocket will attempt to reconnect when online.");
        // Optionally clear reconnection timeout to avoid rapid retries when offline
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        // If the WebSocket is open, close it to trigger the onerror/onclose logic which will handle the offline state.
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close(1001, 'Client is going offline'); // 1001 indicates going away
        }
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
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
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounting');
      }
    };
  }, [queryClient, toast]);

  return wsRef.current;
}