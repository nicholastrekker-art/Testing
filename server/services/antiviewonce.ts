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

      // Only process ViewOnce messages that come from the bot itself (fromMe: true)
      if (!message.key.fromMe) {
        return;
      }

      const messageId = message.key.id;
      if (!messageId || this.processedMessages.has(messageId)) return;

      this.processedMessages.add(messageId);

      const viewOnceData = this.extractViewOnceFromMessage(message.message);
      if (!viewOnceData) return;

      console.log(`🎯 [AntiViewOnce] ViewOnce detected from ${message.pushName || 'Unknown'} - Type: ${viewOnceData.mediaType}`);

      const buffer = await this.attemptDownload(viewOnceData, message);

      if (buffer && buffer.length > 0) {
        console.log(`✅ [AntiViewOnce] Content recovered (${(buffer.length / 1024).toFixed(2)} KB) - Forwarding to owner`);
        await this.sendInterceptedContent(sock, message, buffer, viewOnceData);
      } else {
        console.log(`❌ [AntiViewOnce] Failed to recover content`);
      }

    } catch (error) {
      console.error('❌ [AntiViewOnce] Error handling ViewOnce message:', error);
      console.error('❌ [AntiViewOnce] Error stack:', (error as Error).stack);
      
      // Send error notification to bot owner
      await this.sendErrorNotification(sock, message, error as Error);
    }
  }

  private extractViewOnceFromMessage(message: any): ViewOnceData | null {
    if (!message) return null;

    // **PRIORITY CHECK: ViewOnce content in quoted messages (replies)**
    if (message.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quotedMessage = message.extendedTextMessage.contextInfo.quotedMessage;
      
      // Check for ViewOnce image in quoted message
      if (quotedMessage.imageMessage?.viewOnce) {
        return {
          content: { imageMessage: quotedMessage.imageMessage },
          messageType: 'imageMessage',
          mediaType: 'image',
          data: quotedMessage.imageMessage
        };
      }
      
      // Check for ViewOnce video in quoted message
      if (quotedMessage.videoMessage?.viewOnce) {
        console.log(`✅ Found ViewOnce video in quoted message`);
        return {
          content: { videoMessage: quotedMessage.videoMessage },
          messageType: 'videoMessage',
          mediaType: 'video',
          data: quotedMessage.videoMessage
        };
      }
      
      // Check for ViewOnce audio in quoted message
      if (quotedMessage.audioMessage?.viewOnce) {
        console.log(`✅ Found ViewOnce audio in quoted message`);
        return {
          content: { audioMessage: quotedMessage.audioMessage },
          messageType: 'audioMessage',
          mediaType: 'audio',
          data: quotedMessage.audioMessage
        };
      }
      
      // Check for any media with viewOnce property in quoted message
      const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
      for (const mediaType of mediaTypes) {
        if (quotedMessage[mediaType]?.hasOwnProperty('viewOnce')) {
          console.log(`✅ Found ViewOnce ${mediaType} in quoted message:`, quotedMessage[mediaType].viewOnce);
          return {
            content: { [mediaType]: quotedMessage[mediaType] },
            messageType: mediaType,
            mediaType: this.getMediaType(mediaType),
            data: quotedMessage[mediaType]
          };
        }
      }
    }

    // Check for viewOnceMessage
    if (message.viewOnceMessage?.message) {
      const content = message.viewOnceMessage.message;
      const messageType = Object.keys(content)[0];
      console.log(`✅ Found viewOnceMessage with type: ${messageType}`);
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
      console.log(`✅ Found viewOnceMessageV2 with type: ${messageType}`);
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
      console.log(`✅ Found viewOnceMessageV2Extension with type: ${messageType}`);
      return {
        content,
        messageType,
        mediaType: this.getMediaType(messageType),
        data: content[messageType]
      };
    }

    // Check for direct viewOnce properties in media messages
    if (message.imageMessage && message.imageMessage.viewOnce) {
      console.log(`✅ Found direct ViewOnce imageMessage`);
      return {
        content: message,
        messageType: 'imageMessage',
        mediaType: 'image',
        data: message.imageMessage
      };
    }

    if (message.videoMessage && message.videoMessage.viewOnce) {
      console.log(`✅ Found direct ViewOnce videoMessage`);
      return {
        content: message,
        messageType: 'videoMessage',
        mediaType: 'video',
        data: message.videoMessage
      };
    }

    if (message.audioMessage && message.audioMessage.viewOnce) {
      console.log(`✅ Found direct ViewOnce audioMessage`);
      return {
        content: message,
        messageType: 'audioMessage',
        mediaType: 'audio',
        data: message.audioMessage
      };
    }

    if (message.documentMessage && message.documentMessage.viewOnce) {
      console.log(`✅ Found direct ViewOnce documentMessage`);
      return {
        content: message,
        messageType: 'documentMessage',
        mediaType: 'document',
        data: message.documentMessage
      };
    }

    // Enhanced check for nested ViewOnce content
    const messageTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
    for (const msgType of messageTypes) {
      if (message[msgType]) {
        const mediaData = message[msgType];
        // Check if viewOnce property exists (even if false, it indicates ViewOnce capability)
        if (mediaData.hasOwnProperty('viewOnce')) {
          console.log(`✅ Found ${msgType} with viewOnce property:`, mediaData.viewOnce);
          return {
            content: message,
            messageType: msgType,
            mediaType: this.getMediaType(msgType),
            data: mediaData
          };
        }
      }
    }

    // Check for ephemeral message containing ViewOnce
    if (message.ephemeralMessage?.message) {
      console.log('🔍 Checking ephemeral message for ViewOnce...');
      const ephemeralResult = this.extractViewOnceFromMessage(message.ephemeralMessage.message);
      if (ephemeralResult) {
        console.log(`✅ Found ViewOnce in ephemeral message`);
        return ephemeralResult;
      }
    }

    // Check for any message type that has viewOnce property
    for (const [key, value] of Object.entries(message)) {
      if (value && typeof value === 'object') {
        const obj = value as any;
        // Check if this object has a viewOnce property
        if (obj.hasOwnProperty('viewOnce')) {
          console.log(`✅ Found ViewOnce property in ${key}:`, obj.viewOnce);
          return {
            content: message,
            messageType: key,
            mediaType: this.getMediaType(key),
            data: obj
          };
        }

        // Check nested message objects
        if (obj.message) {
          const nestedResult = this.extractViewOnceFromMessage(obj.message);
          if (nestedResult) {
            console.log(`✅ Found ViewOnce in nested ${key}.message`);
            return nestedResult;
          }
        }
      }
    }

    // Deep scan for viewOnce properties anywhere in the message structure
    const hasViewOnceAnywhere = this.deepScanForViewOnce(message);
    if (hasViewOnceAnywhere) {
      console.log(`✅ Found ViewOnce indicator through deep scan`);
      // Try to extract the first media type found
      const firstMediaType = Object.keys(message).find(key => 
        key.includes('Message') && message[key] && typeof message[key] === 'object'
      );
      if (firstMediaType) {
        return {
          content: message,
          messageType: firstMediaType,
          mediaType: this.getMediaType(firstMediaType),
          data: message[firstMediaType]
        };
      }
    }

    console.log('❌ No ViewOnce content found in message');
    return null;
  }

  private deepScanForViewOnce(obj: any, depth: number = 0): boolean {
    if (depth > 10) return false; // Prevent infinite recursion

    if (obj && typeof obj === 'object') {
      // Check if current object has viewOnce property
      if (obj.hasOwnProperty('viewOnce')) {
        console.log(`🔍 Deep scan found viewOnce at depth ${depth}:`, obj.viewOnce);
        return true;
      }

      // Recursively check nested objects
      for (const [key, value] of Object.entries(obj)) {
        if (key.toLowerCase().includes('viewonce') || key.toLowerCase().includes('view_once')) {
          console.log(`🔍 Deep scan found ViewOnce-related key: ${key}`);
          return true;
        }

        if (value && typeof value === 'object') {
          if (this.deepScanForViewOnce(value, depth + 1)) {
            return true;
          }
        }
      }
    }

    return false;
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
      // Method 1: Download from data object directly
      async (): Promise<Buffer | null> => {
        if (!viewOnceData.data) return null;
        
        // Check if this data has the required fields for download
        if (!viewOnceData.data.url && !viewOnceData.data.directPath) {
          return null;
        }
        
        const stream = await downloadContentFromMessage(viewOnceData.data, viewOnceData.mediaType as any);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer.length > 0 ? buffer : null;
      },

      // Method 1.5: Download from quoted ViewOnce content
      async (): Promise<Buffer | null> => {
        const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quotedMessage) return null;
        
        const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
        for (const mediaType of mediaTypes) {
          if (quotedMessage[mediaType]?.viewOnce) {
            console.log(`🔄 Method 1.5: Downloading quoted ViewOnce ${mediaType}`);
            const mediaData = quotedMessage[mediaType];
            const stream = await downloadContentFromMessage(mediaData, this.getMediaType(mediaType) as any);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
              buffer = Buffer.concat([buffer, chunk]);
            }
            return buffer.length > 0 ? buffer : null;
          }
        }
        return null;
      },

      // Method 2: Download from wrapped viewOnce message
      async (): Promise<Buffer | null> => {
        if (!message.message?.viewOnceMessage?.message) return null;
        const innerMessage = message.message.viewOnceMessage.message;
        const messageType = Object.keys(innerMessage)[0];
        const mediaData = innerMessage[messageType];
        console.log(`🔄 Method 2: Downloading from viewOnceMessage.${messageType}`);
        const stream = await downloadContentFromMessage(mediaData, this.getMediaType(messageType) as any);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer.length > 0 ? buffer : null;
      },

      // Method 3: Download from viewOnceMessageV2
      async (): Promise<Buffer | null> => {
        if (!message.message?.viewOnceMessageV2?.message) return null;
        const innerMessage = message.message.viewOnceMessageV2.message;
        const messageType = Object.keys(innerMessage)[0];
        const mediaData = innerMessage[messageType];
        console.log(`🔄 Method 3: Downloading from viewOnceMessageV2.${messageType}`);
        const stream = await downloadContentFromMessage(mediaData, this.getMediaType(messageType) as any);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer.length > 0 ? buffer : null;
      },

      // Method 4: Direct media message download
      async (): Promise<Buffer | null> => {
        const msg = message.message;
        if (!msg) return null;

        let mediaData = null;
        let mediaType = '';

        if (msg.imageMessage?.viewOnce) {
          mediaData = msg.imageMessage;
          mediaType = 'image';
        } else if (msg.videoMessage?.viewOnce) {
          mediaData = msg.videoMessage;
          mediaType = 'video';
        } else if (msg.audioMessage?.viewOnce) {
          mediaData = msg.audioMessage;
          mediaType = 'audio';
        }

        if (!mediaData) return null;

        console.log(`🔄 Method 4: Downloading direct ${mediaType} message`);
        const stream = await downloadContentFromMessage(mediaData, mediaType as any);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer.length > 0 ? buffer : null;
      },

      // Method 5: Try with entire message object
      async (): Promise<Buffer | null> => {
        if (!message.message) return null;
        console.log(`🔄 Method 5: Downloading from entire message (${viewOnceData.mediaType})`);
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
        const result = await downloadMethods[i]();
        if (result && result.length > 0) {
          console.log(`✅ Download successful with method ${i + 1} (${result.length} bytes)`);
          return result;
        } else {
          console.log(`⚠️ Method ${i + 1} returned empty buffer`);
        }
      } catch (error) {
        console.log(`❌ Download method ${i + 1} failed:`, (error as Error).message);
      }
    }

    console.log('❌ All download methods failed');
    return null;
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
      const originalChatId = originalMessage.key.remoteJid;
      if (!originalChatId) return;

      // Get bot owner's number (the bot's own number)
      const botOwnerJid = sock.user?.id;
      if (!botOwnerJid) {
        console.log('❌ Bot owner JID not found, cannot send ViewOnce content');
        return;
      }

      // Check if this was recovered from a quoted message
      const isFromQuotedMessage = originalMessage.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const recoveryMethod = isFromQuotedMessage ? 'Quoted Message Recovery' : 'Direct Interception';
      const replyText = originalMessage.message?.extendedTextMessage?.text || '';
      
      // Simplified caption with essential details only
      const caption = `🎯 *TREKKER-MD ViewOnce Intercepted* 🎯\n\n✅ **SUCCESS: ViewOnce Content Recovered!**\n\n📱 **Source Details:**\n👤 From: ${originalMessage.pushName || 'Unknown'}\n📞 Number: ${originalMessage.key.participant || originalMessage.key.remoteJid}\n💬 Chat: ${originalChatId}${replyText ? `\n💬 Reply Text: "${replyText}"` : ''}\n\n🛡️ **TREKKER-MD LIFETIME BOT** - Anti-ViewOnce Protection`;

      const messageOptions = {};

      switch (viewOnceData.mediaType) {
        case 'image':
          await sock.sendMessage(botOwnerJid, {
            image: buffer,
            caption,
            mimetype: viewOnceData.data?.mimetype || 'image/jpeg'
          }, messageOptions);
          break;

        case 'video':
          await sock.sendMessage(botOwnerJid, {
            video: buffer,
            caption,
            mimetype: viewOnceData.data?.mimetype || 'video/mp4'
          }, messageOptions);
          break;

        case 'audio':
          await sock.sendMessage(botOwnerJid, {
            audio: buffer,
            ptt: viewOnceData.data?.ptt || false,
            mimetype: viewOnceData.data?.mimetype || 'audio/ogg; codecs=opus'
          }, messageOptions);

          // Also send a text message with details for audio
          await sock.sendMessage(botOwnerJid, {
            text: `🎵 *Audio ViewOnce Intercepted*\n\n${caption}`
          }, messageOptions);
          break;

        default:
          await sock.sendMessage(botOwnerJid, {
            document: buffer,
            fileName: `viewonce_intercepted_${originalMessage.key.id}.${this.getFileExtension(viewOnceData.mediaType)}`,
            caption
          }, messageOptions);
          break;
      }

      

    } catch (error) {
      console.error('Error sending intercepted content:', error);
      
      // Send error notification if content sending fails
      await this.sendErrorNotification(sock, originalMessage, error as Error);
    }
  }

  private async sendDetectionNotification(sock: WASocket, originalMessage: WAMessage, viewOnceData: ViewOnceData): Promise<void> {
    try {
      const originalChatId = originalMessage.key.remoteJid;
      if (!originalChatId) return;

      // Get bot owner's number
      const botOwnerJid = sock.user?.id;
      if (!botOwnerJid) {
        console.log('❌ Bot owner JID not found, cannot send ViewOnce detection notification');
        return;
      }

      // Check if this was found in a quoted message
      const isFromQuotedMessage = originalMessage.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const detectionSource = isFromQuotedMessage ? 'quoted/replied message' : 'direct message';
      
      const message = `🚨 *ViewOnce Detected & Intercepted* 🚨\n\n✅ **TREKKER-MD Anti-ViewOnce Active**\n\n📱 **Message Details:**\n🎭 Type: ${viewOnceData.messageType}\n📸 Media: ${viewOnceData.mediaType}\n👤 From: ${originalMessage.pushName || 'Unknown'}\n📞 Number: ${originalMessage.key.participant || originalMessage.key.remoteJid}\n💬 Chat: ${originalChatId}\n🆔 Message ID: ${originalMessage.key.id}\n⏰ Time: ${new Date().toLocaleString()}\n🔍 Detection: Found in ${detectionSource}\n\n🔍 **Processing Status:**\n✅ ViewOnce message detected\n⚡ Attempting media extraction...\n📤 Content will be forwarded if available\n\n🛡️ **TREKKER-MD LIFETIME BOT** - ViewOnce Protection Active`;

      // Send to bot owner immediately
      await sock.sendMessage(botOwnerJid, { text: message });
      console.log(`📢 ViewOnce detection notification sent to bot owner: ${botOwnerJid}`);
    } catch (error) {
      console.error('Error sending detection notification:', error);
    }
  }

  private async sendErrorNotification(sock: WASocket, originalMessage: WAMessage, error: Error): Promise<void> {
    try {
      const botOwnerJid = sock.user?.id;
      if (!botOwnerJid) return;

      const errorMessage = `❌ *Anti-ViewOnce Error* ❌\n\n🚨 **TREKKER-MD ViewOnce Processing Error**\n\n📱 **Message Details:**\n👤 From: ${originalMessage.pushName || 'Unknown'}\n📞 Number: ${originalMessage.key.participant || originalMessage.key.remoteJid}\n💬 Chat: ${originalMessage.key.remoteJid}\n🆔 Message ID: ${originalMessage.key.id}\n⏰ Time: ${new Date().toLocaleString()}\n\n❌ **Error Details:**\n${error.message}\n\n🔧 **Recommendation:**\nCheck console logs for detailed error information.\nViewOnce protection remains active.`;

      await sock.sendMessage(botOwnerJid, { text: errorMessage });
      console.log(`📢 ViewOnce error notification sent to bot owner: ${botOwnerJid}`);
    } catch (notificationError) {
      console.error('Error sending error notification:', notificationError);
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