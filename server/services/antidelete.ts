import fs from 'fs';
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

    console.log(`🔄 [Antidelete] Attempting to extract media from message ${messageId}`);
    
    if (message.message?.imageMessage) {
      mediaType = 'image';
      console.log(`📸 [Antidelete] Extracting image media`);
      try {
        const buffer = await downloadContentFromMessage(message.message.imageMessage, 'image');
        mediaPath = path.join(this.tempMediaDir, `${messageId}.jpg`);
        const chunks: Buffer[] = [];
        for await (const chunk of buffer) {
          chunks.push(chunk);
        }
        const fullBuffer = Buffer.concat(chunks);
        await writeFile(mediaPath, fullBuffer);
        console.log(`✅ [Antidelete] Image saved: ${mediaPath} (${fullBuffer.length} bytes)`);
      } catch (err) {
        console.error('❌ [Antidelete] Error downloading image:', err);
        mediaPath = '';
      }
    } else if (message.message?.stickerMessage) {
      mediaType = 'sticker';
      console.log(`🎭 [Antidelete] Extracting sticker media`);
      try {
        const buffer = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
        mediaPath = path.join(this.tempMediaDir, `${messageId}.webp`);
        const chunks: Buffer[] = [];
        for await (const chunk of buffer) {
          chunks.push(chunk);
        }
        const fullBuffer = Buffer.concat(chunks);
        await writeFile(mediaPath, fullBuffer);
        console.log(`✅ [Antidelete] Sticker saved: ${mediaPath} (${fullBuffer.length} bytes)`);
      } catch (err) {
        console.error('❌ [Antidelete] Error downloading sticker:', err);
        mediaPath = '';
      }
    } else if (message.message?.videoMessage) {
      mediaType = 'video';
      console.log(`🎬 [Antidelete] Extracting video media`);
      try {
        const buffer = await downloadContentFromMessage(message.message.videoMessage, 'video');
        mediaPath = path.join(this.tempMediaDir, `${messageId}.mp4`);
        const chunks: Buffer[] = [];
        for await (const chunk of buffer) {
          chunks.push(chunk);
        }
        const fullBuffer = Buffer.concat(chunks);
        await writeFile(mediaPath, fullBuffer);
        console.log(`✅ [Antidelete] Video saved: ${mediaPath} (${fullBuffer.length} bytes)`);
      } catch (err) {
        console.error('❌ [Antidelete] Error downloading video:', err);
        mediaPath = '';
      }
    } else if (message.message?.audioMessage) {
      mediaType = 'audio';
      console.log(`🎵 [Antidelete] Extracting audio media`);
      try {
        const buffer = await downloadContentFromMessage(message.message.audioMessage, 'audio');
        mediaPath = path.join(this.tempMediaDir, `${messageId}.mp3`);
        const chunks: Buffer[] = [];
        for await (const chunk of buffer) {
          chunks.push(chunk);
        }
        const fullBuffer = Buffer.concat(chunks);
        await writeFile(mediaPath, fullBuffer);
        console.log(`✅ [Antidelete] Audio saved: ${mediaPath} (${fullBuffer.length} bytes)`);
      } catch (err) {
        console.error('❌ [Antidelete] Error downloading audio:', err);
        mediaPath = '';
      }
    } else if (message.message?.documentMessage) {
      mediaType = 'document';
      console.log(`📄 [Antidelete] Extracting document media`);
      try {
        const buffer = await downloadContentFromMessage(message.message.documentMessage, 'document');
        const extension = message.message.documentMessage.fileName?.split('.').pop() || 'bin';
        mediaPath = path.join(this.tempMediaDir, `${messageId}.${extension}`);
        const chunks: Buffer[] = [];
        for await (const chunk of buffer) {
          chunks.push(chunk);
        }
        const fullBuffer = Buffer.concat(chunks);
        await writeFile(mediaPath, fullBuffer);
        console.log(`✅ [Antidelete] Document saved: ${mediaPath} (${fullBuffer.length} bytes)`);
      } catch (err) {
        console.error('❌ [Antidelete] Error downloading document:', err);
        mediaPath = '';
      }
    } else if (message.message?.viewOnceMessageV2?.message?.imageMessage) {
      mediaType = 'image';
      console.log(`👁️ [Antidelete] Extracting view-once image media`);
      try {
        const buffer = await downloadContentFromMessage(message.message.viewOnceMessageV2.message.imageMessage, 'image');
        mediaPath = path.join(this.tempMediaDir, `${messageId}-viewonce.jpg`);
        const chunks: Buffer[] = [];
        for await (const chunk of buffer) {
          chunks.push(chunk);
        }
        const fullBuffer = Buffer.concat(chunks);
        await writeFile(mediaPath, fullBuffer);
        console.log(`✅ [Antidelete] View-once image saved: ${mediaPath} (${fullBuffer.length} bytes)`);
      } catch (err) {
        console.error('❌ [Antidelete] Error downloading view-once image:', err);
        mediaPath = '';
      }
    } else if (message.message?.viewOnceMessageV2?.message?.videoMessage) {
      mediaType = 'video';
      console.log(`👁️ [Antidelete] Extracting view-once video media`);
      try {
        const buffer = await downloadContentFromMessage(message.message.viewOnceMessageV2.message.videoMessage, 'video');
        mediaPath = path.join(this.tempMediaDir, `${messageId}-viewonce.mp4`);
        const chunks: Buffer[] = [];
        for await (const chunk of buffer) {
          chunks.push(chunk);
        }
        const fullBuffer = Buffer.concat(chunks);
        await writeFile(mediaPath, fullBuffer);
        console.log(`✅ [Antidelete] View-once video saved: ${mediaPath} (${fullBuffer.length} bytes)`);
      } catch (err) {
        console.error('❌ [Antidelete] Error downloading view-once video:', err);
        mediaPath = '';
      }
    } else {
      console.log(`⚠️ [Antidelete] No supported media type found in message`);
    }

    console.log(`📋 [Antidelete] Media extraction result: type=${mediaType}, path=${mediaPath}, exists=${mediaPath ? fs.existsSync(mediaPath) : false}`);
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

      // Check if this message already exists in store with content but now has empty content
      const existingMessage = this.messageStore.get(messageId);
      if (existingMessage && existingMessage.content && existingMessage.content.trim() !== '' && 
          (!messageContent || messageContent.trim() === '')) {
        
        console.log(`🚨 [Antidelete] MESSAGE DELETION DETECTED VIA EMPTY CONTENT!`);
        console.log(`══════════════════════════════════════════════════════════`);
        console.log(`   🆔 Message ID: ${messageId}`);
        console.log(`   👤 Original Sender: ${existingMessage.senderJid}`);
        console.log(`   💬 Chat: ${chatType} (${fromJid})`);
        console.log(`   📝 Original Content: "${existingMessage.content}"`);
        console.log(`   🕐 Deletion Time: ${timestamp}`);
        console.log(`   🔄 Detection Method: Empty content replacement`);

        // Create a synthetic revocation message to handle this deletion
        const syntheticRevocationMessage = {
          key: {
            id: `synthetic_${Date.now()}`,
            remoteJid: fromJid,
            participant: message.key.participant
          },
          message: {
            protocolMessage: {
              key: {
                id: messageId,
                remoteJid: fromJid,
                participant: message.key.participant
              },
              type: 0 // REVOKE type
            }
          }
        };

        console.log(`📤 [Antidelete] Forwarding synthetic deletion to handler...`);
        
        // Check if deleted message had media content
        const hadMedia = this.hasMediaContent(existingMessage.originalMessage);
        if (hadMedia) {
          const mediaInfo = this.getDetailedMediaInfo(existingMessage.originalMessage);
          console.log(`🎬 [Antidelete] DELETED MESSAGE CONTAINED MEDIA!`);
          console.log(`      📱 Media Type: ${mediaInfo.type}`);
          console.log(`      📏 File Size: ${mediaInfo.size || 'Unknown'} bytes`);
          console.log(`      🎭 MIME Type: ${mediaInfo.mimetype || 'Unknown'}`);
          console.log(`      📄 Caption: ${mediaInfo.caption || 'None'}`);
          console.log(`      👁️ ViewOnce: ${mediaInfo.viewOnce ? 'Yes' : 'No'}`);
          console.log(`      📐 Dimensions: ${mediaInfo.width || '?'}x${mediaInfo.height || '?'}`);
          
          // Try to save and forward the media before sending alert
          try {
            const savedMedia = await this.extractAndSaveMedia(existingMessage.originalMessage);
            if (savedMedia.path && fs.existsSync(savedMedia.path)) {
              console.log(`💾 [Antidelete] Media saved to: ${savedMedia.path}`);
              
              // Forward the saved media to bot owner first
              if (sock) {
                await this.forwardMediaToBotOwner(sock, savedMedia, mediaInfo, existingMessage);
              }
            } else {
              console.log(`⚠️ [Antidelete] Media file not saved or doesn't exist`);
            }
          } catch (mediaError) {
            console.error(`❌ [Antidelete] Failed to save deleted media:`, mediaError);
          }
        }
        
        // Send deletion alert to bot owner only
        if (sock) {
          await this.sendDeletionAlertToBotOwner(sock, existingMessage, fromJid, 'Empty content replacement', hadMedia);
        } else {
          console.log(`⚠️ [Antidelete] No socket available for deletion alert`);
        }
        console.log(`══════════════════════════════════════════════════════════`);
      } 
      // Check for new empty content messages and search for recent messages from same chat
      else if ((!messageContent || messageContent.trim() === '') && messageType === 'unknown' && !message.key.fromMe) {
        console.log(`🚨 [Antidelete] EMPTY CONTENT MESSAGE DETECTED - SEARCHING FOR RECENT DELETIONS!`);
        console.log(`══════════════════════════════════════════════════════════`);
        console.log(`   🆔 Empty Message ID: ${messageId}`);
        console.log(`   💬 Chat: ${chatType} (${fromJid})`);
        console.log(`   🕐 Detection Time: ${timestamp}`);
        console.log(`   🔄 Detection Method: Empty content message`);

        // Search for recent messages from the same chat that have content
        const recentMessages = Array.from(this.messageStore.values())
          .filter(msg => 
            msg.fromJid === fromJid && 
            msg.content && 
            msg.content.trim() !== '' &&
            !msg.originalMessage.key.fromMe &&
            (Date.now() - msg.timestamp) < 60000 // Within last 60 seconds
          )
          .sort((a, b) => b.timestamp - a.timestamp); // Most recent first

        if (recentMessages.length > 0) {
          const mostRecentMessage = recentMessages[0];
          console.log(`✅ [Antidelete] FOUND RECENT MESSAGE TO RESTORE!`);
          console.log(`   📝 Recent Message Content: "${mostRecentMessage.content}"`);
          console.log(`   🆔 Recent Message ID: ${mostRecentMessage.id}`);
          console.log(`   👤 Original Sender: ${mostRecentMessage.senderJid}`);
          console.log(`   ⏱️ Time Since Message: ${Date.now() - mostRecentMessage.timestamp}ms`);

          // Check if the recent message had media
          const recentHadMedia = this.hasMediaContent(mostRecentMessage.originalMessage);
          
          if (recentHadMedia) {
            const recentMediaInfo = this.getDetailedMediaInfo(mostRecentMessage.originalMessage);
            console.log(`🎬 [Antidelete] RECENT DELETED MESSAGE CONTAINED MEDIA!`);
            console.log(`      📱 Media Type: ${recentMediaInfo.type}`);
            console.log(`      📏 File Size: ${recentMediaInfo.size || 'Unknown'} bytes`);
            console.log(`      🎭 MIME Type: ${recentMediaInfo.mimetype || 'Unknown'}`);
            
            // Try to save and forward the media
            try {
              const savedMedia = await this.extractAndSaveMedia(mostRecentMessage.originalMessage);
              if (savedMedia.path && fs.existsSync(savedMedia.path)) {
                console.log(`💾 [Antidelete] Recent media saved to: ${savedMedia.path}`);
                
                // Forward the saved media to bot owner first
                if (sock) {
                  await this.forwardMediaToBotOwner(sock, savedMedia, recentMediaInfo, mostRecentMessage);
                }
              } else {
                console.log(`⚠️ [Antidelete] Recent media file not saved or doesn't exist`);
              }
            } catch (mediaError) {
              console.error(`❌ [Antidelete] Failed to save recent deleted media:`, mediaError);
            }
          }
          
          // Send deletion alert to bot owner only
          if (sock) {
            await this.sendDeletionAlertToBotOwner(sock, mostRecentMessage, fromJid, 'Empty content detection', recentHadMedia);
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
        originalMessage: message
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

      // Log detailed media info
      if (this.hasMediaContent(message)) {
        const mediaInfo = this.getDetailedMediaInfo(message);
        console.log(`   📎 MEDIA CONTENT DETECTED:`);
        console.log(`      📱 Media Type: ${mediaInfo.type}`);
        console.log(`      📏 File Size: ${mediaInfo.size || 'Unknown'}`);
        console.log(`      🎭 MIME Type: ${mediaInfo.mimetype || 'Unknown'}`);
        console.log(`      📄 Caption: ${mediaInfo.caption || 'None'}`);
        console.log(`      🔗 URL: ${mediaInfo.url ? 'Present' : 'None'}`);
        console.log(`      👁️ ViewOnce: ${mediaInfo.viewOnce ? 'Yes' : 'No'}`);
        console.log(`      🎬 Duration: ${mediaInfo.duration || 'N/A'}`);
        console.log(`      📐 Dimensions: ${mediaInfo.width}x${mediaInfo.height || 'Unknown'}`);
        
        // Log media structure for debugging
        if (mediaInfo.structure && mediaInfo.structure.length > 0) {
          console.log(`      🔧 Media Structure: [${mediaInfo.structure.join(', ')}]`);
        }
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
          // Check if the revoked message had media
          const revokedHadMedia = this.hasMediaContent(originalMessage.originalMessage);
          if (revokedHadMedia) {
            const mediaInfo = this.getDetailedMediaInfo(originalMessage.originalMessage);
            console.log(`🎬 [Antidelete] REVOKED MESSAGE CONTAINED MEDIA!`);
            console.log(`      📱 Media Type: ${mediaInfo.type}`);
            console.log(`      📏 File Size: ${mediaInfo.size || 'Unknown'} bytes`);
            console.log(`      🎭 MIME Type: ${mediaInfo.mimetype || 'Unknown'}`);
            console.log(`      📄 Caption: ${mediaInfo.caption || 'None'}`);
            console.log(`      👁️ ViewOnce: ${mediaInfo.viewOnce ? 'Yes' : 'No'}`);
            
            // Try to save and forward the media
            try {
              const savedMedia = await this.extractAndSaveMedia(originalMessage.originalMessage);
              if (savedMedia.path && fs.existsSync(savedMedia.path)) {
                console.log(`💾 [Antidelete] Revoked media saved to: ${savedMedia.path}`);
                
                // Forward the saved media to bot owner first
                await this.forwardMediaToBotOwner(sock, savedMedia, mediaInfo, originalMessage);
              } else {
                console.log(`⚠️ [Antidelete] Revoked media file not saved or doesn't exist`);
              }
            } catch (mediaError) {
              console.error(`❌ [Antidelete] Failed to save revoked media:`, mediaError);
            }
          }
          
          // Send deletion alert to bot owner only
          await this.sendDeletionAlertToBotOwner(sock, originalMessage, revokerJid, 'Message revocation', revokedHadMedia);
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
      'pollMessage', 'stickerMessage', 'viewOnceMessageV2'
    ];

    for (const type in message.message) {
      if (mediaTypes.includes(type)) {
        // Check specifically for media attachments within viewOnce messages
        if (type === 'viewOnceMessageV2' && message.message[type]?.message) {
          const viewOnceMessage = message.message[type].message;
          const viewOnceKeys = Object.keys(viewOnceMessage);
          if (viewOnceKeys.some(key => mediaTypes.includes(key))) {
            return true;
          }
        } else if (type !== 'viewOnceMessageV2') {
          return true;
        }
      }
    }
    return false;
  }

  // Helper to get detailed media information for logging
  private getDetailedMediaInfo(message: WAMessage): any {
    if (!message.message) return { type: 'none' };

    const mediaInfo = {
      type: 'unknown',
      size: null,
      mimetype: null,
      caption: null,
      url: null,
      viewOnce: false,
      duration: null,
      width: null,
      height: null,
      structure: [] as string[]
    };

    // Check for different media types
    if (message.message.imageMessage) {
      mediaInfo.type = 'image';
      mediaInfo.size = message.message.imageMessage.fileLength;
      mediaInfo.mimetype = message.message.imageMessage.mimetype;
      mediaInfo.caption = message.message.imageMessage.caption;
      mediaInfo.url = message.message.imageMessage.url;
      mediaInfo.viewOnce = message.message.imageMessage.viewOnce || false;
      mediaInfo.width = message.message.imageMessage.width;
      mediaInfo.height = message.message.imageMessage.height;
      mediaInfo.structure.push('imageMessage');
    }

    if (message.message.videoMessage) {
      mediaInfo.type = 'video';
      mediaInfo.size = message.message.videoMessage.fileLength;
      mediaInfo.mimetype = message.message.videoMessage.mimetype;
      mediaInfo.caption = message.message.videoMessage.caption;
      mediaInfo.url = message.message.videoMessage.url;
      mediaInfo.viewOnce = message.message.videoMessage.viewOnce || false;
      mediaInfo.duration = message.message.videoMessage.seconds;
      mediaInfo.width = message.message.videoMessage.width;
      mediaInfo.height = message.message.videoMessage.height;
      mediaInfo.structure.push('videoMessage');
    }

    if (message.message.audioMessage) {
      mediaInfo.type = 'audio';
      mediaInfo.size = message.message.audioMessage.fileLength;
      mediaInfo.mimetype = message.message.audioMessage.mimetype;
      mediaInfo.url = message.message.audioMessage.url;
      mediaInfo.viewOnce = message.message.audioMessage.viewOnce || false;
      mediaInfo.duration = message.message.audioMessage.seconds;
      mediaInfo.structure.push('audioMessage');
    }

    if (message.message.stickerMessage) {
      mediaInfo.type = 'sticker';
      mediaInfo.size = message.message.stickerMessage.fileLength;
      mediaInfo.mimetype = message.message.stickerMessage.mimetype;
      mediaInfo.url = message.message.stickerMessage.url;
      mediaInfo.width = message.message.stickerMessage.width;
      mediaInfo.height = message.message.stickerMessage.height;
      mediaInfo.structure.push('stickerMessage');
    }

    if (message.message.documentMessage) {
      mediaInfo.type = 'document';
      mediaInfo.size = message.message.documentMessage.fileLength;
      mediaInfo.mimetype = message.message.documentMessage.mimetype;
      mediaInfo.caption = message.message.documentMessage.caption;
      mediaInfo.url = message.message.documentMessage.url;
      mediaInfo.structure.push('documentMessage');
    }

    if (message.message.locationMessage) {
      mediaInfo.type = 'location';
      mediaInfo.structure.push('locationMessage');
    }

    if (message.message.contactMessage) {
      mediaInfo.type = 'contact';
      mediaInfo.structure.push('contactMessage');
    }

    if (message.message.pollMessage) {
      mediaInfo.type = 'poll';
      mediaInfo.structure.push('pollMessage');
    }

    // Check for ViewOnce messages
    if (message.message.viewOnceMessageV2?.message) {
      mediaInfo.viewOnce = true;
      mediaInfo.structure.push('viewOnceMessageV2');
      
      const viewOnceMsg = message.message.viewOnceMessageV2.message;
      
      if (viewOnceMsg.imageMessage) {
        mediaInfo.type = 'viewonce-image';
        mediaInfo.size = viewOnceMsg.imageMessage.fileLength;
        mediaInfo.mimetype = viewOnceMsg.imageMessage.mimetype;
        mediaInfo.caption = viewOnceMsg.imageMessage.caption;
        mediaInfo.url = viewOnceMsg.imageMessage.url;
        mediaInfo.width = viewOnceMsg.imageMessage.width;
        mediaInfo.height = viewOnceMsg.imageMessage.height;
        mediaInfo.structure.push('viewOnceImageMessage');
      }
      
      if (viewOnceMsg.videoMessage) {
        mediaInfo.type = 'viewonce-video';
        mediaInfo.size = viewOnceMsg.videoMessage.fileLength;
        mediaInfo.mimetype = viewOnceMsg.videoMessage.mimetype;
        mediaInfo.caption = viewOnceMsg.videoMessage.caption;
        mediaInfo.url = viewOnceMsg.videoMessage.url;
        mediaInfo.duration = viewOnceMsg.videoMessage.seconds;
        mediaInfo.width = viewOnceMsg.videoMessage.width;
        mediaInfo.height = viewOnceMsg.videoMessage.height;
        mediaInfo.structure.push('viewOnceVideoMessage');
      }
    }

    return mediaInfo;
  }


  // Helper to save the message store to a file
  private saveToFile(): void {
    // Debounce or throttle this if called too frequently to avoid performance issues
    // For now, calling it directly is fine, but a more robust solution would use debouncing.
    this.saveMessageStore();
  }

  // Forward saved media to bot owner
  private async forwardMediaToBotOwner(sock: WASocket, savedMedia: { type: string, path: string }, mediaInfo: any, originalMessage: StoredMessage): Promise<void> {
    try {
      const botOwnerJid = sock.user?.id;
      if (!botOwnerJid) {
        console.log(`❌ [Antidelete] Cannot forward media - bot owner JID not found`);
        return;
      }

      if (!savedMedia.path || !fs.existsSync(savedMedia.path)) {
        console.log(`❌ [Antidelete] Cannot forward media - file not found: ${savedMedia.path}`);
        return;
      }

      const mediaBuffer = fs.readFileSync(savedMedia.path);
      const senderName = originalMessage.originalMessage?.pushName || 'Unknown';
      const sizeInKB = Math.round(mediaBuffer.length / 1024);
      const caption = `🚨 *DELETED MEDIA RECOVERED* 🚨\n\n🗑️ *Deleted by:* ${senderName}\n📎 *Type:* ${savedMedia.type}\n💬 *Caption:* ${mediaInfo.caption || 'None'}\n📏 *Size:* ${sizeInKB}KB\n\n📞 *Owner:* +254704897825`;

      console.log(`📤 [Antidelete] Forwarding ${savedMedia.type} media (${sizeInKB}KB) to bot owner...`);

      try {
        switch (savedMedia.type) {
          case 'image':
            await sock.sendMessage(botOwnerJid, {
              image: mediaBuffer,
              caption: caption,
              mimetype: mediaInfo.mimetype || 'image/jpeg'
            });
            console.log(`✅ [Antidelete] Image forwarded successfully`);
            break;

          case 'video':
            await sock.sendMessage(botOwnerJid, {
              video: mediaBuffer,
              caption: caption,
              mimetype: mediaInfo.mimetype || 'video/mp4'
            });
            console.log(`✅ [Antidelete] Video forwarded successfully`);
            break;

          case 'audio':
            await sock.sendMessage(botOwnerJid, {
              audio: mediaBuffer,
              caption: caption,
              mimetype: mediaInfo.mimetype || 'audio/mpeg'
            });
            console.log(`✅ [Antidelete] Audio forwarded successfully`);
            break;

          case 'sticker':
            await sock.sendMessage(botOwnerJid, {
              sticker: mediaBuffer,
              mimetype: mediaInfo.mimetype || 'image/webp'
            });
            // Send caption separately for stickers
            await sock.sendMessage(botOwnerJid, { text: caption });
            console.log(`✅ [Antidelete] Sticker forwarded successfully`);
            break;

          case 'document':
            const fileName = `recovered_${originalMessage.id}.${this.getFileExtension(savedMedia.type)}`;
            await sock.sendMessage(botOwnerJid, {
              document: mediaBuffer,
              fileName: fileName,
              caption: caption,
              mimetype: mediaInfo.mimetype || 'application/octet-stream'
            });
            console.log(`✅ [Antidelete] Document forwarded successfully`);
            break;

          default:
            // Fallback to document
            const defaultFileName = `recovered_${originalMessage.id}.bin`;
            await sock.sendMessage(botOwnerJid, {
              document: mediaBuffer,
              fileName: defaultFileName,
              caption: caption,
              mimetype: 'application/octet-stream'
            });
            console.log(`✅ [Antidelete] Unknown media type forwarded as document`);
            break;
        }

        console.log(`✅ [Antidelete] Media forwarded to bot owner successfully!`);
        
      } catch (sendError) {
        console.error('❌ [Antidelete] Error sending media message:', sendError);
        
        // Fallback: try to send as document
        try {
          const fallbackFileName = `recovered_${originalMessage.id}_${savedMedia.type}.bin`;
          await sock.sendMessage(botOwnerJid, {
            document: mediaBuffer,
            fileName: fallbackFileName,
            caption: caption,
            mimetype: 'application/octet-stream'
          });
          console.log(`✅ [Antidelete] Media forwarded as fallback document`);
        } catch (fallbackError) {
          console.error('❌ [Antidelete] Fallback document send also failed:', fallbackError);
        }
      }
      
      // Clean up the temp file after forwarding attempt
      try {
        fs.unlinkSync(savedMedia.path);
        console.log(`🧹 [Antidelete] Cleaned up temp file: ${savedMedia.path}`);
      } catch (cleanupError) {
        console.warn(`⚠️ [Antidelete] Failed to cleanup temp file:`, cleanupError);
      }

    } catch (error) {
      console.error('❌ [Antidelete] Critical error in forwardMediaToBotOwner:', error);
    }
  }

  // Helper to get file extension based on media type
  private getFileExtension(mediaType: string): string {
    switch (mediaType) {
      case 'image': return 'jpg';
      case 'video': return 'mp4';
      case 'audio': return 'mp3';
      case 'sticker': return 'webp';
      case 'document': return 'pdf';
      default: return 'bin';
    }
  }

  // Send deletion alert to bot owner
  private async sendDeletionAlertToBotOwner(sock: WASocket, originalMessage: StoredMessage, chatJid: string, detectionMethod: string, hadMedia: boolean = false): Promise<void> {
    try {
      const botOwnerJid = sock.user?.id;
      if (!botOwnerJid) {
        console.log(`❌ [Antidelete] Bot owner JID not found, cannot send deletion alert`);
        return;
      }

      const senderName = originalMessage.originalMessage?.pushName || 'Unknown';
      const chatType = this.getChatType(chatJid);
      const timestamp = new Date().toLocaleString();

      let alertMessage = `🚨 *DELETED MESSAGE*🚨\n\n` +
        `🗑️ *Deleted by:* ${senderName}\n` +
        `💬 *Message:* ░▒▓████◤ "${originalMessage.content}" ◢████▓▒░\n`;
      
      if (hadMedia) {
        const mediaInfo = this.getDetailedMediaInfo(originalMessage.originalMessage);
        alertMessage += `📎 *Media:* ${mediaInfo.type} (${mediaInfo.size ? Math.round(mediaInfo.size / 1024) + 'KB' : 'Unknown size'})\n`;
        if (mediaInfo.mimetype) {
          alertMessage += `🎭 *Type:* ${mediaInfo.mimetype}\n`;
        }
        if (mediaInfo.viewOnce) {
          alertMessage += `👁️ *ViewOnce:* Yes\n`;
        }
      }
      
      alertMessage += `\n📞 *Owner:* +254704897825`;

      console.log(`📤 [Antidelete] Sending deletion alert to bot owner...`);
      await sock.sendMessage(botOwnerJid, { text: alertMessage });

      console.log(`✅ [Antidelete] DELETION ALERT SENT TO BOT OWNER!`);
      console.log(`   📤 Sent to bot owner: ${botOwnerJid.split('@')[0]}`);
      console.log(`   📊 Alert message length: ${alertMessage.length} characters`);
      console.log(`   🎯 Alert ID: ${Date.now()}`);

    } catch (error) {
      console.error('❌ [Antidelete] CRITICAL ERROR sending deletion alert to bot owner:', error);
      console.error('❌ [Antidelete] Alert error details:', {
        chatJid,
        originalMessageId: originalMessage.id,
        detectionMethod,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  }

  
}

// Export singleton instance
export const antideleteService = new AntideleteService();