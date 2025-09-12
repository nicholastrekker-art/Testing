import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import P from 'pino';
export class ValidationBot {
    sock;
    authDir;
    phoneNumber;
    isConnected = false;
    connectionPromise = null;
    constructor(phoneNumber, credentials) {
        this.phoneNumber = phoneNumber;
        this.authDir = join(process.cwd(), 'temp_auth', `validation_${phoneNumber}_${Date.now()}`);
        if (!existsSync(this.authDir)) {
            mkdirSync(this.authDir, { recursive: true });
        }
        if (credentials) {
            this.saveCredentialsToAuthDir(credentials);
        }
    }
    saveCredentialsToAuthDir(credentials) {
        try {
            const credentialsData = JSON.parse(Buffer.from(credentials, 'base64').toString());
            writeFileSync(join(this.authDir, 'creds.json'), JSON.stringify(credentialsData, null, 2));
            console.log(`✅ Credentials saved for validation bot ${this.phoneNumber}`);
        }
        catch (error) {
            console.error(`❌ Error saving credentials for validation bot ${this.phoneNumber}:`, error);
            throw new Error('Invalid credentials format');
        }
    }
    createLogger() {
        return P({ level: 'silent' });
    }
    async connect() {
        if (this.connectionPromise) {
            return this.connectionPromise;
        }
        this.connectionPromise = this._connect();
        return this.connectionPromise;
    }
    async _connect() {
        try {
            console.log(`🔄 Establishing temporary connection for validation bot ${this.phoneNumber}`);
            const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                logger: this.createLogger(),
                browser: [`VALIDATION-BOT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 'Chrome', '110.0.0.0'],
                connectTimeoutMs: 30000,
                defaultQueryTimeoutMs: 30000,
                generateHighQualityLinkPreview: false,
                retryRequestDelayMs: 250,
                maxMsgRetryCount: 3
            });
            this.sock.ev.on('creds.update', saveCreds);
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Connection timeout'));
                }, 45000);
                this.sock.ev.on('connection.update', async (update) => {
                    const { connection, lastDisconnect, qr } = update;
                    console.log(`Validation bot ${this.phoneNumber}: Connection update -`, { connection, qr: !!qr });
                    if (qr) {
                        clearTimeout(timeout);
                        reject(new Error('QR code required - credentials may be invalid or expired'));
                        return;
                    }
                    if (connection === 'close') {
                        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                        console.log(`Validation bot ${this.phoneNumber}: Connection closed`, lastDisconnect?.error);
                        clearTimeout(timeout);
                        this.isConnected = false;
                        if (!shouldReconnect) {
                            reject(new Error('Connection closed - credentials invalid'));
                        }
                        else {
                            reject(new Error('Connection failed'));
                        }
                    }
                    else if (connection === 'open') {
                        console.log(`✅ Validation bot ${this.phoneNumber} connected successfully`);
                        clearTimeout(timeout);
                        this.isConnected = true;
                        resolve(true);
                    }
                });
            });
        }
        catch (error) {
            console.error(`❌ Error connecting validation bot ${this.phoneNumber}:`, error);
            throw error;
        }
    }
    async sendValidationMessage(message) {
        if (!this.isConnected || !this.sock) {
            throw new Error('Bot is not connected');
        }
        try {
            const jid = `${this.phoneNumber}@s.whatsapp.net`;
            await this.sock.sendMessage(jid, { text: message });
            console.log(`✅ Validation message sent to ${this.phoneNumber}`);
            return true;
        }
        catch (error) {
            console.error(`❌ Failed to send validation message to ${this.phoneNumber}:`, error);
            throw error;
        }
    }
    async disconnect(preserveCredentials = false) {
        try {
            if (this.sock) {
                console.log(`🔌 Disconnecting validation bot ${this.phoneNumber}`);
                if (preserveCredentials) {
                    console.log(`📱 Preserving credentials for guest bot ${this.phoneNumber}`);
                    this.sock.end(undefined);
                }
                else {
                    await this.sock.logout();
                }
                this.sock = null;
            }
            this.isConnected = false;
            if (existsSync(this.authDir)) {
                rmSync(this.authDir, { recursive: true, force: true });
                console.log(`🧹 Cleaned up validation bot auth directory for ${this.phoneNumber}`);
            }
        }
        catch (error) {
            console.error(`❌ Error disconnecting validation bot ${this.phoneNumber}:`, error);
            try {
                if (existsSync(this.authDir)) {
                    rmSync(this.authDir, { recursive: true, force: true });
                }
            }
            catch (cleanupError) {
                console.error(`❌ Error cleaning up auth directory:`, cleanupError);
            }
        }
    }
}
export async function sendValidationMessage(phoneNumber, credentials, message) {
    const validationBot = new ValidationBot(phoneNumber, credentials);
    try {
        await validationBot.connect();
        await validationBot.sendValidationMessage(message);
        return true;
    }
    finally {
        await validationBot.disconnect(true);
    }
}
export async function sendGuestValidationMessage(phoneNumber, credentials, message) {
    const validationBot = new ValidationBot(phoneNumber, credentials);
    try {
        await validationBot.connect();
        await validationBot.sendValidationMessage(message);
        return true;
    }
    finally {
        await validationBot.disconnect(true);
    }
}
