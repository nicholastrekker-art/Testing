import { makeWASocket, useMultiFileAuthState, DisconnectReason, ConnectionState, WAMessage } from '@whiskeysockets/baileys';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { Boom } from '@hapi/boom';
import P from 'pino';

export class ValidationBot {
  private sock: any;
  private authDir: string;
  private phoneNumber: string;
  private isConnected: boolean = false;
  private connectionPromise: Promise<boolean> | null = null;

  constructor(phoneNumber: string, credentials?: string) {
    this.phoneNumber = phoneNumber;
    this.authDir = join(process.cwd(), 'temp_auth', `validation_${phoneNumber}_${Date.now()}`);
    
    // Create auth directory
    if (!existsSync(this.authDir)) {
      mkdirSync(this.authDir, { recursive: true });
    }

    // If credentials are provided, save them to the auth directory
    if (credentials) {
      this.saveCredentialsToAuthDir(credentials);
    }
  }

  private saveCredentialsToAuthDir(credentials: string) {
    try {
      // Parse base64 credentials
      const credentialsData = JSON.parse(Buffer.from(credentials, 'base64').toString());
      
      // Save creds.json
      writeFileSync(
        join(this.authDir, 'creds.json'), 
        JSON.stringify(credentialsData, null, 2)
      );
      
      console.log(`✅ Credentials saved for validation bot ${this.phoneNumber}`);
    } catch (error) {
      console.error(`❌ Error saving credentials for validation bot ${this.phoneNumber}:`, error);
      throw new Error('Invalid credentials format');
    }
  }

  private createLogger() {
    return P({ level: 'silent' }); // Silent logger to avoid spam
  }

  async connect(): Promise<boolean> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this._connect();
    return this.connectionPromise;
  }

  private async _connect(): Promise<boolean> {
    try {
      console.log(`🔄 Establishing temporary connection for validation bot ${this.phoneNumber}`);
      
      // Use isolated auth state for this validation bot
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      
      // Create isolated socket connection
      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: this.createLogger(),
        browser: [`VALIDATION-BOT-${Date.now()}`, 'Chrome', '110.0.0.0'],
        connectTimeoutMs: 30000, // Shorter timeout for validation
        defaultQueryTimeoutMs: 30000,
        generateHighQualityLinkPreview: false,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 3
      });

      // Save credentials when they change
      this.sock.ev.on('creds.update', saveCreds);
      
      // Set up connection handler
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 45000); // 45 second timeout

        this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
          const { connection, lastDisconnect, qr } = update;
          
          console.log(`Validation bot ${this.phoneNumber}: Connection update -`, { connection, qr: !!qr });
          
          if (qr) {
            clearTimeout(timeout);
            reject(new Error('QR code required - credentials may be invalid or expired'));
            return;
          }
          
          if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Validation bot ${this.phoneNumber}: Connection closed`, lastDisconnect?.error);
            
            clearTimeout(timeout);
            this.isConnected = false;
            
            if (!shouldReconnect) {
              reject(new Error('Connection closed - credentials invalid'));
            } else {
              reject(new Error('Connection failed'));
            }
          } else if (connection === 'open') {
            console.log(`✅ Validation bot ${this.phoneNumber} connected successfully`);
            clearTimeout(timeout);
            this.isConnected = true;
            resolve(true);
          }
        });
      });
      
    } catch (error) {
      console.error(`❌ Error connecting validation bot ${this.phoneNumber}:`, error);
      throw error;
    }
  }

  async sendValidationMessage(message: string): Promise<boolean> {
    if (!this.isConnected || !this.sock) {
      throw new Error('Bot is not connected');
    }
    
    try {
      // Format phone number for WhatsApp (add @s.whatsapp.net)
      const jid = `${this.phoneNumber}@s.whatsapp.net`;
      
      await this.sock.sendMessage(jid, { text: message });
      console.log(`✅ Validation message sent to ${this.phoneNumber}`);
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to send validation message to ${this.phoneNumber}:`, error);
      throw error;
    }
  }

  async disconnect(preserveCredentials: boolean = false): Promise<void> {
    try {
      if (this.sock) {
        console.log(`🔌 Disconnecting validation bot ${this.phoneNumber}`);
        
        if (preserveCredentials) {
          // For guest bots: gracefully close connection without logout to preserve credentials
          console.log(`📱 Preserving credentials for guest bot ${this.phoneNumber}`);
          this.sock.end(undefined); // Gracefully close without logout
        } else {
          // For regular validation: full logout
          await this.sock.logout();
        }
        
        this.sock = null;
      }
      
      this.isConnected = false;
      
      // Clean up auth directory
      if (existsSync(this.authDir)) {
        rmSync(this.authDir, { recursive: true, force: true });
        console.log(`🧹 Cleaned up validation bot auth directory for ${this.phoneNumber}`);
      }
    } catch (error) {
      console.error(`❌ Error disconnecting validation bot ${this.phoneNumber}:`, error);
      // Continue cleanup even if logout fails
      try {
        if (existsSync(this.authDir)) {
          rmSync(this.authDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        console.error(`❌ Error cleaning up auth directory:`, cleanupError);
      }
    }
  }
}

export async function sendValidationMessage(phoneNumber: string, credentials: string, message: string): Promise<boolean> {
  const validationBot = new ValidationBot(phoneNumber, credentials);
  
  try {
    // Connect to WhatsApp
    await validationBot.connect();
    
    // Send validation message
    await validationBot.sendValidationMessage(message);
    
    return true;
  } finally {
    // Always disconnect and cleanup - preserving credentials for regular validation
    await validationBot.disconnect(true); // Change to preserve credentials by default
  }
}

// Special function for guest bot validation that preserves credentials
export async function sendGuestValidationMessage(phoneNumber: string, credentials: string, message: string): Promise<boolean> {
  const validationBot = new ValidationBot(phoneNumber, credentials);
  
  try {
    // Connect to WhatsApp
    await validationBot.connect();
    
    // Send validation message
    await validationBot.sendValidationMessage(message);
    
    return true;
  } finally {
    // Disconnect but preserve credentials for guest bots
    await validationBot.disconnect(true);
  }
}