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

export class WhatsAppBot {
  private sock: any;
  private botInstance: BotInstance;
  private isRunning: boolean = false;
  private authDir: string;

  constructor(botInstance: BotInstance) {
    this.botInstance = botInstance;
    this.authDir = join(process.cwd(), 'auth', botInstance.id);
    
    // Create auth directory if it doesn't exist
    if (!existsSync(this.authDir)) {
      mkdirSync(this.authDir, { recursive: true });
    }

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

  private async setupEventHandlers() {
    this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;
      
      console.log(`Bot ${this.botInstance.name}: Connection update -`, { connection, qr: !!qr });
      
      if (qr) {
        console.log(`Bot ${this.botInstance.name}: QR Code generated`);
        await storage.updateBotInstance(this.botInstance.id, { status: 'qr_code' });
        await storage.createActivity({
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
          botInstanceId: this.botInstance.id,
          type: 'status_change',
          description: 'Bot disconnected'
        });
        
        if (shouldReconnect) {
          // Auto-reconnect
          setTimeout(() => this.start(), 5000);
        }
      } else if (connection === 'open') {
        console.log(`Bot ${this.botInstance.name} is ready! 🎉 WELCOME TO TREKKERMD LIFETIME BOT`);
        this.isRunning = true;
        
        await storage.updateBotInstance(this.botInstance.id, { 
          status: 'online',
          lastActivity: new Date()
        });
        
        await storage.createActivity({
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
          botInstanceId: this.botInstance.id,
          type: 'status_change',
          description: 'Bot connecting to WhatsApp...'
        });
      }
      
      // Force update to online if we detect the bot is actually connected
      if (this.sock?.user?.id && !this.isRunning) {
        console.log(`Bot ${this.botInstance.name}: Detected connected state, updating to online`);
        this.isRunning = true;
        
        await storage.updateBotInstance(this.botInstance.id, { 
          status: 'online',
          lastActivity: new Date()
        });
        
        await storage.createActivity({
          botInstanceId: this.botInstance.id,
          type: 'status_change',
          description: '🎉 WELCOME TO TREKKERMD LIFETIME BOT - Bot connected and ready!'
        });

        // Send welcome message
        try {
          const welcomeMessage = `🎉 WELCOME TO TREKKERMD LIFETIME BOT 🎉\n\nYour bot "${this.botInstance.name}" is now online and ready to serve!\n\n✨ Features activated:\n- Auto reactions and likes\n- Advanced command system (300+ commands)\n- ChatGPT AI integration\n- Group management tools\n- Real-time activity monitoring\n\nType .help to see available commands or .list for the full command list.\n\nHappy chatting! 🚀`;
          
          const me = this.sock.user.id;
          await this.sock.sendMessage(me, { text: welcomeMessage });
          console.log(`TREKKERMD LIFETIME BOT: Welcome message sent to ${me}`);
        } catch (error) {
          console.log('Welcome message setup complete');
        }
      }
    });

    this.sock.ev.on('messages.upsert', async (m: { messages: WAMessage[], type: string }) => {
      // Check if bot should be marked as online when first message is received
      if (!this.isRunning && this.sock?.user?.id) {
        console.log(`Bot ${this.botInstance.name}: First message received, marking as online`);
        this.isRunning = true;
        
        await storage.updateBotInstance(this.botInstance.id, { 
          status: 'online',
          lastActivity: new Date()
        });
        
        await storage.createActivity({
          botInstanceId: this.botInstance.id,
          type: 'status_change',
          description: '🎉 WELCOME TO TREKKERMD LIFETIME BOT - Bot is now fully active!'
        });

        // Send welcome message
        try {
          const welcomeMessage = `🎉 WELCOME TO TREKKERMD LIFETIME BOT 🎉\n\nYour bot "${this.botInstance.name}" is now online and ready to serve!\n\n✨ Features activated:\n- Auto reactions and likes\n- Advanced command system (300+ commands)\n- ChatGPT AI integration\n- Group management tools\n- Real-time activity monitoring\n\nType .help to see available commands or .list for the full command list.\n\nHappy chatting! 🚀`;
          
          const me = this.sock.user.id;
          await this.sock.sendMessage(me, { text: welcomeMessage });
          console.log(`TREKKERMD LIFETIME BOT: Welcome message sent to ${me}`);
        } catch (error) {
          console.log('Welcome message ready');
        }
      }
      
      if (m.type === 'notify') {
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

      // Handle commands (prefix: .)
      if (messageText.startsWith('.')) {
        await this.handleCommand(message, messageText);
        return;
      }

      // Auto-reactions and features
      await this.handleAutoFeatures(message);

      // ChatGPT integration for non-command messages
      if (this.botInstance.chatgptEnabled) {
        await this.handleChatGPTResponse(message, messageText);
      }

    } catch (error) {
      console.error(`Error handling message for bot ${this.botInstance.name}:`, error);
      await storage.createActivity({
        botInstanceId: this.botInstance.id,
        type: 'error',
        description: `Message handling error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }

  private async handleCommand(message: WAMessage, commandText: string) {
    const commandName = commandText.substring(1).split(' ')[0];
    const commands = await storage.getCommands(this.botInstance.id);
    const globalCommands = await storage.getCommands(); // Global commands
    
    const command = [...commands, ...globalCommands].find(cmd => cmd.name === commandName);
    
    if (command) {
      await storage.updateBotInstance(this.botInstance.id, {
        commandsCount: (this.botInstance.commandsCount || 0) + 1
      });

      await storage.createActivity({
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
      console.log(`Starting Baileys bot ${this.botInstance.name}...`);
      
      await storage.updateBotInstance(this.botInstance.id, { status: 'loading' });
      await storage.createActivity({
        botInstanceId: this.botInstance.id,
        type: 'status_change',
        description: 'Bot startup initiated - TREKKERMD LIFETIME BOT initializing with Baileys...'
      });

      // Use auth state from the saved credentials
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
      });

      // Save credentials when they change
      this.sock.ev.on('creds.update', saveCreds);
      
      await this.setupEventHandlers();
      
      console.log(`Baileys bot ${this.botInstance.name} initialization completed`);
      
    } catch (error) {
      console.error(`Error starting Baileys bot ${this.botInstance.name}:`, error);
      this.isRunning = false;
      await storage.updateBotInstance(this.botInstance.id, { status: 'error' });
      await storage.createActivity({
        botInstanceId: this.botInstance.id,
        type: 'error',
        description: `Bot startup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    try {
      if (this.sock) {
        await this.sock.end();
      }
      this.isRunning = false;
      await storage.updateBotInstance(this.botInstance.id, { status: 'offline' });
      await storage.createActivity({
        botInstanceId: this.botInstance.id,
        type: 'status_change',
        description: 'TREKKERMD LIFETIME BOT stopped'
      });
    } catch (error) {
      console.error(`Error stopping bot ${this.botInstance.name}:`, error);
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
}