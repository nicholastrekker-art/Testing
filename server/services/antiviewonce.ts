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
  private suspiciousMessages = new Set<string>(); // Track suspicious empty messages

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
      console.log(`🔄 [AntiViewOnce] Starting handleMessage processing...`);
      console.log(`🔄 [AntiViewOnce] Service enabled: ${this.isEnabled()}`);

      if (!this.isEnabled()) {
        console.log(`❌ [AntiViewOnce] Service is disabled, skipping`);
        return;
      }

      const messageId = message.key.id;
      console.log(`🔄 [AntiViewOnce] Message ID: ${messageId}`);

      if (!messageId || this.processedMessages.has(messageId)) {
        console.log(`⚠️ [AntiViewOnce] Message already processed or no ID, skipping`);
        return;
      }

      this.processedMessages.add(messageId);
      console.log(`✅ [AntiViewOnce] Message marked as processing`);

      // First try to extract ViewOnce data normally
      let viewOnceData = this.extractViewOnceFromMessage(message.message);
      
      // If no ViewOnce data but we suspect it's a ViewOnce (based on message structure)
      if (!viewOnceData && this.isLikelyViewOnceMessage(message)) {
        console.log(`🔍 [AntiViewOnce] No direct ViewOnce data found, but message structure suggests ViewOnce`);
        
        // Create a synthetic ViewOnce data object to trigger notification
        viewOnceData = {
          content: message.message || {},
          messageType: 'viewOnceDetection',
          mediaType: 'unknown',
          data: message.message
        };
      }

      if (!viewOnceData) {
        console.log(`❌ [AntiViewOnce] No ViewOnce data extracted from message`);
        return;
      }

      console.log(`🎯 [AntiViewOnce] ViewOnce data extracted:`, {
        messageType: viewOnceData.messageType,
        mediaType: viewOnceData.mediaType,
        hasData: !!viewOnceData.data,
        dataKeys: viewOnceData.data ? Object.keys(viewOnceData.data) : 'No data'
      });

      console.log(`🔍 [AntiViewOnce] *** PROCESSING VIEWONCE MESSAGE ***`);
      console.log(`📱 From: ${message.key.remoteJid}`);
      console.log(`👤 Sender: ${message.pushName || 'Unknown'}`);
      console.log(`🎭 Type: ${viewOnceData.messageType} (${viewOnceData.mediaType})`);

      // Always send detection notification to bot owner first
      await this.sendDetectionNotification(sock, message, viewOnceData);

      // Attempt to download the media
      console.log(`⬇️ [AntiViewOnce] Starting download attempt...`);
      const buffer = await this.attemptDownload(viewOnceData, message);

      if (buffer && buffer.length > 0) {
        console.log(`✅ [AntiViewOnce] Download successful! Size: ${buffer.length} bytes`);

        // Save media if configured
        const config = this.getConfig();
        if (config.saveMedia) {
          console.log(`💾 [AntiViewOnce] Saving media to disk...`);
          await this.saveMedia(buffer, viewOnceData.mediaType, messageId);
        }

        // Send the intercepted content to bot owner
        console.log(`📤 [AntiViewOnce] Sending intercepted content to bot owner...`);
        await this.sendInterceptedContent(sock, message, buffer, viewOnceData);
        console.log(`✅ [AntiViewOnce] Content sent successfully!`);
      } else {
        console.log(`❌ [AntiViewOnce] Download failed - sending failure notification`);
        await this.sendMediaExtractionFailureNotification(sock, message, viewOnceData);
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

    console.log('📋 Analyzing message for ViewOnce content:', Object.keys(message));
    console.log('📋 Full message structure:', JSON.stringify(message, null, 2));

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

  private isLikelyViewOnceMessage(message: WAMessage): boolean {
    // Check if message has characteristics of a ViewOnce message
    if (!message.message) return false;

    // Check if it's an extendedTextMessage (often used for ViewOnce notifications)
    if (message.message.extendedTextMessage) {
      const contextInfo = message.message.extendedTextMessage.contextInfo;
      
      // Check if there's quoted message info that might indicate ViewOnce
      if (contextInfo?.quotedMessage || contextInfo?.stanzaId) {
        console.log(`🔍 [AntiViewOnce] ExtendedTextMessage with context info detected - possible ViewOnce notification`);
        return true;
      }
    }

    // Check for empty messages from contacts (often ViewOnce stripped of content)
    if (Object.keys(message.message).length === 0 && !message.key.fromMe) {
      console.log(`🔍 [AntiViewOnce] Empty message from contact - possible stripped ViewOnce`);
      return true;
    }

    // Check for messages with minimal content that could be ViewOnce notifications
    const messageKeys = Object.keys(message.message);
    if (messageKeys.length === 1 && messageKeys[0] === 'extendedTextMessage') {
      console.log(`🔍 [AntiViewOnce] Single extendedTextMessage - possible ViewOnce notification`);
      return true;
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
        console.log(`🔄 Method 1: Downloading from data object (${viewOnceData.mediaType})`);
        const stream = await downloadContentFromMessage(viewOnceData.data, viewOnceData.mediaType as any);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer.length > 0 ? buffer : null;
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
      const originalChatId = originalMessage.key.remoteJid;
      if (!originalChatId) return;

      // Get bot owner's number (the bot's own number)
      const botOwnerJid = sock.user?.id;
      if (!botOwnerJid) {
        console.log('❌ Bot owner JID not found, cannot send ViewOnce content');
        return;
      }

      // Enhanced caption with more details
      const caption = `🎯 *TREKKER-MD ViewOnce Intercepted* 🎯\n\n✅ **SUCCESS: ViewOnce Content Recovered!**\n\n📱 **Source Details:**\n👤 From: ${originalMessage.pushName || 'Unknown'}\n📞 Number: ${originalMessage.key.participant || originalMessage.key.remoteJid}\n💬 Chat: ${originalChatId}\n🆔 Message ID: ${originalMessage.key.id}\n⏰ Timestamp: ${new Date().toLocaleString()}\n\n📸 **Media Details:**\n🎭 Type: ${viewOnceData.mediaType}\n📏 Size: ${(buffer.length / 1024).toFixed(2)} KB\n📝 Caption: ${viewOnceData.data?.caption || 'No caption'}\n🗂️ Mimetype: ${viewOnceData.data?.mimetype || 'Unknown'}\n\n🛡️ **TREKKER-MD LIFETIME BOT** - Anti-ViewOnce Protection\n💾 Content automatically saved and forwarded to bot owner.`;

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

      console.log(`✅ ViewOnce content sent to bot owner: ${botOwnerJid}`);

      // Send success notification to original chat
      await sock.sendMessage(originalChatId, {
        text: `🎯 *ViewOnce Intercepted* 🎯\n\n✅ A ViewOnce message was successfully detected and saved.\n👤 From: ${originalMessage.pushName || 'Unknown'}\n⏰ Time: ${new Date().toLocaleString()}\n\n🛡️ Protected by TREKKER-MD Anti-ViewOnce\n📤 Content forwarded to bot owner for security.`
      }, { quoted: originalMessage });

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

      const message = `🚨 *ViewOnce Detected & Intercepted* 🚨\n\n✅ **TREKKER-MD Anti-ViewOnce Active**\n\n📱 **Message Details:**\n🎭 Type: ${viewOnceData.messageType}\n📸 Media: ${viewOnceData.mediaType}\n👤 From: ${originalMessage.pushName || 'Unknown'}\n📞 Number: ${originalMessage.key.participant || originalMessage.key.remoteJid}\n💬 Chat: ${originalChatId}\n🆔 Message ID: ${originalMessage.key.id}\n⏰ Time: ${new Date().toLocaleString()}\n\n🔍 **Processing Status:**\n✅ ViewOnce message detected\n⚡ Attempting media extraction...\n📤 Content will be forwarded if available\n\n🛡️ **TREKKER-MD LIFETIME BOT** - ViewOnce Protection Active`;

      // Send to bot owner immediately
      await sock.sendMessage(botOwnerJid, { text: message });
      console.log(`📢 ViewOnce detection notification sent to bot owner: ${botOwnerJid}`);

      // Also notify the original chat (optional)
      await sock.sendMessage(originalChatId, { 
        text: `🔍 *ViewOnce Detected* 🔍\n\n⚠️ A ViewOnce message was detected and processed.\n👤 From: ${originalMessage.pushName || 'Unknown'}\n⏰ Time: ${new Date().toLocaleString()}\n\n🛡️ Protected by TREKKER-MD Anti-ViewOnce`
      }, { quoted: originalMessage });

      console.log(`📢 ViewOnce detection notification sent to original chat: ${originalChatId}`);
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

  private async sendMediaExtractionFailureNotification(sock: WASocket, originalMessage: WAMessage, viewOnceData: ViewOnceData): Promise<void> {
    try {
      const botOwnerJid = sock.user?.id;
      if (!botOwnerJid) return;

      const failureMessage = `⚠️ *ViewOnce Media Extraction Failed* ⚠️\n\n🔍 **TREKKER-MD ViewOnce Detection Report**\n\n📱 **Message Details:**\n👤 From: ${originalMessage.pushName || 'Unknown'}\n📞 Number: ${originalMessage.key.participant || originalMessage.key.remoteJid}\n💬 Chat: ${originalMessage.key.remoteJid}\n🆔 Message ID: ${originalMessage.key.id}\n⏰ Time: ${new Date().toLocaleString()}\n\n🎭 **Detected Type:** ${viewOnceData.messageType}\n📸 **Media Type:** ${viewOnceData.mediaType}\n\n❌ **Issue:** ViewOnce message detected but media content could not be extracted\n\n📋 **Possible Reasons:**\n• ViewOnce was already opened by recipient\n• Media was encrypted before bot could access it\n• WhatsApp processed the ViewOnce before interception\n• Network timing issue during download\n\n✅ **What This Means:**\n• ViewOnce detection is working correctly\n• The system identified the ViewOnce message\n• Media content was not recoverable (expected behavior for some ViewOnce messages)\n\n🛡️ **TREKKER-MD Anti-ViewOnce remains active and monitoring**`;

      await sock.sendMessage(botOwnerJid, { text: failureMessage });
      console.log(`📢 ViewOnce media extraction failure notification sent to bot owner: ${botOwnerJid}`);
    } catch (notificationError) {
      console.error('Error sending media extraction failure notification:', notificationError);
    }
  }

  public getStatusMessage(): string {
    const config = this.getConfig();
    const status = config.enabled ? 'enabled' : 'disabled';
    const saveStatus = config.saveMedia ? 'enabled' : 'disabled';

    return `🔍 *Anti-ViewOnce Settings*\n\n👁️ *Status:* ${status}\n💾 *Save Media:* ${saveStatus}\n\n*Commands:*\n.antiviewonce on - Enable anti-viewonce\n.antiviewonce off - Disable anti-viewonce\n.antiviewonce save on - Enable media saving\n.antiviewonce save off - Disable media saving`;
  }

  public async handleEmptyMessage(sock: WASocket, message: WAMessage): Promise<void> {
    try {
      if (!this.isEnabled()) return;

      const messageId = message.key.id;
      if (!messageId || this.suspiciousMessages.has(messageId)) return;

      this.suspiciousMessages.add(messageId);
      
      console.log(`🚨 [AntiViewOnce] Handling potential stripped ViewOnce message: ${messageId}`);
      
      // Send notification about suspicious empty message
      const botOwnerJid = sock.user?.id;
      if (botOwnerJid) {
        const suspiciousMessage = `🔍 *Potential ViewOnce Detection* 🔍\n\n⚠️ **Suspicious Empty Message Detected**\n\n📱 **Message Details:**\n👤 From: ${message.pushName || 'Unknown'}\n📞 Number: ${message.key.participant || message.key.remoteJid}\n💬 Chat: ${message.key.remoteJid}\n🆔 Message ID: ${messageId}\n⏰ Time: ${new Date().toLocaleString()}\n\n🔍 **Analysis:**\nReceived a message with no content from a contact. This pattern often indicates a ViewOnce message that was processed by WhatsApp before the bot could intercept the media content.\n\n💡 **What this means:**\n• A ViewOnce message was likely sent\n• The media content was already processed/encrypted\n• This is common behavior for ViewOnce messages\n\n🛡️ **Anti-ViewOnce is actively monitoring for recoverable content**`;

        await sock.sendMessage(botOwnerJid, { text: suspiciousMessage });
        console.log(`📢 Suspicious message notification sent to bot owner`);
      }

    } catch (error) {
      console.error('Error handling empty message:', error);
    }
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