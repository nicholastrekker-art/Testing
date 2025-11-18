
import { commandRegistry, type CommandContext } from './command-registry.js';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';

// Helper function to extract viewonce data from a message
function extractViewOnceData(message: any): { content: any; messageType: string; mediaType: string; data: any } | null {
  if (!message) return null;

  // Check for ViewOnce in quoted message (reply context)
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
      return {
        content: { videoMessage: quotedMessage.videoMessage },
        messageType: 'videoMessage',
        mediaType: 'video',
        data: quotedMessage.videoMessage
      };
    }

    // Check for ViewOnce audio in quoted message
    if (quotedMessage.audioMessage?.viewOnce) {
      return {
        content: { audioMessage: quotedMessage.audioMessage },
        messageType: 'audioMessage',
        mediaType: 'audio',
        data: quotedMessage.audioMessage
      };
    }

    // Check for any media with viewOnce property
    const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
    for (const mediaType of mediaTypes) {
      if (quotedMessage[mediaType]?.hasOwnProperty('viewOnce')) {
        return {
          content: { [mediaType]: quotedMessage[mediaType] },
          messageType: mediaType,
          mediaType: getMediaTypeString(mediaType),
          data: quotedMessage[mediaType]
        };
      }
    }
  }

  // Check for viewOnceMessage
  if (message.viewOnceMessage?.message) {
    const content = message.viewOnceMessage.message;
    const messageType = Object.keys(content)[0];
    return {
      content,
      messageType,
      mediaType: getMediaTypeString(messageType),
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
      mediaType: getMediaTypeString(messageType),
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
      mediaType: getMediaTypeString(messageType),
      data: content[messageType]
    };
  }

  // Check for direct viewOnce properties in media messages
  if (message.imageMessage?.viewOnce) {
    return {
      content: message,
      messageType: 'imageMessage',
      mediaType: 'image',
      data: message.imageMessage
    };
  }

  if (message.videoMessage?.viewOnce) {
    return {
      content: message,
      messageType: 'videoMessage',
      mediaType: 'video',
      data: message.videoMessage
    };
  }

  if (message.audioMessage?.viewOnce) {
    return {
      content: message,
      messageType: 'audioMessage',
      mediaType: 'audio',
      data: message.audioMessage
    };
  }

  return null;
}

function getMediaTypeString(messageType: string): string {
  if (messageType.includes('image')) return 'image';
  if (messageType.includes('video')) return 'video';
  if (messageType.includes('audio')) return 'audio';
  if (messageType.includes('document')) return 'document';
  return 'unknown';
}

// Helper function to download media with multiple fallback methods
async function downloadViewOnceMedia(viewOnceData: any, originalMessage: WAMessage): Promise<Buffer | null> {
  const downloadMethods = [
    // Method 1: Download from data object directly
    async (): Promise<Buffer | null> => {
      if (!viewOnceData.data || (!viewOnceData.data.url && !viewOnceData.data.directPath)) {
        return null;
      }
      const stream = await downloadContentFromMessage(viewOnceData.data, viewOnceData.mediaType as any);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      return buffer.length > 0 ? buffer : null;
    },

    // Method 2: Download from quoted ViewOnce content
    async (): Promise<Buffer | null> => {
      const quotedMessage = originalMessage.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      if (!quotedMessage) return null;

      const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];
      for (const mediaType of mediaTypes) {
        if (quotedMessage[mediaType]?.viewOnce) {
          const mediaData = quotedMessage[mediaType];
          const stream = await downloadContentFromMessage(mediaData, getMediaTypeString(mediaType) as any);
          let buffer = Buffer.from([]);
          for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
          }
          return buffer.length > 0 ? buffer : null;
        }
      }
      return null;
    },

    // Method 3: Download from wrapped viewOnce message
    async (): Promise<Buffer | null> => {
      if (!originalMessage.message?.viewOnceMessage?.message) return null;
      const innerMessage = originalMessage.message.viewOnceMessage.message;
      const messageType = Object.keys(innerMessage)[0];
      const mediaData = innerMessage[messageType];
      const stream = await downloadContentFromMessage(mediaData, getMediaTypeString(messageType) as any);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      return buffer.length > 0 ? buffer : null;
    }
  ];

  for (const method of downloadMethods) {
    try {
      const result = await method();
      if (result && result.length > 0) {
        return result;
      }
    } catch (error) {
      // Continue to next method
    }
  }

  return null;
}

// Register .vv command
commandRegistry.register({
  name: 'vv',
  aliases: ['save', 'vv2'],
  description: 'Download and save ViewOnce media (reply to a ViewOnce message)',
  category: 'MEDIA',
  ownerOnly: true,
  handler: async (context: CommandContext) => {
    const { message, client, respond } = context;

    try {
      // Check if this is a reply to a message
      const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      
      if (!quotedMessage) {
        await respond('❌ Please reply to a ViewOnce message to download it!\n\n💡 Usage: Reply to any ViewOnce photo/video/audio and send `.vv`');
        return;
      }

      await respond('⏳ Downloading ViewOnce media...');

      // Extract ViewOnce data
      const viewOnceData = extractViewOnceData({ extendedTextMessage: { contextInfo: { quotedMessage } } });

      if (!viewOnceData) {
        await respond('❌ No ViewOnce content found in the replied message!\n\n💡 Make sure you replied to a ViewOnce message (photo/video/audio marked with "1" icon)');
        return;
      }

      // Download the media
      const buffer = await downloadViewOnceMedia(viewOnceData, message);

      if (!buffer || buffer.length === 0) {
        await respond('❌ Failed to download ViewOnce media. The content might have expired or is unavailable.');
        return;
      }

      // Get bot owner JID
      const botOwnerJid = client.user?.id;
      if (!botOwnerJid) {
        await respond('❌ Bot owner not identified. Please contact support.');
        return;
      }

      // Get sender info
      const quotedParticipant = message.message?.extendedTextMessage?.contextInfo?.participant;
      const senderJid = quotedParticipant || message.key.remoteJid;
      const senderNumber = senderJid?.split('@')[0] || 'Unknown';

      // Create caption with details
      const caption = `🎯 *ViewOnce Media Downloaded* 🎯\n\n✅ **Successfully Recovered!**\n\n📱 **Details:**\n👤 Sender: @${senderNumber}\n💬 Chat: ${message.key.remoteJid}\n📥 Downloaded via: .vv command\n\n🛡️ **TREKKERMD LIFETIME BOT** - ViewOnce Downloader`;

      const mentions = senderJid ? [senderJid] : [];

      // Send media to bot owner
      switch (viewOnceData.mediaType) {
        case 'image':
          await client.sendMessage(botOwnerJid, {
            image: buffer,
            caption,
            mimetype: viewOnceData.data?.mimetype || 'image/jpeg',
            mentions
          });
          break;

        case 'video':
          await client.sendMessage(botOwnerJid, {
            video: buffer,
            caption,
            mimetype: viewOnceData.data?.mimetype || 'video/mp4',
            mentions
          });
          break;

        case 'audio':
          await client.sendMessage(botOwnerJid, {
            audio: buffer,
            ptt: viewOnceData.data?.ptt || false,
            mimetype: viewOnceData.data?.mimetype || 'audio/ogg; codecs=opus'
          });
          
          // Send details message for audio
          await client.sendMessage(botOwnerJid, {
            text: `🎵 *Audio ViewOnce Downloaded*\n\n${caption}`,
            mentions
          });
          break;

        default:
          await client.sendMessage(botOwnerJid, {
            document: buffer,
            fileName: `viewonce_${message.key.id}.bin`,
            caption,
            mentions
          });
          break;
      }

      await respond('✅ ViewOnce media downloaded successfully!\n\n📤 The media has been sent to your inbox (bot owner number).');

    } catch (error) {
      console.error('ViewOnce download error:', error);
      await respond(`❌ Error downloading ViewOnce media: ${error instanceof Error ? error.message : 'Unknown error'}\n\n💡 The ViewOnce content might have expired or been deleted.`);
    }
  }
});
