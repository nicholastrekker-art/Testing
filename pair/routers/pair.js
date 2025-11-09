const { giftedId, removeFile } = require('../lib');
const express = require('express');
const fs = require('fs');
require('dotenv').config();
const path = require('path');
const pino = require("pino");
const { Boom } = require('@hapi/boom');
const axios = require('axios');
const FormData = require('form-data');

let router = express.Router();

// Session storage for tracking active sessions
const sessionStorage = new Map();

// Active sessions storage for tracking connected sessions
const activeSessions = new Map();

// Import Baileys modules
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

// Create logger with silent level for production
const logger = pino({ level: "silent" });

/**
 * Saves session credentials locally and returns base64 encoded session ID
 */
async function saveSessionLocallyFromPath(authDir) {
    const authPath = path.join(authDir, 'creds.json');
    try {
        if (!fs.existsSync(authPath)) {
            throw new Error(`Credentials file not found at: ${authPath}`);
        }

        const rawData = fs.readFileSync(authPath, 'utf8');
        const credsData = JSON.parse(rawData);
        const credsBase64 = Buffer.from(JSON.stringify(credsData)).toString('base64');

        const now = new Date();
        sessionStorage.set(credsBase64, {
            sessionId: credsBase64,
            credsData: credsBase64,
            createdAt: now,
            updatedAt: now
        });

        console.log('✅ Session saved to storage');
        return credsBase64;
    } catch (e) {
        console.error('❌ saveSessionLocallyFromPath error:', e.message);
        return null;
    }
}

/**
 * Cleanup function for socket and directories
 */
async function cleanup(sock, authDir, timers = []) {
    try {
        // Clear all timers
        timers.forEach(t => clearTimeout(t));

        // Remove event listeners
        if (sock?.ev) {
            sock.ev.removeAllListeners();
        }

        // Close WebSocket
        if (sock?.ws) {
            try {
                sock.ws.close();
            } catch (e) {
                console.warn('WS close error:', e.message);
            }
        }

        // Clear auth state
        if (sock) {
            sock.authState = null;
        }

        // Clear local session storage (but NOT sessionStatusMap - that's for frontend polling)
        sessionStorage.clear();

        // Remove temp directory
        if (fs.existsSync(authDir)) {
            await removeFile(authDir);
        }

        console.log('✅ Cleanup completed');
    } catch (err) {
        console.error('⚠️ Cleanup error:', err.message);
    }
}

/**
 * Session status storage for polling
 */
const sessionStatusMap = new Map();

/**
 * Endpoint to check session status
 */
router.get('/status/:requestId', (req, res) => {
    const { requestId } = req.params;
    const status = sessionStatusMap.get(requestId);

    if (status) {
        res.json(status);
        // Clean up after sending
        if (status.success) {
            setTimeout(() => sessionStatusMap.delete(requestId), 60000); // Keep for 1 minute
        }
    } else {
        res.json({ pending: true });
    }
});

/**
 * Main pairing endpoint
 */
router.get('/', async (req, res) => {
    const id = giftedId();
    let num = req.query.number;

    if (!num) {
        return res.status(400).json({ 
            error: "Phone number is required",
            usage: "?number=1234567890" 
        });
    }

    // Clean old temp directories
    const tempBaseDir = path.join(__dirname, 'temp');
    try {
        console.log('🧹 Cleaning old temp directories...');
        if (fs.existsSync(tempBaseDir)) {
            const tempDirs = fs.readdirSync(tempBaseDir);
            for (const dir of tempDirs) {
                const dirPath = path.join(tempBaseDir, dir);
                try {
                    const stat = fs.statSync(dirPath);
                    if (stat.isDirectory()) {
                        // Remove directories older than 1 hour
                        const age = Date.now() - stat.mtimeMs;
                        if (age > 3600000) {
                            await removeFile(dirPath);
                            console.log(`✅ Removed old directory: ${dir}`);
                        }
                    }
                } catch (e) {
                    console.warn(`⚠️ Could not check ${dir}:`, e.message);
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ Temp cleanup warning:', e.message);
    }

    const authDir = path.join(__dirname, 'temp', id);
    let sock = null;
    let timers = [];
    let hasResponded = false;
    let connectionEstablished = false;
    let retryCount = 0;
    const MAX_RETRIES = 2;

    // Global timeout (5 minutes)
    const globalTimeout = setTimeout(async () => {
        if (!connectionEstablished && !hasResponded) {
            console.log('⏱️ Global timeout reached');
            await cleanup(sock, authDir, timers);
            hasResponded = true;
            res.status(408).json({ 
                error: "Connection timeout. Please try again.",
                timeout: "5 minutes"
            });
        }
    }, 5 * 60 * 1000);

    timers.push(globalTimeout);

    /**
     * Pairing code generation function
     */
    async function GIFTED_PAIR_CODE() {
        try {
            // Create auth directory
            if (!fs.existsSync(authDir)) {
                fs.mkdirSync(authDir, { recursive: true });
            }

            // Initialize auth state
            const { state, saveCreds } = await useMultiFileAuthState(authDir);

            // Fetch latest version
            const { version, isLatest } = await fetchLatestBaileysVersion();
            console.log(`📡 Using WA version: ${version.join('.')}, isLatest: ${isLatest}`);

            // Create socket for pairing
            sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, logger),
                },
                printQRInTerminal: false,
                logger,
                browser: Browsers.macOS("Safari"),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: true,
                syncFullHistory: false,
                getMessage: async (key) => {
                    return { conversation: '' };
                }
            });

            // FUNCTION CALL: requestPairingCode is a function on the socket
            if (!sock.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');

                console.log('📱 Requesting pairing code for:', num);
                const code = await sock.requestPairingCode(num);
                console.log('✅ Pairing code generated:', code);

                if (!hasResponded) {
                    hasResponded = true;
                    const requestId = id; // Use the same ID for tracking
                    sessionStatusMap.set(requestId, { pending: true });

                    res.json({ 
                        code,
                        requestId,
                        message: "Enter this code in WhatsApp (Linked Devices > Link a Device > Link with phone number instead)",
                        number: num,
                        expiresIn: "60 seconds"
                    });
                }
            }

            // EVENT: Listen for credential updates
            sock.ev.on('creds.update', async () => {
                try {
                    await saveCreds();
                    console.log('💾 Credentials updated');
                } catch (err) {
                    console.warn('Creds save warning:', err.message);
                }
            });

            // EVENT: Handle connection updates
            sock.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;
                const statusCode = lastDisconnect?.error instanceof Boom
                    ? lastDisconnect.error.output.statusCode
                    : 500;

                if (connection === "open") {
                    connectionEstablished = true;
                    console.log('✅ Pairing connection established');

                    try {
                        // Wait for full authentication
                        console.log('⏳ Waiting for authentication to complete...');
                        await delay(8000);

                        // Save credentials
                        await saveCreds();
                        console.log('💾 Final credentials saved');

                        // Generate session ID
                        const sessionId = await saveSessionLocallyFromPath(authDir);
                        if (!sessionId) {
                            throw new Error('Failed to generate session ID');
                        }

                        console.log(`✅ Session ID generated`);

                        // Read creds.json for download
                        const credsPath = path.join(authDir, 'creds.json');
                        const credsData = fs.readFileSync(credsPath, 'utf8');

                        // Send session ID and welcome message NOW while pairing connection is still active
                        console.log('📤 Sending session ID and welcome message via active pairing connection...');

                        try {
                            // Extract phone number from sock.user.id (JID format: number@s.whatsapp.net)
                            // Sometimes JID can have device ID like "254704897825:27@s.whatsapp.net"
                            // We need to remove the :27 part
                            const fullJid = sock.user.id; // Use JID, not LID
                            const jidWithoutDomain = fullJid.split('@')[0]; // Get "254704897825:27" or just "254704897825"
                            const phoneNumber = jidWithoutDomain.split(':')[0]; // Remove device ID if present, get just "254704897825"
                            const ownerName = sock.user.name || 'User'; // Get owner name for registration

                            // Use JID format for sending messages to the owner
                            // Format: [country code][phone number]@s.whatsapp.net
                            const ownerJid = `${phoneNumber}@s.whatsapp.net`;

                            console.log(`📱 Owner Phone: ${phoneNumber}`);
                            console.log(`📱 Owner Name: ${ownerName}`);
                            console.log(`📱 Full JID: ${fullJid}`);
                            console.log(`📱 Owner LID (not used): ${sock.user.lid}`);
                            console.log(`📤 Sending to JID: ${ownerJid} (standard JID format)`);

                            // FIRST: Send the session ID with TREKKER~ prefix to owner using JID
                            const sessionIdMessage = `TREKKER~${sessionId}`;
                            await sock.sendMessage(ownerJid, { 
                                text: sessionIdMessage 
                            });
                            console.log(`✅ Session ID sent to WhatsApp owner via JID!`);

                            // Wait 2 seconds before sending welcome message
                            await delay(2000);

                            // SECOND: Send welcome message to owner using JID
                            const welcomeMsg = `🎉 *TREKKER-MD CONNECTED SUCCESSFULLY!*

━━━━━━━━━━━━━━━━━━━
✨ Your WhatsApp bot is now active!

📱 *Session Details:*
• Status: ✅ Active
• Owner: ${ownerName}
• Number: ${phoneNumber}
• Platform: Web

🔐 *Security:*
• Session created at: ${new Date().toLocaleString()}
• Keep your session ID secure
• Never share credentials

💡 *Next Steps:*
• ✅ Session ID sent above (TREKKER~...)
• Copy your session ID from this chat
• Use it in Step 2 to register your bot
• Start using your bot features!

━━━━━━━━━━━━━━━━━━━
_Powered by TREKKER-MD_
_Baileys v7.0 | WhatsApp Multi-Device_`;

                            await sock.sendMessage(ownerJid, {
                                text: welcomeMsg
                            });
                            console.log(`✅ Welcome message sent to WhatsApp owner via JID!`);

                            // Update connection status
                            activeSessions.set(phoneNumber, {
                                status: 'connected',
                                qr: null,
                                phoneNumber: phoneNumber,
                                sessionId: sessionId,
                                sock: sock,
                                connectedAt: new Date().toISOString()
                            });

                            console.log(`🎉 Connection successful for ${phoneNumber}`);

                            // AUTO-REGISTER BOT: Register the bot automatically using the main server API
                            try {
                                console.log(`🤖 Auto-registering bot for ${phoneNumber} with owner name: ${ownerName}`);

                                // Determine the main server URL (use environment variable or default to localhost)
                                const mainServerUrl = process.env.MAIN_SERVER_URL || 'http://localhost:5000';

                                // Prepare registration data
                                const registrationData = new FormData();
                                registrationData.append('botName', ownerName);
                                registrationData.append('phoneNumber', phoneNumber);
                                registrationData.append('credentialType', 'base64');
                                registrationData.append('sessionId', `TREKKER~${sessionId}`);
                                registrationData.append('features', JSON.stringify({
                                    autoView: true,
                                    typingMode: 'none',
                                    presenceMode: 'available',
                                    intervalSeconds: 30,
                                    chatGPT: false
                                }));

                                // Call the guest registration API
                                const registrationResponse = await axios.post(
                                    `${mainServerUrl}/api/guest/register-bot`,
                                    registrationData,
                                    {
                                        headers: registrationData.getHeaders(),
                                        timeout: 30000
                                    }
                                );

                                console.log(`✅ Bot auto-registered successfully:`, registrationResponse.data);

                                // Send confirmation message to owner
                                await delay(2000);
                                const confirmationMsg = `✅ *BOT AUTO-REGISTERED!*

Your bot "${ownerName}" has been automatically registered!

📊 *Registration Details:*
• Bot Name: ${ownerName}
• Phone: ${phoneNumber}
• Status: ${registrationResponse.data.botDetails?.approvalStatus === 'approved' ? '✅ APPROVED & ACTIVE' : '⏳ Pending Approval'}
• Server: ${registrationResponse.data.assignedServer || 'Current Server'}

${registrationResponse.data.botDetails?.approvalStatus === 'approved' 
    ? '🎉 Your bot is LIVE and ready to use!\n• Send .menu to see available commands\n• Fully operational with all features!' 
    : '⏳ Your bot is awaiting admin approval\n• You will be notified once approved\n• Contact +254704897825 for faster activation'}

━━━━━━━━━━━━━━━━━━━
_Auto-Registration Complete_`;

                                await sock.sendMessage(ownerJid, {
                                    text: confirmationMsg
                                });
                                console.log(`✅ Auto-registration confirmation sent to owner`);

                                // Send promotional offer claim message if bot was auto-approved
                                if (registrationResponse.data.botDetails?.approvalStatus === 'approved') {
                                    await delay(2000);
                                    
                                    // Fetch offer details to get duration
                                    try {
                                        const offerResponse = await axios.get(`${mainServerUrl}/api/offer/status`, {
                                            timeout: 10000
                                        });
                                        
                                        if (offerResponse.data.isActive && offerResponse.data.config) {
                                            const { durationType, durationValue, endDate } = offerResponse.data.config;
                                            const endDateFormatted = new Date(endDate).toLocaleDateString();
                                            
                                            const offerClaimMsg = `🎁 *PROMOTIONAL OFFER CLAIMED!*

━━━━━━━━━━━━━━━━━━━
🎉 Congratulations! You've successfully claimed our limited-time promotional offer!

📊 *Offer Details:*
• Duration: ${durationValue} ${durationType}
• Valid Until: ${endDateFormatted}
• Benefits: Instant auto-approval ✅

🚀 *Your Bot Status:*
• Automatically approved
• Fully operational NOW
• All features unlocked
• No waiting period!

💡 *What's Next:*
• Your bot is already LIVE and running
• Send .menu to see all available commands
• Enjoy premium features during offer period
• Contact +254704897825 for support

━━━━━━━━━━━━━━━━━━━
_Limited Time Offer - Claim Confirmed_
_Powered by GIFTED-MD_`;

                                            await sock.sendMessage(ownerJid, {
                                                text: offerClaimMsg
                                            });
                                            console.log(`✅ Promotional offer claim message sent to owner`);
                                        }
                                    } catch (offerFetchError) {
                                        console.warn(`⚠️ Could not fetch offer details:`, offerFetchError.message);
                                    }
                                }

                            } catch (autoRegError) {
                                console.error(`❌ Auto-registration failed:`, autoRegError.message);

                                // Send fallback message to user
                                await delay(2000);
                                const fallbackMsg = `⚠️ *AUTO-REGISTRATION NOTE*

Your session was created successfully, but automatic registration encountered an issue.

📝 *Manual Registration:*
• Visit the dashboard
• Use your session ID: TREKKER~${sessionId}
• Complete registration manually

Or contact support: +254704897825

Your session ID is safe and ready to use!`;

                                await sock.sendMessage(ownerJid, {
                                    text: fallbackMsg
                                });
                            }
                        } catch (error) {
                            console.error('❌ Connection.open error:', error.message);
                            await cleanup(sock, authDir, timers);

                            if (!hasResponded) {
                                hasResponded = true;
                                res.status(500).json({ 
                                    error: "Failed to send welcome message",
                                    details: error.message,
                                    note: "Session may still be valid. Check your WhatsApp."
                                });
                            }
                        }

                        // Store session data for polling BEFORE cleanup
                        const sessionDataForFrontend = {
                            success: true,
                            sessionId: `TREKKER~${sessionId}`,
                            credsJson: credsData,
                            message: "Session created successfully! Check your WhatsApp for confirmation.",
                            timestamp: new Date().toISOString()
                        };

                        sessionStatusMap.set(id, sessionDataForFrontend);
                        console.log(`📦 Session data stored for request ID: ${id}`);

                        // Keep session data available for 30 minutes (extended for better UX)
                        setTimeout(() => {
                            const currentData = sessionStatusMap.get(id);
                            if (currentData && currentData.success) {
                                sessionStatusMap.delete(id);
                                console.log(`🧹 Cleaned up session data for: ${id}`);
                            }
                        }, 30 * 60 * 1000);

                        // Now close the pairing connection
                        console.log('🔌 Closing pairing connection...');
                        await delay(2000);

                        // Final cleanup (but keep sessionStatusMap intact)
                        await cleanup(sock, authDir, timers);

                    } catch (err) {
                        console.error('❌ Connection.open error:', err.message);
                        await cleanup(sock, authDir, timers);

                        if (!hasResponded) {
                            hasResponded = true;
                            res.status(500).json({ 
                                error: "Failed to send welcome message",
                                details: err.message,
                                note: "Session may still be valid. Check your WhatsApp."
                            });
                        }
                    }

                } else if (connection === "close") {
                    console.log('⚠️ Pairing connection closed. Status:', statusCode);

                    // Check if logged out
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log('⚠️ Device logged out or unauthorized');
                        await cleanup(sock, authDir, timers);

                        if (!hasResponded) {
                            hasResponded = true;
                            res.status(401).json({ 
                                error: "Authentication failed",
                                reason: "Device logged out or unauthorized"
                            });
                        }
                        return;
                    }

                    // Retry logic
                    if (!connectionEstablished && retryCount < MAX_RETRIES) {
                        retryCount++;
                        console.log(`🔄 Retrying (${retryCount}/${MAX_RETRIES})...`);
                        await delay(5000);
                        GIFTED_PAIR_CODE().catch(err => {
                            console.error('Retry error:', err);
                        });
                    } else if (!connectionEstablished) {
                        console.log('❌ Max retries reached or connection failed');
                        await cleanup(sock, authDir, timers);

                        if (!hasResponded) {
                            hasResponded = true;
                            res.status(500).json({ 
                                error: "Connection failed after retries",
                                reason: "Could not establish connection"
                            });
                        }
                    }
                }
            });
        } catch (error) {
            console.error('❌ Pairing error:', error);
            await cleanup(sock, authDir, timers);

            if (!hasResponded) {
                hasResponded = true;
                res.status(500).json({ 
                    error: "Pairing failed",
                    details: error.message 
                });
            }
        }
    }

    // Call the pairing function
    await GIFTED_PAIR_CODE();
});

module.exports = router;
module.exports.default = router;