import { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import * as Baileys from '@whiskeysockets/baileys';
import { storage } from '../storage.js';
import { generateChatGPTResponse } from './openai.js';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { commandRegistry } from './command-registry.js';
import { AutoStatusService } from './auto-status.js';
import { antideleteService } from './antidelete.js';
import './core-commands.js';
export class WhatsAppBot {
    sock;
    botInstance;
    isRunning = false;
    authDir;
    reconnectAttempts = 0;
    heartbeatInterval;
    autoStatusService;
    constructor(botInstance) {
        this.botInstance = botInstance;
        this.authDir = join(process.cwd(), 'auth', `bot_${botInstance.id}`);
        if (!existsSync(this.authDir)) {
            mkdirSync(this.authDir, { recursive: true });
        }
        this.autoStatusService = new AutoStatusService(botInstance);
        if (botInstance.credentials) {
            this.saveCredentialsToAuthDir(botInstance.credentials);
        }
    }
    saveCredentialsToAuthDir(credentials) {
        try {
            console.log(`Bot ${this.botInstance.name}: Saving Baileys session credentials`);
            writeFileSync(join(this.authDir, 'creds.json'), JSON.stringify(credentials, null, 2));
            console.log(`Bot ${this.botInstance.name}: Baileys credentials saved successfully`);
        }
        catch (error) {
            console.error(`Bot ${this.botInstance.name}: Error saving credentials:`, error);
        }
    }
    createLogger() {
        const loggerInstance = {
            level: 'silent',
            child: () => loggerInstance,
            trace: () => { },
            debug: () => { },
            info: () => { },
            warn: () => { },
            error: () => { },
            fatal: () => { }
        };
        return loggerInstance;
    }
    async setupEventHandlers() {
        this.sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            console.log(`Bot ${this.botInstance.name}: Connection update -`, { connection, qr: !!qr });
            if (qr) {
                console.log(`Bot ${this.botInstance.name}: QR Code generated`);
                await storage.updateBotInstance(this.botInstance.id, { status: 'qr_code' });
                await storage.createActivity({
                    serverName: this.botInstance.serverName,
                    botInstanceId: this.botInstance.id,
                    type: 'qr_code',
                    description: 'QR Code generated - Scan to connect WhatsApp',
                    metadata: { qr }
                });
            }
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(`Bot ${this.botInstance.name}: Connection closed due to`, lastDisconnect?.error, ', reconnecting:', shouldReconnect);
                this.isRunning = false;
                await storage.updateBotInstance(this.botInstance.id, { status: 'offline' });
                await storage.createActivity({
                    serverName: this.botInstance.serverName,
                    botInstanceId: this.botInstance.id,
                    type: 'status_change',
                    description: 'Bot disconnected'
                });
                if (shouldReconnect) {
                    const reconnectDelay = Math.min(5000 * (this.reconnectAttempts || 1), 30000);
                    this.reconnectAttempts = (this.reconnectAttempts || 0) + 1;
                    console.log(`Bot ${this.botInstance.name}: Attempting reconnect #${this.reconnectAttempts} in ${reconnectDelay}ms`);
                    setTimeout(async () => {
                        try {
                            await this.start();
                        }
                        catch (error) {
                            console.error(`Bot ${this.botInstance.name}: Reconnect attempt failed:`, error);
                            await storage.createActivity({
                                serverName: this.botInstance.serverName,
                                botInstanceId: this.botInstance.id,
                                type: 'error',
                                description: `Reconnect attempt #${this.reconnectAttempts} failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                            });
                        }
                    }, reconnectDelay);
                }
            }
            else if (connection === 'open') {
                console.log(`Bot ${this.botInstance.name} is ready! 🎉 WELCOME TO TREKKERMD LIFETIME BOT`);
                this.isRunning = true;
                this.reconnectAttempts = 0;
                await storage.updateBotInstance(this.botInstance.id, {
                    status: 'online',
                    lastActivity: new Date()
                });
                await storage.createActivity({
                    serverName: this.botInstance.serverName,
                    botInstanceId: this.botInstance.id,
                    type: 'status_change',
                    description: '🎉 WELCOME TO TREKKERMD LIFETIME BOT - Bot connected and ready!'
                });
                try {
                    const welcomeMessage = `🎉 WELCOME TO TREKKERMD LIFETIME BOT 🎉\n\nYour bot "${this.botInstance.name}" is now online and ready to serve!\n\n✨ Features activated:\n- Auto reactions and likes\n- Advanced command system (300+ commands)\n- ChatGPT AI integration\n- Group management tools\n- Real-time activity monitoring\n\nType .help to see available commands or .list for the full command list.\n\nHappy chatting! 🚀`;
                    const me = this.sock.user?.id;
                    if (me) {
                        await this.sock.sendMessage(me, { text: welcomeMessage });
                        console.log(`TREKKERMD LIFETIME BOT: Welcome message sent to ${me}`);
                    }
                    else {
                        console.log('TREKKERMD LIFETIME BOT READY:', welcomeMessage);
                    }
                }
                catch (error) {
                    console.log('Welcome message setup complete');
                }
            }
            else if (connection === 'connecting') {
                console.log(`Bot ${this.botInstance.name}: Connecting to WhatsApp...`);
                await storage.updateBotInstance(this.botInstance.id, { status: 'loading' });
                await storage.createActivity({
                    serverName: this.botInstance.serverName,
                    botInstanceId: this.botInstance.id,
                    type: 'status_change',
                    description: 'Bot connecting to WhatsApp...'
                });
            }
        });
        this.sock.ev.on('messages.upsert', async (m) => {
            if (!this.isRunning) {
                return;
            }
            if (m.type === 'notify' || m.type === 'append') {
                await this.autoStatusService.handleStatusUpdate(this.sock, m);
                for (const message of m.messages) {
                    await antideleteService.storeMessage(message);
                    await this.handleMessage(message);
                }
            }
        });
        this.sock.ev.on('messages.update', async (updates) => {
            for (const { key, update } of updates) {
                if (update.message?.protocolMessage?.type === Baileys.proto.Message.ProtocolMessage.Type.REVOKE) {
                    const revocationMessage = { key, message: update.message };
                    await antideleteService.handleMessageRevocation(this.sock, revocationMessage);
                }
            }
        });
    }
    extractMessageText(messageObj) {
        const inner = messageObj.ephemeralMessage?.message ||
            messageObj.viewOnceMessage?.message ||
            messageObj.documentWithCaptionMessage?.message ||
            messageObj;
        return inner.conversation ||
            inner.extendedTextMessage?.text ||
            inner.imageMessage?.caption ||
            inner.videoMessage?.caption ||
            inner.buttonsResponseMessage?.selectedButtonId ||
            inner.listResponseMessage?.singleSelectReply?.selectedRowId ||
            inner.templateButtonReplyMessage?.selectedId ||
            '';
    }
    async handleMessage(message) {
        try {
            if (!message.message)
                return;
            const messageText = this.extractMessageText(message.message);
            if (!messageText)
                return;
            await storage.updateBotInstance(this.botInstance.id, {
                messagesCount: (this.botInstance.messagesCount || 0) + 1,
                lastActivity: new Date()
            });
            const commandPrefix = process.env.BOT_PREFIX || '.';
            if (messageText.startsWith(commandPrefix)) {
                console.log(`Bot ${this.botInstance.name}: Detected command: "${messageText.trim()}"`);
                await this.handleCommand(message, messageText);
                return;
            }
            await this.handleAutoFeatures(message);
        }
        catch (error) {
            console.error(`Error handling message for bot ${this.botInstance.name}:`, error);
            await storage.createActivity({
                serverName: this.botInstance.serverName,
                botInstanceId: this.botInstance.id,
                type: 'error',
                description: `Message handling error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            });
        }
    }
    async handleCommand(message, commandText) {
        const commandPrefix = process.env.BOT_PREFIX || '.';
        const args = commandText.substring(commandPrefix.length).split(' ');
        const commandName = args[0].toLowerCase();
        const commandArgs = args.slice(1);
        console.log(`Bot ${this.botInstance.name}: Processing command .${commandName} with args:`, commandArgs);
        const registeredCommand = commandRegistry.get(commandName);
        if (registeredCommand) {
            try {
                const respond = async (text) => {
                    if (message.key.remoteJid) {
                        await this.sock.sendMessage(message.key.remoteJid, { text });
                    }
                };
                const context = {
                    message,
                    client: this.sock,
                    respond,
                    from: message.key.remoteJid || '',
                    sender: message.key.participant || message.key.remoteJid || '',
                    args: commandArgs,
                    command: commandName,
                    prefix: '.'
                };
                await registeredCommand.handler(context);
                await storage.updateBotInstance(this.botInstance.id, {
                    commandsCount: (this.botInstance.commandsCount || 0) + 1
                });
                await storage.createActivity({
                    serverName: this.botInstance.serverName,
                    botInstanceId: this.botInstance.id,
                    type: 'command',
                    description: `Executed command: .${commandName}`,
                    metadata: { command: commandName, user: message.key.remoteJid }
                });
                console.log(`Bot ${this.botInstance.name}: Successfully executed command .${commandName}`);
                return;
            }
            catch (error) {
                console.error(`Error executing command .${commandName}:`, error);
                if (message.key.remoteJid) {
                    await this.sock.sendMessage(message.key.remoteJid, {
                        text: `❌ Error executing command .${commandName}`
                    });
                }
                return;
            }
        }
        const commands = await storage.getCommands(this.botInstance.id);
        const globalCommands = await storage.getCommands();
        const command = [...commands, ...globalCommands].find(cmd => cmd.name === commandName);
        if (command) {
            await storage.updateBotInstance(this.botInstance.id, {
                commandsCount: (this.botInstance.commandsCount || 0) + 1
            });
            await storage.createActivity({
                serverName: this.botInstance.serverName,
                botInstanceId: this.botInstance.id,
                type: 'command',
                description: `Executed command: .${commandName}`,
                metadata: { command: commandName, user: message.key.remoteJid }
            });
            let response = command.response || `Command .${commandName} executed successfully.`;
            if (command.useChatGPT) {
                const fullMessage = commandText.substring(commandName.length + 2);
                response = await generateChatGPTResponse(fullMessage, `User executed command: ${commandName}`);
            }
            if (response && message.key.remoteJid) {
                await this.sock.sendMessage(message.key.remoteJid, { text: response });
            }
        }
        else {
            console.log(`Bot ${this.botInstance.name}: Command .${commandName} not found`);
            if (message.key.remoteJid) {
                await this.sock.sendMessage(message.key.remoteJid, {
                    text: `❌ Command .${commandName} not found. Type .help to see available commands.`
                });
            }
        }
    }
    async handleAutoFeatures(message) {
        if (this.botInstance.autoReact && message.key.remoteJid) {
            const reactions = ['👍', '❤️', '😊', '🔥', '👏'];
            const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
            try {
                await this.sock.sendMessage(message.key.remoteJid, {
                    react: {
                        text: randomReaction,
                        key: message.key
                    }
                });
            }
            catch (error) {
                console.log('Could not react to message:', error);
            }
        }
        if (this.botInstance.typingMode === 'typing' || this.botInstance.typingMode === 'both') {
            if (message.key.remoteJid) {
                await this.sock.sendPresenceUpdate('composing', message.key.remoteJid);
            }
        }
        if (this.botInstance.typingMode === 'recording' || this.botInstance.typingMode === 'both') {
            if (message.key.remoteJid) {
                await this.sock.sendPresenceUpdate('recording', message.key.remoteJid);
            }
        }
    }
    async handleChatGPTResponse(message, messageText) {
        try {
            const response = await generateChatGPTResponse(messageText, `Bot: ${this.botInstance.name}, User: ${message.key.remoteJid}`);
            if (response && message.key.remoteJid) {
                await this.sock.sendMessage(message.key.remoteJid, { text: response });
                await storage.createActivity({
                    serverName: this.botInstance.serverName,
                    botInstanceId: this.botInstance.id,
                    type: 'chatgpt_response',
                    description: 'Generated ChatGPT response',
                    metadata: { message: messageText.substring(0, 100) }
                });
            }
        }
        catch (error) {
            console.error('ChatGPT response error:', error);
        }
    }
    async start() {
        if (this.isRunning) {
            console.log(`Bot ${this.botInstance.name} is already running`);
            return;
        }
        try {
            console.log(`Starting Baileys bot ${this.botInstance.name} in isolated container...`);
            await storage.updateBotInstance(this.botInstance.id, { status: 'loading' });
            await storage.createActivity({
                serverName: this.botInstance.serverName,
                botInstanceId: this.botInstance.id,
                type: 'status_change',
                description: 'Bot startup initiated - TREKKERMD LIFETIME BOT initializing with Baileys...'
            });
            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
            this.sock = Baileys.makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: this.createLogger(),
                browser: [`TREKKERMD-${this.botInstance.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 'Chrome', '110.0.0.0'],
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                generateHighQualityLinkPreview: false,
                retryRequestDelayMs: 250,
                maxMsgRetryCount: 5
            });
            this.sock.ev.on('creds.update', saveCreds);
            await this.setupEventHandlers();
            this.startHeartbeat();
            console.log(`Baileys bot ${this.botInstance.name} initialization completed in isolated container`);
        }
        catch (error) {
            console.error(`Error starting Baileys bot ${this.botInstance.name}:`, error);
            this.isRunning = false;
            this.stopHeartbeat();
            await this.safeUpdateBotStatus('error');
            await this.safeCreateActivity('error', `Bot startup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            console.error(`Bot ${this.botInstance.name} failed to start but app continues running`);
        }
    }
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(async () => {
            try {
                if (this.isRunning && this.sock?.user?.id) {
                    await this.safeUpdateBotStatus('online', { lastActivity: new Date() });
                }
            }
            catch (error) {
                console.error(`Bot ${this.botInstance.name}: Heartbeat error:`, error);
            }
        }, 30000);
    }
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = undefined;
        }
    }
    async safeUpdateBotStatus(status, updates = {}) {
        try {
            await storage.updateBotInstance(this.botInstance.id, { status, ...updates });
        }
        catch (error) {
            console.error(`Bot ${this.botInstance.name}: Failed to update status:`, error);
        }
    }
    async safeCreateActivity(type, description, metadata = {}) {
        try {
            await storage.createActivity({
                serverName: this.botInstance.serverName,
                botInstanceId: this.botInstance.id,
                type,
                description,
                metadata
            });
        }
        catch (error) {
            console.error(`Bot ${this.botInstance.name}: Failed to create activity:`, error);
        }
    }
    async stop() {
        if (!this.isRunning) {
            return;
        }
        this.stopHeartbeat();
        try {
            console.log(`Stopping bot ${this.botInstance.name} in isolated container...`);
            if (this.sock) {
                this.sock.ev.removeAllListeners();
                await this.sock.end();
                this.sock = null;
            }
            this.isRunning = false;
            await this.safeUpdateBotStatus('offline');
            await this.safeCreateActivity('status_change', 'TREKKERMD LIFETIME BOT stopped - isolated container shut down');
            console.log(`Bot ${this.botInstance.name} stopped successfully in isolated container`);
        }
        catch (error) {
            console.error(`Error stopping bot ${this.botInstance.name}:`, error);
            this.isRunning = false;
        }
    }
    async restart() {
        await this.stop();
        await new Promise(resolve => setTimeout(resolve, 2000));
        await this.start();
    }
    getStatus() {
        return this.isRunning ? 'online' : 'offline';
    }
    updateBotInstance(botInstance) {
        this.botInstance = botInstance;
    }
    static validateCredentials(credentials) {
        try {
            if (!credentials || typeof credentials !== 'object') {
                return { valid: false, error: 'Invalid credentials format' };
            }
            if (!credentials.creds || !credentials.creds.noiseKey || !credentials.creds.signedIdentityKey) {
                return { valid: false, error: 'Missing essential credential fields (creds.noiseKey, creds.signedIdentityKey)' };
            }
            if (credentials.creds.me?.id) {
                const phoneMatch = credentials.creds.me.id.match(/^(\d+):/);
                if (!phoneMatch) {
                    return { valid: false, error: 'Invalid phone number format in credentials' };
                }
            }
            else {
                return { valid: false, error: 'Missing user ID in credentials' };
            }
            if (!credentials.creds.signedPreKey || !credentials.creds.registrationId) {
                return { valid: false, error: 'Missing essential credential fields (signedPreKey, registrationId)' };
            }
            return { valid: true };
        }
        catch (error) {
            return { valid: false, error: `Credential validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
        }
    }
    async sendDirectMessage(recipient, message) {
        if (!this.sock || !this.isRunning) {
            throw new Error('Bot is not running or socket is not available');
        }
        try {
            await this.sock.sendMessage(recipient, { text: message });
            console.log(`Bot ${this.botInstance.name}: Message sent to ${recipient}`);
            await storage.createActivity({
                serverName: 'default-server',
                botInstanceId: this.botInstance.id,
                type: 'message_sent',
                description: `Message sent to ${recipient}`,
                metadata: { recipient, message: message.substring(0, 100) }
            });
        }
        catch (error) {
            console.error(`Bot ${this.botInstance.name}: Failed to send message to ${recipient}:`, error);
            throw error;
        }
    }
}
