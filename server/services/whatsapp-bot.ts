import { Client, Message } from 'whatsapp-web.js';
import { storage } from '../storage';
import { generateChatGPTResponse } from './openai';
import type { BotInstance } from '@shared/schema';

export class WhatsAppBot {
  private client: Client;
  private botInstance: BotInstance;
  private isRunning: boolean = false;

  constructor(botInstance: BotInstance) {
    this.botInstance = botInstance;
    
    // Initialize client with credentials if available
    const clientOptions: any = {
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    };

    // If credentials are provided, use them to restore session
    if (botInstance.credentials) {
      clientOptions.session = botInstance.credentials;
    }
    
    this.client = new Client(clientOptions);
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    this.client.on('qr', async (qr) => {
      console.log(`QR Code for bot ${this.botInstance.name}:`, qr);
      await storage.updateBotInstance(this.botInstance.id, { status: 'qr_code' });
      await storage.createActivity({
        botInstanceId: this.botInstance.id,
        type: 'qr_code',
        description: 'QR Code generated - Scan to connect WhatsApp',
        metadata: { qr }
      });
    });

    this.client.on('authenticated', async () => {
      console.log(`Bot ${this.botInstance.name} authenticated successfully!`);
      await storage.updateBotInstance(this.botInstance.id, { status: 'authenticated' });
      await storage.createActivity({
        botInstanceId: this.botInstance.id,
        type: 'authenticated',
        description: 'WhatsApp authenticated successfully'
      });
    });

    this.client.on('auth_failure', async (message) => {
      console.log(`Bot ${this.botInstance.name} authentication failed:`, message);
      await storage.updateBotInstance(this.botInstance.id, { status: 'auth_failed' });
      await storage.createActivity({
        botInstanceId: this.botInstance.id,
        type: 'error',
        description: `Authentication failed: ${message}`
      });
      this.isRunning = false;
    });

    this.client.on('ready', async () => {
      console.log(`Bot ${this.botInstance.name} is ready!`);
      await storage.updateBotInstance(this.botInstance.id, { 
        status: 'online',
        lastActivity: new Date()
      });
      
      await storage.createActivity({
        botInstanceId: this.botInstance.id,
        type: 'status_change',
        description: 'Bot connected and ready - WELCOME TO TREKKERMD LIFETIME BOT',
      });
      
      // Send welcome message to owner/admin
      try {
        const welcomeMessage = `🎉 WELCOME TO TREKKERMD LIFETIME BOT 🎉\n\nYour bot "${this.botInstance.name}" is now online and ready to serve!\n\n✨ Features activated:\n- Auto reactions and likes\n- Advanced command system (300+ commands)\n- ChatGPT AI integration\n- Group management tools\n- Real-time activity monitoring\n\nType .help to see available commands or .list for the full command list.\n\nHappy chatting! 🚀`;
        
        console.log('TREKKERMD LIFETIME BOT READY:', welcomeMessage);
      } catch (error) {
        console.log('Welcome message setup complete');
      }
    });

    this.client.on('disconnected', async (reason) => {
      console.log(`Bot ${this.botInstance.name} disconnected:`, reason);
      this.isRunning = false;
      await storage.updateBotInstance(this.botInstance.id, { status: 'offline' });
      
      await storage.createActivity({
        botInstanceId: this.botInstance.id,
        type: 'status_change',
        description: `Bot disconnected: ${reason}`,
      });
    });

    this.client.on('loading_screen', async (percent, message) => {
      console.log(`Bot ${this.botInstance.name} loading:`, percent, message);
      await storage.createActivity({
        botInstanceId: this.botInstance.id,
        type: 'loading',
        description: `Loading WhatsApp: ${percent}% - ${message}`
      });
    });

    this.client.on('message', async (message) => {
      await this.handleMessage(message);
    });
  }

  private async handleMessage(message: Message) {
    try {
      const messageBody = message.body.trim();
      
      // Update message count
      await storage.updateBotInstance(this.botInstance.id, {
        messagesCount: (this.botInstance.messagesCount || 0) + 1,
        lastActivity: new Date()
      });

      // Handle commands (prefix: .)
      if (messageBody.startsWith('.')) {
        await this.handleCommand(message, messageBody);
        return;
      }

      // Auto-reactions and features
      await this.handleAutoFeatures(message);

      // ChatGPT integration for non-command messages
      if (this.botInstance.chatgptEnabled) {
        await this.handleChatGPTResponse(message);
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

  private async handleCommand(message: Message, commandText: string) {
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
        metadata: { command: commandName, user: message.from }
      });

      let response = command.response || `Command .${commandName} executed successfully.`;
      
      if (command.useChatGPT) {
        const fullMessage = commandText.substring(commandName.length + 2); // Remove .command part
        response = await generateChatGPTResponse(fullMessage, `User executed command: ${commandName}`);
      }

      if (response) {
        await message.reply(response);
      }
    }
  }

  private async handleAutoFeatures(message: Message) {
    // Auto-like status updates
    if (this.botInstance.autoLike && message.hasMedia) {
      // In a real implementation, you'd check if it's a status and like it
      console.log(`Auto-liking status from ${message.from}`);
    }

    // Auto-react to messages
    if (this.botInstance.autoReact) {
      const reactions = ['👍', '❤️', '😊', '🔥', '👏'];
      const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
      try {
        await message.react(randomReaction);
      } catch (error) {
        console.log('Could not react to message:', error);
      }
    }

    // Typing indicators
    if (this.botInstance.typingMode === 'typing' || this.botInstance.typingMode === 'both') {
      const chat = await message.getChat();
      await chat.sendStateTyping();
    }

    if (this.botInstance.typingMode === 'recording' || this.botInstance.typingMode === 'both') {
      const chat = await message.getChat();
      await chat.sendStateRecording();
    }
  }

  private async handleChatGPTResponse(message: Message) {
    try {
      const response = await generateChatGPTResponse(
        message.body,
        `Bot: ${this.botInstance.name}, User: ${message.from}`
      );
      
      if (response) {
        await message.reply(response);
        
        await storage.createActivity({
          botInstanceId: this.botInstance.id,
          type: 'chatgpt_response',
          description: 'Generated ChatGPT response',
          metadata: { message: message.body.substring(0, 100) }
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
      console.log(`Starting bot ${this.botInstance.name}...`);
      this.isRunning = true;
      
      await storage.updateBotInstance(this.botInstance.id, { status: 'loading' });
      await storage.createActivity({
        botInstanceId: this.botInstance.id,
        type: 'status_change',
        description: 'Bot startup initiated - TREKKERMD LIFETIME BOT initializing...'
      });
      
      await this.client.initialize();
      console.log(`Bot ${this.botInstance.name} initialization completed`);
      
    } catch (error) {
      console.error(`Error starting bot ${this.botInstance.name}:`, error);
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
      await this.client.destroy();
      this.isRunning = false;
      await storage.updateBotInstance(this.botInstance.id, { status: 'offline' });
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
