import { WASocket, WAMessage, proto, downloadMediaMessage } from '@whiskeysockets/baileys';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { BotInstance } from '@shared/schema';

interface StoredMessage {
  messageId: string;
  chatId: string;
  sender: string;
  timestamp: number;
  messageContent: any; // Store complete message content
  text?: string;
  caption?: string;
  mediaBuffer?: Buffer; // Store media as buffer
  mediaType?: string;
}

export class AntideleteService {
  private botId: string;
  private storageDir: string;
  private messagesFile: string;
  private mediaDir: string;
  private storedMessages: Map<string, StoredMessage> = new Map();
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
        // Ensure correct type for storedMessages
        this.storedMessages = new Map<string, StoredMessage>();
        for (const key in messages) {
            if (Object.prototype.hasOwnProperty.call(messages, key)) {
                const msg = messages[key];
                // Reconstruct buffer if it was saved as string
                if (msg.mediaBuffer && typeof msg.mediaBuffer === 'string') {
                    msg.mediaBuffer = Buffer.from(msg.mediaBuffer, 'base64');
                }
                this.storedMessages.set(key, msg);
            }
        }
      }
    } catch (error) {
      console.error(`[Antidelete-${this.botId}] Error loading messages:`, error);
    }
  }

  private saveMessages() {
    try {
      // Serialize buffer to base64 string for JSON compatibility
      const messagesObj = Object.fromEntries(this.storedMessages);
      for (const key in messagesObj) {
          if (Object.prototype.hasOwnProperty.call(messagesObj, key)) {
              const msg = messagesObj[key];
              if (msg.mediaBuffer && Buffer.isBuffer(msg.mediaBuffer)) {
                  msg.mediaBuffer = msg.mediaBuffer.toString('base64');
              }
          }
      }
      writeFileSync(this.messagesFile, JSON.stringify(messagesObj, null, 2));
    } catch (error) {
      console.error(`[Antidelete-${this.botId}] Error saving messages:`, error);
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async storeMessage(message: WAMessage, client: WASocket) {
    if (!this.enabled) return;

    try {
      const messageId = message.key.id;
      if (!messageId) return;

      const chatId = message.key.remoteJid || '';
      const sender = message.key.participant || message.key.remoteJid || '';
      const timestamp = message.messageTimestamp ? Number(message.messageTimestamp) : Date.now();

      let text = '';
      let caption = '';
      let mediaBuffer: Buffer | undefined;
      let mediaType: string | undefined;

      const messageContent = message.message;
      if (!messageContent) return;

      // Extract text
      if (messageContent.conversation) {
        text = messageContent.conversation;
      } else if (messageContent.extendedTextMessage?.text) {
        text = messageContent.extendedTextMessage.text;
      }

      // Extract caption and download media
      if (messageContent.imageMessage) {
        caption = messageContent.imageMessage.caption || '';
        mediaType = 'image';
        try {
          const buffer = await downloadMediaMessage(message, 'buffer', {}, { reuploadRequest: client.updateMediaMessage });
          mediaBuffer = buffer as Buffer;
        } catch (e) {
          console.error(`[Antidelete-${this.botId}] Error downloading image media:`, e);
        }
      } else if (messageContent.videoMessage) {
        caption = messageContent.videoMessage.caption || '';
        mediaType = 'video';
        try {
          const buffer = await downloadMediaMessage(message, 'buffer', {}, { reuploadRequest: client.updateMediaMessage });
          mediaBuffer = buffer as Buffer;
        } catch (e) {
          console.error(`[Antidelete-${this.botId}] Error downloading video media:`, e);
        }
      } else if (messageContent.audioMessage) {
        mediaType = 'audio';
        try {
          const buffer = await downloadMediaMessage(message, 'buffer', {}, { reuploadRequest: client.updateMediaMessage });
          mediaBuffer = buffer as Buffer;
        } catch (e) {
          console.error(`[Antidelete-${this.botId}] Error downloading audio media:`, e);
        }
      } else if (messageContent.documentMessage) {
        caption = messageContent.documentMessage.caption || '';
        mediaType = 'document';
        try {
          const buffer = await downloadMediaMessage(message, 'buffer', {}, { reuploadRequest: client.updateMediaMessage });
          mediaBuffer = buffer as Buffer;
        } catch (e) {
          console.error(`[Antidelete-${this.botId}] Error downloading document media:`, e);
        }
      } else if (messageContent.stickerMessage) {
        mediaType = 'sticker';
        try {
          const buffer = await downloadMediaMessage(message, 'buffer', {}, { reuploadRequest: client.updateMediaMessage });
          mediaBuffer = buffer as Buffer;
        } catch (e) {
          console.error(`[Antidelete-${this.botId}] Error downloading sticker media:`, e);
        }
      }

      const storedMessage: StoredMessage = {
        messageId,
        chatId,
        sender,
        timestamp,
        messageContent, // Store the entire message content object
        text,
        caption,
        mediaBuffer,
        mediaType
      };

      this.storedMessages.set(messageId, storedMessage);
      this.saveMessages();
      
      console.log(`[Antidelete-${this.botId}] Stored message ${messageId}`);

    } catch (error) {
      console.error(`[Antidelete-${this.botId}] Error storing message:`, error);
    }
  }

  async handleMessageUpdate(sock: WASocket, update: any) {
    if (!this.enabled) return;

    try {
      // The update parameter is actually the WAMessage containing the protocolMessage
      // Check if this message contains a REVOKE protocolMessage
      const protocolMsg = update.message?.protocolMessage;
      
      // Check if it's a delete event by checking the type field directly
      // Type "REVOKE" is represented as 0 in the protocol
      if (protocolMsg && (protocolMsg.type === 'REVOKE' || protocolMsg.type === 0)) {
        const deletedMessageId = protocolMsg.key?.id;
        
        if (!deletedMessageId) {
            console.log(`[Antidelete-${this.botId}] REVOKE message found but no deleted message ID.`);
            return;
        }

        console.log(`[Antidelete-${this.botId}] Detected deleted message ID: ${deletedMessageId}`);

        // Retrieve the stored message
        const storedMsg = this.storedMessages.get(deletedMessageId);

        if (!storedMsg) {
          console.log(`[Antidelete-${this.botId}] Stored message not found for ID: ${deletedMessageId}`);
          return;
        }

        // Send recovery notification to bot owner
        await this.sendRecoveryMessage(sock, storedMsg, update.key?.remoteJid);
      }
    } catch (error) {
      console.error(`[Antidelete-${this.botId}] Error handling message update:`, error);
    }
  }

  private async sendRecoveryMessage(sock: WASocket, storedMsg: StoredMessage, chatId: string) {
    try {
      const botOwnerJid = sock.user?.id;
      if (!botOwnerJid) {
        console.error(`[Antidelete-${this.botId}] Bot owner JID not found.`);
        return;
      }

      const senderNumber = storedMsg.sender.split('@')[0];

      let recoveryText = `🔴 *Message Deleted - TREKKER-MD Recovery* 🔴\n\n`;
      recoveryText += `👤 *Sender:* @${senderNumber}\n`;
      recoveryText += `💬 *Chat:* ${storedMsg.chatId}\n`;
      recoveryText += `📅 *Time:* ${new Date(storedMsg.timestamp).toLocaleString()}\n`;
      recoveryText += `🆔 *Message ID:* ${storedMsg.messageId}\n\n`;

      if (storedMsg.text) {
        recoveryText += `📝 *Message Text:*\n${storedMsg.text}\n\n`;
      }

      if (storedMsg.caption) {
        recoveryText += `📝 *Caption:*\n${storedMsg.caption}\n\n`;
      }

      // Send text notification first
      await sock.sendMessage(botOwnerJid, {
        text: recoveryText,
        mentions: [storedMsg.sender]
      });

      // Send media if available
      if (storedMsg.mediaBuffer && storedMsg.mediaType) {
        const caption = `🔴 Recovered ${storedMsg.mediaType} from deleted message`;

        switch (storedMsg.mediaType) {
          case 'image':
            await sock.sendMessage(botOwnerJid, {
              image: storedMsg.mediaBuffer,
              caption
            });
            break;
          case 'video':
            await sock.sendMessage(botOwnerJid, {
              video: storedMsg.mediaBuffer,
              caption
            });
            break;
          case 'audio':
            await sock.sendMessage(botOwnerJid, {
              audio: storedMsg.mediaBuffer,
              mimetype: 'audio/mp4' // Common mimetype for audio playback
            });
            break;
          case 'sticker':
            await sock.sendMessage(botOwnerJid, {
              sticker: storedMsg.mediaBuffer
            });
            break;
          case 'document':
            await sock.sendMessage(botOwnerJid, {
              document: storedMsg.mediaBuffer,
              fileName: 'recovered_document' // Generic filename
            });
            break;
          default:
            console.warn(`[Antidelete-${this.botId}] Unsupported media type for recovery: ${storedMsg.mediaType}`);
        }
      }

    } catch (error) {
      console.error(`[Antidelete-${this.botId}] Error sending recovery message:`, error);
    }
  }

  async handleAntideleteCommand(client: WASocket, chatId: string, message: WAMessage, command?: string) {
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
        const statusText = `📊 *Anti-Delete Status*\n\n🔰 *Status:* ${status}\n💾 *Stored Messages:* ${this.storedMessages.size}\n\n*Usage:*\n.antidelete on - Enable\n.antidelete off - Disable\n.antidelete clear - Clear stored messages`;

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
        // Clear stored messages and associated media buffers
        this.storedMessages.clear();
        this.saveMessages(); // Save the empty map

        // Note: Media files are not explicitly saved to disk in this version,
        // so there's no need to unlink them. If media was saved to disk,
        // we would iterate and unlink here.

        await client.sendMessage(chatId, {
          text: '🗑️ *Anti-Delete Storage Cleared!*\n\nAll stored messages have been deleted.'
        });
      } else {
        await client.sendMessage(chatId, {
          text: '❌ Invalid command! Use: .antidelete on/off/clear'
        });
      }

    } catch (error) {
      console.error(`[Antidelete-${this.botId}] Command error:`, error);
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
    console.log(`[Antidelete] Creating new service for bot: ${botInstance.id}`);
    antideleteServices.set(botInstance.id, new AntideleteService(botInstance));
  }
  return antideleteServices.get(botInstance.id)!;
}

export function clearAntideleteService(botId: string): void {
  if (antideleteServices.has(botId)) {
    console.log(`[Antidelete] Clearing service for bot: ${botId}`);
    antideleteServices.delete(botId);
  }
}