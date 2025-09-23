import makeWASocket, { 
  DisconnectReason, 
  ConnectionState, 
  useMultiFileAuthState,
  WAMessage,
  BaileysEventMap
} from '@whiskeysockets/baileys';
import * as Baileys from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { storage } from '../storage';
import { generateChatGPTResponse } from './openai';
import type { BotInstance } from '@shared/schema';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { commandRegistry, type CommandContext } from './command-registry.js';
import { AutoStatusService } from './auto-status.js';
import { antideleteService } from './antidelete.js';
import { getAntiViewOnceService } from './antiviewonce.js';
import './core-commands.js'; // Load core commands

export class WhatsAppBot {
  private sock: any;
  private botInstance: BotInstance;
  private isRunning: boolean = false;
  private authDir: string;
  private reconnectAttempts: number = 0;
  private heartbeatInterval?: NodeJS.Timeout;
  private autoStatusService: AutoStatusService;
  private antiViewOnceService: any;
  private presenceInterval?: NodeJS.Timeout;
  private currentPresenceState: 'composing' | 'recording' = 'composing';

  constructor(botInstance: BotInstance) {
    this.botInstance = botInstance;
    // Each bot gets its own isolated auth directory
    this.authDir = join(process.cwd(), 'auth', `bot_${botInstance.id}`);

    // Create auth directory if it doesn't exist
    if (!existsSync(this.authDir)) {
      mkdirSync(this.authDir, { recursive: true });
    }

    // Initialize auto status service
    this.autoStatusService = new AutoStatusService(botInstance);

    // Initialize anti-viewonce service
    this.antiViewOnceService = getAntiViewOnceService(botInstance.id);

    // If credentials are provided, save them to the auth directory
    if (botInstance.credentials) {
      this.saveCredentialsToAuthDir(botInstance.credentials);
    }
  }

  private saveCredentialsToAuthDir(credentials: any) {
    try {
      console.log(`Bot ${this.botInstance.name}: Saving Baileys session credentials`);

      // Save the main creds.json file
      writeFileSync(join(this.authDir, 'creds.json'), JSON.stringify(credentials, null, 2));

      console.log(`Bot ${this.botInstance.name}: Baileys credentials saved successfully`);
    } catch (error) {
      console.error(`Bot ${this.botInstance.name}: Error saving credentials:`, error);
    }
  }

  private createLogger() {
    const loggerInstance = {
      level: 'silent',
      child: () => loggerInstance,
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {}
    };
    return loggerInstance;
  }

  private async setupEventHandlers() {
    this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      console.log(`Bot ${this.botInstance.name}: Connection update -`, { connection, qr: !!qr });

      if (qr) {
        console.log(`Bot ${this.botInstance.name}: QR Code generated`);
        await storage.updateBotInstance(this.botInstance.id, { status: 'qr_code' });
        await storage.createActivity({
          serverName: this.botInstance.serverName,
          botInstanceId: this.botInstance.id,
          type: 'qr_code',
          description: 'QR Code generated - Scan to connect WhatsApp',
          metadata: { qr }
        });
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log(`Bot ${this.botInstance.name}: Connection closed due to`, lastDisconnect?.error, ', reconnecting:', shouldReconnect);

        this.isRunning = false;
        this.stopPresenceAutoSwitch(); // Stop presence auto-switch when disconnected
        await storage.updateBotInstance(this.botInstance.id, { status: 'offline' });
        await storage.createActivity({
          serverName: this.botInstance.serverName,
          botInstanceId: this.botInstance.id,
          type: 'status_change',
          description: 'Bot disconnected'
        });

        if (shouldReconnect) {
          // Auto-reconnect with exponential backoff to prevent crash loops
          const reconnectDelay = Math.min(5000 * (this.reconnectAttempts || 1), 30000);
          this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;

          console.log(`Bot ${this.botInstance.name}: Attempting reconnect #${this.reconnectAttempts} in ${reconnectDelay}ms`);

          setTimeout(async () => {
            try {
              await this.start();
            } catch (error) {
              console.error(`Bot ${this.botInstance.name}: Reconnect attempt failed:`, error);
              await storage.createActivity({
                serverName: this.botInstance.serverName,
                botInstanceId: this.botInstance.id,
                type: 'error',
                description: `Reconnect attempt #${this.reconnectAttempts} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
              });
            }
          }, reconnectDelay);
        }
      } else if (connection === 'open') {
        console.log(`Bot ${this.botInstance.name} is ready! 🎉 WELCOME TO TREKKERMD LIFETIME BOT`);
        this.isRunning = true;
        this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection

        await storage.updateBotInstance(this.botInstance.id, { 
          status: 'online',
          lastActivity: new Date()
        });

        await storage.createActivity({
          serverName: this.botInstance.serverName,
          botInstanceId: this.botInstance.id,
          type: 'status_change',
          description: '🎉 WELCOME TO TREKKERMD LIFETIME BOT - Bot connected and ready!'
        });

        // Start presence auto-switch if configured
        this.startPresenceAutoSwitch();

        // Send welcome message to the bot owner
        try {
          const welcomeMessage = `🎉 WELCOME TO TREKKERMD LIFETIME BOT 🎉\n\nYour bot "${this.botInstance.name}" is now online and ready to serve!\n\n✨ Features activated:\n- Auto reactions and likes\n- Advanced command system (300+ commands)\n- ChatGPT AI integration\n- Group management tools\n- Real-time activity monitoring\n- PRESENCE features (auto-typing/recording)\n\nType .help to see available commands or .list for the full command list.\n\nHappy chatting! 🚀`;

          // Get the bot's own number and send welcome message
          const me = this.sock.user?.id;
          if (me) {
            await this.sock.sendMessage(me, { text: welcomeMessage });
            console.log(`TREKKERMD LIFETIME BOT: Welcome message sent to ${me}`);
          } else {
            console.log('TREKKERMD LIFETIME BOT READY:', welcomeMessage);
          }
        } catch (error) {
          console.log('Welcome message setup complete');
        }

        // Start auto view processor and fetch existing statuses
        // Start auto view processor and fetch existing statuses
        const sock = this.sock; // Capture sock in a variable for the timeout
        this.autoStatusService.startAutoViewProcessor();

        // Fetch existing statuses after connection is established
        setTimeout(async () => {
          await this.autoStatusService.fetchAllStatuses(sock);
        }, 5000); // Wait 5 seconds after connection to fetch existing statuses

      } else if (connection === 'connecting') {
        console.log(`Bot ${this.botInstance.name}: Connecting to WhatsApp...`);
        await storage.updateBotInstance(this.botInstance.id, { status: 'loading' });
        await storage.createActivity({
          serverName: this.botInstance.serverName,
          botInstanceId: this.botInstance.id,
          type: 'status_change',
          description: 'Bot connecting to WhatsApp...'
        });
      }

      // Only mark as online when connection is explicitly 'open' - not based on user.id alone
    });

    this.sock.ev.on('messages.upsert', async (m: { messages: WAMessage[], type: string }) => {
      // Only process messages if the bot is actually running and connected
      if (!this.isRunning) {
        return;
      }

      if (m.type === 'notify' || m.type === 'append') {
        // Handle auto status updates for status messages
        await this.autoStatusService.handleStatusUpdate(this.sock, m);

        for (const message of m.messages) {
          try {
            // Filter out reaction messages from console logs to reduce noise
            const isReactionMessage = message.message && message.message.reactionMessage;

            // Store message for antidelete functionality
            await antideleteService.storeMessage(message);

            // Handle Anti-ViewOnce silently - no logging
            if (this.antiViewOnceService && !isReactionMessage && message.key.fromMe) {
              const hasViewOnce = this.hasViewOnceContent(message);
              if (hasViewOnce) {
                try {
                  await this.antiViewOnceService.handleMessage(this.sock, message);
                } catch (error) {
                  // Log error to activities silently
                  await storage.createActivity({
                    serverName: this.botInstance.serverName,
                    botInstanceId: this.botInstance.id,
                    type: 'error',
                    description: `ViewOnce processing error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    metadata: { from: message.key.remoteJid }
                  });
                }
              }
            }

            // Process regular message handling
            await this.handleMessage(message);

          } catch (error) {
            console.error(`❌ [${this.botInstance.name}] Error processing message from ${message.key.remoteJid}:`, error);
          }
        }
      }
    });

    // Handle message revocation (deletion)
    this.sock.ev.on('messages.update', async (updates: { key: any; update: any }[]) => {
      for (const { key, update } of updates) {
        // Check if this is a message deletion
        if (update.message?.protocolMessage?.type === Baileys.proto.Message.ProtocolMessage.Type.REVOKE) {
          const revocationMessage = { key, message: update.message };
          await antideleteService.handleMessageRevocation(this.sock, revocationMessage);
        }
      }
    });
  }

  private hasViewOnceContent(message: WAMessage): boolean {
    if (!message.message) {
      return false;
    }

    // Check for various ViewOnce message types silently
    const checks = {
      viewOnceMessage: !!message.message.viewOnceMessage,
      viewOnceMessageV2: !!message.message.viewOnceMessageV2,
      viewOnceMessageV2Extension: !!message.message.viewOnceMessageV2Extension,
      imageMessageViewOnce: !!(message.message.imageMessage && message.message.imageMessage.hasOwnProperty('viewOnce')),
      videoMessageViewOnce: !!(message.message.videoMessage && message.message.videoMessage.hasOwnProperty('viewOnce')),
      audioMessageViewOnce: !!(message.message.audioMessage && message.message.audioMessage.hasOwnProperty('viewOnce')),
      documentMessageViewOnce: !!(message.message.documentMessage && message.message.documentMessage.hasOwnProperty('viewOnce')),
    };

    // Enhanced check for viewOnce properties (including false values)
    const hasViewOnceProperty = Object.entries(message.message).some(([key, value]) => {
      if (value && typeof value === 'object') {
        return (value as any).hasOwnProperty('viewOnce');
      }
      return false;
    });

    // Deep scan for ViewOnce indicators
    const hasDeepViewOnce = this.deepScanMessageForViewOnce(message.message);

    // Check for ephemeral messages that might contain ViewOnce
    const hasEphemeralViewOnce = !!(message.message.ephemeralMessage?.message && 
      this.hasViewOnceContent({ message: message.message.ephemeralMessage.message, key: message.key } as WAMessage));

    return !!(
      checks.viewOnceMessage ||
      checks.viewOnceMessageV2 ||
      checks.viewOnceMessageV2Extension ||
      checks.imageMessageViewOnce ||
      checks.videoMessageViewOnce ||
      checks.audioMessageViewOnce ||
      checks.documentMessageViewOnce ||
      hasViewOnceProperty ||
      hasDeepViewOnce ||
      hasEphemeralViewOnce
    );
  }

  private deepScanMessageForViewOnce(messageObj: any, depth: number = 0): boolean {
    if (depth > 5 || !messageObj) return false;

    if (typeof messageObj === 'object') {
      // Check current level for viewOnce
      if (messageObj.hasOwnProperty('viewOnce')) {
        return true;
      }

      // Check for ViewOnce-related keys
      for (const key of Object.keys(messageObj)) {
        if (key.toLowerCase().includes('viewonce') || key.toLowerCase().includes('view_once')) {
          return true;
        }

        // Recursively check nested objects
        if (messageObj[key] && typeof messageObj[key] === 'object') {
          if (this.deepScanMessageForViewOnce(messageObj[key], depth + 1)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private logMessageActivity(message: WAMessage): void {
    // Message activity logging disabled to reduce console noise
    return;
  }

  private extractMessageText(messageObj: any): string {
    if (!messageObj) return '';

    // Unwrap common message wrappers
    const inner = messageObj.ephemeralMessage?.message || 
                  messageObj.viewOnceMessage?.message || 
                  messageObj.documentWithCaptionMessage?.message || 
                  messageObj;

    // Extract text from various message types
    return inner.conversation || 
           inner.extendedTextMessage?.text || 
           inner.imageMessage?.caption || 
           inner.videoMessage?.caption || 
           inner.buttonsResponseMessage?.selectedButtonId || 
           inner.listResponseMessage?.singleSelectReply?.selectedRowId || 
           inner.templateButtonReplyMessage?.selectedId || 
           '';
  }

  private async handleMessage(message: WAMessage) {
    try {
      if (!message.message) return;

      // Log detailed message activity
      this.logMessageActivity(message);

      // Always update message count for any message
      await storage.updateBotInstance(this.botInstance.id, {
        messagesCount: (this.botInstance.messagesCount || 0) + 1,
        lastActivity: new Date()
      });

      const messageText = this.extractMessageText(message.message);

      // Get command prefix from environment variable (default: .)
      const commandPrefix = process.env.BOT_PREFIX || '.';

      // Handle commands (only respond to messages with the configured prefix)
      if (messageText && messageText.startsWith(commandPrefix)) {
        console.log(`Bot ${this.botInstance.name}: Detected command: "${messageText.trim()}"`);
        await this.handleCommand(message, messageText);
        return;
      }

      // Auto-reactions and features for non-command messages
      await this.handleAutoFeatures(message);

      // No automatic ChatGPT responses - only respond to prefix commands
      // This prevents the bot from responding to every message

    } catch (error) {
      console.error(`Error handling message for bot ${this.botInstance.name}:`, error);
      await storage.createActivity({
        serverName: this.botInstance.serverName,
        botInstanceId: this.botInstance.id,
        type: 'error',
        description: `Message handling error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  private async handleCommand(message: WAMessage, commandText: string) {
    const commandPrefix = process.env.BOT_PREFIX || '.';
    const args = commandText.substring(commandPrefix.length).trim().split(' ');
    const commandName = args[0].toLowerCase();
    const commandArgs = args.slice(1);

    console.log(`Bot ${this.botInstance.name}: Processing command ${commandName} with args:`, commandArgs);

    // Check our command registry first
    const registeredCommand = commandRegistry.get(commandName);
    if (registeredCommand) {
      try {
        const respond = async (text: string) => {
          if (message.key.remoteJid) {
            await this.sock.sendMessage(message.key.remoteJid, { text });
          }
        };

        const context: CommandContext = {
          message,
          client: this.sock,
          respond,
          from: message.key.remoteJid || '',
          sender: message.key.participant || message.key.remoteJid || '',
          args: commandArgs,
          command: commandName,
          prefix: '.',
          botId: this.botInstance.id
        };

        await registeredCommand.handler(context);

        // Update bot stats
        await storage.updateBotInstance(this.botInstance.id, {
          commandsCount: (this.botInstance.commandsCount || 0) + 1
        });

        await storage.createActivity({
          serverName: this.botInstance.serverName,
          botInstanceId: this.botInstance.id,
          type: 'command',
          description: `Executed command: .${commandName}`,
          metadata: { command: commandName, user: message.key.remoteJid }
        });

        console.log(`Bot ${this.botInstance.name}: Successfully executed command .${commandName}`);
        return;
      } catch (error) {
        console.error(`Error executing command .${commandName}:`, error);
        if (message.key.remoteJid) {
          await this.sock.sendMessage(message.key.remoteJid, { 
            text: `❌ Error executing command .${commandName}` 
          });
        }
        return;
      }
    }

    // Fallback to database commands
    const commands = await storage.getCommands(this.botInstance.id);
    const globalCommands = await storage.getCommands(); // Global commands
    const command = [...commands, ...globalCommands].find(cmd => cmd.name === commandName);

    if (command) {
      await storage.updateBotInstance(this.botInstance.id, {
        commandsCount: (this.botInstance.commandsCount || 0) + 1
      });

      await storage.createActivity({
        serverName: this.botInstance.serverName,
        botInstanceId: this.botInstance.id,
        type: 'command',
        description: `Executed command: .${commandName}`,
        metadata: { command: commandName, user: message.key.remoteJid }
      });

      let response = command.response || `Command .${commandName} executed successfully.`;

      if (command.useChatGPT) {
        const fullMessage = commandText.substring(commandName.length + 2); // Remove .command part
        response = await generateChatGPTResponse(fullMessage, `User executed command: ${commandName}`);
      }

      if (response && message.key.remoteJid) {
        await this.sock.sendMessage(message.key.remoteJid, { text: response });
      }
    } else {
      console.log(`Bot ${this.botInstance.name}: Command .${commandName} not found`);
      if (message.key.remoteJid) {
        await this.sock.sendMessage(message.key.remoteJid, { 
          text: `❌ Command .${commandName} not found. Type .help to see available commands.` 
        });
      }
    }
  }

  private async handleAutoFeatures(message: WAMessage) {
    // Auto-react to messages (skip messages from the bot itself)
    if (this.botInstance.autoReact && message.key.remoteJid && !message.key.fromMe) {
      const reactions = ['👍', '❤️', '😊', '🔥', '👏'];
      const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];

      try {
        await this.sock.sendMessage(message.key.remoteJid, {
          react: {
            text: randomReaction,
            key: message.key
          }
        });

        // Log to activities silently
        await storage.createActivity({
          serverName: this.botInstance.serverName,
          botInstanceId: this.botInstance.id,
          type: 'auto_react',
          description: `Auto-reacted with ${randomReaction} to message from ${message.key.remoteJid}`,
          metadata: { 
            reaction: randomReaction,
            messageId: message.key.id,
            from: message.key.remoteJid,
            timestamp: new Date().toISOString()
          }
        });

      } catch (error) {
        // Log error to activities silently
        await storage.createActivity({
          serverName: this.botInstance.serverName,
          botInstanceId: this.botInstance.id,
          type: 'error',
          description: `Auto-react failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          metadata: { 
            reaction: randomReaction,
            messageId: message.key.id,
            from: message.key.remoteJid,
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      }
    }

    // Handle presence updates based on settings
    await this.updatePresenceForChat(message.key.remoteJid);
  }

  private async updatePresenceForChat(chatId: string | null | undefined) {
    if (!chatId || !this.isRunning) return;

    try {
      const settings = this.botInstance.settings as any || {};
      const presenceMode = settings.presenceMode || 'none';

      switch (presenceMode) {
        case 'always_online':
          await this.sock.sendPresenceUpdate('available', chatId);
          break;
        case 'always_typing':
          await this.sock.sendPresenceUpdate('composing', chatId);
          break;
        case 'always_recording':
          await this.sock.sendPresenceUpdate('recording', chatId);
          break;
        case 'auto_switch':
          // For auto_switch, the presence is managed by the interval timer
          // Just update the current state for this chat
          await this.sock.sendPresenceUpdate(this.currentPresenceState, chatId);
          break;
        default:
          // Legacy typingMode support for backward compatibility
          if (this.botInstance.typingMode === 'typing' || this.botInstance.typingMode === 'both') {
            await this.sock.sendPresenceUpdate('composing', chatId);
          }
          if (this.botInstance.typingMode === 'recording' || this.botInstance.typingMode === 'both') {
            await this.sock.sendPresenceUpdate('recording', chatId);
          }
          break;
      }
    } catch (error) {
      console.log('Error updating presence:', error);
    }
  }

  private startPresenceAutoSwitch() {
    // Use new database schema fields instead of settings
    const presenceAutoSwitch = this.botInstance.presenceAutoSwitch;
    const alwaysOnline = this.botInstance.alwaysOnline;
    const presenceMode = this.botInstance.presenceMode;
    const intervalSeconds = 30; // 30 seconds as requested by user

    // Start auto-switch if presenceAutoSwitch is enabled
    if (presenceAutoSwitch && this.isRunning) {
      console.log(`Bot ${this.botInstance.name}: Starting auto-switch typing/recording presence (${intervalSeconds}s intervals)`);

      this.presenceInterval = setInterval(async () => {
        if (!this.isRunning) {
          this.stopPresenceAutoSwitch();
          return;
        }

        // Switch between composing (typing) and recording every 30 seconds
        this.currentPresenceState = this.currentPresenceState === 'composing' ? 'recording' : 'composing';

        try {
          // Update presence for active chats by broadcasting the new state
          // For better implementation, we could track active chats, but for now update generally
          console.log(`Bot ${this.botInstance.name}: Auto-switched presence to ${this.currentPresenceState}`);

          // Force update presence for the current state
          await this.sock.sendPresenceUpdate(this.currentPresenceState);
        } catch (error) {
          console.log('Error in auto-switch presence:', error);
        }
      }, intervalSeconds * 1000);
    }

    // Handle always online feature
    if (alwaysOnline && this.isRunning) {
      console.log(`Bot ${this.botInstance.name}: Always online mode activated`);

      // Keep sending available presence every 60 seconds to stay online
      setInterval(async () => {
        if (this.isRunning && alwaysOnline) {
          try {
            await this.sock.sendPresenceUpdate('available');
          } catch (error) {
            console.log('Error maintaining online presence:', error);
          }
        }
      }, 60000); // Every 60 seconds
    }

    // Handle auto recording feature (when presenceMode is 'recording')
    if (presenceMode === 'recording' && this.isRunning && !presenceAutoSwitch) {
      console.log(`Bot ${this.botInstance.name}: Auto recording mode activated`);

      // Send recording presence every 30 seconds when not auto-switching
      setInterval(async () => {
        if (this.isRunning && this.botInstance.presenceMode === 'recording' && !this.botInstance.presenceAutoSwitch) {
          try {
            await this.sock.sendPresenceUpdate('recording');
          } catch (error) {
            console.log('Error maintaining recording presence:', error);
          }
        }
      }, 30000); // Every 30 seconds
    }
  }

  private stopPresenceAutoSwitch() {
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
      this.presenceInterval = undefined;
      console.log(`Bot ${this.botInstance.name}: Stopped auto-switch presence`);
    }
  }

  private async handleChatGPTResponse(message: WAMessage, messageText: string) {
    try {
      const response = await generateChatGPTResponse(
        messageText,
        `Bot: ${this.botInstance.name}, User: ${message.key.remoteJid}`
      );

      if (response && message.key.remoteJid) {
        await this.sock.sendMessage(message.key.remoteJid, { text: response });

        await storage.createActivity({
          serverName: this.botInstance.serverName,
          botInstanceId: this.botInstance.id,
          type: 'chatgpt_response',
          description: 'Generated ChatGPT response',
          metadata: { message: messageText.substring(0, 100) }
        });
      }
    } catch (error) {
      console.error('ChatGPT response error:', error);
    }
  }

  async start() {
    if (this.isRunning) {
      console.log(`Bot ${this.botInstance.name} is already running`);
      return;
    }

    try {
      console.log(`Starting Baileys bot ${this.botInstance.name} in isolated container...`);

      await storage.updateBotInstance(this.botInstance.id, { status: 'loading' });
      await storage.createActivity({
        serverName: this.botInstance.serverName,
        botInstanceId: this.botInstance.id,
        type: 'status_change',
        description: 'Bot startup initiated - TREKKERMD LIFETIME BOT initializing with Baileys...'
      });

      // Use isolated auth state for this specific bot
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      // Create isolated socket connection with unique configuration
      this.sock = Baileys.makeWASocket({
        auth: state,
        printQRInTerminal: false, // Disable QR printing to avoid conflicts
        logger: this.createLogger(),
        // Add dynamic device fingerprint that changes each connection
        browser: [`TREKKERMD-${this.botInstance.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 'Chrome', '110.0.0.0'],
        // Ensure each bot has isolated connection settings
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        // Generate unique connection IDs
        generateHighQualityLinkPreview: false,
        // Add retry configuration for stability
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5
      });

      // Save credentials when they change (isolated per bot)
      this.sock.ev.on('creds.update', saveCreds);

      await this.setupEventHandlers();
      this.startHeartbeat(); // Start heartbeat monitoring

      console.log(`Baileys bot ${this.botInstance.name} initialization completed in isolated container`);

    } catch (error) {
      console.error(`Error starting Baileys bot ${this.botInstance.name}:`, error);
      this.isRunning = false;
      this.stopHeartbeat();
      await this.safeUpdateBotStatus('error');
      await this.safeCreateActivity('error', `Bot startup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

      // Don't throw error to prevent app crash - just log it
      console.error(`Bot ${this.botInstance.name} failed to start but app continues running`);
    }
  }

  private startHeartbeat() {
    // Clear any existing heartbeat
    this.stopHeartbeat();

    // Set up heartbeat to monitor bot health
    this.heartbeatInterval = setInterval(async () => {
      try {
        if (this.isRunning && this.sock?.user?.id) {
          await this.safeUpdateBotStatus('online', { lastActivity: new Date() });
        }
      } catch (error) {
        console.error(`Bot ${this.botInstance.name}: Heartbeat error:`, error);
      }
    }, 30000); // Update every 30 seconds
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  private async safeUpdateBotStatus(status: string, updates: any = {}) {
    try {
      await storage.updateBotInstance(this.botInstance.id, { status, ...updates });
    } catch (error) {
      console.error(`Bot ${this.botInstance.name}: Failed to update status:`, error);
    }
  }

  private async safeCreateActivity(type: string, description: string, metadata: any = {}) {
    try {
      await storage.createActivity({
        serverName: this.botInstance.serverName,
        botInstanceId: this.botInstance.id,
        type,
        description,
        metadata
      });
    } catch (error) {
      console.error(`Bot ${this.botInstance.name}: Failed to create activity:`, error);
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.stopHeartbeat();
    this.stopPresenceAutoSwitch(); // Stop presence auto-switch when bot stops

    try {
      console.log(`Stopping bot ${this.botInstance.name} in isolated container...`);

      if (this.sock) {
        // Remove all event listeners to prevent conflicts
        this.sock.ev.removeAllListeners();

        // Close the socket connection
        await this.sock.end();
        this.sock = null;
      }

      this.isRunning = false;

      await this.safeUpdateBotStatus('offline');
      await this.safeCreateActivity('status_change', 'TREKKERMD LIFETIME BOT stopped - isolated container shut down');

      console.log(`Bot ${this.botInstance.name} stopped successfully in isolated container`);
    } catch (error) {
      console.error(`Error stopping bot ${this.botInstance.name}:`, error);
      this.isRunning = false; // Force stop even if error occurs
    }
  }

  async restart() {
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    await this.start();
  }

  getStatus() {
    return this.isRunning ? 'online' : 'offline';
  }

  updateBotInstance(botInstance: BotInstance) {
    this.botInstance = botInstance;
  }

  // Validate credentials by checking essential fields
  static validateCredentials(credentials: any): { valid: boolean; error?: string } {
    try {
      if (!credentials || typeof credentials !== 'object') {
        return { valid: false, error: 'Invalid credentials format' };
      }

      // Check for essential fields
      if (!credentials.creds || !credentials.creds.noiseKey || !credentials.creds.signedIdentityKey) {
        return { valid: false, error: 'Missing essential credential fields (creds.noiseKey, creds.signedIdentityKey)' };
      }

      // Check if credentials have a valid user ID structure
      if (credentials.creds.me?.id) {
        const phoneMatch = credentials.creds.me.id.match(/^(\d+):/);
        if (!phoneMatch) {
          return { valid: false, error: 'Invalid phone number format in credentials' };
        }
      } else {
        return { valid: false, error: 'Missing user ID in credentials' };
      }

      // Check for other essential fields
      if (!credentials.creds.signedPreKey || !credentials.creds.registrationId) {
        return { valid: false, error: 'Missing essential credential fields (signedPreKey, registrationId)' };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: `Credential validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
    }
  }

  private async sendViewOnceDetectionAlert(message: WAMessage): Promise<void> {
    try {
      const botOwnerJid = this.sock.user?.id;
      if (!botOwnerJid) {
        console.log('❌ Bot owner JID not found, cannot send ViewOnce detection alert');
        return;
      }

      const alertMessage = `🚨 *ViewOnce Detection Alert* 🚨\n\n⚠️ **POTENTIAL VIEWONCE MESSAGE DETECTED**\n\n📱 From: ${message.key.remoteJid}\n📞 Message ID: ${message.key.id}\n⏰ Time: ${new Date().toLocaleString()}\n🔍 Status: Message received without content (likely ViewOnce)\n\n💡 **Note:** WhatsApp may have processed/encrypted the ViewOnce message before the bot could intercept it. This is common with ViewOnce messages as they are designed to be ephemeral.\n\n🛡️ Anti-ViewOnce is actively monitoring all messages.`;

      await this.sock.sendMessage(botOwnerJid, { text: alertMessage });
      console.log(`🚨 [${this.botInstance.name}] ViewOnce detection alert sent to bot owner`);

      // Log the activity
      await storage.createActivity({
        serverName: this.botInstance.serverName,
        botInstanceId: this.botInstance.id,
        type: 'viewonce_detection',
        description: 'Potential ViewOnce message detected (no content)',
        metadata: { 
          from: message.key.remoteJid,
          messageId: message.key.id,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error sending ViewOnce detection alert:', error);
    }
  }

  async sendDirectMessage(recipient: string, message: string): Promise<void> {
    if (!this.sock || !this.isRunning) {
      throw new Error('Bot is not running or socket is not available');
    }

    try {
      await this.sock.sendMessage(recipient, { text: message });
      console.log(`Bot ${this.botInstance.name}: Message sent to ${recipient}`);

      // Log the activity
      await storage.createActivity({
        serverName: 'default-server',
        botInstanceId: this.botInstance.id,
        type: 'message_sent',
        description: `Message sent to ${recipient}`,
        metadata: { recipient, message: message.substring(0, 100) }
      });
    } catch (error) {
      console.error(`Bot ${this.botInstance.name}: Failed to send message to ${recipient}:`, error);
      throw error;
    }
  }
}