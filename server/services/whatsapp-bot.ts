import makeWASocket, {
  DisconnectReason,
  ConnectionState,
  useMultiFileAuthState,
  WAMessage,
  BaileysEventMap,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion
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
import './channel-commands.js'; // Load channel commands
import { handleChannelMessage } from './channel-commands.js';

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
    // Each bot gets its own isolated auth directory under its tenancy
    // Structure: auth/{serverName}/bot_{botId}
    this.authDir = join(process.cwd(), 'auth', botInstance.serverName, `bot_${botInstance.id}`);

    // Create auth directory if it doesn't exist (including parent directories)
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

  private async getMessage(key: any) {
    console.log(`📨 [getMessage] Retrieving message for retry: ${key.id}`);
    return {
      conversation: ''
    };
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
        const disconnectReason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const errorMessage = (lastDisconnect?.error as Error)?.message || 'Unknown error';
        
        console.log(`Bot ${this.botInstance.name}: Connection closed due to`, lastDisconnect?.error, ', reconnecting:', shouldReconnect);

        this.isRunning = false;
        this.stopPresenceAutoSwitch();

        // Check for 405 errors (Connection Failure from WhatsApp)
        const is405Error = disconnectReason === 405 || errorMessage.includes('405') || errorMessage.includes('Connection Failure');
        
        if (is405Error) {
          console.log(`🚫 Bot ${this.botInstance.name}: WhatsApp returned 405 Connection Failure - stopping reconnection attempts`);
          this.reconnectAttempts = 999; // Stop auto-reconnect
          
          await storage.updateBotInstance(this.botInstance.id, {
            status: 'offline',
            invalidReason: 'WhatsApp rejected connection (405). Credentials may need refresh or too many attempts detected.',
            autoStart: false
          });
          
          await storage.createActivity({
            serverName: this.botInstance.serverName,
            botInstanceId: this.botInstance.id,
            type: 'error',
            description: `WhatsApp 405 Connection Failure - bot stopped. Please refresh credentials or wait before retrying.`
          });
          return; // Stop here, don't attempt reconnect
        }

        // If logged out (invalid credentials), mark bot as invalid
        if (disconnectReason === DisconnectReason.loggedOut) {
          const invalidReason = 'Invalid credentials or connection closed - credentials may have expired';
          await storage.updateBotInstance(this.botInstance.id, {
            status: 'offline',
            invalidReason,
            autoStart: false
          });
          await storage.createActivity({
            serverName: this.botInstance.serverName,
            botInstanceId: this.botInstance.id,
            type: 'error',
            description: `Bot credentials invalid: ${invalidReason}`
          });
          console.log(`❌ Bot ${this.botInstance.name} marked as invalid due to logged out status`);
        } else {
          await storage.updateBotInstance(this.botInstance.id, { status: 'offline' });
          await storage.createActivity({
            serverName: this.botInstance.serverName,
            botInstanceId: this.botInstance.id,
            type: 'status_change',
            description: 'Bot disconnected'
          });
        }

        if (shouldReconnect && this.reconnectAttempts < 5) {
          // Auto-reconnect with exponential backoff (max 5 attempts)
          const reconnectDelay = Math.min(10000 * Math.pow(2, this.reconnectAttempts || 0), 120000);
          this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
          
          console.log(`🔄 Bot ${this.botInstance.name}: Will retry connection in ${reconnectDelay/1000}s (attempt ${this.reconnectAttempts}/5)`);

          setTimeout(async () => {
            try {
              await this.start();
            } catch (error) {
              await storage.createActivity({
                serverName: this.botInstance.serverName,
                botInstanceId: this.botInstance.id,
                type: 'error',
                description: `Reconnect attempt ${this.reconnectAttempts} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
              });
            }
          }, reconnectDelay);
        } else if (this.reconnectAttempts >= 5) {
          console.log(`⛔ Bot ${this.botInstance.name}: Max reconnection attempts reached, stopping bot`);
          await storage.updateBotInstance(this.botInstance.id, {
            status: 'offline',
            invalidReason: 'Max reconnection attempts reached. Please check credentials and restart manually.',
            autoStart: false
          });
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
          const welcomeMessage = `╔══════════════════════════════════╗
║ 🎉  WELCOME TO TREKKER-MD BOT  🎉 ║
╠══════════════════════════════════╣
║ 🤖  "${this.botInstance.name}" is ONLINE & READY 🚀 ║
╚══════════════════════════════════╝

💡 *Try these commands:*
• .menu - Show all commands
• .help - Get help
• .ping - Test bot

✅ Bot is ready to receive commands!`;

          // Get the bot's own number and send welcome message to yourself
          // Use LID (Baileys v7) if available, fallback to traditional JID
          const userLid = this.sock.user?.lid;
          const userId = this.sock.user?.id;
          const recipientId = userLid || userId;
          
          if (recipientId) {
            console.log(`TREKKERMD LIFETIME BOT: Sending welcome to ${recipientId} (using ${userLid ? 'LID' : 'JID'})`);
            await this.sock.sendMessage(recipientId, { text: welcomeMessage });
            console.log(`TREKKERMD LIFETIME BOT: Welcome message sent successfully`);
          } else {
            console.log('TREKKERMD LIFETIME BOT READY:', welcomeMessage);
          }
        } catch (error) {
          console.error('Welcome message error:', error);
        }

        // Fetch existing statuses after connection is established
        const sock = this.sock; // Capture sock in a variable for the timeout
        setTimeout(async () => {
          await this.autoStatusService.fetchAllStatuses(sock);
        }, 5000); // Wait 5 seconds after connection to fetch existing statuses

        // Auto-follow channel on startup
        setTimeout(async () => {
          try {
            const channelJid = '120363421057570812@newsletter';
            console.log(`Bot ${this.botInstance.name}: Auto-following TrekkerMD newsletter channel...`);

            try {
              await this.sock.newsletterFollow(channelJid);
              console.log(`Bot ${this.botInstance.name}: Successfully auto-followed channel ${channelJid}`);
            } catch (followError: any) {
              // The API returns unexpected structure but still follows successfully
              if (followError.message?.includes('unexpected response structure') ||
                  followError.output?.statusCode === 400) {
                console.log(`Bot ${this.botInstance.name}: Channel auto-follow completed (ignoring API response format issue)`);
              } else if (followError.message?.includes('already')) {
                console.log(`Bot ${this.botInstance.name}: Already following channel ${channelJid}`);
              } else {
                throw followError;
              }
            }

            await storage.createActivity({
              serverName: this.botInstance.serverName,
              botInstanceId: this.botInstance.id,
              type: 'auto_follow_channel',
              description: 'Automatically followed TrekkerMD newsletter channel on startup',
              metadata: { channelJid }
            });
          } catch (error) {
            console.error(`Bot ${this.botInstance.name}: Auto-follow channel failed:`, error);
          }
        }, 7000); // Wait 7 seconds after connection for auto-follow

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
        console.log(`⚠️ [${this.botInstance.name}] Skipping message processing - bot not running`);
        return;
      }

      console.log(`📨 [${this.botInstance.name}] MESSAGE BATCH RECEIVED - Approval Status: ${this.botInstance.approvalStatus}`);
      console.log(`   📊 Batch Type: ${m.type}`);
      console.log(`   📈 Message Count: ${m.messages.length}`);
      console.log(`   🕐 Processing Time: ${new Date().toLocaleString()}`);

      if (m.type === 'notify' || m.type === 'append') {
        // Handle auto status updates for status messages
        await this.autoStatusService.handleStatusUpdate(this.sock, m);

        for (let i = 0; i < m.messages.length; i++) {
          const message = m.messages[i];

          console.log(`📝 [${this.botInstance.name}] PROCESSING MESSAGE ${i + 1}/${m.messages.length}`);
          console.log(`   🆔 Message ID: ${message.key.id}`);
          console.log(`   👤 From: ${message.pushName || 'Unknown'} (${message.key.remoteJid})`);
          console.log(`   🔄 From Me: ${message.key.fromMe ? 'Yes' : 'No'}`);
          console.log(`   📅 Timestamp: ${message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000).toLocaleString() : 'Unknown'}`);

          try {
            // Filter out reaction messages to reduce noise
            const isReactionMessage = message.message && message.message.reactionMessage;

            if (isReactionMessage) {
              console.log(`   😀 Reaction Message: ${message.message?.reactionMessage?.text} to ${message.message?.reactionMessage?.key?.id}`);
            }

            console.log(`   💾 Storing in antidelete service...`);
            // Store message for antidelete functionality
            await antideleteService.storeMessage(message, this.sock);

            // Handle Anti-ViewOnce
            if (this.antiViewOnceService && !isReactionMessage && message.key.fromMe) {
              const hasViewOnce = this.hasViewOnceContent(message);
              console.log(`   👁️ ViewOnce Check: ${hasViewOnce ? 'DETECTED' : 'None'}`);
              if (hasViewOnce) {
                try {
                  console.log(`   🔍 Processing ViewOnce message...`);
                  await this.antiViewOnceService.handleMessage(this.sock, message);
                } catch (error) {
                  console.error(`   ❌ ViewOnce processing error:`, error);
                  // Store error silently without any console logs
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

            console.log(`   🎯 Processing regular message handling...`);

            // Handle channel auto-reactions (before regular message handling)
            await handleChannelMessage(this.sock, message, this.botInstance.id);

            // Process regular message handling
            await this.handleMessage(message);

            console.log(`   ✅ Message ${i + 1} processed successfully`);

          } catch (error) {
            console.error(`❌ [${this.botInstance.name}] Error processing message ${i + 1} from ${message.key.remoteJid}:`, error);
            console.error(`❌ [${this.botInstance.name}] Error details:`, {
              messageId: message.key.id,
              fromJid: message.key.remoteJid,
              error: error instanceof Error ? error.message : 'Unknown error',
              stack: error instanceof Error ? error.stack : 'No stack trace'
            });
          }
        }

        console.log(`🎉 [${this.botInstance.name}] BATCH PROCESSING COMPLETE - ${m.messages.length} messages processed`);
        console.log(`─────────────────────────────────────────────────────────`);
      } else {
        console.log(`⚠️ [${this.botInstance.name}] Skipping batch - type '${m.type}' not handled`);
      }
    });

    // Handle message revocation (deletion)
    this.sock.ev.on('messages.update', async (updates: { key: any; update: any }[]) => {
      console.log(`🔄 [${this.botInstance.name}] MESSAGE UPDATES RECEIVED`);
      console.log(`   📊 Update Count: ${updates.length}`);
      console.log(`   🕐 Processing Time: ${new Date().toLocaleString()}`);

      for (let i = 0; i < updates.length; i++) {
        const { key, update } = updates[i];

        console.log(`📝 [${this.botInstance.name}] PROCESSING UPDATE ${i + 1}/${updates.length}`);
        console.log(`   🆔 Message ID: ${key.id}`);
        console.log(`   💬 Chat: ${key.remoteJid}`);
        console.log(`   👤 Participant: ${key.participant || 'N/A'}`);
        console.log(`   🔧 Update Type: ${update.message?.protocolMessage?.type || 'Unknown'}`);

        // Log all update types for debugging
        if (update.status) {
          console.log(`   📊 Status Update: ${update.status}`);
        }

        if (update.reactions) {
          console.log(`   😀 Reactions Update: ${JSON.stringify(update.reactions)}`);
        }

        if (update.pollUpdates) {
          console.log(`   📊 Poll Updates: ${JSON.stringify(update.pollUpdates)}`);
        }

        // Check if this is a message deletion
        if (update.message?.protocolMessage?.type === Baileys.proto.Message.ProtocolMessage.Type.REVOKE) {
          console.log(`🚨 [${this.botInstance.name}] MESSAGE REVOCATION DETECTED!`);
          console.log(`   🎯 Target Message ID: ${update.message.protocolMessage.key?.id}`);
          console.log(`   🗑️ Revocation Type: REVOKE`);
          console.log(`   🔧 Protocol Message:`, JSON.stringify(update.message.protocolMessage, null, 2));

          const revocationMessage = { key, message: update.message };
          console.log(`   📤 Forwarding to antidelete service...`);
          await antideleteService.handleMessageRevocation(this.sock, revocationMessage);
          console.log(`   ✅ Revocation handled by antidelete service`);
        } else if (update.message?.protocolMessage) {
          console.log(`   📡 Other Protocol Message:`, {
            type: update.message.protocolMessage.type,
            key: update.message.protocolMessage.key
          });
        } else {
          console.log(`   ℹ️ Non-revocation update processed`);
        }

        console.log(`   ✅ Update ${i + 1} processed successfully`);
      }

      console.log(`🎉 [${this.botInstance.name}] MESSAGE UPDATES COMPLETE - ${updates.length} updates processed`);
      console.log(`─────────────────────────────────────────────────────────`);
    });

    // Handle incoming calls - reject if anti-call is enabled
    this.sock.ev.on('call', async (callEvents: any[]) => {
      for (const call of callEvents) {
        console.log(`📞 [${this.botInstance.name}] INCOMING CALL DETECTED`);
        console.log(`   👤 From: ${call.from}`);
        console.log(`   📞 Call ID: ${call.id}`);
        console.log(`   🔔 Status: ${call.status}`);

        // Check if anti-call is enabled
        const settings = this.botInstance.settings as any || {};
        const antiCallEnabled = settings.antiCall || false;

        if (antiCallEnabled && call.status === 'offer') {
          try {
            // Reject the call
            await this.sock.rejectCall(call.id, call.from);
            console.log(`🚫 [${this.botInstance.name}] Call rejected from ${call.from}`);

            // Log activity
            await storage.createActivity({
              serverName: this.botInstance.serverName,
              botInstanceId: this.botInstance.id,
              type: 'call_rejected',
              description: `Auto-rejected incoming call from ${call.from}`,
              metadata: { callId: call.id, from: call.from }
            });

            // Optionally send a message to the caller
            try {
              await this.sock.sendMessage(call.from, {
                text: '📵 *Auto-Call Rejection*\n\nSorry, this bot does not accept calls. Please send a text message instead.\n\n> Anti-Call Protection Active'
              });
            } catch (msgError) {
              console.log(`Could not send rejection message: ${msgError}`);
            }
          } catch (error) {
            console.error(`Error rejecting call: ${error}`);
            await storage.createActivity({
              serverName: this.botInstance.serverName,
              botInstanceId: this.botInstance.id,
              type: 'error',
              description: `Failed to reject call from ${call.from}: ${error instanceof Error ? error.message : 'Unknown error'}`,
              metadata: { callId: call.id, from: call.from }
            });
          }
        } else if (!antiCallEnabled) {
          console.log(`📞 [${this.botInstance.name}] Call received but anti-call is disabled`);
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

    // Priority order for text extraction - most specific first
    
    // 1. Direct conversation (simple text message) - MOST COMMON FOR COMMANDS
    if (messageObj.conversation) {
      const text = String(messageObj.conversation).trim();
      console.log(`📝 Extracted from conversation: "${text}"`);
      return text;
    }

    // 2. Extended text message (replies, quoted messages)
    if (messageObj.extendedTextMessage?.text) {
      const text = String(messageObj.extendedTextMessage.text).trim();
      console.log(`📝 Extracted from extendedTextMessage: "${text}"`);
      return text;
    }

    // 3. Media captions (images, videos, etc. with text)
    const caption = messageObj.imageMessage?.caption ||
                   messageObj.videoMessage?.caption ||
                   messageObj.documentMessage?.caption ||
                   messageObj.audioMessage?.caption;
    
    if (caption) {
      const text = String(caption).trim();
      console.log(`📝 Extracted from media caption: "${text}"`);
      return text;
    }

    // 4. Interactive message responses (buttons, lists)
    const interactive = messageObj.buttonsResponseMessage?.selectedButtonId ||
                       messageObj.listResponseMessage?.singleSelectReply?.selectedRowId ||
                       messageObj.templateButtonReplyMessage?.selectedId;
    
    if (interactive) {
      const text = String(interactive).trim();
      console.log(`📝 Extracted from interactive: "${text}"`);
      return text;
    }

    // 5. Unwrap ephemeral/viewonce wrappers and retry (recursive)
    const inner = messageObj.ephemeralMessage?.message ||
                  messageObj.viewOnceMessage?.message ||
                  messageObj.viewOnceMessageV2?.message ||
                  messageObj.documentWithCaptionMessage?.message ||
                  messageObj.editedMessage?.message;
    
    if (inner && inner !== messageObj) {
      console.log(`🔄 Unwrapping nested message...`);
      return this.extractMessageText(inner);
    }

    console.log(`⚠️ No text found in message structure`);
    return '';
  }

  private async handleMessage(message: WAMessage) {
    try {
      if (!message.message) {
        console.log(`Bot ${this.botInstance.name}: Skipping - no message content`);
        return;
      }

      // Get message text - extract directly from the message object
      const messageText = this.extractMessageText(message.message);
      
      if (!messageText || messageText.length === 0) {
        console.log(`Bot ${this.botInstance.name}: ⚠️ No text content in message from ${message.key.remoteJid}`);
      } else {
        console.log(`Bot ${this.botInstance.name}: 📝 Message text: "${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}"`);
      }
      
      const commandPrefix = process.env.BOT_PREFIX || '.';
      const trimmedText = messageText.trim();
      const startsWithPrefix = trimmedText.startsWith(commandPrefix);
      const isCommand = trimmedText.length > 0 && startsWithPrefix;

      if (trimmedText.length > 0) {
        console.log(`Bot ${this.botInstance.name}: 🔍 Prefix check: "${trimmedText.charAt(0)}" === "${commandPrefix}" ? ${startsWithPrefix}`);
        console.log(`Bot ${this.botInstance.name}: 🎯 IS COMMAND: ${isCommand ? 'YES ✅' : 'NO ❌'}`);
      }

      // Always update message count for any message
      await storage.updateBotInstance(this.botInstance.id, {
        messagesCount: (this.botInstance.messagesCount || 0) + 1,
        lastActivity: new Date()
      });

      // Handle commands (respond to ANY message with the prefix, regardless of source)
      if (isCommand) {
        console.log(`Bot ${this.botInstance.name}: 🎯 COMMAND DETECTED: "${trimmedText}" from ${message.key.remoteJid}`);

        try {
          // Process commands for all bots regardless of approval status or message source
          await this.handleCommand(message, trimmedText);
          console.log(`Bot ${this.botInstance.name}: ✅ Command executed successfully`);
        } catch (cmdError) {
          console.error(`Bot ${this.botInstance.name}: ❌ Command error:`, cmdError);
        }
        return;
      } else if (trimmedText.length > 0) {
        console.log(`Bot ${this.botInstance.name}: ℹ️ Not a command - no prefix detected`);
      }

      // Auto-reactions and features for non-command messages (for all bots)
      if (!message.key.fromMe) {
        await this.handleAutoFeatures(message);
      }

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
    console.log(`Bot ${this.botInstance.name}: 🔧 handleCommand called with text: "${commandText}"`);
    
    const commandPrefix = process.env.BOT_PREFIX || '.';
    const textWithoutPrefix = commandText.substring(commandPrefix.length).trim();
    const args = textWithoutPrefix.split(' ');
    const commandName = args[0].toLowerCase();
    const commandArgs = args.slice(1);

    console.log(`Bot ${this.botInstance.name}: 🔍 Parsed command:`);
    console.log(`   📝 Command Name: "${commandName}"`);
    console.log(`   📝 Arguments:`, commandArgs);
    console.log(`   📍 Chat: ${message.key.remoteJid}`);
    console.log(`   🤖 Bot running: ${this.isRunning}`);
    console.log(`   📡 Socket available: ${!!this.sock}`);

    // Check our command registry first
    const registeredCommand = commandRegistry.get(commandName);
    console.log(`Bot ${this.botInstance.name}: 🔍 Registry lookup for "${commandName}": ${registeredCommand ? 'FOUND' : 'NOT FOUND'}`);
    
    if (registeredCommand) {
      // Verify bot is ready to send messages
      if (!this.sock) {
        console.error(`Bot ${this.botInstance.name}: ❌ Cannot execute command - socket not available`);
        return;
      }
      
      if (!this.isRunning) {
        console.error(`Bot ${this.botInstance.name}: ❌ Cannot execute command - bot not running`);
        return;
      }

      try {
        console.log(`Bot ${this.botInstance.name}: ▶️ Executing registered command: ${commandName}`);
        console.log(`Bot ${this.botInstance.name}: 🔌 Socket state: connected=${!!this.sock.user?.id}`);
        
        const respond = async (text: string) => {
          if (!message.key.remoteJid) {
            console.error(`Bot ${this.botInstance.name}: ❌ No remoteJid available for response`);
            return;
          }
          
          if (!this.sock) {
            console.error(`Bot ${this.botInstance.name}: ❌ Socket not available`);
            return;
          }
          
          if (!this.isRunning) {
            console.error(`Bot ${this.botInstance.name}: ❌ Bot not running`);
            return;
          }

          console.log(`Bot ${this.botInstance.name}: 💬 Attempting to send response to ${message.key.remoteJid}`);
          console.log(`Bot ${this.botInstance.name}: 📝 Message text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
          
          try {
            const sendResult = await this.sock.sendMessage(message.key.remoteJid, { text });
            console.log(`Bot ${this.botInstance.name}: ✅ Response sent successfully, result:`, sendResult?.status || 'unknown');
          } catch (sendError: any) {
            console.error(`Bot ${this.botInstance.name}: ❌ Failed to send message:`, {
              error: sendError.message || sendError,
              stack: sendError.stack,
              code: sendError.code,
              statusCode: sendError.statusCode
            });
            throw sendError;
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
          prefix: commandPrefix,
          botId: this.botInstance.id
        };

        console.log(`Bot ${this.botInstance.name}: 🎬 Starting command handler execution...`);
        await registeredCommand.handler(context);
        console.log(`Bot ${this.botInstance.name}: 🎬 Command handler completed successfully`);

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

        console.log(`Bot ${this.botInstance.name}: ✅ Successfully executed command .${commandName}`);
        return;
      } catch (error) {
        console.error(`Bot ${this.botInstance.name}: ❌ Error executing command .${commandName}:`, error);
        if (message.key.remoteJid) {
          await this.sock.sendMessage(message.key.remoteJid, {
            text: `❌ Error executing command .${commandName}: ${error instanceof Error ? error.message : 'Unknown error'}`
          });
        }
        return;
      }
    }

    // Fallback to database commands
    console.log(`Bot ${this.botInstance.name}: 🔍 Checking database commands...`);
    const commands = await storage.getCommands(this.botInstance.id);
    const globalCommands = await storage.getCommands(); // Global commands
    const command = [...commands, ...globalCommands].find(cmd => cmd.name === commandName);

    if (command) {
      console.log(`Bot ${this.botInstance.name}: ▶️ Executing database command: ${commandName}`);
      
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
        console.log(`Bot ${this.botInstance.name}: 💬 Sending database command response...`);
        try {
          await this.sock.sendMessage(message.key.remoteJid, { text: response });
          console.log(`Bot ${this.botInstance.name}: ✅ Database command response sent`);
        } catch (sendError) {
          console.error(`Bot ${this.botInstance.name}: ❌ Failed to send database command response:`, sendError);
        }
      }
      
      console.log(`Bot ${this.botInstance.name}: ✅ Database command executed`);
    } else {
      console.log(`Bot ${this.botInstance.name}: ❌ Command .${commandName} not found in registry or database`);
      if (message.key.remoteJid) {
        try {
          await this.sock.sendMessage(message.key.remoteJid, {
            text: `❌ Command .${commandName} not found. Type .help to see available commands.`
          });
          console.log(`Bot ${this.botInstance.name}: ✅ "Command not found" message sent`);
        } catch (sendError) {
          console.error(`Bot ${this.botInstance.name}: ❌ Failed to send "command not found" message:`, sendError);
        }
      }
    }
  }

  private async handleAutoFeatures(message: WAMessage) {
    // Auto-react to messages (skip messages from the bot itself) - completely silent
    // Only react to messages NOT sent by the bot (fromMe must be false)
    if (this.botInstance.autoReact && message.key.remoteJid && message.key.fromMe === false) {
      const reactions = ['👍', '❤️', '😊', '🔥', '👏'];
      const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];

      try {
        await this.sock.sendMessage(message.key.remoteJid, {
          react: {
            text: randomReaction,
            key: message.key
          }
        });

        // Store to activities silently without any console logs
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
        // Store error to activities silently without any console logs
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
      await storage.updateBotInstance(this.botInstance.id, { status: 'loading' });
      await storage.createActivity({
        serverName: this.botInstance.serverName,
        botInstanceId: this.botInstance.id,
        type: 'status_change',
        description: 'Bot startup initiated - TREKKERMD LIFETIME BOT initializing with Baileys...'
      });

      // Use isolated auth state for this specific bot
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      // Fetch latest Baileys version for compatibility
      const { version, isLatest } = await fetchLatestBaileysVersion();
      console.log(`Bot ${this.botInstance.name}: Using Baileys version ${version.join('.')}, isLatest: ${isLatest}`);

      // Create isolated socket connection with Baileys v7 LID support
      const logger = this.createLogger();
      this.sock = Baileys.makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        printQRInTerminal: false,
        logger,
        browser: [`TREKKERMD-${this.botInstance.id}`, 'Chrome', '110.0.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        generateHighQualityLinkPreview: false,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        getMessage: this.getMessage.bind(this)
      });

      // Save credentials when they change (isolated per bot) with error handling
      this.sock.ev.on('creds.update', async () => {
        try {
          await saveCreds();
        } catch (error) {
          // Silently handle credential save errors (e.g., directory deleted)
          console.log(`Bot ${this.botInstance.name}: Credential save skipped (directory may be cleaned up)`);
        }
      });

      await this.setupEventHandlers();
      this.startHeartbeat(); // Start heartbeat monitoring

    } catch (error) {
      console.error(`❌ Error starting bot ${this.botInstance.name}:`, error);
      this.isRunning = false;
      this.stopHeartbeat();

      // Handle different error types gracefully
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const is401Error = errorMessage.includes('401') || errorMessage.includes('Unauthorized');

      if (is401Error) {
        console.error(`🔐 Bot ${this.botInstance.name}: Invalid or expired credentials (401). Please re-authenticate this bot.`);
      }

      await this.safeUpdateBotStatus('error');
      await this.safeCreateActivity('error', `Bot startup failed: ${errorMessage}`);

      // NEVER throw error - server must continue running regardless of bot failures
      console.log(`✅ Server continues running despite bot ${this.botInstance.name} failure`);
    }
  }

  private startHeartbeat() {
    // Clear any existing heartbeat
    this.stopHeartbeat();

    // Set up heartbeat to monitor bot health and keep connection alive
    this.heartbeatInterval = setInterval(async () => {
      try {
        if (this.isRunning && this.sock?.user?.id) {
          console.log(`Bot ${this.botInstance.name}: 💓 Heartbeat - connection alive, user: ${this.sock.user.id}`);
          await this.safeUpdateBotStatus('online', { lastActivity: new Date() });

          // Send keep-alive ping to WhatsApp to prevent connection timeout
          try {
            await this.sock.sendPresenceUpdate('available');
            console.log(`Bot ${this.botInstance.name}: ✅ Keep-alive ping sent successfully`);
          } catch (pingError) {
            console.error(`Bot ${this.botInstance.name}: ❌ Keep-alive ping failed:`, pingError);
            console.log(`Bot ${this.botInstance.name}: 🔄 Attempting reconnect...`);
            // If ping fails, attempt to reconnect
            if (this.isRunning) {
              await this.restart();
            }
          }
        } else {
          console.warn(`Bot ${this.botInstance.name}: ⚠️ Heartbeat - bot not fully connected (running: ${this.isRunning}, user: ${!!this.sock?.user?.id})`);
        }
      } catch (error) {
        console.error(`Bot ${this.botInstance.name}: Heartbeat error:`, error);
      }
    }, 15000); // Update every 15 seconds (reduced from 30 for more frequent keep-alive)
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
      if (this.sock) {
        // Remove all event listeners to prevent conflicts
        this.sock.ev.removeAllListeners();

        // Close the socket connection
        await this.sock.end();
        this.sock = null;
      }

      this.isRunning = false;

      await this.safeUpdateBotStatus('offline');
      await this.safeCreateActivity('status_change', 'TREKKERMD LIFETIME BOT stopped');
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

  // Validate credentials by checking essential fields (supports Baileys v7 LID format)
  static validateCredentials(credentials: any): { valid: boolean; error?: string } {
    try {
      if (!credentials || typeof credentials !== 'object') {
        return { valid: false, error: 'Invalid credentials format' };
      }

      // Check for essential fields
      if (!credentials.creds || !credentials.creds.noiseKey || !credentials.creds.signedIdentityKey) {
        return { valid: false, error: 'Missing essential credential fields (creds.noiseKey, creds.signedIdentityKey)' };
      }

      // Check if credentials have a valid user identity (LID or traditional JID)
      const hasLID = credentials.creds.me?.lid;
      const hasJID = credentials.creds.me?.id;
      
      if (!hasLID && !hasJID) {
        return { valid: false, error: 'Missing user identity (lid or id) in credentials' };
      }

      // Validate phone number format in either LID or JID
      const userIdentity = hasLID || hasJID;
      const phoneMatch = userIdentity.match(/^(\d+)[@:]/);
      if (!phoneMatch) {
        return { valid: false, error: 'Invalid phone number format in credentials' };
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

      const alertMessage = `🚨 *ViewOnce Detection Alert* 🚨

⚠️ **POTENTIAL VIEWONCE MESSAGE DETECTED**

📱 From: ${message.key.remoteJid}
📞 Message ID: ${message.key.id}
⏰ Time: ${new Date().toLocaleString()}
🔍 Status: Message received without content (likely ViewOnce)

💡 **Note:** WhatsApp may have processed/encrypted the ViewOnce message before the bot could intercept it. This is common with ViewOnce messages as they are designed to be ephemeral.

🛡️ Anti-ViewOnce is actively monitoring all messages.`;

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