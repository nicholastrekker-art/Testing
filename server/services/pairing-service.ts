import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import {
  default as makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket
} from '@whiskeysockets/baileys';
import { nanoid } from 'nanoid';

const logger = pino({ level: "silent" });

interface PairingResult {
  success: boolean;
  code?: string;
  requestId?: string;
  error?: string;
  phoneNumber?: string;
}

async function removeFile(dirPath: string) {
  return new Promise<void>((resolve, reject) => {
    if (!fs.existsSync(dirPath)) {
      return resolve();
    }

    fs.rm(dirPath, { recursive: true, force: true }, (err) => {
      if (err) {
        console.warn(`⚠️ Could not remove ${dirPath}:`, err.message);
        resolve();
      } else {
        resolve();
      }
    });
  });
}

async function cleanup(sock: WASocket | null, authDir: string, timers: NodeJS.Timeout[] = []) {
  try {
    timers.forEach(t => clearTimeout(t));

    if (sock?.ev) {
      (sock.ev as any).removeAllListeners();
    }

    if (sock?.ws) {
      try {
        sock.ws.close();
      } catch (e: any) {
        console.warn('WS close error:', e.message);
      }
    }

    if (sock) {
      (sock as any).authState = null;
    }

    if (fs.existsSync(authDir)) {
      await removeFile(authDir);
    }

    console.log('✅ Cleanup completed');
  } catch (err: any) {
    console.error('⚠️ Cleanup error:', err.message);
  }
}

export async function generatePairingCode(phoneNumber: string): Promise<PairingResult> {
  const requestId = nanoid();
  const authDir = path.join(process.cwd(), 'pair', 'temp', requestId);
  let sock: WASocket | null = null;
  const timers: NodeJS.Timeout[] = [];

  try {
    if (!phoneNumber.match(/^\d{10,15}$/)) {
      return {
        success: false,
        error: 'Invalid phone number format. Please use 10-15 digits without spaces or special characters.'
      };
    }

    console.log(`📱 Generating pairing code for: ${phoneNumber}`);

    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    console.log(`📡 Using WA version: ${version.join('.')}, isLatest: ${isLatest}`);

    try {
      sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        logger,
        browser: Browsers.macOS('Desktop'),
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        getMessage: async (key) => {
          return undefined;
        }
      });
    } catch (initError: any) {
      console.error('❌ Socket initialization failed:', initError.message);
      await cleanup(null, authDir, timers);
      return {
        success: false,
        error: 'Failed to initialize WhatsApp connection. Please try again.'
      };
    }

    if (!sock) {
      await cleanup(sock, authDir, timers);
      return {
        success: false,
        error: 'WhatsApp socket could not be initialized'
      };
    }

    return await new Promise<PairingResult>((resolve, reject) => {
      let resolved = false;

      const timeoutTimer = setTimeout(async () => {
        if (!resolved) {
          resolved = true;
          await cleanup(sock, authDir, timers);
          resolve({
            success: false,
            error: 'Timeout while generating pairing code'
          });
        }
      }, 60000);

      timers.push(timeoutTimer);

      if (sock) {
        sock.ev.on('creds.update', async () => {
          try {
            await saveCreds();
            console.log('💾 Credentials updated');
          } catch (err: any) {
            console.warn('Creds save warning:', err.message);
          }
        });

        sock.ev.on("connection.update", async (update) => {
          const { connection, lastDisconnect } = update;
          const statusCode = lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output.statusCode
            : 500;

          if (connection === "close") {
            console.log('⚠️ Connection closed. Status:', statusCode);

            if (!resolved) {
              resolved = true;
              await cleanup(sock, authDir, timers);
              
              let errorMessage = 'Connection closed unexpectedly';
              if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                errorMessage = 'Authentication failed';
              } else if (statusCode === DisconnectReason.connectionClosed) {
                errorMessage = 'Connection closed. Please try again.';
              } else if (statusCode === DisconnectReason.timedOut) {
                errorMessage = 'Connection timed out. Please check your internet and try again.';
              } else if (statusCode === DisconnectReason.badSession) {
                errorMessage = 'Invalid session. Please try again.';
              }
              
              resolve({
                success: false,
                error: errorMessage
              });
            }
          }
        });
      }

      (async () => {
        try {
          const code = await sock!.requestPairingCode(phoneNumber);
          console.log(`✅ Pairing code generated: ${code}`);

          if (!resolved) {
            resolved = true;
            timers.forEach(t => clearTimeout(t));
            
            const cleanupTimer = setTimeout(async () => {
              await cleanup(sock, authDir, []);
            }, 5000);
            timers.push(cleanupTimer);
            
            resolve({
              success: true,
              code: code,
              requestId: requestId,
              phoneNumber: phoneNumber
            });
          }
        } catch (err: any) {
          console.error('❌ Error generating pairing code:', err.message);
          if (!resolved) {
            resolved = true;
            await cleanup(sock, authDir, timers);
            
            let errorMessage = 'Failed to generate pairing code';
            if (err.message.includes('rate')) {
              errorMessage = 'Too many requests. Please wait a few minutes and try again.';
            } else if (err.message.includes('auth') || err.message.includes('401')) {
              errorMessage = 'Authentication failed. Please verify the phone number is correct.';
            } else if (err.message.includes('timeout')) {
              errorMessage = 'Request timed out. Please check your internet connection and try again.';
            }
            
            resolve({
              success: false,
              error: errorMessage
            });
          }
        }
      })();
    });

  } catch (error: any) {
    console.error('❌ Pairing service error:', error.message);
    await cleanup(sock, authDir, timers);
    return {
      success: false,
      error: error.message
    };
  }
}

export const pairingService = {
  generatePairingCode
};
