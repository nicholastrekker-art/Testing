
import { WASocket, proto, downloadMediaMessage } from '@whiskeysockets/baileys';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { BotInstance } from '@shared/schema';

interface DeletedMessage {
  messageId: string;
  chatId: string;
  sender: string;
  timestamp: number;
  messageType: string;
  text?: string;
  caption?: string;
  mediaPath?: string;
  mediaType?: string;
}

class AntideleteService {
  private botId: string;
  private storageDir: string;
  private messagesFile: string;
  private mediaDir: string;
  private deletedMessages: Map<string, DeletedMessage> = new Map();
  private enabled: boolean = true;

  constructor(botInstance: BotInstance) {
    this.botId = botInstance.id;
    
    // Use server name from bot instance settings
    const serverName = (botInstance.settings as any)?.serverName || 'SERVER0';
    
    // Create bot-specific directory under server folder
    this.storageDir = join(process.cwd(), 'server', 'data', 'antidelete', serverName, `bot_${this.botId}`);
    this.mediaDir = join(this.storageDir, 'media');
    this.messagesFile = join(this.storageDir, 'messages.json');

    // Ensure directories exist
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
    if (!existsSync(this.mediaDir)) {
      mkdirSync(this.mediaDir, { recursive: true });
    }

    this.loadMessages();
  }

  private loadMessages() {
    try {
      if (existsSync(this.messagesFile)) {
        const data = readFileSync(this.messagesFile, 'utf-8');
        const messages = JSON.parse(data);
        this.deletedMessages = new Map(Object.entries(messages));
      }
    } catch (error) {
      console.error(`[Antidelete] Error loading messages for bot ${this.botId}:`, error);
    }
  }

  private saveMessages() {
    try {
      const messagesObj = Object.fromEntries(this.deletedMessages);
      writeFileSync(this.messagesFile, JSON.stringify(messagesObj, null, 2));
    } catch (error) {
      console.error(`[Antidelete] Error saving messages for bot ${this.botId}:`, error);
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async storeMessage(message: proto.IWebMessageInfo, client: WASocket) {
    if (!this.enabled) return;

    try {
      const messageId = message.key.id;
      if (!messageId) return;

      const chatId = message.key.remoteJid || '';
      const sender = message.key.participant || message.key.remoteJid || '';
      const timestamp = message.messageTimestamp ? Number(message.messageTimestamp) : Date.now();

      console.log(`\n📥 [Antidelete] Storing Message`);
      console.log(`   🆔 ID: ${messageId}`);
      console.log(`   💬 Chat: ${chatId}`);
      console.log(`   👤 Sender: ${sender}`);
      console.log(`   🕐 Timestamp: ${new Date(timestamp).toLocaleString()}`);

      let messageType = 'text';
      let text = '';
      let caption = '';
      let mediaPath = '';
      let mediaType = '';

      // Extract message content
      const messageContent = message.message;
      if (!messageContent) {
        console.log(`   ⚠️ No message content found`);
        return;
      }

      console.log(`   📦 Message keys: ${Object.keys(messageContent).join(', ')}`);

      // Text message
      if (messageContent.conversation) {
        messageType = 'text';
        text = messageContent.conversation;
        console.log(`   📝 Type: Conversation`);
        console.log(`   💬 Text: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
      } else if (messageContent.extendedTextMessage?.text) {
        messageType = 'text';
        text = messageContent.extendedTextMessage.text;
        console.log(`   📝 Type: Extended Text`);
        console.log(`   💬 Text: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
        if (messageContent.extendedTextMessage.contextInfo) {
          console.log(`   🔗 Has context info (quoted message, etc.)`);
        }
      }

      // Image
      else if (messageContent.imageMessage) {
        messageType = 'image';
        caption = messageContent.imageMessage.caption || '';
        mediaType = 'image';
        console.log(`   🖼️ Type: Image`);
        console.log(`   📏 Size: ${messageContent.imageMessage.width}x${messageContent.imageMessage.height}`);
        console.log(`   📦 File size: ${messageContent.imageMessage.fileLength} bytes`);
        console.log(`   🔗 URL: ${messageContent.imageMessage.url || 'N/A'}`);
        console.log(`   🛣️ Direct Path: ${messageContent.imageMessage.directPath || 'N/A'}`);
        console.log(`   🎭 Mimetype: ${messageContent.imageMessage.mimetype || 'N/A'}`);
        if (caption) console.log(`   💬 Caption: ${caption.substring(0, 100)}${caption.length > 100 ? '...' : ''}`);
        mediaPath = await this.downloadMedia(message, client, messageId, 'image');
      }

      // Video
      else if (messageContent.videoMessage) {
        messageType = 'video';
        caption = messageContent.videoMessage.caption || '';
        mediaType = 'video';
        console.log(`   🎥 Type: Video`);
        console.log(`   📏 Size: ${messageContent.videoMessage.width}x${messageContent.videoMessage.height}`);
        console.log(`   ⏱️ Duration: ${messageContent.videoMessage.seconds || 'N/A'} seconds`);
        console.log(`   📦 File size: ${messageContent.videoMessage.fileLength} bytes`);
        console.log(`   🔗 URL: ${messageContent.videoMessage.url || 'N/A'}`);
        console.log(`   🛣️ Direct Path: ${messageContent.videoMessage.directPath || 'N/A'}`);
        console.log(`   🎭 Mimetype: ${messageContent.videoMessage.mimetype || 'N/A'}`);
        if (caption) console.log(`   💬 Caption: ${caption.substring(0, 100)}${caption.length > 100 ? '...' : ''}`);
        mediaPath = await this.downloadMedia(message, client, messageId, 'video');
      }

      // Audio
      else if (messageContent.audioMessage) {
        messageType = 'audio';
        mediaType = 'audio';
        console.log(`   🎵 Type: Audio`);
        console.log(`   ⏱️ Duration: ${messageContent.audioMessage.seconds || 'N/A'} seconds`);
        console.log(`   📦 File size: ${messageContent.audioMessage.fileLength} bytes`);
        console.log(`   🔗 URL: ${messageContent.audioMessage.url || 'N/A'}`);
        console.log(`   🛣️ Direct Path: ${messageContent.audioMessage.directPath || 'N/A'}`);
        console.log(`   🎭 Mimetype: ${messageContent.audioMessage.mimetype || 'N/A'}`);
        console.log(`   🎤 Is Voice: ${messageContent.audioMessage.ptt ? 'Yes' : 'No'}`);
        mediaPath = await this.downloadMedia(message, client, messageId, 'audio');
      }

      // Document
      else if (messageContent.documentMessage) {
        messageType = 'document';
        caption = messageContent.documentMessage.caption || '';
        mediaType = 'document';
        console.log(`   📄 Type: Document`);
        console.log(`   📝 Filename: ${messageContent.documentMessage.fileName || 'N/A'}`);
        console.log(`   📦 File size: ${messageContent.documentMessage.fileLength} bytes`);
        console.log(`   🔗 URL: ${messageContent.documentMessage.url || 'N/A'}`);
        console.log(`   🛣️ Direct Path: ${messageContent.documentMessage.directPath || 'N/A'}`);
        console.log(`   🎭 Mimetype: ${messageContent.documentMessage.mimetype || 'N/A'}`);
        if (caption) console.log(`   💬 Caption: ${caption.substring(0, 100)}${caption.length > 100 ? '...' : ''}`);
        mediaPath = await this.downloadMedia(message, client, messageId, 'document');
      }

      // Sticker
      else if (messageContent.stickerMessage) {
        messageType = 'sticker';
        mediaType = 'sticker';
        console.log(`   🎨 Type: Sticker`);
        console.log(`   📏 Size: ${messageContent.stickerMessage.width}x${messageContent.stickerMessage.height}`);
        console.log(`   📦 File size: ${messageContent.stickerMessage.fileLength} bytes`);
        console.log(`   🔗 URL: ${messageContent.stickerMessage.url || 'N/A'}`);
        console.log(`   🛣️ Direct Path: ${messageContent.stickerMessage.directPath || 'N/A'}`);
        console.log(`   🎭 Mimetype: ${messageContent.stickerMessage.mimetype || 'N/A'}`);
        console.log(`   🎭 Animated: ${messageContent.stickerMessage.isAnimated ? 'Yes' : 'No'}`);
        mediaPath = await this.downloadMedia(message, client, messageId, 'sticker');
      }

      const deletedMessage: DeletedMessage = {
        messageId,
        chatId,
        sender,
        timestamp,
        messageType,
        text,
        caption,
        mediaPath,
        mediaType
      };

      this.deletedMessages.set(messageId, deletedMessage);
      this.saveMessages();
      
      console.log(`   ✅ Message stored successfully`);
      console.log(`   💾 Total stored messages: ${this.deletedMessages.size}`);
      if (mediaPath) {
        console.log(`   📂 Media saved to: ${mediaPath}`);
      }
      console.log(`─────────────────────────────────────────────────────────\n`);

    } catch (error) {
      console.error(`❌ [Antidelete] Error storing message:`, error);
      console.log(`─────────────────────────────────────────────────────────\n`);
    }
  }

  private async downloadMedia(message: proto.IWebMessageInfo, client: WASocket, messageId: string, mediaType: string): Promise<string> {
    try {
      console.log(`   ⬇️ Downloading ${mediaType} media...`);
      const buffer = await downloadMediaMessage(message, 'buffer', {});
      const filename = `${messageId}.media`;
      const filepath = join(this.mediaDir, filename);
      writeFileSync(filepath, buffer as Buffer);
      console.log(`   ✅ Media downloaded: ${(buffer as Buffer).length} bytes`);
      return filepath;
    } catch (error) {
      console.error(`   ❌ [Antidelete] Error downloading media:`, error);
      return '';
    }
  }

  async handleDeletedMessage(messageId: string, client: WASocket, chatId: string) {
    if (!this.enabled) return;

    const deletedMsg = this.deletedMessages.get(messageId);
    if (!deletedMsg) {
      return;
    }

    try {
      let recoveryText = `🔴 *Message Deleted*\n\n`;
      recoveryText += `👤 *Sender:* @${deletedMsg.sender.split('@')[0]}\n`;
      recoveryText += `📅 *Time:* ${new Date(deletedMsg.timestamp).toLocaleString()}\n`;
      recoveryText += `💬 *Type:* ${deletedMsg.messageType}\n\n`;

      if (deletedMsg.text) {
        recoveryText += `📝 *Message:*\n${deletedMsg.text}`;
      } else if (deletedMsg.caption) {
        recoveryText += `📝 *Caption:*\n${deletedMsg.caption}`;
      }

      // Send text info
      await client.sendMessage(chatId, {
        text: recoveryText,
        mentions: [deletedMsg.sender]
      });

      // Send media if exists
      if (deletedMsg.mediaPath && existsSync(deletedMsg.mediaPath)) {
        const buffer = readFileSync(deletedMsg.mediaPath);

        if (deletedMsg.mediaType === 'image') {
          await client.sendMessage(chatId, {
            image: buffer,
            caption: '📸 Recovered Image'
          });
        } else if (deletedMsg.mediaType === 'video') {
          await client.sendMessage(chatId, {
            video: buffer,
            caption: '🎥 Recovered Video'
          });
        } else if (deletedMsg.mediaType === 'audio') {
          await client.sendMessage(chatId, {
            audio: buffer,
            mimetype: 'audio/mp4'
          });
        } else if (deletedMsg.mediaType === 'sticker') {
          await client.sendMessage(chatId, {
            sticker: buffer
          });
        } else if (deletedMsg.mediaType === 'document') {
          await client.sendMessage(chatId, {
            document: buffer,
            fileName: 'recovered_document'
          });
        }
      }

    } catch (error) {
      console.error(`[Antidelete] Error handling deleted message:`, error);
    }
  }

  getStoredMessage(messageId: string): DeletedMessage | undefined {
    return this.deletedMessages.get(messageId);
  }

  async handleAntideleteCommand(client: WASocket, chatId: string, message: proto.IWebMessageInfo, command?: string) {
    try {
      const isOwner = message.key.fromMe;

      if (!isOwner) {
        await client.sendMessage(chatId, {
          text: '❌ This command can only be used by the bot owner!'
        });
        return;
      }

      if (!command) {
        const status = this.enabled ? 'Enabled ✅' : 'Disabled ❌';
        const statusText = `📊 *Anti-Delete Status*\n\n🔰 *Status:* ${status}\n💾 *Stored Messages:* ${this.deletedMessages.size}\n\n*Usage:*\n.antidelete on - Enable\n.antidelete off - Disable\n.antidelete clear - Clear stored messages`;

        await client.sendMessage(chatId, { text: statusText });
        return;
      }

      if (command === 'on') {
        this.setEnabled(true);
        await client.sendMessage(chatId, {
          text: '✅ *Anti-Delete Enabled!*\n\n🛡️ Deleted messages will now be recovered.'
        });
      } else if (command === 'off') {
        this.setEnabled(false);
        await client.sendMessage(chatId, {
          text: '❌ *Anti-Delete Disabled!*\n\n⚠️ Deleted messages will not be recovered.'
        });
      } else if (command === 'clear') {
        // Clear messages and media files
        this.deletedMessages.forEach((msg) => {
          if (msg.mediaPath && existsSync(msg.mediaPath)) {
            try {
              unlinkSync(msg.mediaPath);
            } catch (error) {
              console.error(`[Antidelete] Error deleting media file:`, error);
            }
          }
        });

        this.deletedMessages.clear();
        this.saveMessages();

        await client.sendMessage(chatId, {
          text: '🗑️ *Anti-Delete Storage Cleared!*\n\nAll stored messages and media have been deleted.'
        });
      } else {
        await client.sendMessage(chatId, {
          text: '❌ Invalid command! Use: .antidelete on/off/clear'
        });
      }

    } catch (error) {
      console.error('[Antidelete] Command error:', error);
      await client.sendMessage(chatId, {
        text: '❌ Error executing antidelete command.'
      });
    }
  }
}

// Service instances map
const antideleteServices = new Map<string, AntideleteService>();

export function getAntideleteService(botInstance: BotInstance): AntideleteService {
  if (!antideleteServices.has(botInstance.id)) {
    antideleteServices.set(botInstance.id, new AntideleteService(botInstance));
  }
  return antideleteServices.get(botInstance.id)!;
}

export function clearAntideleteService(botId: string): void {
  antideleteServices.delete(botId);
}

// Legacy export for backward compatibility
export const antideleteService = {
  getStoredMessage: (messageId: string) => {
    // This is a fallback - ideally each bot should use its own service
    for (const service of antideleteServices.values()) {
      const msg = service.getStoredMessage(messageId);
      if (msg) return msg;
    }
    return undefined;
  }
};
