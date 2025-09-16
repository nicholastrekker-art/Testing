import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { writeFile } from 'fs/promises';
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';

interface StoredMessage {
  content: string;
  mediaType: string;
  mediaPath: string;
  sender: string;
  group: string | null;
  timestamp: string;
  fullMessage: any; // Store the full message object for recovery attempts
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

    // Load stored messages from local storage
    this.loadMessageStore();

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
        const data = fs.readFileSync(this.messageStorePath, 'utf8');
        const storedMessages = JSON.parse(data);
        this.messageStore = new Map(Object.entries(storedMessages));
        console.log(`Loaded ${this.messageStore.size} stored messages for antidelete`);
      }
    } catch (err) {
      console.error('Error loading message store:', err);
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
      } catch (err) {
        console.error('Error downloading image:', err);
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
      } catch (err) {
        console.error('Error downloading sticker:', err);
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
      } catch (err) {
        console.error('Error downloading video:', err);
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
      } catch (err) {
        console.error('Error downloading view-once image:', err);
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
      } catch (err) {
        console.error('Error downloading view-once video:', err);
      }
    }

    return { type: mediaType, path: mediaPath };
  }

  async storeMessage(message: WAMessage): Promise<void> {
    try {
      const messageId = message.key.id;
      if (!messageId || this.processedMessages.has(messageId)) return;

      // Skip storing reaction messages to reduce noise
      if (message.message?.reactionMessage) return;

      this.processedMessages.add(messageId);

      const messageText = this.extractMessageText(message.message);
      let mediaType = '';
      let mediaPath = '';

      // Check for media content and save it
      if (message.message) {
        const mediaInfo = await this.extractAndSaveMedia(message);
        mediaType = mediaInfo.type;
        mediaPath = mediaInfo.path;
      }

      const messageData: StoredMessage = {
        content: messageText,
        mediaType,
        mediaPath,
        sender: message.key.participant || message.key.remoteJid || '',
        group: message.key.remoteJid?.includes('@g.us') ? message.key.remoteJid : null,
        timestamp: new Date().toISOString(),
        fullMessage: message.message // Store the full message object for recovery attempts
      };

      this.messageStore.set(messageId, messageData);
      this.saveMessageStore();

      // Enhanced logging for antidelete
      const senderInfo = message.key.participant ? 
        `${message.pushName || 'Unknown'} (${message.key.participant.split('@')[0]})` : 
        `${message.pushName || 'Unknown'} (${message.key.remoteJid?.split('@')[0]})`;
      
      const chatType = message.key.remoteJid?.includes('@g.us') ? 'Group' : 'Private';
      
      if (messageText || mediaType) {
        console.log(`💾 [Antidelete] Message stored - From: ${senderInfo} | Chat: ${chatType} | Type: ${mediaType || 'text'} | Content: ${messageText ? messageText.substring(0, 50) + '...' : 'Media only'}`);
      }
    } catch (error) {
      console.error('❌ [Antidelete] Error storing message:', error);
    }
  }

  getStoredMessage(messageId: string | undefined): StoredMessage | null {
    if (!messageId) return null;
    return this.messageStore.get(messageId) || null;
  }

  async handleMessageRevocation(sock: WASocket, revocationMessage: WAMessage): Promise<void> {
    try {
      const config = this.loadAntideleteConfig();
      if (!config.enabled) {
        console.log(`🔒 [Antidelete] Service disabled - ignoring deletion`);
        return;
      }

      if (!revocationMessage.message?.protocolMessage?.key?.id) return;

      const messageId = revocationMessage.message.protocolMessage.key.id;
      const deletedBy = revocationMessage.key.participant || revocationMessage.key.remoteJid || '';

      // Get bot's own WhatsApp ID with better detection
      let ownerNumber = '';
      if (sock.user?.id) {
        const userId = sock.user.id;
        if (userId.includes(':')) {
          ownerNumber = userId.split(':')[0] + '@s.whatsapp.net';
        } else if (userId.includes('@')) {
          ownerNumber = userId;
        } else {
          ownerNumber = userId + '@s.whatsapp.net';
        }
      }

      console.log(`🗑️ [Antidelete] Message deletion detected by ${deletedBy.split('@')[0]}`);

      if (!ownerNumber || deletedBy.includes(sock.user?.id || '') || deletedBy === ownerNumber) {
        console.log(`⚠️ [Antidelete] Ignoring deletion (bot owner deleted own message)`);
        return;
      }

      const original = this.getStoredMessage(messageId);
      if (!original) {
        console.log(`❌ [Antidelete] No backup found for deleted message ${messageId}`);
        return;
      }

      const senderName = original.sender.split('@')[0];
      const chatType = original.group ? 'group chat' : 'private chat';
      console.log(`🔍 [Antidelete] Recovering deleted message from ${senderName} in ${chatType}`);

      const sender = original.sender;
      const senderName = sender.split('@')[0];
      let groupName = '';

      if (original.group) {
        try {
          const groupMetadata = await sock.groupMetadata(original.group);
          groupName = groupMetadata.subject;
        } catch (err) {
          console.error('Error getting group metadata:', err);
        }
      }

      const time = new Date().toLocaleString('en-US', {
        timeZone: 'Africa/Nairobi',
        hour12: true,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      let text = `*🔰 ANTIDELETE REPORT 🔰*\n\n` +
        `*🗑️ Deleted By:* @${deletedBy.split('@')[0]}\n` +
        `*👤 Sender:* @${senderName}\n` +
        `*📱 Number:* ${sender}\n` +
        `*🕒 Time:* ${time}\n`;

      if (groupName) {
        text += `*👥 Group:* ${groupName}\n`;
      }

      if (original.content) {
        text += `\n*💬 Deleted Message:*\n${original.content}`;
      }

      await sock.sendMessage(ownerNumber, {
        text,
        mentions: [deletedBy, sender]
      });

      // Media sending
      if (original.mediaType && fs.existsSync(original.mediaPath)) {
        const mediaOptions = {
          caption: `*Deleted ${original.mediaType}*\nFrom: @${senderName}`,
          mentions: [sender]
        };

        try {
          switch (original.mediaType) {
            case 'image':
              await sock.sendMessage(ownerNumber, {
                image: { url: original.mediaPath },
                ...mediaOptions
              });
              break;
            case 'sticker':
              await sock.sendMessage(ownerNumber, {
                sticker: { url: original.mediaPath },
                ...mediaOptions
              });
              break;
            case 'video':
              await sock.sendMessage(ownerNumber, {
                video: { url: original.mediaPath },
                ...mediaOptions
              });
              break;
          }
        } catch (err) {
          await sock.sendMessage(ownerNumber, {
            text: `⚠️ Error sending media: ${(err as Error).message}`
          });
        }

        // Cleanup
        try {
          fs.unlinkSync(original.mediaPath);
          console.log(`🧹 [Antidelete] Cleaned up temporary media file`);
        } catch (err) {
          console.error('❌ [Antidelete] Media cleanup error:', err);
        }
      }

      this.messageStore.delete(messageId);
      console.log(`✅ [Antidelete] Successfully recovered and forwarded deleted message to bot owner`);

    } catch (err) {
      console.error('❌ [Antidelete] Error in message recovery:', err);
    }
  }
}

// Export singleton instance
export const antideleteService = new AntideleteService();