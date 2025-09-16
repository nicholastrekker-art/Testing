
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';

interface ViewOnceData {
  content: any;
  messageType: string;
  mediaType: string;
  data: any;
}

interface ViewOnceConfig {
  enabled: boolean;
  saveMedia: boolean;
  notifyOwner: boolean;
}

export class AntiViewOnceService {
  private configPath: string;
  private mediaDir: string;
  private processedMessages = new Set<string>();

  constructor(botId: string) {
    const dataDir = join(process.cwd(), 'data', 'antiviewonce');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    
    this.configPath = join(dataDir, `${botId}.json`);
    this.mediaDir = join(dataDir, 'media');
    
    if (!existsSync(this.mediaDir)) {
      mkdirSync(this.mediaDir, { recursive: true });
    }
    
    this.initializeConfig();
  }

  private initializeConfig(): void {
    if (!existsSync(this.configPath)) {
      const defaultConfig: ViewOnceConfig = {
        enabled: true,
        saveMedia: true,
        notifyOwner: true
      };
      writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2));
    }
  }

  private getConfig(): ViewOnceConfig {
    try {
      const configData = readFileSync(this.configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      console.error('Error reading antiviewonce config:', error);
      return { enabled: true, saveMedia: true, notifyOwner: true };
    }
  }

  private saveConfig(config: ViewOnceConfig): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Error saving antiviewonce config:', error);
    }
  }

  public isEnabled(): boolean {
    return this.getConfig().enabled;
  }

  public setEnabled(enabled: boolean): void {
    const config = this.getConfig();
    config.enabled = enabled;
    this.saveConfig(config);
  }

  public async handleMessage(sock: WASocket, message: WAMessage): Promise<void> {
    try {
      if (!this.isEnabled()) return;

      const messageId = message.key.id;
      if (!messageId || this.processedMessages.has(messageId)) return;

      this.processedMessages.add(messageId);

      const viewOnceData = this.extractViewOnceFromMessage(message.message);
      if (!viewOnceData) return;

      console.log(`🔍 ViewOnce message detected from ${message.key.remoteJid}`);

      // Attempt to download the media
      const buffer = await this.attemptDownload(viewOnceData, message);
      
      if (buffer && buffer.length > 0) {
        // Save media if configured
        const config = this.getConfig();
        if (config.saveMedia) {
          await this.saveMedia(buffer, viewOnceData.mediaType, messageId);
        }

        // Send the intercepted content back to the chat
        await this.sendInterceptedContent(sock, message, buffer, viewOnceData);
      } else {
        // Send detection notification even if download failed
        await this.sendDetectionNotification(sock, message, viewOnceData);
      }

    } catch (error) {
      console.error('Error handling ViewOnce message:', error);
    }
  }

  private extractViewOnceFromMessage(message: any): ViewOnceData | null {
    if (!message) return null;

    // Check for viewOnceMessage
    if (message.viewOnceMessage?.message) {
      const content = message.viewOnceMessage.message;
      const messageType = Object.keys(content)[0];
      return {
        content,
        messageType,
        mediaType: this.getMediaType(messageType),
        data: content[messageType]
      };
    }

    // Check for viewOnceMessageV2
    if (message.viewOnceMessageV2?.message) {
      const content = message.viewOnceMessageV2.message;
      const messageType = Object.keys(content)[0];
      return {
        content,
        messageType,
        mediaType: this.getMediaType(messageType),
        data: content[messageType]
      };
    }

    // Check for viewOnceMessageV2Extension
    if (message.viewOnceMessageV2Extension?.message) {
      const content = message.viewOnceMessageV2Extension.message;
      const messageType = Object.keys(content)[0];
      return {
        content,
        messageType,
        mediaType: this.getMediaType(messageType),
        data: content[messageType]
      };
    }

    // Check for direct viewOnce properties
    for (const [key, value] of Object.entries(message)) {
      if (value && typeof value === 'object' && (value as any).viewOnce === true) {
        return {
          content: message,
          messageType: key,
          mediaType: this.getMediaType(key),
          data: value
        };
      }
    }

    return null;
  }

  private getMediaType(messageType: string): string {
    if (messageType.includes('image')) return 'image';
    if (messageType.includes('video')) return 'video';
    if (messageType.includes('audio')) return 'audio';
    if (messageType.includes('document')) return 'document';
    return 'unknown';
  }

  private async attemptDownload(viewOnceData: ViewOnceData, message: WAMessage): Promise<Buffer | null> {
    const downloadMethods = [
      // Method 1: Download from data object
      async (): Promise<Buffer | null> => {
        if (!viewOnceData.data) return null;
        const stream = await downloadContentFromMessage(viewOnceData.data, viewOnceData.mediaType as any);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer.length > 0 ? buffer : null;
      },

      // Method 2: Download from content
      async (): Promise<Buffer | null> => {
        if (!viewOnceData.content) return null;
        const messageData = viewOnceData.content[viewOnceData.messageType];
        if (!messageData) return null;
        const stream = await downloadContentFromMessage(messageData, viewOnceData.mediaType as any);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer.length > 0 ? buffer : null;
      },

      // Method 3: Try with the message itself
      async (): Promise<Buffer | null> => {
        if (!message.message) return null;
        const stream = await downloadContentFromMessage(message.message, viewOnceData.mediaType as any);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer.length > 0 ? buffer : null;
      }
    ];

    for (let i = 0; i < downloadMethods.length; i++) {
      try {
        console.log(`🔄 Trying download method ${i + 1}...`);
        const result = await downloadMethods[i]();
        if (result && result.length > 0) {
          console.log(`✅ Download successful with method ${i + 1} (${result.length} bytes)`);
          return result;
        }
      } catch (error) {
        console.log(`❌ Download method ${i + 1} failed:`, (error as Error).message);
      }
    }

    console.log('❌ All download methods failed');
    return null;
  }

  private async saveMedia(buffer: Buffer, mediaType: string, messageId: string): Promise<void> {
    try {
      const extension = this.getFileExtension(mediaType);
      const filename = `viewonce_${messageId}.${extension}`;
      const filepath = join(this.mediaDir, filename);
      
      writeFileSync(filepath, buffer);
      console.log(`💾 ViewOnce media saved: ${filename}`);
    } catch (error) {
      console.error('Error saving ViewOnce media:', error);
    }
  }

  private getFileExtension(mediaType: string): string {
    switch (mediaType) {
      case 'image': return 'jpg';
      case 'video': return 'mp4';
      case 'audio': return 'ogg';
      case 'document': return 'bin';
      default: return 'dat';
    }
  }

  private async sendInterceptedContent(sock: WASocket, originalMessage: WAMessage, buffer: Buffer, viewOnceData: ViewOnceData): Promise<void> {
    try {
      const chatId = originalMessage.key.remoteJid;
      if (!chatId) return;

      const caption = `🔍 *Anti-ViewOnce* 🔍\n\n📱 ViewOnce message intercepted!\n👤 From: ${originalMessage.pushName || 'Unknown'}\n⏰ Time: ${new Date().toLocaleString()}\n\n${viewOnceData.data?.caption || ''}`;

      const messageOptions = {
        quoted: originalMessage
      };

      switch (viewOnceData.mediaType) {
        case 'image':
          await sock.sendMessage(chatId, {
            image: buffer,
            caption,
            mimetype: viewOnceData.data?.mimetype || 'image/jpeg'
          }, messageOptions);
          break;

        case 'video':
          await sock.sendMessage(chatId, {
            video: buffer,
            caption,
            mimetype: viewOnceData.data?.mimetype || 'video/mp4'
          }, messageOptions);
          break;

        case 'audio':
          await sock.sendMessage(chatId, {
            audio: buffer,
            ptt: viewOnceData.data?.ptt || false,
            mimetype: viewOnceData.data?.mimetype || 'audio/ogg; codecs=opus'
          }, messageOptions);
          break;

        default:
          await sock.sendMessage(chatId, {
            document: buffer,
            fileName: `viewonce_intercepted.${this.getFileExtension(viewOnceData.mediaType)}`,
            caption
          }, messageOptions);
          break;
      }

      console.log(`✅ ViewOnce content sent back to chat: ${chatId}`);
    } catch (error) {
      console.error('Error sending intercepted content:', error);
    }
  }

  private async sendDetectionNotification(sock: WASocket, originalMessage: WAMessage, viewOnceData: ViewOnceData): Promise<void> {
    try {
      const chatId = originalMessage.key.remoteJid;
      if (!chatId) return;

      const message = `🔍 *Anti-ViewOnce Detection* 🔍\n\n⚠️ ViewOnce message detected but content could not be retrieved\n\n📱 Type: ${viewOnceData.messageType}\n🎭 Media: ${viewOnceData.mediaType}\n👤 From: ${originalMessage.pushName || 'Unknown'}\n⏰ Time: ${new Date().toLocaleString()}\n\n💡 The message was already processed or encrypted before interception.`;

      await sock.sendMessage(chatId, { text: message }, { quoted: originalMessage });
      console.log(`📢 ViewOnce detection notification sent to: ${chatId}`);
    } catch (error) {
      console.error('Error sending detection notification:', error);
    }
  }

  public getStatusMessage(): string {
    const config = this.getConfig();
    const status = config.enabled ? 'enabled' : 'disabled';
    const saveStatus = config.saveMedia ? 'enabled' : 'disabled';
    
    return `🔍 *Anti-ViewOnce Settings*\n\n👁️ *Status:* ${status}\n💾 *Save Media:* ${saveStatus}\n\n*Commands:*\n.antiviewonce on - Enable anti-viewonce\n.antiviewonce off - Disable anti-viewonce\n.antiviewonce save on - Enable media saving\n.antiviewonce save off - Disable media saving`;
  }
}

// Export singleton-style factory
const antiViewOnceInstances = new Map<string, AntiViewOnceService>();

export const getAntiViewOnceService = (botId: string): AntiViewOnceService => {
  if (!antiViewOnceInstances.has(botId)) {
    antiViewOnceInstances.set(botId, new AntiViewOnceService(botId));
  }
  return antiViewOnceInstances.get(botId)!;
};
