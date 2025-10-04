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
  private credsUpdateHandler: (() => Promise<void>) | null = null; // Store handler to remove it later
  private connectionUpdateHandler: ((update: Partial<ConnectionState>) => void) | null = null; // Store handler to remove it later

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
      let credentialsData;

      // Try to parse as JSON first (for when credentials are already parsed)
      try {
        credentialsData = JSON.parse(credentials);
      } catch (jsonError) {
        // If JSON parse fails, try as base64
        try {
          credentialsData = JSON.parse(Buffer.from(credentials, 'base64').toString());
        } catch (base64Error) {
          throw new Error('Credentials must be valid JSON or base64-encoded JSON');
        }
      }

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
        browser: [`VALIDATION-BOT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 'Chrome', '110.0.0.0'],
        connectTimeoutMs: 30000, // Shorter timeout for validation
        defaultQueryTimeoutMs: 30000,
        generateHighQualityLinkPreview: false,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 3
      });

      // Save credentials when they change (isolated per bot) with error handling
      this.credsUpdateHandler = async () => {
        try {
          await saveCreds();
        } catch (error) {
          // Silently handle credential save errors (e.g., directory deleted)
          console.log(`Bot ${this.phoneNumber}: Credential save skipped (directory may be cleaned up)`);
        }
      };
      this.sock.ev.on('creds.update', this.credsUpdateHandler);

      // Set up connection handler
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Connection timeout'));
        }, 45000); // 45 second timeout

        this.connectionUpdateHandler = async (update: Partial<ConnectionState>) => {
          const { connection, lastDisconnect, qr } = update;

          console.log(`Validation bot ${this.phoneNumber}: Connection update -`, { connection, qr: !!qr });

          if (qr) {
            clearTimeout(timeout);
            this.sock.ev.off('connection.update', this.connectionUpdateHandler);
            this.sock.ev.off('creds.update', this.credsUpdateHandler);
            reject(new Error('QR code required - credentials may be invalid or expired'));
            return;
          }

          if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Validation bot ${this.phoneNumber}: Connection closed`, lastDisconnect?.error);

            clearTimeout(timeout);
            this.isConnected = false;

            // Remove listeners before rejecting
            this.sock.ev.off('connection.update', this.connectionUpdateHandler);
            this.sock.ev.off('creds.update', this.credsUpdateHandler);

            if (!shouldReconnect) {
              reject(new Error('Connection closed - credentials invalid'));
            } else {
              reject(new Error('Connection failed'));
            }
          } else if (connection === 'open') {
            console.log(`✅ Validation bot ${this.phoneNumber} connected successfully`);
            clearTimeout(timeout);
            this.isConnected = true;
            // Keep listeners active until disconnect is called
            resolve(true);
          }
        };
        this.sock.ev.on('connection.update', this.connectionUpdateHandler);
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

        // Remove event listeners with error handling
        try {
          if (this.connectionUpdateHandler) {
            this.sock.ev.off('connection.update', this.connectionUpdateHandler);
            this.connectionUpdateHandler = null;
          }
        } catch (err) {
          console.log(`⚠️ Could not remove connection.update listener:`, err);
        }

        try {
          if (this.credsUpdateHandler) {
            this.sock.ev.off('creds.update', this.credsUpdateHandler);
            this.credsUpdateHandler = null;
          }
        } catch (err) {
          console.log(`⚠️ Could not remove creds.update listener:`, err);
        }

        if (preserveCredentials) {
          // For guest bots: gracefully close connection without logout to preserve credentials
          console.log(`📱 Preserving credentials for guest bot ${this.phoneNumber}`);
          try {
            this.sock.end(undefined); // Gracefully close without logout
          } catch (endErr) {
            console.log(`⚠️ Could not end socket gracefully:`, endErr);
          }
        } else {
          // For regular validation: full logout
          try {
            await this.sock.logout();
          } catch (logoutErr) {
            console.log(`⚠️ Could not logout:`, logoutErr);
          }
        }

        this.sock = null;
      }

      this.isConnected = false;

      // Clean up auth directory
      try {
        if (existsSync(this.authDir)) {
          rmSync(this.authDir, { recursive: true, force: true });
          console.log(`🧹 Cleaned up validation bot auth directory for ${this.phoneNumber}`);
        }
      } catch (cleanupErr) {
        console.log(`⚠️ Could not clean up auth directory:`, cleanupErr);
      }
    } catch (error) {
      console.error(`❌ Error disconnecting validation bot ${this.phoneNumber}:`, error);
      // Ensure cleanup always happens even if other operations fail
      try {
        if (existsSync(this.authDir)) {
          rmSync(this.authDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        console.log(`⚠️ Final cleanup also failed:`, cleanupError);
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
export async function validateWhatsAppCredentials(phoneNumber: string, credentials: any): Promise<{isValid: boolean, message?: string}> {
  const validationBot = new ValidationBot(phoneNumber, Buffer.from(JSON.stringify(credentials), 'utf-8').toString('base64'));

  try {
    console.log(`🔄 Testing WhatsApp connection for credential validation ${phoneNumber}`);

    // Try to connect to WhatsApp to validate credentials
    const connected = await validationBot.connect();

    if (connected) {
      console.log(`✅ Credentials validated successfully for ${phoneNumber}`);
      return { isValid: true, message: "Credentials are valid and connection established" };
    } else {
      console.log(`❌ Failed to validate credentials for ${phoneNumber} - connection failed`);
      return { isValid: false, message: "Unable to establish WhatsApp connection with provided credentials" };
    }
  } catch (error) {
    console.log(`❌ Credential validation error for ${phoneNumber}:`, (error as Error).message);
    return { isValid: false, message: `Credential validation failed: ${(error as Error).message}` };
  } finally {
    // Always disconnect and cleanup - preserve credentials by terminating properly
    await validationBot.disconnect(true);
  }
}

export async function sendGuestValidationMessage(phoneNumber: string, credentials: string, message: string, preserveCredentials = true): Promise<boolean> {
  const validationBot = new ValidationBot(phoneNumber, credentials);

  try {
    // Connect to WhatsApp
    await validationBot.connect();

    // Send validation message
    await validationBot.sendValidationMessage(message);

    return true;
  } finally {
    // Disconnect with credential preservation option (true = preserve, false = logout)
    await validationBot.disconnect(preserveCredentials);
  }
}