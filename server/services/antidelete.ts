import fs, { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { writeFile } from 'fs/promises';
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';

interface StoredMessage {
  id: string;
  fromJid: string;
  senderJid: string;
  content: string;
  type: string;
  timestamp: number;
  originalMessage: WAMessage;
  mediaInfo?: { type: string, path: string } | null;
}

interface AntideleteConfig {
  enabled: boolean;
}

export class AntideleteService {
  private messageStore = new Map<string, StoredMessage>();
  private configPath: string;
  private tempMediaDir: string;
  private messageStorePath: string;
  private processedMessages = new Set<string>(); // To prevent processing the same message multiple times

  constructor() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    this.configPath = path.join(__dirname, '../data/antidelete.json');
    this.tempMediaDir = path.join(__dirname, '../tmp');
    this.messageStorePath = path.join(__dirname, '../data/message-store.json');

    // Ensure directories exist
    this.ensureDirectories();

    // Clear stored messages from previous sessions
    this.loadMessageStore();

    // Also clear any old temp media files from previous sessions
    this.clearTempMedia();

    // Start periodic cleanup every minute
    setInterval(() => this.cleanTempFolderIfLarge(), 60 * 1000);

    // Save message store periodically (every 5 minutes)
    setInterval(() => this.saveMessageStore(), 5 * 60 * 1000);
  }

  private ensureDirectories(): void {
    const dataDir = path.dirname(this.configPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (!fs.existsSync(this.tempMediaDir)) {
      fs.mkdirSync(this.tempMediaDir, { recursive: true });
    }
  }

  private getFolderSizeInMB(folderPath: string): number {
    try {
      const files = fs.readdirSync(folderPath);
      let totalSize = 0;

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        if (fs.statSync(filePath).isFile()) {
          totalSize += fs.statSync(filePath).size;
        }
      }

      return totalSize / (1024 * 1024); // Convert bytes to MB
    } catch (err) {
      console.error('Error getting folder size:', err);
      return 0;
    }
  }

  private cleanTempFolderIfLarge(): void {
    try {
      const sizeMB = this.getFolderSizeInMB(this.tempMediaDir);

      if (sizeMB > 100) {
        const files = fs.readdirSync(this.tempMediaDir);
        for (const file of files) {
          const filePath = path.join(this.tempMediaDir, file);
          fs.unlinkSync(filePath);
        }
        console.log(`Cleaned temp folder - was ${sizeMB.toFixed(2)}MB`);
      }
    } catch (err) {
      console.error('Temp cleanup error:', err);
    }
  }

  private clearTempMedia(): void {
    try {
      if (fs.existsSync(this.tempMediaDir)) {
        const files = fs.readdirSync(this.tempMediaDir);
        for (const file of files) {
          const filePath = path.join(this.tempMediaDir, file);
          fs.unlinkSync(filePath);
        }
        if (files.length > 0) {
          console.log(`🧹 Cleared ${files.length} temp media files from previous session`);
        }
      }
    } catch (err) {
      console.error('Error clearing temp media:', err);
    }
  }

  private loadAntideleteConfig(): AntideleteConfig {
    try {
      if (!fs.existsSync(this.configPath)) {
        return { enabled: true };
      }
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    } catch {
      return { enabled: true };
    }
  }

  private saveAntideleteConfig(config: AntideleteConfig): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      console.error('Config save error:', err);
    }
  }

  private loadMessageStore(): void {
    try {
      if (fs.existsSync(this.messageStorePath)) {
        // Delete the existing message store file instead of loading it
        fs.unlinkSync(this.messageStorePath);
        console.log('🗑️ Deleted old stored messages from previous session');
      }
      // Always start with a fresh, empty message store
      this.messageStore = new Map();
      console.log('✨ Started with fresh message store for antidelete');
    } catch (err) {
      console.error('Error clearing message store:', err);
      this.messageStore = new Map();
    }
  }

  private saveMessageStore(): void {
    try {
      // Convert Map to plain object for JSON storage
      const messageObj = Object.fromEntries(this.messageStore);
      fs.writeFileSync(this.messageStorePath, JSON.stringify(messageObj, null, 2));
    } catch (err) {
      console.error('Error saving message store:', err);
    }
  }

  async handleAntideleteCommand(sock: WASocket, chatId: string, message: WAMessage, match?: string): Promise<void> {
    if (!message.key.fromMe) {
      await sock.sendMessage(chatId, { text: '*Only the bot owner can use this command.*' });
      return;
    }

    const config = this.loadAntideleteConfig();

    if (!match) {
      await sock.sendMessage(chatId, {
        text: `*ANTIDELETE SETUP*\n\nCurrent Status: ${config.enabled ? '✅ Enabled' : '❌ Disabled'}\n\n*.antidelete on* - Enable\n*.antidelete off* - Disable`
      });
      return;
    }

    if (match === 'on') {
      config.enabled = true;
    } else if (match === 'off') {
      config.enabled = false;
    } else {
      await sock.sendMessage(chatId, { text: '*Invalid command. Use .antidelete to see usage.*' });
      return;
    }

    this.saveAntideleteConfig(config);
    await sock.sendMessage(chatId, { text: `*Antidelete ${match === 'on' ? 'enabled' : 'disabled'}*` });
  }

  // Helper to extract text from different message types
  private extractMessageText(message: any): string {
    if (!message) return '';
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
    if (message.imageMessage?.caption) return message.imageMessage.caption;
    if (message.videoMessage?.caption) return message.videoMessage.caption;
    if (message.audioMessage?.caption) return message.audioMessage.caption;
    if (message.stickerMessage?.caption) return message.stickerMessage.caption;
    if (message.documentMessage?.caption) return message.documentMessage.caption;
    if (message.viewOnceMessageV2?.message?.imageMessage?.caption) return message.viewOnceMessageV2.message.imageMessage.caption;
    if (message.viewOnceMessageV2?.message?.videoMessage?.caption) return message.viewOnceMessageV2.message.videoMessage.caption;
    return '';
  }

  // Helper to extract and save media
  private async extractAndSaveMedia(message: WAMessage): Promise<{ type: string, path: string }> {
    let mediaType = '';
    let mediaPath = '';
    const messageId = message.key.id;

    if (!messageId) {
      console.log('❌ [Antidelete] No message ID for media extraction');
      return { type: mediaType, path: mediaPath };
    }

    try {
      if (message.message?.imageMessage) {
        mediaType = 'image';
        try {
          const buffer = await downloadContentFromMessage(message.message.imageMessage, 'image');
          mediaPath = path.join(this.tempMediaDir, `${messageId}.jpg`);
          const chunks: Buffer[] = [];
          for await (const chunk of buffer) {
            chunks.push(chunk);
          }
          await writeFile(mediaPath, Buffer.concat(chunks));
          console.log(`✅ [Antidelete] Image saved: ${mediaPath}`);
        } catch (err) {
          console.error('❌ [Antidelete] Error downloading image:', err);
        }
      } else if (message.message?.stickerMessage) {
        mediaType = 'sticker';
        try {
          const buffer = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
          mediaPath = path.join(this.tempMediaDir, `${messageId}.webp`);
          const chunks: Buffer[] = [];
          for await (const chunk of buffer) {
            chunks.push(chunk);
          }
          await writeFile(mediaPath, Buffer.concat(chunks));
          console.log(`✅ [Antidelete] Sticker saved: ${mediaPath}`);
        } catch (err) {
          console.error('❌ [Antidelete] Error downloading sticker:', err);
        }
      } else if (message.message?.videoMessage) {
        mediaType = 'video';
        try {
          const buffer = await downloadContentFromMessage(message.message.videoMessage, 'video');
          mediaPath = path.join(this.tempMediaDir, `${messageId}.mp4`);
          const chunks: Buffer[] = [];
          for await (const chunk of buffer) {
            chunks.push(chunk);
          }
          await writeFile(mediaPath, Buffer.concat(chunks));
          console.log(`✅ [Antidelete] Video saved: ${mediaPath}`);
        } catch (err) {
          console.error('❌ [Antidelete] Error downloading video:', err);
        }
      } else if (message.message?.audioMessage) {
        mediaType = 'audio';
        try {
          const buffer = await downloadContentFromMessage(message.message.audioMessage, 'audio');
          mediaPath = path.join(this.tempMediaDir, `${messageId}.ogg`);
          const chunks: Buffer[] = [];
          for await (const chunk of buffer) {
            chunks.push(chunk);
          }
          await writeFile(mediaPath, Buffer.concat(chunks));
          console.log(`✅ [Antidelete] Audio saved: ${mediaPath}`);
        } catch (err) {
          console.error('❌ [Antidelete] Error downloading audio:', err);
        }
      } else if (message.message?.documentMessage) {
        mediaType = 'document';
        try {
          const buffer = await downloadContentFromMessage(message.message.documentMessage, 'document');
          const fileName = message.message.documentMessage.fileName || `${messageId}.bin`;
          mediaPath = path.join(this.tempMediaDir, fileName);
          const chunks: Buffer[] = [];
          for await (const chunk of buffer) {
            chunks.push(chunk);
          }
          await writeFile(mediaPath, Buffer.concat(chunks));
          console.log(`✅ [Antidelete] Document saved: ${mediaPath}`);
        } catch (err) {
          console.error('❌ [Antidelete] Error downloading document:', err);
        }
      } else if (message.message?.viewOnceMessageV2?.message?.imageMessage) {
        mediaType = 'image';
        try {
          const buffer = await downloadContentFromMessage(message.message.viewOnceMessageV2.message.imageMessage, 'image');
          mediaPath = path.join(this.tempMediaDir, `${messageId}-viewonce.jpg`);
          const chunks: Buffer[] = [];
          for await (const chunk of buffer) {
            chunks.push(chunk);
          }
          await writeFile(mediaPath, Buffer.concat(chunks));
          console.log(`✅ [Antidelete] ViewOnce image saved: ${mediaPath}`);
        } catch (err) {
          console.error('❌ [Antidelete] Error downloading view-once image:', err);
        }
      } else if (message.message?.viewOnceMessageV2?.message?.videoMessage) {
        mediaType = 'video';
        try {
          const buffer = await downloadContentFromMessage(message.message.viewOnceMessageV2.message.videoMessage, 'video');
          mediaPath = path.join(this.tempMediaDir, `${messageId}-viewonce.mp4`);
          const chunks: Buffer[] = [];
          for await (const chunk of buffer) {
            chunks.push(chunk);
          }
          await writeFile(mediaPath, Buffer.concat(chunks));
          console.log(`✅ [Antidelete] ViewOnce video saved: ${mediaPath}`);
        } catch (err) {
          console.error('❌ [Antidelete] Error downloading view-once video:', err);
        }
      }
    } catch (error) {
      console.error('❌ [Antidelete] General media extraction error:', error);
    }

    return { type: mediaType, path: mediaPath };
  }

  async storeMessage(message: WAMessage, sock?: WASocket): Promise<void> {
    try {
      const messageId = message.key.id;
      const fromJid = message.key.remoteJid;
      const senderJid = message.key.participant || message.key.fromMe ? 'self' : fromJid;

      if (!messageId || !fromJid) {
        console.log(`⚠️ [Antidelete] Skipping message - Missing ID or JID | ID: ${messageId} | JID: ${fromJid}`);
        return;
      }

      // Extract message content
      const messageContent = this.extractMessageContent(message);
      const messageType = this.getMessageType(message);
      const chatType = this.getChatType(fromJid);
      const timestamp = new Date().toLocaleString();

      // Extract and save media if present
      let mediaInfo: { type: string, path: string } | null = null;
      if (this.hasMediaContent(message)) {
        try {
          mediaInfo = await this.extractAndSaveMedia(message);
          console.log(`📎 [Antidelete] Media extracted: ${mediaInfo.type} saved to ${mediaInfo.path}`);
        } catch (error) {
          console.error(`❌ [Antidelete] Failed to extract media:`, error);
        }
      }

      // Check if this message already exists in store with content but now has empty content
      const existingMessage = this.messageStore.get(messageId);
      if (existingMessage && (existingMessage.content && existingMessage.content.trim() !== '' || existingMessage.mediaInfo) && 
          (!messageContent || messageContent.trim() === '') && !mediaInfo) {
        
        console.log(`🚨 [Antidelete] MESSAGE DELETION DETECTED VIA EMPTY CONTENT!`);
        console.log(`══════════════════════════════════════════════════════════`);
        console.log(`   🆔 Message ID: ${messageId}`);
        console.log(`   👤 Original Sender: ${existingMessage.senderJid}`);
        console.log(`   💬 Chat: ${chatType} (${fromJid})`);
        console.log(`   📝 Original Content: "${existingMessage.content}"`);
        console.log(`   📎 Original Media: ${existingMessage.mediaInfo ? existingMessage.mediaInfo.type : 'None'}`);
        console.log(`   🕐 Deletion Time: ${timestamp}`);
        console.log(`   🔄 Detection Method: Empty content replacement`);

        // Send deletion alert to bot owner only
        if (sock) {
          await this.sendDeletionAlertToBotOwner(sock, existingMessage, fromJid, 'Empty content replacement');
        } else {
          console.log(`⚠️ [Antidelete] No socket available for deletion alert`);
        }
        console.log(`══════════════════════════════════════════════════════════`);
      } 
      // Check for new empty content messages and search for recent messages from same chat
      else if ((!messageContent || messageContent.trim() === '') && !mediaInfo && messageType === 'unknown' && !message.key.fromMe) {
        console.log(`🚨 [Antidelete] EMPTY CONTENT MESSAGE DETECTED - SEARCHING FOR RECENT DELETIONS!`);
        console.log(`══════════════════════════════════════════════════════════`);
        console.log(`   🆔 Empty Message ID: ${messageId}`);
        console.log(`   💬 Chat: ${chatType} (${fromJid})`);
        console.log(`   🕐 Detection Time: ${timestamp}`);
        console.log(`   🔄 Detection Method: Empty content message`);

        // Search for recent messages from the same chat that have content or media
        const recentMessages = Array.from(this.messageStore.values())
          .filter(msg => 
            msg.fromJid === fromJid && 
            (msg.content && msg.content.trim() !== '' || msg.mediaInfo) &&
            !msg.originalMessage.key.fromMe &&
            (Date.now() - msg.timestamp) < 60000 // Within last 60 seconds
          )
          .sort((a, b) => b.timestamp - a.timestamp); // Most recent first

        if (recentMessages.length > 0) {
          const mostRecentMessage = recentMessages[0];
          console.log(`✅ [Antidelete] FOUND RECENT MESSAGE TO RESTORE!`);
          console.log(`   📝 Recent Message Content: "${mostRecentMessage.content}"`);
          console.log(`   📎 Recent Message Media: ${mostRecentMessage.mediaInfo ? mostRecentMessage.mediaInfo.type : 'None'}`);
          console.log(`   🆔 Recent Message ID: ${mostRecentMessage.id}`);
          console.log(`   👤 Original Sender: ${mostRecentMessage.senderJid}`);
          console.log(`   ⏱️ Time Since Message: ${Date.now() - mostRecentMessage.timestamp}ms`);

          // Send deletion alert to bot owner only
          if (sock) {
            await this.sendDeletionAlertToBotOwner(sock, mostRecentMessage, fromJid, 'Empty content detection');
          }
        } else {
          console.log(`❌ [Antidelete] NO RECENT MESSAGES FOUND TO RESTORE`);
          console.log(`   📊 Total stored messages: ${this.messageStore.size}`);
          console.log(`   🔍 Searched for messages from: ${fromJid}`);
        }
        console.log(`══════════════════════════════════════════════════════════`);
      }

      // Store or update in memory
      this.messageStore.set(messageId, {
        id: messageId,
        fromJid,
        senderJid,
        content: messageContent,
        type: messageType,
        timestamp: Date.now(),
        originalMessage: message,
        mediaInfo
      });

      // Comprehensive logging
      console.log(`📨 [Antidelete] INCOMING MESSAGE`);
      console.log(`   📍 Message ID: ${messageId}`);
      console.log(`   👤 From: ${message.pushName || 'Unknown'} (${senderJid})`);
      console.log(`   💬 Chat: ${chatType} (${fromJid})`);
      console.log(`   📝 Type: ${messageType}`);
      console.log(`   🕐 Time: ${timestamp}`);
      console.log(`   📄 Content: ${messageContent.substring(0, 100)}${messageContent.length > 100 ? '...' : ''}`);
      console.log(`   🔄 From Me: ${message.key.fromMe ? 'Yes' : 'No'}`);
      console.log(`   📊 Store Size: ${this.messageStore.size} messages`);

      // Log message structure for debugging
      if (message.message) {
        const messageKeys = Object.keys(message.message);
        console.log(`   🔧 Message Structure: [${messageKeys.join(', ')}]`);
      }

      // Log reactions if present
      if (message.message?.reactionMessage) {
        console.log(`   😀 Reaction: ${message.message.reactionMessage.text} to message ${message.message.reactionMessage.key?.id}`);
      }

      // Log quoted messages
      if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        console.log(`   💭 Contains quoted message`);
      }

      // Log media info
      if (this.hasMediaContent(message)) {
        console.log(`   📎 Contains media content`);
      }

      console.log(`   ✅ Successfully stored message ${messageId}`);
      console.log(`─────────────────────────────────────────────────────────`);

      // Cleanup old messages (keep last 1000)
      if (this.messageStore.size > 1000) {
        const oldestKey = this.messageStore.keys().next().value;
        this.messageStore.delete(oldestKey);
        console.log(`🧹 [Antidelete] Cleaned up oldest message: ${oldestKey}`);
      }

      // Persist to file periodically
      this.saveToFile();
    } catch (error) {
      console.error('❌ [Antidelete] Error storing message:', error);
      console.error('❌ [Antidelete] Error details:', {
        messageId: message.key?.id,
        fromJid: message.key?.remoteJid,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  getStoredMessage(messageId: string | undefined): StoredMessage | null {
    if (!messageId) return null;
    return this.messageStore.get(messageId) || null;
  }

  async handleMessageRevocation(sock: WASocket, revocationMessage: WAMessage): Promise<void> {
    try {
      const revokedMessageId = revocationMessage.message?.protocolMessage?.key?.id;
      const revokerJid = revocationMessage.key?.remoteJid;
      const participantJid = revocationMessage.key?.participant;
      const timestamp = new Date().toLocaleString();

      console.log(`🚨 [Antidelete] MESSAGE REVOCATION DETECTED!`);
      console.log(`══════════════════════════════════════════════════════════`);
      console.log(`   🆔 Revocation Message ID: ${revocationMessage.key?.id}`);
      console.log(`   🎯 Target Message ID: ${revokedMessageId}`);
      console.log(`   👤 Revoked by: ${participantJid || revokerJid}`);
      console.log(`   💬 Chat: ${this.getChatType(revokerJid)} (${revokerJid})`);
      console.log(`   🕐 Revocation Time: ${timestamp}`);
      console.log(`   📊 Protocol Type: ${revocationMessage.message?.protocolMessage?.type}`);

      if (!revokedMessageId || !revokerJid) {
        console.log(`❌ [Antidelete] Invalid revocation - Missing message ID or JID`);
        console.log(`   🔧 Debug Info:`);
        console.log(`      - Revoked Message ID: ${revokedMessageId}`);
        console.log(`      - Revoker JID: ${revokerJid}`);
        console.log(`      - Full revocation structure:`, JSON.stringify(revocationMessage, null, 2));
        return;
      }

      // Check if we have the original message
      const originalMessage = this.messageStore.get(revokedMessageId);

      if (originalMessage) {
        console.log(`✅ [Antidelete] ORIGINAL MESSAGE FOUND IN STORE!`);
        console.log(`   📝 Original Type: ${originalMessage.type}`);
        console.log(`   📄 Original Content: ${originalMessage.content}`);
        console.log(`   👤 Original Sender: ${originalMessage.senderJid}`);
        console.log(`   🕐 Original Timestamp: ${new Date(originalMessage.timestamp).toLocaleString()}`);
        console.log(`   ⏱️ Time Since Original: ${Date.now() - originalMessage.timestamp}ms`);

        // Log the restoration attempt
        console.log(`📤 [Antidelete] SENDING DELETION ALERT TO BOT OWNER...`);

        try {
          // Send deletion alert to bot owner only
          await this.sendDeletionAlertToBotOwner(sock, originalMessage, revokerJid, 'Message revocation');
          console.log(`✅ [Antidelete] DELETION ALERT SENT TO BOT OWNER!`);
        } catch (alertError) {
          console.error(`❌ [Antidelete] Failed to send deletion alert:`, alertError);
        }
      } else {
        console.log(`❌ [Antidelete] ORIGINAL MESSAGE NOT FOUND IN STORE!`);
        console.log(`   🔍 Searched for ID: ${revokedMessageId}`);
        console.log(`   📊 Store contains ${this.messageStore.size} messages`);
        console.log(`   🗂️ Available message IDs: [${Array.from(this.messageStore.keys()).slice(0, 10).join(', ')}${this.messageStore.size > 10 ? '...' : ''}]`);

        // Check if it might be a partial match
        const similarIds = Array.from(this.messageStore.keys()).filter(id =>
          id.includes(revokedMessageId.substring(0, 8)) || revokedMessageId.includes(id.substring(0, 8))
        );

        if (similarIds.length > 0) {
          console.log(`   🔍 Similar message IDs found: [${similarIds.join(', ')}]`);
        }
      }

      // Log server revocation request details
      console.log(`📡 [Antidelete] SERVER REVOCATION REQUEST DETAILS:`);
      console.log(`   🌐 Request from server: ${sock.user?.id || 'Unknown'}`);
      console.log(`   🔧 Socket connection: ${sock.ws?.readyState === 1 ? 'Active' : 'Inactive'}`);
      console.log(`   📊 Total stored messages: ${this.messageStore.size}`);

      console.log(`══════════════════════════════════════════════════════════`);

    } catch (error) {
      console.error('❌ [Antidelete] CRITICAL ERROR handling message revocation:', error);
      console.error('❌ [Antidelete] Full error details:', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        revocationMessage: revocationMessage,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Helper to get message type
  private getMessageType(message: WAMessage): string {
    if (!message.message) return 'empty';
    const messageKeys = Object.keys(message.message);
    if (messageKeys.length === 1) {
      return messageKeys[0];
    }
    return 'unknown';
  }

  // Helper to get chat type
  private getChatType(jid: string | undefined): string {
    if (!jid) return 'unknown';
    return jid.includes('@g.us') ? 'Group' : 'Private';
  }

  // Helper to extract message content, including media captions
  private extractMessageContent(message: WAMessage): string {
    if (!message.message) return '';
    let content = '';

    if (message.message.conversation) {
      content = message.message.conversation;
    } else if (message.message.extendedTextMessage?.text) {
      content = message.message.extendedTextMessage.text;
    } else if (message.message.imageMessage?.caption) {
      content = message.message.imageMessage.caption;
    } else if (message.message.videoMessage?.caption) {
      content = message.message.videoMessage.caption;
    } else if (message.message.audioMessage?.caption) {
      content = message.message.audioMessage.caption;
    } else if (message.message.stickerMessage?.caption) {
      content = message.message.stickerMessage.caption;
    } else if (message.message.documentMessage?.caption) {
      content = message.message.documentMessage.caption;
    } else if (message.message.viewOnceMessageV2?.message?.imageMessage?.caption) {
      content = message.message.viewOnceMessageV2.message.imageMessage.caption;
    } else if (message.message.viewOnceMessageV2?.message?.videoMessage?.caption) {
      content = message.message.viewOnceMessageV2.message.videoMessage.caption;
    } else if (message.message.templateButtonReplyMessage?.selectedDisplayText) {
      content = `[Button Reply: ${message.message.templateButtonReplyMessage.selectedDisplayText}]`;
    } else if (message.message.interactiveMessage?.body?.text) {
      content = `[Interactive: ${message.message.interactiveMessage.body.text}]`;
    } else if (message.message.buttonsResponseMessage?.selectedButtonId) {
      content = `[Button Response: ${message.message.buttonsResponseMessage.selectedButtonId}]`;
    } else if (message.message.listResponseMessage?.title) {
      content = `[List Response: ${message.message.listResponseMessage.title}]`;
    }

    // Include quoted message text if available
    if (message.message.extendedTextMessage?.contextInfo?.quotedMessage && message.message.extendedTextMessage?.contextInfo?.quotedMessage.conversation) {
      content = `"${message.message.extendedTextMessage.contextInfo.quotedMessage.conversation}"\n${content}`;
    }

    return content || '';
  }

  // Helper to check if a message contains any media content
  private hasMediaContent(message: WAMessage): boolean {
    if (!message.message) return false;

    const mediaTypes = [
      'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage',
      'stickerMessage', 'locationMessage', 'contactMessage', 'liveLocationMessage',
      'pollMessage', 'viewOnceMessageV2'
    ];

    // Check for direct media types
    for (const type in message.message) {
      if (mediaTypes.includes(type)) {
        // Special handling for viewOnce messages
        if (type === 'viewOnceMessageV2' && message.message[type]?.message) {
          const viewOnceMessage = message.message[type].message;
          const viewOnceKeys = Object.keys(viewOnceMessage);
          if (viewOnceKeys.some(key => ['imageMessage', 'videoMessage', 'audioMessage'].includes(key))) {
            return true;
          }
        } else if (type !== 'viewOnceMessageV2') {
          return true;
        }
      }
    }

    // Check for messages that might contain downloadable content
    if (message.message.imageMessage?.url || 
        message.message.videoMessage?.url ||
        message.message.audioMessage?.url ||
        message.message.documentMessage?.url ||
        message.message.stickerMessage?.url) {
      return true;
    }

    return false;
  }


  // Helper to save the message store to a file
  private saveToFile(): void {
    // Debounce or throttle this if called too frequently to avoid performance issues
    // For now, calling it directly is fine, but a more robust solution would use debouncing.
    this.saveMessageStore();
  }

  // Send deletion alert to bot owner
  private async sendDeletionAlertToBotOwner(sock: WASocket, originalMessage: StoredMessage, chatJid: string, detectionMethod: string): Promise<void> {
    try {
      const botOwnerJid = sock.user?.id;
      if (!botOwnerJid) {
        console.log(`❌ [Antidelete] Bot owner JID not found, cannot send deletion alert`);
        return;
      }

      const senderName = originalMessage.originalMessage?.pushName || 'Unknown';
      const chatType = this.getChatType(chatJid);
      const timestamp = new Date().toLocaleString();

      // Improved alert message with more details
      const alertMessage = `🚨 *DELETED MESSAGE DETECTED* 🚨\n\n` +
        `👤 *Sender:* ${senderName}\n` +
        `💬 *Chat:* ${chatType}\n` +
        `📅 *Time:* ${timestamp}\n` +
        `🔍 *Detection:* ${detectionMethod}\n\n` +
        `📝 *Original Message:*\n"${originalMessage.content || '[No text content]'}"\n\n` +
        `📎 *Media:* ${originalMessage.mediaInfo ? `${originalMessage.mediaInfo.type.toUpperCase()} file` : 'None'}\n\n` +
        `🆔 *Message ID:* ${originalMessage.id}\n` +
        `📞 *TrekkerMD:* +254704897825`;

      console.log(`📤 [Antidelete] Sending deletion alert to bot owner (${botOwnerJid})...`);
      
      // Send the text alert first
      await sock.sendMessage(botOwnerJid, { 
        text: alertMessage,
        quoted: originalMessage.originalMessage
      });

      console.log(`✅ [Antidelete] Text alert sent successfully`);

      // Send media file if available and exists
      if (originalMessage.mediaInfo && originalMessage.mediaInfo.path && originalMessage.mediaInfo.type) {
        // Wait a moment before sending media
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
          // Check if file exists
          if (existsSync(originalMessage.mediaInfo.path)) {
            console.log(`📎 [Antidelete] Sending deleted media file: ${originalMessage.mediaInfo.type} from ${originalMessage.mediaInfo.path}`);
            
            const mediaCaption = `🚨 *DELETED ${originalMessage.mediaInfo.type.toUpperCase()}*\n\n` +
              `👤 From: ${senderName}\n` +
              `📅 Deleted: ${timestamp}\n` +
              `📝 Caption: ${originalMessage.content || 'No caption'}\n\n` +
              `📞 TrekkerMD: +254704897825`;

            if (originalMessage.mediaInfo.type === 'image') {
              await sock.sendMessage(botOwnerJid, {
                image: { url: originalMessage.mediaInfo.path },
                caption: mediaCaption
              });
            } else if (originalMessage.mediaInfo.type === 'video') {
              await sock.sendMessage(botOwnerJid, {
                video: { url: originalMessage.mediaInfo.path },
                caption: mediaCaption
              });
            } else if (originalMessage.mediaInfo.type === 'audio') {
              await sock.sendMessage(botOwnerJid, {
                audio: { url: originalMessage.mediaInfo.path },
                caption: mediaCaption
              });
            } else if (originalMessage.mediaInfo.type === 'sticker') {
              await sock.sendMessage(botOwnerJid, {
                sticker: { url: originalMessage.mediaInfo.path }
              });
              // Send caption separately for stickers
              await sock.sendMessage(botOwnerJid, { text: mediaCaption });
            } else if (originalMessage.mediaInfo.type === 'document') {
              await sock.sendMessage(botOwnerJid, {
                document: { url: originalMessage.mediaInfo.path },
                caption: mediaCaption,
                fileName: `deleted_${originalMessage.id}_document`
              });
            }
            
            console.log(`✅ [Antidelete] Deleted media file sent successfully`);
          } else {
            console.log(`⚠️ [Antidelete] Media file not found: ${originalMessage.mediaInfo.path}`);
          }
        } catch (mediaError) {
          console.error(`❌ [Antidelete] Failed to send deleted media:`, mediaError);
          // Send error message to owner
          await sock.sendMessage(botOwnerJid, {
            text: `⚠️ *Media Recovery Failed*\n\nThe deleted ${originalMessage.mediaInfo.type} could not be recovered due to: ${mediaError instanceof Error ? mediaError.message : 'Unknown error'}`
          });
        }
      }

      console.log(`✅ [Antidelete] DELETION ALERT SENT TO BOT OWNER!`);
      console.log(`   📤 Sent to bot owner: ${botOwnerJid.split('@')[0]}`);
      console.log(`   📊 Alert message length: ${alertMessage.length} characters`);
      console.log(`   🎯 Alert ID: ${Date.now()}`);
      console.log(`   🔍 Detection method: ${detectionMethod}`);

    } catch (error) {
      console.error('❌ [Antidelete] CRITICAL ERROR sending deletion alert to bot owner:', error);
      console.error('❌ [Antidelete] Alert error details:', {
        chatJid,
        originalMessageId: originalMessage.id,
        detectionMethod,
        botOwnerJid: sock.user?.id,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        timestamp: new Date().toISOString()
      });

      // Try to send a simplified error message to the owner
      try {
        const errorMessage = `❌ *Antidelete Error*\n\nFailed to send deletion alert for message from ${originalMessage.originalMessage?.pushName || 'Unknown'}\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}`;
        await sock.sendMessage(sock.user?.id || '', { text: errorMessage });
      } catch (fallbackError) {
        console.error('❌ [Antidelete] Failed to send fallback error message:', fallbackError);
      }
    }
  }

  
}

// Export singleton instance
export const antideleteService = new AntideleteService();