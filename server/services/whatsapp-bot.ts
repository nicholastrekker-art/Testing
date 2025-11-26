import makeWASocket, {
  DisconnectReason,
  ConnectionState,
  useMultiFileAuthState,
  WAMessage,
  BaileysEventMap,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers
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
import { getAntiViewOnceService } from './antiviewonce.js';
import { getAntideleteService } from './antidelete.js';
import { botIsolationService } from './bot-isolation.js';
import './core-commands.js'; // Load core commands
import './channel-commands.js'; // Load channel commands
import './viewonce-commands.js'; // Load on-demand viewonce commands
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
  private antideleteService: any;
  private presenceInterval?: NodeJS.Timeout;
  private currentPresenceState: 'composing' | 'recording' = 'recording';
  private store: any;
  private reconnectInProgress: boolean = false;

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

    // Initialize bot-specific antidelete service
    this.antideleteService = getAntideleteService(botInstance);

    // Note: makeInMemoryStore is not available in current Baileys version
    // We'll use the antidelete service for message storage instead
    this.store = null;
    console.log(`Bot ${this.botInstance.name}: Using antidelete service for message storage`);

    // If credentials are provided, save them to the auth directory
    if (botInstance.credentials) {
      this.saveCredentialsToAuthDir(botInstance.credentials);
    }
  }

  private saveCredentialsToAuthDir(credentials: any) {
    try {
      console.log(`Bot ${this.botInstance.name}: Saving Baileys session credentials`);

      // Detect credential format and extract the creds object for creds.json
      let credsContent = credentials;

      // Check if this is v7 format (fields at root level)
      const isV7Format = credentials.noiseKey && credentials.signedIdentityKey && !credentials.creds;

      // Check if this is already in wrapped format (fields under creds)
      const isWrappedFormat = credentials.creds?.noiseKey;

      if (isWrappedFormat) {
        // Already wrapped - extract the creds content for the file
        credsContent = credentials.creds;
        console.log(`Bot ${this.botInstance.name}: Extracting creds from wrapped format`);
      } else if (isV7Format) {
        // V7 format at root - already in correct format for creds.json
        console.log(`Bot ${this.botInstance.name}: Using v7 credentials directly for creds.json`);
        // credentials is already in the right format
      }

      // Save ONLY the creds content to creds.json (Baileys expects unwrapped format)
      writeFileSync(join(this.authDir, 'creds.json'), JSON.stringify(credsContent, null, 2));

      console.log(`Bot ${this.botInstance.name}: Baileys credentials saved successfully`);
    } catch (error) {
      console.error(`Bot ${this.botInstance.name}: Error saving credentials:`, error);
    }
  }

  private createLogger() {
    // Complete silent logger - suppresses all Baileys internal logging
    // including Signal protocol session logs
    const loggerInstance = {
      level: 'silent',
      child: () => loggerInstance,
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      log: () => {}
    };
    return loggerInstance;
  }

  private async getMessage(key: any) {
    // getMessage is called when a retry is needed for a message
    console.log(`📨 [getMessage] Retrieving message for retry: ${key.id}`);
    
    // Use antidelete service to retrieve message
    try {
      const storedMsg = await this.antideleteService.getStoredMessage(key.id);
      if (storedMsg?.message) {
        console.log(`✅ [getMessage] Found message ${key.id} in antidelete service`);
        return storedMsg.message;
      }
    } catch (error) {
      console.log(`⚠️ [getMessage] Error retrieving from antidelete: ${error}`);
    }
    
    console.log(`⚠️ [getMessage] Message ${key.id} not found`);
    return undefined;
  }

  private resolvePresenceMode(): 'available' | 'composing' | 'recording' | 'unavailable' | null {
    if (this.botInstance.alwaysOnline) {
      return 'available';
    }

    if (this.botInstance.presenceAutoSwitch) {
      return this.currentPresenceState;
    }

    const presenceMode = this.botInstance.presenceMode || 'recording';

    switch (presenceMode) {
      case 'always_online':
      case 'available':
        return 'available';
      case 'always_typing':
      case 'composing':
      case 'typing':
        return 'composing';
      case 'always_recording':
      case 'recording':
        return 'recording';
      case 'auto_switch':
        return this.currentPresenceState;
      case 'unavailable':
        return 'unavailable';
      case 'none':
        return null;
      default:
        if (this.botInstance.typingMode === 'typing' || this.botInstance.typingMode === 'both') {
          return 'composing';
        }
        if (this.botInstance.typingMode === 'recording' || this.botInstance.typingMode === 'both') {
          return 'recording';
        }
        return 'recording';
    }
  }

  private async setupEventHandlers() {
    this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
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

        this.isRunning = false;
        this.stopPresenceAutoSwitch();

        // Check for conflict errors (440 - multiple simultaneous connections)
        const isConflictError = disconnectReason === 440 || errorMessage.includes('conflict');

        if (isConflictError) {
          this.reconnectAttempts = 999; // Stop auto-reconnect

          await storage.updateBotInstance(this.botInstance.id, {
            status: 'offline',
            invalidReason: 'Conflict: Another instance of this bot is already connected. Please ensure only one instance is running.',
            autoStart: false
          });

          await storage.createActivity({
            serverName: this.botInstance.serverName,
            botInstanceId: this.botInstance.id,
            type: 'error',
            description: 'Connection conflict (440) - multiple instances detected. Bot stopped.'
          });
          return;
        }

        // Check for 428 errors (Connection Closed / Precondition Required)
        const is428Error = disconnectReason === 428 || errorMessage.includes('Connection Closed');

        if (is428Error) {
          // Implement longer backoff for 428 errors
          if (this.reconnectAttempts < 3) {
            const backoffDelay = 30000 * Math.pow(2, this.reconnectAttempts); // 30s, 60s, 120s
            this.reconnectAttempts++;

            await storage.updateBotInstance(this.botInstance.id, { status: 'offline' });

            setTimeout(async () => {
              try {
                await this.start();
              } catch (error) {
                console.error(`Bot ${this.botInstance.name}: Reconnect failed:`, error);
              }
            }, backoffDelay);
            return;
          } else {
            // Max attempts reached for 428 errors
            this.reconnectAttempts = 999;

            await storage.updateBotInstance(this.botInstance.id, {
              status: 'offline',
              invalidReason: 'Connection repeatedly closed by WhatsApp. Please restart bot later.',
              autoStart: false
            });

            await storage.createActivity({
              serverName: this.botInstance.serverName,
              botInstanceId: this.botInstance.id,
              type: 'error',
              description: 'Connection Closed (428) - max retries reached. Bot stopped.'
            });
            return;
          }
        }

        // Check for 405 errors (Connection Failure from WhatsApp)
        const is405Error = disconnectReason === 405 || errorMessage.includes('405') || errorMessage.includes('Connection Failure');

        if (is405Error) {
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

        // Provide sock to auto-status service for status viewing
        this.autoStatusService.setSock(this.sock);

        // Reload bot instance from database to get latest settings
        const freshBot = await storage.getBotInstance(this.botInstance.id);
        if (freshBot) {
          this.botInstance = freshBot;
          console.log(`Bot ${this.botInstance.name}: Reloaded settings - Presence Mode: ${freshBot.presenceMode}, Auto-Switch: ${freshBot.presenceAutoSwitch}, Always Online: ${freshBot.alwaysOnline}`);
        }

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

        // Send AVAILABLE presence immediately on startup to show as online to other users
        try {
          if (this.sock.user?.id || this.sock.user?.lid) {
            // Always mark as 'available' (online) to other users on connection
            await this.sock.sendPresenceUpdate('available');
            console.log(`Bot ${this.botInstance.name}: ✅ ONLINE presence sent - Other users now see bot as online`);
          }
        } catch (presenceError) {
          console.log(`Bot ${this.botInstance.name}: ⚠️ Could not send initial online presence`);
        }

        // Start presence auto-switch if configured
        this.startPresenceAutoSwitch();

        // Log that bot is ready with all active services
        console.log(`✅ TREKKERMD LIFETIME BOT: ${this.botInstance.name} is now online and ready!`);
        console.log(`📋 Bot owner can test with: .ping command`);
        
        // Log active services
        console.log(`\n🔧 Active Services for ${this.botInstance.name}:`);
        console.log(`   ✅ Command Processing - Ready to receive .commands`);
        console.log(`   ${this.botInstance.autoViewStatus ? '✅' : '❌'} Auto Status Viewing - ${this.botInstance.autoViewStatus ? 'Active' : 'Disabled'}`);
        console.log(`   ${this.autoStatusService.isStatusReactionEnabled() ? '✅' : '❌'} Auto Status Reactions - ${this.autoStatusService.isStatusReactionEnabled() ? 'Active' : 'Disabled'}`);
        console.log(`   ✅ Anti-Delete - Active (messages being stored)`);
        console.log(`   ✅ Channel Auto-React - Ready`);
        console.log(`   ✅ Presence Updates - Mode: ${this.botInstance.presenceMode || 'recording'}`);
        console.log(`   ✅ Message Event Listeners - Active\n`);

        // Fetch existing statuses in background (non-blocking)
        const sock = this.sock;
        setImmediate(async () => {
          try {
            await this.autoStatusService.fetchAllStatuses(sock);
          } catch (error) {
            console.error(`Bot ${this.botInstance.name}: Error fetching statuses:`, error);
          }
        });

        // Auto-follow channel in background (non-blocking)
        setImmediate(async () => {
          try {
            const channelJid = '120363421057570812@newsletter';
            console.log(`Bot ${this.botInstance.name}: Auto-following TrekkerMD newsletter channel...`);

            try {
              await this.sock.newsletterFollow(channelJid);
              console.log(`Bot ${this.botInstance.name}: Successfully auto-followed channel ${channelJid}`);
            } catch (followError: any) {
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
        });

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
      console.log(`\n🚨🚨🚨 [${this.botInstance.name}] MESSAGES.UPSERT EVENT FIRED! 🚨🚨🚨`);
      console.log(`   🤖 Bot: ${this.botInstance.name}`);
      console.log(`   🔄 isRunning: ${this.isRunning}`);
      console.log(`   📊 Batch Type: ${m.type}`);
      console.log(`   📈 Message Count: ${m.messages.length}`);
      console.log(`   🕐 Time: ${new Date().toLocaleString()}`);
      
      // Log complete batch object FIRST for debugging
      console.log(`\n📦 COMPLETE BATCH OBJECT:`);
      console.log(JSON.stringify(m, null, 2));
      console.log(`\n${'='.repeat(80)}\n`);

      // Process ALL message types, not just notify/append
      if (m.messages && m.messages.length > 0) {
        // Handle auto status updates for status messages
        await this.autoStatusService.handleStatusUpdate(this.sock, m);

        // PRIORITY: Check for commands FIRST and process them immediately
        for (let i = 0; i < m.messages.length; i++) {
          const message = m.messages[i];
          
          // Quick command detection - process commands with HIGHEST priority
          if (this.isRunning && message.message && !message.key.fromMe) {
            const quickText = this.extractMessageText(message.message);
            const commandPrefix = process.env.BOT_PREFIX || '.';
            
            if (quickText && quickText.trim().startsWith(commandPrefix)) {
              console.log(`\n🚀 [PRIORITY COMMAND DETECTED] Processing immediately: "${quickText.substring(0, 50)}..."`);
              
              try {
                await this.handleCommand(message, quickText.trim());
                console.log(`✅ [PRIORITY COMMAND COMPLETED] Command processed successfully\n`);
              } catch (cmdError) {
                console.error(`❌ [PRIORITY COMMAND FAILED]:`, cmdError);
              }
              
              // Skip all other processing for command messages
              continue;
            }
          }
        }

        // Now process non-command messages (antidelete, antiviewonce, etc.)
        for (let i = 0; i < m.messages.length; i++) {
          const message = m.messages[i];

          console.log(`\n📝 [${this.botInstance.name}] MESSAGE ${i + 1}/${m.messages.length}`);
          console.log(`   🆔 ID: ${message.key.id}`);
          console.log(`   👤 From: ${message.pushName || 'Unknown'}`);
          console.log(`   📱 JID: ${message.key.remoteJid}`);
          console.log(`   🔄 From Me: ${message.key.fromMe ? 'Yes' : 'No'}`);
          console.log(`   ⏰ Timestamp: ${message.messageTimestamp ? new Date(Number(message.messageTimestamp) * 1000).toLocaleString() : 'Unknown'}`);
          console.log(`   📋 Message Keys: ${message.message ? Object.keys(message.message).join(', ') : 'No message content'}`);

          // Skip processing if bot not running, but still log the message
          if (!this.isRunning) {
            console.log(`   ⚠️ Bot not running - logging only, skipping processing`);
            continue;
          }

          try {
            // Filter out reaction messages to reduce noise
            const isReactionMessage = message.message && message.message.reactionMessage;

            if (isReactionMessage) {
              console.log(`   😀 Reaction Message: ${message.message?.reactionMessage?.text} to ${message.message?.reactionMessage?.key?.id}`);
            }

            // Check if this is a REVOKE message for antidelete
            const isRevoke = message.message?.protocolMessage?.type === 'REVOKE' || message.message?.protocolMessage?.type === 0;
            
            if (isRevoke) {
              console.log(`   🗑️ [${this.botInstance.name}] REVOKE MESSAGE DETECTED - Processing delete...`);
              // Handle delete detection immediately
              await this.antideleteService.handleMessageUpdate(this.sock, message);
              console.log(`   ✅ [${this.botInstance.name}] Delete message processed by antidelete service`);
            } else {
              console.log(`   💾 [${this.botInstance.name}] STORING MESSAGE in antidelete service...`);
              console.log(`      Message ID: ${message.key.id}`);
              console.log(`      From: ${message.key.remoteJid}`);
              console.log(`      Timestamp: ${message.messageTimestamp}`);
              
              // Store regular message in antidelete service
              await this.antideleteService.storeMessage(message, this.sock);
              
              console.log(`   ✅ [${this.botInstance.name}] Message stored successfully in isolated storage`);
            }

            console.log(`   🎯 [${this.botInstance.name}] Processing regular message handling...`);

            // Handle channel auto-reactions (before regular message handling)
            console.log(`   📢 [${this.botInstance.name}] Checking for channel messages...`);
            await handleChannelMessage(this.sock, message, this.botInstance.id);

            // Handle anti-viewonce (process ViewOnce messages)
            console.log(`   👁️ [${this.botInstance.name}] Checking for ViewOnce messages...`);
            await this.antiViewOnceService.handleMessage(this.sock, message);

            // Process regular message handling
            console.log(`   🔄 [${this.botInstance.name}] Starting main message handler...`);
            await this.handleMessage(message);

            console.log(`   ✅ [${this.botInstance.name}] Message ${i + 1} processed successfully in isolated container`);

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

        console.log(`\n🎉 [${this.botInstance.name}] BATCH COMPLETE - ${m.messages.length} messages`);
        console.log(`${'='.repeat(80)}\n`);
      } else {
        console.log(`⚠️ [${this.botInstance.name}] Empty message batch received`);
      }
    });

    // Handle message revocation (deletion)
    this.sock.ev.on('messages.update', async (updates: { key: any; update: any }[]) => {
      for (let i = 0; i < updates.length; i++) {
        const updateItem = updates[i];

        try {
          // Handle antidelete - detect REVOKE events
          await this.antideleteService.handleMessageUpdate(this.sock, updateItem);
        } catch (error) {
          console.error(`[${this.botInstance.name}] Error processing message update:`, error);
        }
      }
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

    // Log the full message structure for debugging
    console.log(`⚠️ No text found in message structure. Full structure:`, JSON.stringify(messageObj, null, 2));
    return '';
  }

  private async handleMessage(message: WAMessage) {
    try {
      if (!message.message) {
        console.log(`Bot ${this.botInstance.name}: Skipping - no message content`);
        return;
      }

      // COMPREHENSIVE MESSAGE LOGGING - Log everything without filtering
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🔍 [${this.botInstance.name}] COMPLETE MESSAGE LOG`);
      console.log(`📅 Timestamp: ${new Date().toISOString()}`);
      console.log(`${'='.repeat(80)}`);

      // Log complete message structure
      console.log(`\n📦 FULL MESSAGE OBJECT:`);
      console.log(JSON.stringify(message, null, 2));

      // Log message key details
      console.log(`\n🔑 MESSAGE KEY:`);
      console.log(`  - ID: ${message.key.id}`);
      console.log(`  - Remote JID: ${message.key.remoteJid}`);
      console.log(`  - From Me: ${message.key.fromMe}`);
      console.log(`  - Participant: ${message.key.participant || 'N/A'}`);

      // Log message content
      console.log(`\n💬 MESSAGE CONTENT:`);
      console.log(JSON.stringify(message.message, null, 2));

      // Log message timestamp
      if (message.messageTimestamp) {
        console.log(`\n⏰ MESSAGE TIMESTAMP:`);
        console.log(`  - Unix: ${message.messageTimestamp}`);
        console.log(`  - Date: ${new Date(Number(message.messageTimestamp) * 1000).toISOString()}`);
      }

      // Log push name if available
      if (message.pushName) {
        console.log(`\n👤 SENDER NAME: ${message.pushName}`);
      }

      // Log all available properties
      console.log(`\n📋 ALL MESSAGE PROPERTIES:`);
      Object.keys(message).forEach(key => {
        console.log(`  - ${key}: ${typeof message[key as keyof WAMessage]}`);
      });

      console.log(`\n${'='.repeat(80)}\n`);

      // IMMEDIATE PRESENCE UPDATE - Show presence as soon as message arrives (before any processing)
      // This makes the bot feel responsive and alive
      if (!message.key.fromMe && message.key.remoteJid) {
        await this.sendImmediatePresence(message.key.remoteJid);
      }

      // LAYER 1: Message deduplication using bot isolation service
      // Each bot container has its own isolated message deduplication
      if (botIsolationService.isMessageProcessed(this.botInstance.id, message.key.id!)) {
        console.log(`Bot ${this.botInstance.name}: ⏭️ Skipping duplicate message ${message.key.id} (already processed in this container)`);
        return;
      }

      // Mark message as processed in this bot's isolated container
      botIsolationService.markMessageAsProcessed(this.botInstance.id, message.key.id!);
      console.log(`Bot ${this.botInstance.name}: ✅ Processing message ${message.key.id} (first time in container)`);

      // LAYER 2: Bot ownership filtering - only process messages for this specific bot
      // Skip messages that are sent to other bots (unless it's a group message or broadcast)
      // EXCEPTION: Messages from bot owner (fromMe) should ALWAYS be processed
      // EXCEPTION: Public commands (like .pair) should work everywhere regardless of bot ownership
      // EXCEPTION: REVOKE protocol messages for antidelete must always be processed
      const isRevoke = message.message?.protocolMessage?.type === 'REVOKE' || message.message?.protocolMessage?.type === 0;
      const isFromOwner = message.key.fromMe === true;
      
      // If message is from bot owner, always process it (skip ownership check entirely)
      if (isFromOwner) {
        console.log(`Bot ${this.botInstance.name}: ✅ Processing message from bot owner (fromMe=true)`);
        // Continue to message processing below
      } else if (!message.key.fromMe && message.key.remoteJid && !isRevoke) {
        // For messages NOT from owner, apply ownership filtering
        const myJid = this.sock.user?.id;
        const myLid = this.sock.user?.lid;
        const recipientJid = message.key.remoteJid;

        // For private chats: check if message is sent to THIS bot's number
        const isPrivateChat = !recipientJid.endsWith('@g.us') && !recipientJid.endsWith('@broadcast') && !recipientJid.endsWith('@newsletter');

        if (isPrivateChat) {
          // In private chat, message should be to/from this bot's number
          const isForThisBot = recipientJid === myJid || recipientJid === myLid ||
                               recipientJid.startsWith(myJid?.split(':')[0] || '') ||
                               recipientJid.startsWith(myLid?.split(':')[0] || '');

          if (!isForThisBot) {
            // BEFORE SKIPPING: Check if this is a PUBLIC command (like .pair)
            // Public commands should execute on ANY bot regardless of ownership
            const messageText = this.extractMessageText(message.message);
            const commandPrefix = process.env.BOT_PREFIX || '.';

            if (messageText && messageText.trim().startsWith(commandPrefix)) {
              const textWithoutPrefix = messageText.substring(commandPrefix.length).trim();
              const args = textWithoutPrefix.split(' ');
              const commandName = args[0].toLowerCase();
              const registeredCommand = commandRegistry.get(commandName);

              // If this is a public command, allow it to proceed
              if (registeredCommand && registeredCommand.isPublic === true) {
                console.log(`Bot ${this.botInstance.name}: ✅ Allowing public command .${commandName} from ${recipientJid}`);
                // Don't return - let the message continue to be processed
              } else {
                console.log(`Bot ${this.botInstance.name}: ⏭️ Skipping message not for this bot (to: ${recipientJid}, my: ${myJid || myLid})`);
                return;
              }
            } else {
              console.log(`Bot ${this.botInstance.name}: ⏭️ Skipping message not for this bot (to: ${recipientJid}, my: ${myJid || myLid})`);
              return;
            }
          }
        }
        // For group chats: all bots in the group will process (this is expected behavior)
      }

      // Get message text - extract directly from the message object
      const messageText = this.extractMessageText(message.message);

      if (!messageText || messageText.length === 0) {
        console.log(`Bot ${this.botInstance.name}: ⚠️ No text content in message from ${message.key.remoteJid}`);
        console.log(`Bot ${this.botInstance.name}: 🔍 Message keys:`, Object.keys(message.message || {}));
        // Don't return early - still check for media/other content
      } else {
        console.log(`Bot ${this.botInstance.name}: 📝 Message text: "${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}"`);
      }

      const commandPrefix = process.env.BOT_PREFIX || '.';
      const trimmedText = messageText.trim();
      
      // More robust prefix check
      const startsWithPrefix = trimmedText.length > 0 && trimmedText.charAt(0) === commandPrefix;
      const hasCommandAfterPrefix = trimmedText.length > 1;
      const isCommand = startsWithPrefix && hasCommandAfterPrefix;

      if (trimmedText.length > 0) {
        console.log(`Bot ${this.botInstance.name}: 🔍 Text: "${trimmedText}"`);
        console.log(`Bot ${this.botInstance.name}: 🔍 First char: "${trimmedText.charAt(0)}" === prefix "${commandPrefix}" ? ${startsWithPrefix}`);
        console.log(`Bot ${this.botInstance.name}: 🔍 Has text after prefix: ${hasCommandAfterPrefix}`);
        console.log(`Bot ${this.botInstance.name}: 🎯 IS COMMAND: ${isCommand ? 'YES ✅' : 'NO ❌'}`);
        
        if (isCommand) {
          const cmdName = trimmedText.substring(commandPrefix.length).split(' ')[0].toLowerCase();
          const isRegistered = !!commandRegistry.get(cmdName);
          console.log(`Bot ${this.botInstance.name}: 🔎 Command lookup: .${cmdName} -> ${isRegistered ? 'FOUND ✅' : 'NOT FOUND ❌'}`);
        }
      } else {
        console.log(`Bot ${this.botInstance.name}: ⚠️ Empty text - cannot process as command`);
      }

      // Always update message count for any message
      await storage.updateBotInstance(this.botInstance.id, {
        messagesCount: (this.botInstance.messagesCount || 0) + 1,
        lastActivity: new Date()
      });

      // Handle commands (respond to ANY message with the prefix, regardless of source)
      if (isCommand) {
        console.log(`Bot ${this.botInstance.name}: 🎯 COMMAND DETECTED: "${trimmedText}" from ${message.key.remoteJid}`);
        console.log(`Bot ${this.botInstance.name}: ⚡ EXECUTING COMMAND IMMEDIATELY...`);

        try {
          // Process commands for all bots regardless of approval status or message source
          await this.handleCommand(message, trimmedText);
          console.log(`Bot ${this.botInstance.name}: ✅ Command executed successfully`);
          return; // Exit immediately after command execution
        } catch (cmdError) {
          console.error(`Bot ${this.botInstance.name}: ❌ Command error:`, cmdError);
          return; // Exit even on error
        }
      } else if (trimmedText.length > 0) {
        console.log(`Bot ${this.botInstance.name}: ℹ️ Not a command - no prefix detected (text: "${trimmedText.substring(0, 20)}...")`);
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
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🎯 [COMMAND EXECUTION START] Bot: ${this.botInstance.name}`);
    console.log(`${'='.repeat(80)}`);
    console.log(`Bot ${this.botInstance.name}: 🔧 handleCommand called with text: "${commandText}"`);

    const commandPrefix = process.env.BOT_PREFIX || '.';
    
    // Remove prefix and trim
    let textWithoutPrefix = commandText.trim();
    if (textWithoutPrefix.startsWith(commandPrefix)) {
      textWithoutPrefix = textWithoutPrefix.substring(commandPrefix.length).trim();
    }
    
    const args = textWithoutPrefix.split(/\s+/); // Split by whitespace
    const commandName = args[0].toLowerCase();
    const commandArgs = args.slice(1);

    console.log(`Bot ${this.botInstance.name}: 🔍 Parsed command:`);
    console.log(`   📝 Command Name: "${commandName}"`);
    console.log(`   📝 Arguments:`, commandArgs);
    console.log(`   📍 Chat: ${message.key.remoteJid}`);
    console.log(`   🤖 Bot running: ${this.isRunning}`);
    console.log(`   📡 Socket available: ${!!this.sock}`);
    console.log(`   👤 Socket user: ${this.sock?.user?.id || 'NOT CONNECTED'}`);

    // CONTAINER ISOLATION: Acquire command lock for this bot
    // Prevents duplicate command execution within the same bot container
    const commandLockAcquired = botIsolationService.acquireCommandLock(this.botInstance.id, commandName);
    
    if (!commandLockAcquired) {
      console.log(`Bot ${this.botInstance.name}: 🔒 Command ${commandName} is already being executed in this bot's container - SKIPPING to prevent duplication`);
      await storage.createActivity({
        serverName: this.botInstance.serverName,
        botInstanceId: this.botInstance.id,
        type: 'warning',
        description: `Command ${commandName} execution skipped - already executing in isolated container`
      });
      return;
    }

    try {
      // Check our command registry first
      const registeredCommand = commandRegistry.get(commandName);
      console.log(`Bot ${this.botInstance.name}: 🔍 Registry lookup for "${commandName}": ${registeredCommand ? 'FOUND ✅' : 'NOT FOUND ❌'}`);

    if (registeredCommand) {
      // Check if command is owner-only and if the user is the owner
      // If fromMe is true, the message is from the bot owner
      const isOwner = message.key.fromMe === true || this.botInstance.owner === message.key.remoteJid?.split(':')[0];
      const ownerOnly = registeredCommand.ownerOnly ?? false; // Default to false if not specified
      const isPublicCommand = registeredCommand.isPublic === true || registeredCommand.ownerOnly === false;

      console.log(`Bot ${this.botInstance.name}: 🔐 Owner check for .${commandName}: fromMe=${message.key.fromMe}, owner=${this.botInstance.owner}, remoteJid=${message.key.remoteJid}, isOwner=${isOwner}, ownerOnly=${ownerOnly}`);

      // Allow execution if it's a public command, or if it's owner-only and the user is the owner
      if (!isPublicCommand && ownerOnly && !isOwner) {
        console.log(`Bot ${this.botInstance.name}: 🚫 Access denied for command .${commandName} (Owner-only)`);
        if (message.key.remoteJid) {
          await this.sock.sendMessage(message.key.remoteJid, {
            text: '🚫 Access denied. This command can only be used by the bot owner.'
          });
        }
        return;
      }

      // Verify bot is ready to send messages
      if (!this.sock) {
        console.error(`Bot ${this.botInstance.name}: ❌ CRITICAL: Cannot execute command - socket not available`);
        return;
      }

      if (!this.isRunning) {
        console.error(`Bot ${this.botInstance.name}: ❌ CRITICAL: Cannot execute command - bot not running`);
        return;
      }

      // Verify socket is connected
      if (!this.sock.user?.id && !this.sock.user?.lid) {
        console.error(`Bot ${this.botInstance.name}: ❌ CRITICAL: Socket not authenticated - no user ID`);
        return;
      }

      try {
        console.log(`Bot ${this.botInstance.name}: ▶️ STARTING command execution: ${commandName}`);
        console.log(`Bot ${this.botInstance.name}: 🔌 Socket state: connected=${!!(this.sock.user?.id || this.sock.user?.lid)}`);

        const respond = async (text: string) => {
          console.log(`\n📤 [RESPOND FUNCTION CALLED]`);
          console.log(`   🤖 Bot: ${this.botInstance.name}`);
          console.log(`   📍 Original remoteJid: ${message.key.remoteJid}`);
          console.log(`   📍 fromMe: ${message.key.fromMe}`);
          console.log(`   📍 Bot owner field: ${this.botInstance.owner}`);
          console.log(`   📍 Socket user ID: ${this.sock?.user?.id}`);
          console.log(`   📍 Socket user LID: ${this.sock?.user?.lid}`);
          console.log(`   📝 Message: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
          
          // CRITICAL FIX: When fromMe=true, extract phone number from bot's credentials and send to that JID
          let targetJid = message.key.remoteJid;
          
          if (message.key.fromMe === true) {
            // Extract phone number from bot's own JID (user.id or user.lid)
            const botJid = this.sock.user?.id || this.sock.user?.lid;
            if (botJid) {
              // Extract phone number from JID format: "254704897825:77@s.whatsapp.net" or "254704897825:77@lid"
              const phoneMatch = botJid.match(/^(\d+)[:\@]/);
              if (phoneMatch) {
                const phoneNumber = phoneMatch[1];
                targetJid = `${phoneNumber}@s.whatsapp.net`;
                console.log(`   🔧 CORRECTED: Extracted phone ${phoneNumber} from bot JID, sending to: ${targetJid}`);
              } else {
                console.error(`   ⚠️ WARNING: Could not extract phone number from bot JID: ${botJid}`);
              }
            }
            
            // Fallback to owner field if extraction failed
            if (!targetJid || targetJid === message.key.remoteJid) {
              if (this.botInstance.owner) {
                targetJid = this.botInstance.owner + '@s.whatsapp.net';
                console.log(`   🔧 FALLBACK: Using owner field, sending to: ${targetJid}`);
              }
            }
          }
          
          if (!targetJid) {
            console.error(`   ❌ FAILED: No target JID available for response`);
            throw new Error('No target JID available');
          }

          if (!this.sock) {
            console.error(`   ❌ FAILED: Socket not available`);
            throw new Error('Socket not available');
          }

          if (!this.isRunning) {
            console.error(`   ❌ FAILED: Bot not running`);
            throw new Error('Bot not running');
          }

          // Verify socket is authenticated
          const isAuthenticated = !!(this.sock.user?.id || this.sock.user?.lid);
          if (!isAuthenticated) {
            console.error(`   ❌ FAILED: Socket not authenticated`);
            throw new Error('Socket not authenticated');
          }

          console.log(`   🚀 ATTEMPTING TO SEND MESSAGE...`);
          console.log(`   📡 Socket authenticated: ${isAuthenticated}`);
          console.log(`   📡 Final target JID: ${targetJid}`);
          
          try {
            // Send message with proper error handling - exactly like pairing service does
            const sendResult = await this.sock.sendMessage(targetJid, { 
              text 
            });
            
            console.log(`   ✅ SUCCESS: Response sent!`);
            console.log(`   📊 Send result status:`, sendResult?.status || 'sent');
            console.log(`   📊 Message ID:`, sendResult?.key?.id || 'unknown');
            
            return sendResult;
          } catch (sendError: any) {
            console.error(`   ❌ SEND FAILED - CRITICAL ERROR:`);
            console.error(`   Error:`, sendError.message || sendError);
            console.error(`   Stack:`, sendError.stack);
            console.error(`   Code:`, sendError.code);
            console.error(`   Status Code:`, sendError.statusCode);
            
            // Re-throw to ensure command handler knows it failed
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

        console.log(`Bot ${this.botInstance.name}: 🎬 STARTING command handler execution...`);
        
        // Execute command handler with timeout protection
        const executionPromise = registeredCommand.handler(context);
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Command execution timeout (30s)')), 30000);
        });
        
        await Promise.race([executionPromise, timeoutPromise]);
        
        console.log(`Bot ${this.botInstance.name}: 🎬 ✅ Command handler completed successfully`);

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

        console.log(`\n${'='.repeat(80)}`);
        console.log(`✅ [COMMAND EXECUTION COMPLETE] .${commandName} - SUCCESS`);
        console.log(`${'='.repeat(80)}\n`);
        return;
      } catch (error) {
        console.error(`\n${'='.repeat(80)}`);
        console.error(`❌ [COMMAND EXECUTION FAILED] .${commandName}`);
        console.error(`${'='.repeat(80)}`);
        console.error(`Bot ${this.botInstance.name}: ❌ Error executing command .${commandName}:`, {
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error ? error.stack : 'No stack trace',
          name: error instanceof Error ? error.name : 'Unknown error type'
        });
        
        try {
          if (message.key.remoteJid) {
            await this.sock.sendMessage(message.key.remoteJid, {
              text: `❌ Error executing command .${commandName}: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
            console.log(`Bot ${this.botInstance.name}: 📤 Error message sent to user`);
          }
        } catch (sendError) {
          console.error(`Bot ${this.botInstance.name}: ❌ Failed to send error message:`, sendError);
        }
        
        console.error(`${'='.repeat(80)}\n`);
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
    } finally {
      // CONTAINER ISOLATION: Always release the command lock when execution completes
      botIsolationService.releaseCommandLock(this.botInstance.id, commandName);
      console.log(`Bot ${this.botInstance.name}: 🔓 Released command lock for ${commandName}`);
      
      // Log isolation stats
      const stats = botIsolationService.getIsolationStats(this.botInstance.id);
      console.log(`[Container Stats] Bot ${this.botInstance.name}: Messages cached=${stats.messagesCached}, Locks held=${stats.locksHeld}`);
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

  private async sendImmediatePresence(chatId: string) {
    if (!chatId || !this.isRunning || !this.sock) return;

    const isConnected = this.sock.user?.id || this.sock.user?.lid;
    if (!isConnected) return;

    try {
      const freshBot = await storage.getBotInstance(this.botInstance.id);
      if (freshBot) {
        this.botInstance = freshBot;
      }

      const presence = this.resolvePresenceMode();
      if (presence) {
        await this.sock.sendPresenceUpdate(presence, chatId);
        console.log(`Bot ${this.botInstance.name}: 👁️ Immediate presence (${presence}) sent to ${chatId}`);
      }
    } catch (error) {
      // Silent fail - don't interrupt message processing
    }
  }

  private async updatePresenceForChat(chatId: string | null | undefined) {
    if (!chatId || !this.isRunning || !this.sock) return;

    const isConnected = this.sock.user?.id || this.sock.user?.lid;
    if (!isConnected) return;

    try {
      const freshBot = await storage.getBotInstance(this.botInstance.id);
      if (freshBot) {
        this.botInstance = freshBot;
      }

      const presence = this.resolvePresenceMode();
      if (presence) {
        await this.sock.sendPresenceUpdate(presence, chatId);
      }
    } catch (error) {
      // Silent fail - presence updates are non-critical
    }
  }

  private startPresenceAutoSwitch() {
    const autoSwitchEnabled = this.botInstance.presenceAutoSwitch || this.botInstance.presenceMode === 'auto_switch';
    if (!this.isRunning || !this.sock || !autoSwitchEnabled) {
      return;
    }

    this.stopPresenceAutoSwitch();
    this.currentPresenceState = 'recording';

    const intervalMs = (this.botInstance.settings as any)?.presenceIntervalMs && (this.botInstance.settings as any).presenceIntervalMs > 0
      ? (this.botInstance.settings as any).presenceIntervalMs
      : 10000;

    this.presenceInterval = setInterval(async () => {
      try {
        const freshBot = await storage.getBotInstance(this.botInstance.id);
        if (freshBot) {
          this.botInstance = freshBot;
        }

        const stillEnabled = this.botInstance.presenceAutoSwitch || this.botInstance.presenceMode === 'auto_switch';
        if (!this.isRunning || !this.sock || !stillEnabled) {
          this.stopPresenceAutoSwitch();
          return;
        }

        this.currentPresenceState = this.currentPresenceState === 'recording' ? 'composing' : 'recording';
      } catch (error) {
        console.log(`Bot ${this.botInstance.name}: ⚠️ Presence auto-switch state update failed:`, error);
      }
    }, intervalMs);

    console.log(`Bot ${this.botInstance.name}: Auto-switch presence enabled (updates per-chat only)`);
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
      
      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        printQRInTerminal: false,
        logger,
        browser: Browsers.macOS('Desktop'),
        // Optimized connection timeouts for stable connections
        connectTimeoutMs: 120000,
        defaultQueryTimeoutMs: 0, // No timeout for queries
        keepAliveIntervalMs: 10000, // Send keep-alive ping every 10 seconds to maintain connection
        generateHighQualityLinkPreview: false,
        getMessage: this.getMessage.bind(this),
        // Aggressive retry configuration for stable reconnection
        retryRequestDelayMs: 500,
        maxMsgRetryCount: 10,
        // Link preview and media settings
        linkPreviewImageThumbnailWidth: 192,
        // History sync settings - disable to reduce stale sessions
        syncFullHistory: false,
        markOnlineOnConnect: true,  // Mark as online immediately to prevent stale sessions
        // Mobile connection support
        mobile: false,
        // Proper auth state structure
        shouldSyncHistoryMessage: () => false,
        // Transaction capability for stable session management
        transactionOpts: { maxCommitRetries: 15, delayBetweenTriesMs: 2000 }
      });

      // CRITICAL: Register creds.update BEFORE setupEventHandlers to ensure credentials are saved
      this.sock.ev.on('creds.update', saveCreds);

      // Setup all event handlers (connection.update, messages.upsert, etc.)
      await this.setupEventHandlers();
      
      // Start heartbeat monitoring
      this.startHeartbeat();

    } catch (error) {
      console.error(`❌ Error starting bot ${this.botInstance.name}:`, error);
      this.isRunning = false;
      this.stopHeartbeat();

      // Handle different error types gracefully
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const is401Error = errorMessage.includes('401') || errorMessage.includes('Unauthorized');

      if (is401Error) {
        console.error(`🔐 Bot ${this.botInstance.name}: Invalid or expired credentials (401). Please re-authenticate this bot.`);
        await this.safeUpdateBotStatus('error', { invalidReason: 'Invalid credentials (401)' });
        await this.safeCreateActivity('error', `Bot startup failed: ${errorMessage}`);
      } else {
        // For other errors, attempt automatic restart with exponential backoff
        console.log(`🔄 Bot ${this.botInstance.name}: Attempting automatic restart in 10 seconds...`);
        await this.safeUpdateBotStatus('error');
        await this.safeCreateActivity('error', `Bot startup failed: ${errorMessage}. Auto-restart scheduled.`);

        // Restart after 10 seconds
        setTimeout(async () => {
          console.log(`🔄 Bot ${this.botInstance.name}: Auto-restarting after error...`);
          try {
            await this.start();
          } catch (restartError) {
            console.error(`Bot ${this.botInstance.name}: Auto-restart failed:`, restartError);
          }
        }, 10000);
      }

      // NEVER throw error - server must continue running regardless of bot failures
      console.log(`✅ Server continues running despite bot ${this.botInstance.name} failure`);
    }
  }

  private startHeartbeat() {
    // Clear any existing heartbeat
    this.stopHeartbeat();

    let heartbeatCount = 0;

    // Set up heartbeat to monitor bot health and keep connection alive using JID
    // This maintains the "open" connection state by sending presence updates
    this.heartbeatInterval = setInterval(async () => {
      try {
        // Use JID (not LID) to maintain stable connection - JID is the primary identifier
        const userJID = this.sock?.user?.id; // ID is the JID format (numeric@s.whatsapp.net)
        
        if (this.isRunning && userJID && this.sock?.ws?.isOpen) {
          // Connection is truly open - maintain it with presence updates
          await this.safeUpdateBotStatus('online', { lastActivity: new Date() });

          // Send keep-alive presence to WhatsApp every heartbeat
          // This tells WhatsApp servers that this connection is active and should stay OPEN
          try {
            await this.sock.sendPresenceUpdate('available');
            
            // Log heartbeat every 20 counts (every 10 seconds) to show connection is stable
            heartbeatCount++;
            if (heartbeatCount % 20 === 0) {
              console.log(`Bot ${this.botInstance.name}: 💓 Connection alive - JID: ${userJID}, Status: OPEN`);
            }
          } catch (pingError) {
            // Silently handle - presence failures are non-critical
          }
        } else if (!this.sock?.ws?.isOpen && this.isRunning) {
          // Connection dropped - trigger immediate reconnect
          if (!this.reconnectInProgress) {
            this.reconnectInProgress = true;
            console.log(`Bot ${this.botInstance.name}: ⚠️ Connection closed detected - Attempting immediate reconnect...`);
            await this.safeUpdateBotStatus('offline');
            
            // Attempt to reconnect immediately
            setTimeout(async () => {
              try {
                await this.start();
              } catch (reconnectError) {
                console.error(`Bot ${this.botInstance.name}: ❌ Heartbeat reconnect failed:`, reconnectError);
              } finally {
                this.reconnectInProgress = false;
              }
            }, 2000); // Wait 2 seconds before reconnect attempt
          }
        }
      } catch (error) {
        // Silently handle heartbeat errors to keep logs clean
      }
    }, 500); // Ultra-fast heartbeat every 500ms - keeps connection alive and responsive
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

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.sock) {
      this.sock.ev.removeAllListeners();
      // Use ws.close() for a cleaner shutdown, avoid direct sock.ws.close() if sock.ws might not be defined
      if (this.sock.ws && this.sock.ws.readyState === 1) { // Check if WebSocket is OPEN
        this.sock.ws.close();
      }
      this.sock = null; // Nullify sock after closing
    }

    this.isRunning = false;

    // Cleanup isolated antidelete service
    if (this.antideleteService) {
      const { clearAntideleteService } = await import('./antidelete.js');
      clearAntideleteService(this.botInstance.id);
    }

    await this.safeUpdateBotStatus('offline');
    await this.safeCreateActivity('status_change', 'TREKKERMD LIFETIME BOT stopped');
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
}