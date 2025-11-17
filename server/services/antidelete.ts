import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { writeFile } from 'fs/promises';
import type { WASocket, WAMessage } from '@whiskeysockets/baileys';
import type { BotInstance } from '@shared/schema';

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
  private botInstance: BotInstance;
  private configPath: string;
  private tempMediaDir: string;
  private messageStorePath: string;
  private processedMessages = new Set<string>();

  constructor(botInstance: BotInstance) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    this.botInstance = botInstance;

    // Isolated paths based on tenancy and bot ID
    const isolatedDir = path.join(__dirname, '../data/antidelete', botInstance.serverName, `bot_${botInstance.id}`);

    this.configPath = path.join(isolatedDir, 'config.json');
    this.tempMediaDir = path.join(isolatedDir, 'media');
    this.messageStorePath = path.join(isolatedDir, 'messages.json');

    // Ensure directories exist
    this.ensureDirectories();

    // Clear stored messages from previous sessions
    this.loadMessageStore();

    // Clear any old temp media files from previous sessions
    this.clearTempMedia();

    // Start periodic cleanup every minute
    setInterval(() => this.cleanTempFolderIfLarge(), 60 * 1000);

    // Save message store periodically (every 5 minutes)
    setInterval(() => this.saveMessageStore(), 5 * 60 * 1000);

    console.log(`✅ [Antidelete] Initialized for bot ${botInstance.name} (${botInstance.id}) in tenant ${botInstance.serverName}`);
  }

  private ensureDirectories(): void {
    const dirs = [
      path.dirname(this.configPath),
      this.tempMediaDir,
      path.dirname(this.messageStorePath)
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private getFolderSizeInMB(folderPath: string): number {
    try {
      if (!fs.existsSync(folderPath)) return 0;

      const files = fs.readdirSync(folderPath);
      let totalSize = 0;

      for (const file of files) {
        const filePath = path.join(folderPath, file);
        if (fs.statSync(filePath).isFile()) {
          totalSize += fs.statSync(filePath).size;
        }
      }

      return totalSize / (1024 * 1024);
    } catch (err) {
      console.error(`[Antidelete:${this.botInstance.id}] Error getting folder size:`, err);
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
        console.log(`[Antidelete:${this.botInstance.id}] Cleaned temp folder - was ${sizeMB.toFixed(2)}MB`);
      }
    } catch (err) {
      console.error(`[Antidelete:${this.botInstance.id}] Temp cleanup error:`, err);
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
          console.log(`[Antidelete:${this.botInstance.id}] Cleared ${files.length} temp media files from previous session`);
        }
      }
    } catch (err) {
      console.error(`[Antidelete:${this.botInstance.id}] Error clearing temp media:`, err);
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
      const dataDir = path.dirname(this.configPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (err) {
      console.error(`[Antidelete:${this.botInstance.id}] Config save error:`, err);
    }
  }

  private loadMessageStore(): void {
    try {
      if (fs.existsSync(this.messageStorePath)) {
        fs.unlinkSync(this.messageStorePath);
        console.log(`[Antidelete:${this.botInstance.id}] Deleted old stored messages from previous session`);
      }
      this.messageStore = new Map();
      console.log(`[Antidelete:${this.botInstance.id}] Started with fresh message store`);
    } catch (err) {
      console.error(`[Antidelete:${this.botInstance.id}] Error clearing message store:`, err);
      this.messageStore = new Map();
    }
  }

  private saveMessageStore(): void {
    try {
      const dataDir = path.dirname(this.messageStorePath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const messageObj = Object.fromEntries(this.messageStore);
      fs.writeFileSync(this.messageStorePath, JSON.stringify(messageObj, null, 2));
    } catch (err) {
      console.error(`[Antidelete:${this.botInstance.id}] Error saving message store:`, err);
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

  async storeMessage(message: WAMessage, sock?: WASocket): Promise<void> {
    try {
      const messageId = message.key.id;
      const fromJid = message.key.remoteJid;
      const senderJid = message.key.participant || message.key.fromMe ? 'self' : fromJid;

      if (!messageId || !fromJid) {
        return;
      }

      const messageContent = this.extractMessageContent(message);
      const messageType = this.getMessageType(message);

      if (messageContent.trim() !== '' || this.hasMediaContent(message)) {
        this.messageStore.set(messageId, {
          id: messageId,
          fromJid,
          senderJid,
          content: messageContent,
          type: messageType,
          timestamp: Date.now(),
          originalMessage: message
        });

        if (this.hasMediaContent(message)) {
          const mediaInfo = this.getDetailedMediaInfo(message);
          if (mediaInfo.url) {
            try {
              const mediaBuffer = await this.downloadMediaFromUrl(mediaInfo.url);
              if (mediaBuffer) {
                const mediaPath = path.join(this.tempMediaDir, `${messageId}.media`);
                fs.writeFileSync(mediaPath, mediaBuffer);
              }
            } catch (error) {
              console.error(`[Antidelete:${this.botInstance.id}] Failed to download and store media:`, error);
            }
          }
        }
      }

      // Cleanup old messages (keep last 1000)
      if (this.messageStore.size > 1000) {
        const oldestKey = this.messageStore.keys().next().value;
        this.messageStore.delete(oldestKey);
      }

      this.saveToFile();
    } catch (error) {
      console.error(`[Antidelete:${this.botInstance.id}] Error storing message:`, error);
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

      console.log(`[Antidelete:${this.botInstance.id}] 🗑️ Message revocation detected:`);
      console.log(`   Message ID: ${revokedMessageId}`);
      console.log(`   Revoker JID: ${revokerJid}`);
      console.log(`   Total messages in store: ${this.messageStore.size}`);

      if (!revokedMessageId || !revokerJid) {
        console.log(`[Antidelete:${this.botInstance.id}] ⚠️ Missing revocation details, skipping`);
        return;
      }

      const originalMessage = this.messageStore.get(revokedMessageId);
      console.log(`[Antidelete:${this.botInstance.id}] Original message found: ${!!originalMessage}`);

      if (originalMessage) {
        const revokedHadMedia = this.hasMediaContent(originalMessage.originalMessage);

        if (revokedHadMedia) {
          const mediaPath = path.join(this.tempMediaDir, `${revokedMessageId}.media`);
          if (fs.existsSync(mediaPath)) {
            const mediaBuffer = fs.readFileSync(mediaPath);
            const mediaInfo = this.getDetailedMediaInfo(originalMessage.originalMessage);
            await this.forwardStoredMedia(sock, mediaBuffer, mediaInfo, originalMessage);
            fs.unlinkSync(mediaPath);
          }
        }

        await this.sendDeletionAlertToBotOwner(sock, originalMessage, revokerJid, 'Message revocation', revokedHadMedia);
        this.messageStore.delete(revokedMessageId);
      }
    } catch (error) {
      console.error(`[Antidelete:${this.botInstance.id}] Error handling message revocation:`, error);
    }
  }

  private getMessageType(message: WAMessage): string {
    if (!message.message) return 'empty';
    const messageKeys = Object.keys(message.message);
    if (messageKeys.length === 1) {
      return messageKeys[0];
    }
    return 'unknown';
  }

  private getChatType(jid: string | undefined): string {
    if (!jid) return 'unknown';
    return jid.includes('@g.us') ? 'Group' : 'Private';
  }

  private extractMessageContent(message: WAMessage): string {
    if (!message.message) return '';

    const msg = message.message;

    if (msg.conversation) return msg.conversation;
    if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
    if (msg.imageMessage?.caption) return msg.imageMessage.caption;
    if (msg.videoMessage?.caption) return msg.videoMessage.caption;
    if (msg.audioMessage?.caption) return msg.audioMessage.caption;
    if (msg.documentMessage?.caption) return msg.documentMessage.caption;

    return '';
  }

  private hasMediaContent(message: WAMessage): boolean {
    if (!message.message) return false;

    const actualMediaTypes = [
      'imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'
    ];

    for (const type in message.message) {
      if (actualMediaTypes.includes(type)) {
        return true;
      }
    }
    return false;
  }

  private getDetailedMediaInfo(message: WAMessage): any {
    if (!message.message) return { type: 'none' };

    const mediaInfo: any = {
      type: 'unknown',
      size: null,
      mimetype: null,
      caption: null,
      url: null
    };

    if (message.message.imageMessage) {
      mediaInfo.type = 'image';
      mediaInfo.size = message.message.imageMessage.fileLength;
      mediaInfo.mimetype = message.message.imageMessage.mimetype;
      mediaInfo.caption = message.message.imageMessage.caption;
      mediaInfo.url = message.message.imageMessage.url;
    }

    if (message.message.videoMessage) {
      mediaInfo.type = 'video';
      mediaInfo.size = message.message.videoMessage.fileLength;
      mediaInfo.mimetype = message.message.videoMessage.mimetype;
      mediaInfo.caption = message.message.videoMessage.caption;
      mediaInfo.url = message.message.videoMessage.url;
    }

    if (message.message.audioMessage) {
      mediaInfo.type = 'audio';
      mediaInfo.size = message.message.audioMessage.fileLength;
      mediaInfo.mimetype = message.message.audioMessage.mimetype;
      mediaInfo.url = message.message.audioMessage.url;
    }

    if (message.message.documentMessage) {
      mediaInfo.type = 'document';
      mediaInfo.size = message.message.documentMessage.fileLength;
      mediaInfo.mimetype = message.message.documentMessage.mimetype;
      mediaInfo.caption = message.message.documentMessage.caption;
      mediaInfo.url = message.message.documentMessage.url;
    }

    return mediaInfo;
  }

  private saveToFile(): void {
    this.saveMessageStore();
  }

  private async downloadMediaFromUrl(url: string): Promise<Buffer | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const mediaBuffer = Buffer.from(await response.arrayBuffer());
      return mediaBuffer;
    } catch (error) {
      console.error(`[Antidelete:${this.botInstance.id}] Error downloading media:`, error);
      return null;
    }
  }

  private async forwardStoredMedia(sock: WASocket, mediaBuffer: Buffer, mediaInfo: any, originalMessage: StoredMessage): Promise<void> {
    try {
      // Use bot owner from bot instance configuration
      const botOwnerPhone = this.botInstance.owner;
      if (!botOwnerPhone) {
        console.error(`[Antidelete:${this.botInstance.id}] No owner configured for bot`);
        return;
      }
      
      // Format owner JID properly (add @s.whatsapp.net if not present)
      const botOwnerJid = botOwnerPhone.includes('@') ? botOwnerPhone : `${botOwnerPhone}@s.whatsapp.net`;
      console.log(`[Antidelete:${this.botInstance.id}] Forwarding deleted media to owner: ${botOwnerJid}`);

      const senderName = originalMessage.originalMessage?.pushName || 'Unknown';
      const sizeInKB = Math.round(mediaBuffer.length / 1024);
      const caption = `🚨 *DELETED MEDIA RECOVERED* 🚨\n\n🗑️ *Deleted by:* ${senderName}\n📎 *Type:* ${mediaInfo.type}\n💬 *Caption:* ${mediaInfo.caption || 'None'}\n📏 *Size:* ${sizeInKB}KB`;

      switch (mediaInfo.type) {
        case 'image':
          await sock.sendMessage(botOwnerJid, {
            image: mediaBuffer,
            caption: caption,
            mimetype: mediaInfo.mimetype || 'image/jpeg'
          });
          break;

        case 'video':
          await sock.sendMessage(botOwnerJid, {
            video: mediaBuffer,
            caption: caption,
            mimetype: mediaInfo.mimetype || 'video/mp4'
          });
          break;

        case 'audio':
          await sock.sendMessage(botOwnerJid, {
            audio: mediaBuffer,
            mimetype: mediaInfo.mimetype || 'audio/mpeg'
          });
          await sock.sendMessage(botOwnerJid, { text: caption });
          break;

        case 'document':
          const fileName = `recovered_${originalMessage.id}.bin`;
          await sock.sendMessage(botOwnerJid, {
            document: mediaBuffer,
            fileName: fileName,
            mimetype: mediaInfo.mimetype || 'application/octet-stream',
            caption: caption
          });
          break;

        default:
          await sock.sendMessage(botOwnerJid, {
            document: mediaBuffer,
            fileName: `recovered_${originalMessage.id}.bin`,
            mimetype: 'application/octet-stream',
            caption: caption
          });
      }
    } catch (error) {
      console.error(`[Antidelete:${this.botInstance.id}] Error forwarding stored media:`, error);
    }
  }

  private async sendDeletionAlertToBotOwner(sock: WASocket, storedMessage: StoredMessage, revokerJid: string, reason: string, hadMedia: boolean): Promise<void> {
    try {
      // Use bot owner from bot instance configuration
      const botOwnerPhone = this.botInstance.owner;
      if (!botOwnerPhone) {
        console.error(`[Antidelete:${this.botInstance.id}] No owner configured for bot`);
        return;
      }
      
      // Format owner JID properly (add @s.whatsapp.net if not present)
      const botOwnerJid = botOwnerPhone.includes('@') ? botOwnerPhone : `${botOwnerPhone}@s.whatsapp.net`;
      console.log(`[Antidelete:${this.botInstance.id}] Sending deletion alert to owner: ${botOwnerJid}`);

      const senderName = storedMessage.originalMessage?.pushName || 'Unknown';
      const chatType = this.getChatType(storedMessage.fromJid);
      const timestamp = new Date(storedMessage.timestamp).toLocaleString();

      let alertText = `🚨 *DELETED MESSAGE DETECTED* 🚨\n\n`;
      alertText += `🗑️ *Deleted by:* ${senderName}\n`;
      alertText += `💬 *Chat Type:* ${chatType}\n`;
      alertText += `🕐 *Original Time:* ${timestamp}\n`;
      alertText += `📝 *Type:* ${storedMessage.type}\n\n`;

      if (!hadMedia && storedMessage.content) {
        alertText += `📄 *Original Message:*\n${storedMessage.content}`;
      } else if (hadMedia) {
        alertText += `📎 *Had Media:* Yes (forwarded above)`;
      }

      await sock.sendMessage(botOwnerJid, { text: alertText });
    } catch (error) {
      console.error(`[Antidelete:${this.botInstance.id}] Error sending deletion alert:`, error);
    }
  }
}

// Bot-specific antidelete instances
const antideleteInstances = new Map<string, AntideleteService>();

export function getAntideleteService(botInstance: BotInstance): AntideleteService {
  const key = `${botInstance.serverName}_${botInstance.id}`;

  if (!antideleteInstances.has(key)) {
    antideleteInstances.set(key, new AntideleteService(botInstance));
  }

  return antideleteInstances.get(key)!;
}

export function clearAntideleteService(botInstance: BotInstance): void {
  const key = `${botInstance.serverName}_${botInstance.id}`;
  antideleteInstances.delete(key);
}