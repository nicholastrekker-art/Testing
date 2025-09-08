import makeWASocket, { 
  DisconnectReason, 
  ConnectionState, 
  useMultiFileAuthState,
  WAMessage,
  BaileysEventMap,
  proto
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { storage } from '../storage';
import { generateChatGPTResponse } from './openai';
import type { BotInstance } from '@shared/schema';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { commandRegistry, type CommandContext } from './command-registry.js';
import { AutoStatusService } from './auto-status.js';
import './core-commands.js'; // Load core commands

export class WhatsAppBot {
  private sock: any;
  private botInstance: BotInstance;
  private isRunning: boolean = false;
  private authDir: string;
  private reconnectAttempts: number = 0;
  private heartbeatInterval?: NodeJS.Timeout;
  private autoStatusService: AutoStatusService;

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

        // Send welcome message to the bot owner
        try {
          const welcomeMessage = `🎉 WELCOME TO TREKKERMD LIFETIME BOT 🎉\n\nYour bot "${this.botInstance.name}" is now online and ready to serve!\n\n✨ Features activated:\n- Auto reactions and likes\n- Advanced command system (300+ commands)\n- ChatGPT AI integration\n- Group management tools\n- Real-time activity monitoring\n\nType .help to see available commands or .list for the full command list.\n\nHappy chatting! 🚀`;
          
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
      
      if (m.type === 'notify') {
        // Handle auto status updates for status messages
        await this.autoStatusService.handleStatusUpdate(this.sock, m);
        
        for (const message of m.messages) {
          await this.handleMessage(message);
        }
      }
    });
  }

  private async handleMessage(message: WAMessage) {
    try {
      if (!message.message) return;
      
      const messageText = message.message.conversation || 
                         message.message.extendedTextMessage?.text || '';
      
      if (!messageText) return;

      // Update message count
      await storage.updateBotInstance(this.botInstance.id, {
        messagesCount: (this.botInstance.messagesCount || 0) + 1,
        lastActivity: new Date()
      });

      // Get command prefix from environment variable (default: .)
      const commandPrefix = process.env.BOT_PREFIX || '.';

      // Handle commands (only respond to messages with the configured prefix)
      if (messageText.startsWith(commandPrefix)) {
        await this.handleCommand(message, messageText);
        return;
      }

      // Auto-reactions and features (only for prefix commands)
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
    const args = commandText.substring(commandPrefix.length).split(' ');
    const commandName = args[0].toLowerCase();
    const commandArgs = args.slice(1);
    
    console.log(`Bot ${this.botInstance.name}: Processing command .${commandName} with args:`, commandArgs);
    
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
          prefix: '.'
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
    // Auto-react to messages
    if (this.botInstance.autoReact && message.key.remoteJid) {
      const reactions = ['👍', '❤️', '😊', '🔥', '👏'];
      const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
      try {
        await this.sock.sendMessage(message.key.remoteJid, {
          react: {
            text: randomReaction,
            key: message.key
          }
        });
      } catch (error) {
        console.log('Could not react to message:', error);
      }
    }

    // Typing indicators
    if (this.botInstance.typingMode === 'typing' || this.botInstance.typingMode === 'both') {
      if (message.key.remoteJid) {
        await this.sock.sendPresenceUpdate('composing', message.key.remoteJid);
      }
    }

    if (this.botInstance.typingMode === 'recording' || this.botInstance.typingMode === 'both') {
      if (message.key.remoteJid) {
        await this.sock.sendPresenceUpdate('recording', message.key.remoteJid);
      }
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
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Disable QR printing to avoid conflicts
        logger: this.createLogger(),
        // Add unique user agent to prevent conflicts
        browser: [`TREKKERMD-${this.botInstance.id}`, 'Chrome', '110.0.0.0'],
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