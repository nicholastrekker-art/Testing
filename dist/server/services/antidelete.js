import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { writeFile } from 'fs/promises';
export class AntideleteService {
    messageStore = new Map();
    configPath;
    tempMediaDir;
    constructor() {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        this.configPath = path.join(__dirname, '../data/antidelete.json');
        this.tempMediaDir = path.join(__dirname, '../tmp');
        this.ensureDirectories();
        setInterval(() => this.cleanTempFolderIfLarge(), 60 * 1000);
    }
    ensureDirectories() {
        const dataDir = path.dirname(this.configPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        if (!fs.existsSync(this.tempMediaDir)) {
            fs.mkdirSync(this.tempMediaDir, { recursive: true });
        }
    }
    getFolderSizeInMB(folderPath) {
        try {
            const files = fs.readdirSync(folderPath);
            let totalSize = 0;
            for (const file of files) {
                const filePath = path.join(folderPath, file);
                if (fs.statSync(filePath).isFile()) {
                    totalSize += fs.statSync(filePath).size;
                }
            }
            return totalSize / (1024 * 1024);
        }
        catch (err) {
            console.error('Error getting folder size:', err);
            return 0;
        }
    }
    cleanTempFolderIfLarge() {
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
        }
        catch (err) {
            console.error('Temp cleanup error:', err);
        }
    }
    loadAntideleteConfig() {
        try {
            if (!fs.existsSync(this.configPath)) {
                return { enabled: true };
            }
            return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
        }
        catch {
            return { enabled: true };
        }
    }
    saveAntideleteConfig(config) {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
        }
        catch (err) {
            console.error('Config save error:', err);
        }
    }
    async handleAntideleteCommand(sock, chatId, message, match) {
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
        }
        else if (match === 'off') {
            config.enabled = false;
        }
        else {
            await sock.sendMessage(chatId, { text: '*Invalid command. Use .antidelete to see usage.*' });
            return;
        }
        this.saveAntideleteConfig(config);
        await sock.sendMessage(chatId, { text: `*Antidelete ${match === 'on' ? 'enabled' : 'disabled'}*` });
    }
    async storeMessage(message) {
        try {
            const config = this.loadAntideleteConfig();
            if (!config.enabled)
                return;
            if (!message.key?.id)
                return;
            const messageId = message.key.id;
            let content = '';
            let mediaType = '';
            let mediaPath = '';
            const sender = message.key.participant || message.key.remoteJid || '';
            if (message.message?.conversation) {
                content = message.message.conversation;
            }
            else if (message.message?.extendedTextMessage?.text) {
                content = message.message.extendedTextMessage.text;
            }
            else if (message.message?.imageMessage) {
                mediaType = 'image';
                content = message.message.imageMessage.caption || '';
                try {
                    const buffer = await downloadContentFromMessage(message.message.imageMessage, 'image');
                    mediaPath = path.join(this.tempMediaDir, `${messageId}.jpg`);
                    const chunks = [];
                    for await (const chunk of buffer) {
                        chunks.push(chunk);
                    }
                    await writeFile(mediaPath, Buffer.concat(chunks));
                }
                catch (err) {
                    console.error('Error downloading image:', err);
                }
            }
            else if (message.message?.stickerMessage) {
                mediaType = 'sticker';
                try {
                    const buffer = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
                    mediaPath = path.join(this.tempMediaDir, `${messageId}.webp`);
                    const chunks = [];
                    for await (const chunk of buffer) {
                        chunks.push(chunk);
                    }
                    await writeFile(mediaPath, Buffer.concat(chunks));
                }
                catch (err) {
                    console.error('Error downloading sticker:', err);
                }
            }
            else if (message.message?.videoMessage) {
                mediaType = 'video';
                content = message.message.videoMessage.caption || '';
                try {
                    const buffer = await downloadContentFromMessage(message.message.videoMessage, 'video');
                    mediaPath = path.join(this.tempMediaDir, `${messageId}.mp4`);
                    const chunks = [];
                    for await (const chunk of buffer) {
                        chunks.push(chunk);
                    }
                    await writeFile(mediaPath, Buffer.concat(chunks));
                }
                catch (err) {
                    console.error('Error downloading video:', err);
                }
            }
            this.messageStore.set(messageId, {
                content,
                mediaType,
                mediaPath,
                sender,
                group: message.key.remoteJid?.endsWith('@g.us') ? message.key.remoteJid : null,
                timestamp: new Date().toISOString()
            });
        }
        catch (err) {
            console.error('storeMessage error:', err);
        }
    }
    async handleMessageRevocation(sock, revocationMessage) {
        try {
            const config = this.loadAntideleteConfig();
            if (!config.enabled)
                return;
            if (!revocationMessage.message?.protocolMessage?.key?.id)
                return;
            const messageId = revocationMessage.message.protocolMessage.key.id;
            const deletedBy = revocationMessage.key.participant || revocationMessage.key.remoteJid || '';
            const ownerNumber = sock.user?.id.split(':')[0] + '@s.whatsapp.net';
            if (!ownerNumber || deletedBy.includes(sock.user?.id || '') || deletedBy === ownerNumber)
                return;
            const original = this.messageStore.get(messageId);
            if (!original)
                return;
            const sender = original.sender;
            const senderName = sender.split('@')[0];
            let groupName = '';
            if (original.group) {
                try {
                    const groupMetadata = await sock.groupMetadata(original.group);
                    groupName = groupMetadata.subject;
                }
                catch (err) {
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
                }
                catch (err) {
                    await sock.sendMessage(ownerNumber, {
                        text: `⚠️ Error sending media: ${err.message}`
                    });
                }
                try {
                    fs.unlinkSync(original.mediaPath);
                }
                catch (err) {
                    console.error('Media cleanup error:', err);
                }
            }
            this.messageStore.delete(messageId);
        }
        catch (err) {
            console.error('handleMessageRevocation error:', err);
        }
    }
}
export const antideleteService = new AntideleteService();
