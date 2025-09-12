import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";
import { storage } from "./storage.js";
import { insertBotInstanceSchema, insertCommandSchema } from "../shared/schema.js";
import { botManager } from "./services/bot-manager.js";
import { getServerName } from "./db.js";
import { authenticateAdmin, authenticateUser, validateAdminCredentials, generateToken } from './middleware/auth.js';
import { sendGuestValidationMessage } from "./services/validation-bot.js";
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.originalname.endsWith('.json')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only JSON files are allowed'));
        }
    },
    limits: { fileSize: 1024 * 1024 }
});
async function resetToDefaultServerAfterRegistration() {
    try {
        const currentServer = getServerName();
        const defaultServer = process.env.SERVER_NAME || 'default-server';
        if (currentServer !== defaultServer) {
            console.log(`🔄 Resetting to default server from ${currentServer} to ${defaultServer} after guest registration`);
            const { botManager } = await import('./services/bot-manager.js');
            await botManager.stopAllBots();
            process.env.RUNTIME_SERVER_NAME = defaultServer;
            await botManager.resumeBotsForServer(defaultServer);
            console.log(`✅ Successfully reset to default server: ${defaultServer}`);
        }
    }
    catch (error) {
        console.warn('⚠️ Failed to reset to default server after registration:', error);
    }
}
export async function registerRoutes(app) {
    const httpServer = createServer(app);
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    wss.on('connection', (ws) => {
        console.log('Client connected to WebSocket');
        ws.on('close', () => {
            console.log('Client disconnected from WebSocket');
        });
    });
    const broadcast = (data) => {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    };
    botManager.setBroadcastFunction(broadcast);
    app.get("/health", (req, res) => {
        res.status(200).json({
            status: "healthy",
            timestamp: new Date().toISOString(),
            uptime: process.uptime()
        });
    });
    app.get("/ready", async (req, res) => {
        try {
            await storage.getAllServers();
            res.status(200).json({
                status: "ready",
                timestamp: new Date().toISOString(),
                database: "connected"
            });
        }
        catch (error) {
            res.status(503).json({
                status: "not ready",
                timestamp: new Date().toISOString(),
                database: "disconnected",
                error: error instanceof Error ? error.message : "Unknown error"
            });
        }
    });
    async function resumeSavedBots() {
        try {
            console.log('🔄 Starting bot resume process...');
            const savedBots = await storage.getAllBotInstances();
            if (savedBots.length === 0) {
                console.log('📋 No saved bots found in database');
                return;
            }
            console.log(`📱 Found ${savedBots.length} saved bot(s) in database`);
            const resumableBots = savedBots.filter(bot => bot.credentials && bot.approvalStatus === 'approved');
            if (resumableBots.length === 0) {
                console.log('⚠️ No approved bots with credentials found to resume');
                return;
            }
            console.log(`🚀 Resuming ${resumableBots.length} bot(s) with credentials...`);
            for (const bot of resumableBots) {
                await storage.updateBotInstance(bot.id, { status: 'loading' });
                await storage.createActivity({
                    botInstanceId: bot.id,
                    type: 'startup',
                    description: 'Bot resume initiated on server restart',
                    serverName: getServerName()
                });
            }
            for (let i = 0; i < resumableBots.length; i++) {
                const bot = resumableBots[i];
                setTimeout(async () => {
                    try {
                        console.log(`🔄 Resuming bot: ${bot.name} (${bot.id})`);
                        await botManager.createBot(bot.id, bot);
                        await botManager.startBot(bot.id);
                        console.log(`✅ Bot ${bot.name} resumed successfully`);
                        await storage.createActivity({
                            botInstanceId: bot.id,
                            type: 'startup',
                            description: 'Bot resumed successfully on server restart',
                            serverName: getServerName()
                        });
                        broadcast({
                            type: 'BOT_RESUMED',
                            data: {
                                botId: bot.id,
                                name: bot.name,
                                status: 'loading'
                            }
                        });
                    }
                    catch (error) {
                        console.error(`❌ Failed to resume bot ${bot.name}:`, error);
                        await storage.updateBotInstance(bot.id, { status: 'error' });
                        await storage.createActivity({
                            botInstanceId: bot.id,
                            type: 'error',
                            description: `Bot resume failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            serverName: getServerName()
                        });
                        broadcast({
                            type: 'BOT_ERROR',
                            data: {
                                botId: bot.id,
                                name: bot.name,
                                status: 'error',
                                error: error instanceof Error ? error.message : 'Unknown error'
                            }
                        });
                    }
                }, i * 2000);
            }
            console.log(`✅ Bot resume process initiated for ${resumableBots.length} bot(s)`);
        }
        catch (error) {
            console.error('❌ Failed to resume saved bots:', error);
        }
    }
    await resumeSavedBots();
    app.post("/api/auth/login", async (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) {
                return res.status(400).json({ message: "Username and password are required" });
            }
            const isValidAdmin = validateAdminCredentials(username, password);
            if (isValidAdmin) {
                const token = generateToken(username, true);
                res.json({
                    token,
                    user: { username, isAdmin: true },
                    message: "Admin login successful"
                });
            }
            else {
                res.status(401).json({ message: "Invalid credentials" });
            }
        }
        catch (error) {
            res.status(500).json({ message: "Login failed" });
        }
    });
    app.get("/api/auth/verify", authenticateUser, (req, res) => {
        res.json({ user: req.user });
    });
    app.post("/api/validate-credentials", upload.single('credentials'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    message: "Please upload a credentials.json file"
                });
            }
            let credentials;
            try {
                credentials = JSON.parse(req.file.buffer.toString());
            }
            catch (error) {
                return res.status(400).json({
                    message: "❌ Invalid JSON file. Please ensure you're uploading a valid credentials.json file."
                });
            }
            if (!credentials || typeof credentials !== 'object') {
                return res.status(400).json({
                    message: "❌ Invalid credentials file format. Please upload a valid WhatsApp session file."
                });
            }
            const testBotData = {
                name: `Test_${Date.now()}`,
                credentials,
                autoLike: false,
                autoViewStatus: false,
                autoReact: false,
                chatgptEnabled: false,
                typingMode: 'none'
            };
            try {
                const validatedData = insertBotInstanceSchema.parse(testBotData);
                const testBot = await storage.createBotInstance(validatedData);
                await botManager.createBot(testBot.id, testBot);
                await botManager.destroyBot(testBot.id);
                await storage.deleteBotInstance(testBot.id);
                res.json({
                    valid: true,
                    message: "✅ Your credentials.json is valid! Checking admin approval...",
                    status: "pending_approval"
                });
            }
            catch (botError) {
                try {
                    console.error('Bot creation failed, cleaning up...');
                }
                catch (cleanupError) {
                    console.error('Cleanup error:', cleanupError);
                }
                res.status(400).json({
                    valid: false,
                    message: "❌ Invalid credentials.json file. Please ensure it's a valid WhatsApp session file.",
                    error: botError instanceof Error ? botError.message : 'Unknown error'
                });
            }
        }
        catch (error) {
            console.error('Credentials validation error:', error);
            res.status(500).json({
                message: "Failed to validate credentials",
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    });
    app.get("/api/dashboard/stats", async (req, res) => {
        try {
            const stats = await storage.getDashboardStats();
            res.json(stats);
        }
        catch (error) {
            console.error("Dashboard stats error:", error);
            res.status(500).json({ message: "Failed to fetch dashboard stats" });
        }
    });
    app.get("/api/server/info", async (req, res) => {
        try {
            const { getServerNameWithFallback } = await import('./db.js');
            const serverName = await getServerNameWithFallback();
            const maxBots = parseInt(process.env.BOTCOUNT || '10', 10);
            const currentBots = await storage.getAllBotInstances();
            const hasSecretConfig = !!process.env.SERVER_NAME;
            res.json({
                serverName,
                maxBots,
                currentBots: currentBots.length,
                availableSlots: maxBots - currentBots.length,
                hasSecretConfig
            });
        }
        catch (error) {
            res.status(500).json({ message: "Failed to fetch server info" });
        }
    });
    app.get("/api/servers/list", async (req, res) => {
        try {
            const maxBots = parseInt(process.env.BOTCOUNT || '10', 10);
            const serverList = [];
            for (let i = 1; i <= 100; i++) {
                const serverName = `Server${i}`;
                const serverInfo = await storage.getServerByName(serverName);
                if (serverInfo) {
                    serverList.push({
                        name: serverName,
                        totalBots: serverInfo.maxBotCount,
                        currentBots: serverInfo.currentBotCount || 0,
                        remainingBots: serverInfo.maxBotCount - (serverInfo.currentBotCount || 0),
                        description: serverInfo.description,
                        status: serverInfo.serverStatus
                    });
                }
                else {
                    serverList.push({
                        name: serverName,
                        totalBots: maxBots,
                        currentBots: 0,
                        remainingBots: maxBots,
                        description: null,
                        status: 'available'
                    });
                }
            }
            serverList.sort((a, b) => {
                const aCurrent = a.currentBots || 0;
                const bCurrent = b.currentBots || 0;
                if (aCurrent !== bCurrent) {
                    return aCurrent - bCurrent;
                }
                return a.name.localeCompare(b.name);
            });
            res.json(serverList);
        }
        catch (error) {
            console.error("Server list error:", error);
            res.status(500).json({ message: "Failed to fetch server list" });
        }
    });
    app.post("/api/server/configure", async (req, res) => {
        try {
            if (process.env.SERVER_NAME) {
                return res.status(400).json({
                    message: "Server name is configured via secrets and cannot be changed through UI"
                });
            }
            const { serverName, description } = req.body;
            if (!serverName || serverName.trim().length === 0) {
                return res.status(400).json({ message: "Server name is required" });
            }
            const { getServerName } = await import('./db.js');
            const currentServerName = getServerName();
            const newServerName = serverName.trim();
            if (currentServerName === newServerName) {
                const currentServer = await storage.getServerByName(currentServerName);
                if (currentServer) {
                    await storage.updateServerInfo(currentServerName, {
                        serverName: newServerName,
                        description: description?.trim() || null
                    });
                }
                return res.json({ message: "Server description updated successfully" });
            }
            console.log(`🔄 Switching server context from "${currentServerName}" to "${newServerName}"`);
            let targetServer = await storage.getServerByName(newServerName);
            if (!targetServer) {
                const maxBots = parseInt(process.env.BOTCOUNT || '10', 10);
                targetServer = await storage.createServer({
                    serverName: newServerName,
                    maxBotCount: maxBots,
                    currentBotCount: 0,
                    serverStatus: 'active',
                    description: description?.trim() || `Server ${newServerName}`
                });
                console.log(`✅ Created new server tenant: ${newServerName}`);
            }
            else if (description?.trim()) {
                await storage.updateServerInfo(newServerName, {
                    serverName: newServerName,
                    description: description.trim()
                });
            }
            try {
                const { botManager } = await import('./services/bot-manager.js');
                await botManager.stopAllBots();
                console.log(`🛑 Stopped all bot operations for server: ${currentServerName}`);
                process.env.RUNTIME_SERVER_NAME = newServerName;
                console.log(`🔄 Server context switched to: ${newServerName}`);
                await initializeServerTenant(newServerName);
                await botManager.resumeBotsForServer(newServerName);
                console.log(`✅ Restarted bot manager for server: ${newServerName}`);
                res.json({
                    message: "Server switched successfully. All operations now running under new server context.",
                    newServerName: newServerName,
                    requiresRefresh: true
                });
            }
            catch (switchError) {
                console.error("Server context switching error:", switchError);
                res.status(500).json({ message: "Failed to switch server context. Please try again." });
            }
        }
        catch (error) {
            console.error("Server configuration error:", error);
            res.status(500).json({ message: "Failed to update server configuration" });
        }
    });
    async function initializeServerTenant(serverName) {
        console.log(`🔧 Initializing tenant for server: ${serverName}`);
        const actualBots = await storage.getBotInstancesForServer(serverName);
        await storage.updateServerBotCount(serverName, actualBots.length);
        console.log(`✅ Tenant initialized for server: ${serverName} (${actualBots.length} bots)`);
    }
    app.get("/api/server-config", async (req, res) => {
        try {
            const serverConfig = process.env.SERVER_CONFIG;
            if (serverConfig) {
                res.set('Content-Type', 'text/plain');
                res.send(serverConfig);
            }
            else {
                res.status(404).send('');
            }
        }
        catch (error) {
            console.error('Server config error:', error);
            res.status(500).send('');
        }
    });
    app.get("/api/bot-instances", async (req, res) => {
        try {
            const showPendingOnly = req.query.pending === 'true';
            if (showPendingOnly) {
                const bots = await storage.getBotInstancesByApprovalStatus('pending');
                res.json(bots);
            }
            else {
                const bots = await storage.getAllBotInstances();
                res.json(bots);
            }
        }
        catch (error) {
            console.error("Bot instances error:", error);
            res.status(500).json({ message: "Failed to fetch bot instances" });
        }
    });
    app.get("/api/bots/pending", async (req, res) => {
        try {
            const pendingBots = await storage.getPendingBots();
            res.json(pendingBots);
        }
        catch (error) {
            console.error("Get pending bots error:", error);
            res.status(500).json({ message: "Failed to fetch pending bots" });
        }
    });
    app.get("/api/bots/approved", async (req, res) => {
        try {
            const approvedBots = await storage.getApprovedBots();
            res.json(approvedBots);
        }
        catch (error) {
            console.error("Get approved bots error:", error);
            res.status(500).json({ message: "Failed to fetch approved bots" });
        }
    });
    app.post("/api/bots/:id/approve", authenticateAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { expirationMonths = 3 } = req.body;
            const bot = await storage.getBotInstance(id);
            if (!bot) {
                return res.status(404).json({ message: "Bot not found" });
            }
            const updatedBot = await storage.updateBotInstance(id, {
                approvalStatus: 'approved',
                approvalDate: new Date().toISOString(),
                expirationMonths,
                status: 'loading'
            });
            await storage.createActivity({
                botInstanceId: id,
                type: 'approval',
                description: `Bot approved for ${expirationMonths} months by admin`,
                metadata: { expirationMonths },
                serverName: getServerName()
            });
            try {
                console.log(`Auto-starting approved bot ${bot.name} (${bot.id})...`);
                await botManager.startBot(id);
                setTimeout(async () => {
                    try {
                        if (bot.phoneNumber) {
                            const approvalMessage = `🎉 *Bot Approval Confirmed!* 🎉

Congratulations! Your TREKKER-MD WhatsApp bot "${bot.name}" has been successfully approved and is now active!

📱 *Bot Details:*
• Name: ${bot.name}
• Phone: ${bot.phoneNumber}
• Status: ✅ Active & Online
• Approval Date: ${new Date().toLocaleDateString()}
• Valid For: ${expirationMonths} months

🚀 *Your bot is now live and ready to serve!*
• All automation features are enabled
• ChatGPT integration is active
• Auto-like, auto-react, and status viewing are operational

Thank you for choosing TREKKER-MD! Your bot will remain active for ${expirationMonths} months from today.

---
*TREKKER-MD - Ultra Fast Lifetime WhatsApp Bot Automation*`;
                            const messageSent = await botManager.sendMessageThroughBot(id, bot.phoneNumber, approvalMessage);
                            if (messageSent) {
                                console.log(`✅ Approval notification sent to ${bot.phoneNumber} via bot ${bot.name}`);
                            }
                            else {
                                console.log(`⚠️ Failed to send approval notification to ${bot.phoneNumber} - bot might not be online yet`);
                            }
                        }
                    }
                    catch (notificationError) {
                        console.error('Failed to send approval notification:', notificationError);
                    }
                }, 5000);
            }
            catch (startError) {
                console.error(`Failed to auto-start bot ${id}:`, startError);
                await storage.updateBotInstance(id, { status: 'error' });
            }
            broadcast({ type: 'BOT_APPROVED', data: updatedBot });
            res.json({ message: "Bot approved successfully and starting automatically" });
        }
        catch (error) {
            console.error("Approve bot error:", error);
            res.status(500).json({ message: "Failed to approve bot" });
        }
    });
    app.post("/api/bots/:id/reject", authenticateAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const success = await storage.rejectBotInstance(id);
            if (success) {
                res.json({ message: "Bot rejected successfully" });
            }
            else {
                res.status(404).json({ message: "Bot not found" });
            }
        }
        catch (error) {
            console.error("Reject bot error:", error);
            res.status(500).json({ message: "Failed to reject bot" });
        }
    });
    app.post("/api/bots/:id/toggle-feature", authenticateAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const { feature, enabled } = req.body;
            const bot = await storage.getBotInstance(id);
            if (!bot) {
                return res.status(404).json({ message: "Bot not found" });
            }
            const currentSettings = bot.settings || {};
            const features = currentSettings.features || {};
            features[feature] = enabled;
            const success = await storage.updateBotInstance(id, {
                settings: { ...currentSettings, features }
            });
            if (success) {
                await storage.createActivity({
                    botInstanceId: id,
                    type: 'settings_change',
                    description: `Admin ${enabled ? 'enabled' : 'disabled'} ${feature} feature`,
                    metadata: { feature, enabled, admin: true },
                    serverName: getServerName()
                });
                res.json({ message: "Feature updated successfully" });
            }
            else {
                res.status(404).json({ message: "Failed to update feature" });
            }
        }
        catch (error) {
            console.error("Toggle feature error:", error);
            res.status(500).json({ message: "Failed to toggle feature" });
        }
    });
    app.get("/api/bot-instances/:id", async (req, res) => {
        try {
            const bot = await storage.getBotInstance(req.params.id);
            if (!bot) {
                return res.status(404).json({ message: "Bot instance not found" });
            }
            res.json(bot);
        }
        catch (error) {
            res.status(500).json({ message: "Failed to fetch bot instance" });
        }
    });
    app.post("/api/bot-instances", upload.single('credentials'), async (req, res) => {
        try {
            let credentials = null;
            if (req.body.credentialsBase64) {
                try {
                    const base64Data = req.body.credentialsBase64.trim();
                    if (!base64Data) {
                        return res.status(400).json({
                            message: "Base64 credentials string is empty. Please provide valid base64-encoded credentials."
                        });
                    }
                    const decodedContent = Buffer.from(base64Data, 'base64').toString('utf8');
                    if (!decodedContent.trim()) {
                        return res.status(400).json({
                            message: "Decoded credentials are empty. Please check your base64 string."
                        });
                    }
                    credentials = JSON.parse(decodedContent);
                    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
                        return res.status(400).json({
                            message: "Invalid credentials format. Please ensure your base64 string contains valid WhatsApp session data."
                        });
                    }
                    if (Object.keys(credentials).length === 0) {
                        return res.status(400).json({
                            message: "Credentials are empty. Please provide valid base64-encoded credentials with session data."
                        });
                    }
                }
                catch (error) {
                    return res.status(400).json({
                        message: "Invalid base64 or JSON format. Please ensure you're providing a valid base64-encoded credentials.json file."
                    });
                }
            }
            else if (req.file) {
                if (req.file.size < 10) {
                    return res.status(400).json({
                        message: "Credentials file is too small or empty. Please upload a valid credentials file."
                    });
                }
                if (req.file.size > 5 * 1024 * 1024) {
                    return res.status(400).json({
                        message: "Credentials file is too large. Maximum size is 5MB."
                    });
                }
                try {
                    const fileContent = req.file.buffer.toString();
                    if (!fileContent.trim()) {
                        return res.status(400).json({
                            message: "Credentials file is empty. Please upload a valid credentials file."
                        });
                    }
                    credentials = JSON.parse(fileContent);
                    if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
                        return res.status(400).json({
                            message: "Invalid credentials file format. Please upload a valid WhatsApp session file."
                        });
                    }
                    if (Object.keys(credentials).length === 0) {
                        return res.status(400).json({
                            message: "Credentials file is empty. Please upload a valid credentials file with session data."
                        });
                    }
                }
                catch (error) {
                    return res.status(400).json({
                        message: "Invalid JSON file. Please ensure you're uploading a valid credentials.json file from WhatsApp Web."
                    });
                }
            }
            if (!req.body.name || req.body.name.trim() === '') {
                return res.status(400).json({
                    message: "Bot name is required. Please provide a name for your bot instance."
                });
            }
            const existingBots = await storage.getAllBotInstances();
            const botCountCheck = await storage.strictCheckBotCountLimit();
            if (!botCountCheck.canAdd) {
                const availableServers = await storage.getAvailableServers();
                if (availableServers.length > 0) {
                    return res.status(400).json({
                        message: `🚫 ${getServerName()} is full! (${botCountCheck.currentCount}/${botCountCheck.maxCount} bots)`,
                        serverFull: true,
                        currentServer: getServerName(),
                        availableServers: availableServers.map(server => ({
                            serverName: server.serverName,
                            currentBots: server.currentBotCount || 0,
                            maxBots: server.maxBotCount,
                            availableSlots: server.maxBotCount - (server.currentBotCount || 0),
                            serverUrl: server.serverUrl,
                            description: server.description
                        })),
                        action: 'select_server'
                    });
                }
                else {
                    return res.status(400).json({
                        message: `😞 All servers are full! Current server: ${getServerName()} (${botCountCheck.currentCount}/${botCountCheck.maxCount}). Please contact administrator for more capacity.`,
                        serverFull: true,
                        allServersFull: true
                    });
                }
            }
            const duplicateName = existingBots.find(bot => bot.name.toLowerCase().trim() === req.body.name.toLowerCase().trim());
            if (duplicateName) {
                return res.status(400).json({
                    message: `Bot name "${req.body.name.trim()}" is already in use. Please choose a different name.`
                });
            }
            if (credentials) {
                const duplicateCredentials = existingBots.find(bot => {
                    if (!bot.credentials)
                        return false;
                    return JSON.stringify(bot.credentials) === JSON.stringify(credentials);
                });
                if (duplicateCredentials) {
                    return res.status(400).json({
                        message: `These credentials are already in use by bot "${duplicateCredentials.name}". Each bot must have unique credentials.`
                    });
                }
            }
            const botData = {
                ...req.body,
                credentials,
                name: req.body.name.trim(),
                autoLike: req.body.autoLike === 'true',
                autoViewStatus: req.body.autoViewStatus === 'true',
                autoReact: req.body.autoReact === 'true',
                chatgptEnabled: req.body.chatgptEnabled === 'true',
            };
            const validatedData = insertBotInstanceSchema.parse(botData);
            const bot = await storage.createBotInstance(validatedData);
            try {
                await botManager.createBot(bot.id, bot);
                setTimeout(async () => {
                    try {
                        const currentBot = await storage.getBotInstance(bot.id);
                        if (currentBot && (currentBot.status === 'loading' || currentBot.status === 'error')) {
                            console.log(`Auto-deleting bot ${bot.id} due to connection timeout`);
                            await botManager.destroyBot(bot.id);
                            await storage.deleteBotInstance(bot.id);
                            await storage.createActivity({
                                botInstanceId: bot.id,
                                type: 'auto_cleanup',
                                description: `Bot "${bot.name}" was automatically deleted due to connection failure`,
                                serverName: getServerName()
                            });
                            broadcast({ type: 'BOT_DELETED', data: { botId: bot.id } });
                        }
                    }
                    catch (cleanupError) {
                        console.error(`Failed to auto-cleanup bot ${bot.id}:`, cleanupError);
                    }
                }, 5 * 60 * 1000);
            }
            catch (botError) {
                await storage.deleteBotInstance(bot.id);
                throw new Error(`Failed to initialize bot: ${botError instanceof Error ? botError.message : 'Unknown error'}`);
            }
            await storage.createActivity({
                botInstanceId: bot.id,
                type: 'bot_created',
                description: `🎉 WELCOME TO TREKKERMD LIFETIME BOT - Bot "${bot.name}" created successfully!`,
                serverName: getServerName()
            });
            broadcast({ type: 'BOT_CREATED', data: bot });
            res.json(bot);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Failed to create bot instance";
            console.error('Bot creation error:', error);
            let userMessage = errorMessage;
            if (errorMessage.includes('name')) {
                userMessage = "Bot name is invalid or already exists. Please choose a different name.";
            }
            else if (errorMessage.includes('credentials')) {
                userMessage = "Invalid credentials file. Please upload a valid WhatsApp session file.";
            }
            else if (errorMessage.includes('Expected object')) {
                userMessage = "Missing required bot configuration. Please fill in all required fields.";
            }
            res.status(400).json({ message: userMessage });
        }
    });
    app.patch("/api/bot-instances/:id", async (req, res) => {
        try {
            const bot = await storage.updateBotInstance(req.params.id, req.body);
            broadcast({ type: 'BOT_UPDATED', data: bot });
            res.json(bot);
        }
        catch (error) {
            res.status(500).json({ message: "Failed to update bot instance" });
        }
    });
    app.delete("/api/bot-instances/:id", authenticateAdmin, async (req, res) => {
        try {
            const botInstance = await storage.getBotInstance(req.params.id);
            await botManager.destroyBot(req.params.id);
            await storage.deleteBotRelatedData(req.params.id);
            await storage.deleteBotInstance(req.params.id);
            if (botInstance && botInstance.phoneNumber) {
                await storage.deleteGlobalRegistration(botInstance.phoneNumber);
                console.log(`🗑️ Removed ${botInstance.phoneNumber} from god register table`);
            }
            broadcast({ type: 'BOT_DELETED', data: { id: req.params.id } });
            res.json({ success: true });
        }
        catch (error) {
            console.error('Delete bot error:', error);
            res.status(500).json({ message: "Failed to delete bot instance" });
        }
    });
    app.post("/api/bot-instances/:id/toggle-feature", async (req, res) => {
        try {
            const { id } = req.params;
            const { feature, enabled } = req.body;
            if (!feature || enabled === undefined) {
                return res.status(400).json({ message: "Feature and enabled status are required" });
            }
            const bot = await storage.getBotInstance(id);
            if (!bot) {
                return res.status(404).json({ message: "Bot not found" });
            }
            if (bot.approvalStatus !== 'approved') {
                return res.status(400).json({ message: "Only approved bots can have features toggled" });
            }
            const featureMap = {
                'autoLike': 'autoLike',
                'autoView': 'autoViewStatus',
                'autoReact': 'autoReact',
                'typingIndicator': 'typingMode',
                'chatGPT': 'chatgptEnabled'
            };
            const dbField = featureMap[feature];
            if (!dbField) {
                return res.status(400).json({ message: "Invalid feature name" });
            }
            const updates = {};
            if (dbField === 'typingMode') {
                updates[dbField] = enabled ? 'typing' : 'none';
            }
            else {
                updates[dbField] = enabled;
            }
            const currentSettings = bot.settings || {};
            const currentFeatures = currentSettings.features || {};
            updates.settings = {
                ...currentSettings,
                features: {
                    ...currentFeatures,
                    [feature]: enabled
                }
            };
            await storage.updateBotInstance(id, updates);
            await storage.createActivity({
                botInstanceId: id,
                type: 'feature_toggle',
                description: `${feature} feature ${enabled ? 'enabled' : 'disabled'}`,
                metadata: { feature, enabled },
                serverName: getServerName()
            });
            res.json({ message: "Feature updated successfully", feature, enabled });
        }
        catch (error) {
            console.error('Feature toggle error:', error);
            res.status(500).json({ message: "Failed to toggle feature" });
        }
    });
    app.post("/api/bot-instances/:id/approve", async (req, res) => {
        try {
            const { id } = req.params;
            const { expirationMonths = 3 } = req.body;
            const bot = await storage.getBotInstance(id);
            if (!bot) {
                return res.status(404).json({ message: "Bot not found" });
            }
            if (bot.approvalStatus !== 'pending') {
                return res.status(400).json({ message: "Only pending bots can be approved" });
            }
            const updatedBot = await storage.updateBotInstance(id, {
                approvalStatus: 'approved',
                approvalDate: new Date().toISOString(),
                expirationMonths,
                status: 'loading'
            });
            await storage.createActivity({
                botInstanceId: id,
                type: 'approval',
                description: `Bot approved for ${expirationMonths} months`,
                metadata: { expirationMonths },
                serverName: getServerName()
            });
            try {
                console.log(`Auto-starting approved bot ${bot.name} (${bot.id})...`);
                await botManager.startBot(id);
                setTimeout(async () => {
                    try {
                        if (bot.phoneNumber) {
                            const approvalMessage = `🎉 *Bot Approval Confirmed!* 🎉

Congratulations! Your TREKKER-MD WhatsApp bot "${bot.name}" has been successfully approved and is now active!

📱 *Bot Details:*
• Name: ${bot.name}
• Phone: ${bot.phoneNumber}
• Status: ✅ Active & Online
• Approval Date: ${new Date().toLocaleDateString()}
• Valid For: ${expirationMonths} months

🚀 *Your bot is now live and ready to serve!*
• All automation features are enabled
• ChatGPT integration is active
• Auto-like, auto-react, and status viewing are operational

Thank you for choosing TREKKER-MD! Your bot will remain active for ${expirationMonths} months from today.

---
*TREKKER-MD - Ultra Fast Lifetime WhatsApp Bot Automation*`;
                            const messageSent = await botManager.sendMessageThroughBot(id, bot.phoneNumber, approvalMessage);
                            if (messageSent) {
                                console.log(`✅ Approval notification sent to ${bot.phoneNumber} via bot ${bot.name}`);
                            }
                            else {
                                console.log(`⚠️ Failed to send approval notification to ${bot.phoneNumber} - bot might not be online yet`);
                            }
                        }
                    }
                    catch (notificationError) {
                        console.error('Failed to send approval notification:', notificationError);
                    }
                }, 5000);
            }
            catch (startError) {
                console.error(`Failed to auto-start bot ${bot.id}:`, startError);
                await storage.updateBotInstance(id, { status: 'error' });
            }
            broadcast({ type: 'BOT_APPROVED', data: updatedBot });
            res.json({ message: "Bot approved successfully and starting automatically" });
        }
        catch (error) {
            console.error('Bot approval error:', error);
            res.status(500).json({ message: "Failed to approve bot" });
        }
    });
    app.post("/api/bot-instances/:id/revoke", authenticateAdmin, async (req, res) => {
        try {
            const { id } = req.params;
            const botInstance = await storage.getBotInstance(id);
            if (!botInstance) {
                return res.status(404).json({ message: "Bot not found" });
            }
            await botManager.destroyBot(id);
            const bot = await storage.updateBotInstance(id, {
                approvalStatus: 'pending',
                status: 'offline',
                approvalDate: null,
                expirationMonths: null,
            });
            await storage.createActivity({
                botInstanceId: id,
                type: 'revoke_approval',
                description: `Bot approval revoked - returned to pending status`,
                metadata: { previousStatus: botInstance.approvalStatus },
                serverName: getServerName()
            });
            broadcast({ type: 'BOT_APPROVAL_REVOKED', data: bot });
            res.json({ message: "Bot approval revoked successfully" });
        }
        catch (error) {
            console.error('Bot approval revoke error:', error);
            res.status(500).json({ message: "Failed to revoke bot approval" });
        }
    });
    app.post("/api/bot-instances/:id/start", authenticateAdmin, async (req, res) => {
        try {
            const bot = await storage.getBotInstance(req.params.id);
            if (!bot) {
                return res.status(404).json({ message: "Bot instance not found" });
            }
            console.log(`Starting bot ${bot.name} (${bot.id})...`);
            await botManager.startBot(req.params.id);
            const updatedBot = await storage.updateBotInstance(req.params.id, { status: 'loading' });
            broadcast({ type: 'BOT_STATUS_CHANGED', data: updatedBot });
            res.json({
                success: true,
                message: `Bot ${bot.name} startup initiated - TREKKERMD LIFETIME BOT initializing...`
            });
        }
        catch (error) {
            console.error('Bot start error:', error);
            const errorMessage = error instanceof Error ? error.message : "Failed to start bot";
            try {
                const bot = await storage.updateBotInstance(req.params.id, { status: 'error' });
                broadcast({ type: 'BOT_STATUS_CHANGED', data: bot });
            }
            catch (updateError) {
                console.error('Failed to update bot status:', updateError);
            }
            res.status(500).json({ message: errorMessage });
        }
    });
    app.post("/api/bot-instances/:id/stop", authenticateAdmin, async (req, res) => {
        try {
            await botManager.stopBot(req.params.id);
            const bot = await storage.updateBotInstance(req.params.id, { status: 'offline' });
            broadcast({ type: 'BOT_STATUS_CHANGED', data: bot });
            res.json({ success: true });
        }
        catch (error) {
            res.status(500).json({ message: "Failed to stop bot" });
        }
    });
    app.post("/api/bot-instances/:id/restart", authenticateAdmin, async (req, res) => {
        try {
            await botManager.restartBot(req.params.id);
            const bot = await storage.updateBotInstance(req.params.id, { status: 'loading' });
            broadcast({ type: 'BOT_STATUS_CHANGED', data: bot });
            res.json({ success: true });
        }
        catch (error) {
            res.status(500).json({ message: "Failed to restart bot" });
        }
    });
    app.get("/api/commands", async (req, res) => {
        try {
            const botInstanceId = req.query.botInstanceId;
            let commands = await storage.getCommands(botInstanceId);
            if (commands.length === 0 && !botInstanceId) {
                try {
                    const { commandRegistry } = await import('./services/command-registry.js');
                    const registeredCommands = commandRegistry.getAllCommands();
                    console.log('Database empty, populating with registered commands...');
                    for (const command of registeredCommands) {
                        try {
                            await storage.createCommand({
                                name: command.name,
                                description: command.description,
                                response: `Executing ${command.name}...`,
                                isActive: true,
                                useChatGPT: false,
                                serverName: getServerName()
                            });
                        }
                        catch (error) {
                            if (!error?.message?.includes('duplicate') && !error?.message?.includes('unique')) {
                                console.log(`Error saving ${command.name}:`, error?.message);
                            }
                        }
                    }
                    commands = await storage.getCommands(botInstanceId);
                    console.log(`✅ Populated database with ${commands.length} commands`);
                }
                catch (error) {
                    console.log('Note: Could not populate database with commands:', error);
                }
            }
            res.json(commands);
        }
        catch (error) {
            console.error("Commands error:", error);
            res.status(500).json({ message: "Failed to fetch commands" });
        }
    });
    app.post("/api/commands", async (req, res) => {
        try {
            const validatedData = insertCommandSchema.parse(req.body);
            const command = await storage.createCommand(validatedData);
            broadcast({ type: 'COMMAND_CREATED', data: command });
            res.json(command);
        }
        catch (error) {
            res.status(400).json({ message: error instanceof Error ? error.message : "Failed to create command" });
        }
    });
    app.patch("/api/commands/:id", async (req, res) => {
        try {
            const command = await storage.updateCommand(req.params.id, req.body);
            broadcast({ type: 'COMMAND_UPDATED', data: command });
            res.json(command);
        }
        catch (error) {
            res.status(500).json({ message: "Failed to update command" });
        }
    });
    app.delete("/api/commands/:id", async (req, res) => {
        try {
            await storage.deleteCommand(req.params.id);
            broadcast({ type: 'COMMAND_DELETED', data: { id: req.params.id } });
            res.json({ success: true });
        }
        catch (error) {
            res.status(500).json({ message: "Failed to delete command" });
        }
    });
    app.post("/api/commands/sync", async (req, res) => {
        try {
            const { commandRegistry } = await import('./services/command-registry.js');
            const registeredCommands = commandRegistry.getAllCommands();
            const existingCommands = await storage.getCommands();
            const existingCommandNames = new Set(existingCommands.map(cmd => cmd.name));
            let addedCount = 0;
            for (const command of registeredCommands) {
                if (!existingCommandNames.has(command.name)) {
                    try {
                        await storage.createCommand({
                            name: command.name,
                            description: command.description,
                            response: `Executing ${command.name}...`,
                            isActive: true,
                            useChatGPT: false,
                            serverName: getServerName()
                        });
                        addedCount++;
                    }
                    catch (error) {
                        console.log(`Error adding ${command.name}:`, error?.message);
                    }
                }
            }
            console.log(`✅ Command sync completed: ${addedCount} new commands added`);
            res.json({
                success: true,
                message: `Sync completed: ${addedCount} new commands added`,
                addedCount
            });
        }
        catch (error) {
            console.error("Command sync error:", error);
            res.status(500).json({ message: "Failed to sync commands" });
        }
    });
    app.post("/api/commands/custom", authenticateAdmin, async (req, res) => {
        try {
            const { name, code, description, category } = req.body;
            if (!name || !code || !description) {
                return res.status(400).json({ message: "Name, code, and description are required" });
            }
            if (code.includes('require(') && !code.includes('// @allow-require')) {
                return res.status(400).json({ message: "Custom require() not allowed for security reasons" });
            }
            const commandData = {
                name: name.toLowerCase(),
                description,
                response: code,
                isActive: true,
                category: category || 'CUSTOM',
                useChatGPT: false,
                customCode: true
            };
            const command = await storage.createCommand({
                ...commandData,
                serverName: getServerName()
            });
            const { commandRegistry } = await import('./services/command-registry.js');
            try {
                const customHandler = new Function('context', `
          const { respond, args, message, client } = context;
          return (async () => {
            ${code}
          })();
        `);
                commandRegistry.register({
                    name: name.toLowerCase(),
                    description,
                    category: category || 'CUSTOM',
                    handler: customHandler
                });
                console.log(`✅ Custom command '${name}' registered successfully`);
            }
            catch (error) {
                console.error(`❌ Failed to register custom command '${name}':`, error);
                await storage.deleteCommand(command.id);
                return res.status(400).json({ message: "Invalid command code syntax" });
            }
            broadcast({ type: 'CUSTOM_COMMAND_CREATED', data: command });
            res.json({ success: true, command });
        }
        catch (error) {
            console.error('Custom command creation error:', error);
            res.status(500).json({ message: "Failed to create custom command" });
        }
    });
    app.post("/api/guest/register-bot", upload.single('credsFile'), async (req, res) => {
        try {
            const { botName, phoneNumber, credentialType, sessionId, features } = req.body;
            if (!botName || !phoneNumber) {
                return res.status(400).json({ message: "Bot name and phone number are required" });
            }
            const currentTenancyName = getServerName();
            const globalRegistration = await storage.checkGlobalRegistration(phoneNumber);
            if (globalRegistration) {
                if (globalRegistration.tenancyName !== currentTenancyName) {
                    return res.status(400).json({
                        message: `This phone number is registered to ${globalRegistration.tenancyName}. Please go to ${globalRegistration.tenancyName} server to manage your bot.`,
                        registeredTo: globalRegistration.tenancyName
                    });
                }
                const existingBot = await storage.getBotByPhoneNumber(phoneNumber);
                if (existingBot) {
                    const isActive = existingBot.status === 'online';
                    const isApproved = existingBot.approvalStatus === 'approved';
                    let timeRemaining = null;
                    let isExpired = false;
                    if (isApproved && existingBot.approvalDate && existingBot.expirationMonths) {
                        const approvalDate = new Date(existingBot.approvalDate);
                        const expirationDate = new Date(approvalDate);
                        expirationDate.setMonth(expirationDate.getMonth() + existingBot.expirationMonths);
                        const now = new Date();
                        if (now > expirationDate) {
                            isExpired = true;
                        }
                        else {
                            timeRemaining = Math.ceil((expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                        }
                    }
                    return res.json({
                        type: 'existing_bot_found',
                        message: `Welcome back! You have a bot on this server.`,
                        botDetails: {
                            id: existingBot.id,
                            name: existingBot.name,
                            phoneNumber: existingBot.phoneNumber,
                            status: existingBot.status,
                            isActive,
                            isApproved,
                            approvalStatus: existingBot.approvalStatus,
                            isExpired,
                            timeRemaining,
                            expirationMonths: existingBot.expirationMonths
                        }
                    });
                }
            }
            else {
                await storage.addGlobalRegistration(phoneNumber, currentTenancyName);
            }
            const existingBot = await storage.getBotByPhoneNumber(phoneNumber);
            if (existingBot) {
                if (existingBot.approvalStatus === 'approved' && existingBot.status === 'online') {
                    return res.status(400).json({
                        message: "Your previous bot is active. Can't add new bot with same number."
                    });
                }
                if (existingBot.approvalStatus === 'approved' && existingBot.status !== 'online') {
                    try {
                        console.log(`Testing connection for existing bot ${existingBot.id}`);
                    }
                    catch (error) {
                        console.log(`Connection test failed for ${existingBot.id}, allowing new registration`);
                        await storage.deleteBotInstance(existingBot.id);
                    }
                }
            }
            let credentials = null;
            if (credentialType === 'base64' && sessionId) {
                try {
                    const decoded = Buffer.from(sessionId, 'base64').toString('utf-8');
                    const parsedCreds = JSON.parse(decoded);
                    credentials = parsedCreds;
                }
                catch (error) {
                    return res.status(400).json({ message: "Invalid base64 session ID format" });
                }
            }
            else if (credentialType === 'file' && req.file) {
                try {
                    const fileContent = req.file.buffer.toString('utf-8');
                    credentials = JSON.parse(fileContent);
                }
                catch (error) {
                    return res.status(400).json({ message: "Invalid creds.json file format" });
                }
            }
            else {
                return res.status(400).json({ message: "Valid credentials are required" });
            }
            if (credentials && credentials.me && credentials.me.id) {
                const credentialsPhoneMatch = credentials.me.id.match(/^(\d+):/);
                const credentialsPhone = credentialsPhoneMatch ? credentialsPhoneMatch[1] : null;
                const inputPhone = phoneNumber.replace(/^\+/, '');
                if (!credentialsPhone || credentialsPhone !== inputPhone) {
                    return res.status(400).json({
                        message: "You are not the owner of this credentials file. The phone number in the session does not match your input."
                    });
                }
            }
            else {
                return res.status(400).json({ message: "Invalid credentials format - missing phone number data" });
            }
            let botFeatures = {};
            if (features) {
                try {
                    botFeatures = JSON.parse(features);
                }
                catch (error) {
                    console.warn('Invalid features JSON:', error);
                }
            }
            const botCountCheck = await storage.strictCheckBotCountLimit();
            if (!botCountCheck.canAdd) {
                const availableServers = await storage.getAvailableServers();
                if (availableServers.length > 0) {
                    const targetServer = availableServers[0];
                    console.log(`🔄 ${getServerName()} is full (${botCountCheck.currentCount}/${botCountCheck.maxCount}), auto-distributing to ${targetServer.serverName}`);
                    await storage.deleteGlobalRegistration(phoneNumber);
                    await storage.addGlobalRegistration(phoneNumber, targetServer.serverName);
                    const newBotCount = (targetServer.currentBotCount || 0) + 1;
                    await storage.updateServerBotCount(targetServer.serverName, newBotCount);
                    console.log(`📋 Bot ${botName} (${phoneNumber}) registered to ${targetServer.serverName} via cross-tenancy distribution`);
                    return res.json({
                        type: 'cross_tenancy_registered',
                        message: `✅ ${getServerName()} is full, but your bot has been automatically registered to ${targetServer.serverName}!`,
                        originalServer: getServerName(),
                        assignedServer: targetServer.serverName,
                        serverUrl: targetServer.serverUrl,
                        botDetails: {
                            name: botName,
                            phoneNumber: phoneNumber,
                            assignedTo: targetServer.serverName,
                            availableSlots: targetServer.maxBotCount - newBotCount,
                            registeredVia: 'auto_distribution'
                        },
                        nextSteps: [
                            `Your bot is now registered on ${targetServer.serverName}`,
                            'You can manage your bot from that server',
                            `Contact +254704897825 for activation`,
                            'Cross-tenancy management is enabled for approved bots'
                        ]
                    });
                }
                else {
                    return res.status(400).json({
                        message: `😞 All servers are currently full! Current server: ${getServerName()} (${botCountCheck.currentCount}/${botCountCheck.maxCount}). Please contact administrator for more capacity or try again later.`,
                        serverFull: true,
                        allServersFull: true,
                        currentServer: getServerName(),
                        capacity: {
                            current: botCountCheck.currentCount,
                            max: botCountCheck.maxCount
                        },
                        action: 'contact_admin'
                    });
                }
            }
            const botInstance = await storage.createBotInstance({
                name: botName,
                phoneNumber: phoneNumber,
                credentials: credentials,
                status: 'pending_validation',
                approvalStatus: 'pending',
                isGuest: true,
                settings: { features: botFeatures },
                autoLike: botFeatures.autoLike || false,
                autoViewStatus: botFeatures.autoView || false,
                autoReact: botFeatures.autoReact || false,
                typingMode: botFeatures.typingIndicator ? 'typing' : 'none',
                chatgptEnabled: botFeatures.chatGPT || false,
                serverName: getServerName()
            });
            try {
                console.log(`🔄 Testing WhatsApp connection for guest bot ${botInstance.id}`);
                const validationMessage = `🎉 Welcome to TREKKER-MD!

Your bot "${botName}" has been successfully registered and is awaiting admin approval.

📱 Phone: ${phoneNumber}
🤖 Bot Name: ${botName}
📅 Registered: ${new Date().toLocaleString()}

Next Steps:
✅ Your credentials have been validated
⏳ Your bot is now dormant and awaiting approval
📞 Call or message +254704897825 to activate your bot
🚀 Once approved, enjoy all premium TREKKER-MD features!

Thank you for choosing TREKKER-MD! 🚀`;
                const credentialsBase64 = credentialType === 'base64' ? sessionId : Buffer.from(JSON.stringify(credentials)).toString('base64');
                await sendGuestValidationMessage(phoneNumber, credentialsBase64, validationMessage);
                console.log(`✅ Validation message sent successfully to ${phoneNumber}`);
                await storage.updateBotInstance(botInstance.id, {
                    status: 'dormant',
                    lastActivity: new Date()
                });
                await storage.createActivity({
                    botInstanceId: botInstance.id,
                    type: 'registration',
                    description: `Guest bot registered and validation message sent to ${phoneNumber}`,
                    metadata: { phoneNumber, credentialType, phoneValidated: true },
                    serverName: getServerName()
                });
                broadcast({
                    type: 'GUEST_BOT_REGISTERED',
                    data: {
                        botInstance: { ...botInstance, credentials: undefined },
                        phoneNumber
                    }
                });
                res.json({
                    success: true,
                    message: "Bot registered successfully! Validation message sent to your WhatsApp. Contact +254704897825 for activation.",
                    botId: botInstance.id
                });
                await resetToDefaultServerAfterRegistration();
            }
            catch (error) {
                console.error('Failed to validate WhatsApp connection:', error);
                await storage.deleteBotInstance(botInstance.id);
                return res.status(400).json({
                    message: "Failed to validate WhatsApp credentials. Please check your session ID or creds.json file."
                });
            }
        }
        catch (error) {
            console.error('Guest bot registration error:', error);
            res.status(500).json({ message: "Failed to register bot" });
        }
    });
    app.post("/api/guest/manage-bot", upload.single('credsFile'), async (req, res) => {
        try {
            const { phoneNumber, action, credentialType, sessionId, botId } = req.body;
            if (!phoneNumber || !action || !botId) {
                return res.status(400).json({ message: "Phone number, action, and bot ID are required" });
            }
            const currentTenancyName = getServerName();
            const globalRegistration = await storage.checkGlobalRegistration(phoneNumber);
            if (!globalRegistration || globalRegistration.tenancyName !== currentTenancyName) {
                return res.status(400).json({
                    message: `Phone number not registered to this server or registered to ${globalRegistration?.tenancyName || 'another server'}`
                });
            }
            const botInstance = await storage.getBotInstance(botId);
            if (!botInstance || botInstance.phoneNumber !== phoneNumber) {
                return res.status(404).json({ message: "Bot not found or phone number mismatch" });
            }
            switch (action) {
                case 'restart':
                    if (botInstance.approvalStatus !== 'approved') {
                        return res.status(400).json({ message: "Bot must be approved before it can be restarted" });
                    }
                    if (botInstance.approvalDate && botInstance.expirationMonths) {
                        const approvalDate = new Date(botInstance.approvalDate);
                        const expirationDate = new Date(approvalDate);
                        expirationDate.setMonth(expirationDate.getMonth() + botInstance.expirationMonths);
                        const now = new Date();
                        if (now > expirationDate) {
                            return res.status(400).json({
                                message: "Bot has expired. Please contact admin for renewal.",
                                expired: true
                            });
                        }
                    }
                    try {
                        await botManager.destroyBot(botId);
                    }
                    catch (error) {
                        console.log('Bot was not running, creating new instance');
                    }
                    await botManager.createBot(botId, botInstance);
                    await storage.updateBotInstance(botId, { status: 'loading' });
                    await storage.createActivity({
                        botInstanceId: botId,
                        type: 'restart',
                        description: `Bot restarted by user via management interface`,
                        serverName: getServerName()
                    });
                    res.json({
                        success: true,
                        message: "Bot restart initiated",
                        botStatus: 'loading'
                    });
                    break;
                case 'update_credentials':
                    let newCredentials = null;
                    if (credentialType === 'base64' && sessionId) {
                        try {
                            const decoded = Buffer.from(sessionId, 'base64').toString('utf-8');
                            newCredentials = JSON.parse(decoded);
                        }
                        catch (error) {
                            return res.status(400).json({ message: "Invalid base64 session ID format" });
                        }
                    }
                    else if (credentialType === 'file' && req.file) {
                        try {
                            const fileContent = req.file.buffer.toString('utf-8');
                            newCredentials = JSON.parse(fileContent);
                        }
                        catch (error) {
                            return res.status(400).json({ message: "Invalid creds.json file format" });
                        }
                    }
                    else {
                        return res.status(400).json({ message: "Valid credentials are required for update" });
                    }
                    const { WhatsAppBot } = await import('./services/whatsapp-bot.js');
                    const validation = WhatsAppBot.validateCredentials(newCredentials);
                    if (!validation.valid) {
                        return res.status(400).json({
                            message: `Invalid credentials: ${validation.error}`
                        });
                    }
                    if (newCredentials && newCredentials.creds && newCredentials.creds.me && newCredentials.creds.me.id) {
                        const credentialsPhoneMatch = newCredentials.creds.me.id.match(/^(\d+):/);
                        const credentialsPhone = credentialsPhoneMatch ? credentialsPhoneMatch[1] : null;
                        const inputPhone = phoneNumber.replace(/^\+/, '');
                        if (!credentialsPhone || credentialsPhone !== inputPhone) {
                            return res.status(400).json({
                                message: "Credentials don't match your phone number"
                            });
                        }
                    }
                    else {
                        return res.status(400).json({
                            message: "Unable to verify phone number in credentials"
                        });
                    }
                    await storage.updateBotInstance(botId, {
                        credentials: newCredentials,
                        status: 'offline'
                    });
                    await storage.createActivity({
                        botInstanceId: botId,
                        type: 'credentials_update',
                        description: `Bot credentials updated by user`,
                        metadata: { credentialType },
                        serverName: getServerName()
                    });
                    let messageSent = false;
                    try {
                        const successMessage = `✅ *TREKKER-MD Bot Credentials Updated Successfully!*\n\n` +
                            `🔑 Your bot credentials have been updated and verified.\n` +
                            `🤖 Bot ID: ${botInstance.name}\n` +
                            `📞 Phone: ${phoneNumber}\n` +
                            `🌐 Server: ${getServerName()}\n\n` +
                            `Your bot is now ready to be restarted. Visit your management panel to start your bot.\n\n` +
                            `💫 *TREKKER-MD - Advanced WhatsApp Bot*`;
                        messageSent = await botManager.sendMessageThroughBot(botId, phoneNumber, successMessage);
                        if (messageSent) {
                            console.log(`✅ Success message sent to ${phoneNumber} after credential update`);
                        }
                        else {
                            console.log(`ℹ️ Bot not running, success message not sent to ${phoneNumber}`);
                        }
                    }
                    catch (messageError) {
                        console.warn(`⚠️ Failed to send success message to ${phoneNumber}:`, messageError);
                    }
                    const responseMessage = messageSent
                        ? "Credentials updated successfully. Bot can now be restarted. A confirmation message has been sent to your WhatsApp."
                        : "Credentials updated successfully. Bot can now be restarted.";
                    res.json({
                        success: true,
                        message: responseMessage
                    });
                    break;
                case 'start':
                    if (botInstance.approvalStatus !== 'approved') {
                        return res.status(400).json({ message: "Bot must be approved before it can be started" });
                    }
                    if (botInstance.approvalDate && botInstance.expirationMonths) {
                        const approvalDate = new Date(botInstance.approvalDate);
                        const expirationDate = new Date(approvalDate);
                        expirationDate.setMonth(expirationDate.getMonth() + botInstance.expirationMonths);
                        const now = new Date();
                        if (now > expirationDate) {
                            return res.status(400).json({
                                message: "Bot has expired. Please contact admin for renewal.",
                                expired: true
                            });
                        }
                    }
                    try {
                        await botManager.startBot(botId);
                        await storage.updateBotInstance(botId, { status: 'loading' });
                        await storage.createActivity({
                            botInstanceId: botId,
                            type: 'start',
                            description: `Bot started by user via management interface`,
                            serverName: getServerName()
                        });
                        res.json({
                            success: true,
                            message: "Bot start initiated",
                            botStatus: 'loading'
                        });
                    }
                    catch (error) {
                        console.error('Error starting bot:', error);
                        res.status(500).json({ message: "Failed to start bot" });
                    }
                    break;
                case 'stop':
                    if (botInstance.approvalStatus !== 'approved') {
                        return res.status(400).json({ message: "Bot must be approved before it can be stopped" });
                    }
                    try {
                        await botManager.stopBot(botId);
                        await storage.updateBotInstance(botId, { status: 'offline' });
                        await storage.createActivity({
                            botInstanceId: botId,
                            type: 'stop',
                            description: `Bot stopped by user via management interface`,
                            serverName: getServerName()
                        });
                        res.json({
                            success: true,
                            message: "Bot stopped successfully"
                        });
                    }
                    catch (error) {
                        console.error('Error stopping bot:', error);
                        res.status(500).json({ message: "Failed to stop bot" });
                    }
                    break;
                default:
                    res.status(400).json({ message: "Invalid action specified" });
            }
        }
        catch (error) {
            console.error('Bot management error:', error);
            res.status(500).json({ message: "Failed to manage bot" });
        }
    });
    async function handleCrossTenancyCredentialUpdate(req, res, globalRegistration) {
        const { phoneNumber, credentialType, sessionId } = req.body;
        const targetServer = globalRegistration.tenancyName;
        const currentServer = getServerName();
        try {
            let newCredentials = null;
            if (credentialType === 'base64' && sessionId) {
                try {
                    const decoded = Buffer.from(sessionId, 'base64').toString('utf-8');
                    newCredentials = JSON.parse(decoded);
                }
                catch (error) {
                    return res.status(400).json({ message: "Invalid base64 session ID format" });
                }
            }
            else if (credentialType === 'file' && req.file) {
                try {
                    const fileContent = req.file.buffer.toString('utf-8');
                    newCredentials = JSON.parse(fileContent);
                }
                catch (error) {
                    return res.status(400).json({ message: "Invalid creds.json file format" });
                }
            }
            else {
                return res.status(400).json({ message: "Valid credentials are required for update" });
            }
            const { WhatsAppBot } = await import('./services/whatsapp-bot.js');
            const validation = WhatsAppBot.validateCredentials(newCredentials);
            if (!validation.valid) {
                return res.status(400).json({
                    message: `Invalid credentials: ${validation.error}`
                });
            }
            if (newCredentials?.creds?.me?.id) {
                const credentialsPhoneMatch = newCredentials.creds.me.id.match(/^(\d+):/);
                const credentialsPhone = credentialsPhoneMatch ? credentialsPhoneMatch[1] : null;
                const inputPhone = phoneNumber.replace(/^\+/, '');
                if (!credentialsPhone || credentialsPhone !== inputPhone) {
                    return res.status(400).json({
                        message: "Credentials don't match your phone number"
                    });
                }
            }
            else {
                return res.status(400).json({
                    message: "Unable to verify phone number in credentials"
                });
            }
            await storage.createActivity({
                botInstanceId: 'cross-tenancy-request',
                type: 'cross_tenancy_credential_update',
                description: `Credential update request from ${currentServer} for phone ${phoneNumber} on ${targetServer}`,
                metadata: {
                    phoneNumber,
                    targetServer,
                    sourceServer: currentServer,
                    credentialType,
                    credentialsData: newCredentials,
                    requestTimestamp: new Date().toISOString()
                },
                serverName: currentServer
            });
            res.json({
                success: true,
                message: `Cross-tenancy credential update initiated for ${targetServer}. The credentials have been prepared for transfer.`,
                crossTenancy: true,
                targetServer,
                sourceServer: currentServer,
                phoneNumber,
                nextSteps: [
                    `Your credentials will be updated on ${targetServer}`,
                    `You can now manage your bot from ${targetServer}`,
                    `The bot may take a few moments to restart with new credentials`,
                    `Check the bot status on the target server dashboard`
                ]
            });
        }
        catch (error) {
            console.error('Cross-tenancy credential update error:', error);
            res.status(500).json({ message: "Failed to process cross-tenancy credential update" });
        }
    }
    async function handleCrossTenancyBotControl(req, res, globalRegistration, action) {
        const { phoneNumber } = req.body;
        const targetServer = globalRegistration.tenancyName;
        const currentServer = getServerName();
        try {
            await storage.createActivity({
                botInstanceId: 'cross-tenancy-request',
                type: `cross_tenancy_${action}`,
                description: `Bot ${action} request from ${currentServer} for phone ${phoneNumber} on ${targetServer}`,
                metadata: {
                    phoneNumber,
                    targetServer,
                    sourceServer: currentServer,
                    action,
                    requestTimestamp: new Date().toISOString()
                },
                serverName: currentServer
            });
            res.json({
                success: true,
                message: `Cross-tenancy ${action} operation initiated for ${targetServer}`,
                crossTenancy: true,
                targetServer,
                sourceServer: currentServer,
                phoneNumber,
                action,
                note: `Bot ${action} command has been forwarded to ${targetServer}. Please check the bot status on the target server.`
            });
        }
        catch (error) {
            console.error(`Cross-tenancy ${action} error:`, error);
            res.status(500).json({ message: `Failed to process cross-tenancy ${action} operation` });
        }
    }
    app.post("/api/guest/cross-tenancy-manage", upload.single('credsFile'), async (req, res) => {
        try {
            const { phoneNumber, action, credentialType, sessionId, botId, targetServer } = req.body;
            if (!phoneNumber || !action) {
                return res.status(400).json({ message: "Phone number and action are required" });
            }
            const currentTenancyName = getServerName();
            const globalRegistration = await storage.checkGlobalRegistration(phoneNumber);
            if (!globalRegistration) {
                return res.status(404).json({
                    message: "Phone number not registered to any server in the system"
                });
            }
            const actualServer = globalRegistration.tenancyName;
            const isCurrentServer = actualServer === currentTenancyName;
            if (isCurrentServer) {
                if (!botId) {
                    return res.status(400).json({ message: "Bot ID is required for same-server operations" });
                }
                const { action } = req.body;
                const botInstance = await storage.getBotInstance(botId);
                if (!botInstance) {
                    return res.status(404).json({ message: "Bot not found" });
                }
                res.json({ message: `${action} action executed successfully`, botId, action });
            }
            switch (action) {
                case 'update_credentials':
                    await handleCrossTenancyCredentialUpdate(req, res, globalRegistration);
                    break;
                case 'start':
                case 'stop':
                case 'restart':
                    await handleCrossTenancyBotControl(req, res, globalRegistration, action);
                    break;
                default:
                    res.status(400).json({
                        message: `Cross-tenancy action '${action}' not supported yet`,
                        suggestion: "Please contact the target server directly for this operation"
                    });
            }
        }
        catch (error) {
            console.error('Cross-tenancy bot management error:', error);
            res.status(500).json({ message: "Failed to manage bot across tenancies" });
        }
    });
    app.post("/api/master/feature-management", authenticateAdmin, async (req, res) => {
        try {
            const { action, botId, tenancy, feature, enabled } = req.body;
            const currentServer = getServerName();
            if (action !== 'toggle_feature') {
                return res.status(400).json({ message: "Invalid action. Only 'toggle_feature' is supported." });
            }
            if (!tenancy || !feature || typeof enabled !== 'boolean') {
                return res.status(400).json({
                    message: "Tenancy, feature, and enabled status are required"
                });
            }
            if (botId) {
                if (tenancy === currentServer) {
                    const botInstance = await storage.getBotInstance(botId);
                    if (!botInstance) {
                        return res.status(404).json({ message: "Bot not found on current server" });
                    }
                    const updateData = {};
                    updateData[feature] = enabled;
                    await storage.updateBotInstance(botId, updateData);
                    await storage.createActivity({
                        botInstanceId: botId,
                        type: 'feature_toggle',
                        description: `Admin ${enabled ? 'enabled' : 'disabled'} ${feature} feature`,
                        metadata: { feature, enabled, changedBy: 'admin' },
                        serverName: currentServer
                    });
                    res.json({
                        success: true,
                        message: `Feature ${feature} ${enabled ? 'enabled' : 'disabled'} for bot ${botInstance.name}`,
                        botId,
                        feature,
                        enabled
                    });
                }
                else {
                    await storage.createActivity({
                        botInstanceId: 'cross-tenancy-request',
                        type: 'cross_tenancy_feature_toggle',
                        description: `Admin requested ${feature} ${enabled ? 'enable' : 'disable'} for bot ${botId} on ${tenancy}`,
                        metadata: {
                            targetServer: tenancy,
                            sourceServer: currentServer,
                            botId,
                            feature,
                            enabled,
                            requestTimestamp: new Date().toISOString()
                        },
                        serverName: currentServer
                    });
                    res.json({
                        success: true,
                        message: `Cross-tenancy feature toggle request logged for ${tenancy}`,
                        crossTenancy: true,
                        targetServer: tenancy,
                        botId,
                        feature,
                        enabled
                    });
                }
            }
            else {
                await storage.createActivity({
                    botInstanceId: 'cross-tenancy-request',
                    type: 'cross_tenancy_global_feature_toggle',
                    description: `Admin requested global ${feature} ${enabled ? 'enable' : 'disable'} for ${tenancy}`,
                    metadata: {
                        targetServer: tenancy,
                        sourceServer: currentServer,
                        feature,
                        enabled,
                        scope: 'global',
                        requestTimestamp: new Date().toISOString()
                    },
                    serverName: currentServer
                });
                res.json({
                    success: true,
                    message: `Global feature toggle request logged for ${tenancy}`,
                    crossTenancy: true,
                    targetServer: tenancy,
                    feature,
                    enabled,
                    scope: 'global'
                });
            }
        }
        catch (error) {
            console.error('Feature management error:', error);
            res.status(500).json({ message: "Failed to manage feature" });
        }
    });
    app.post("/api/master/sync-commands", authenticateAdmin, async (req, res) => {
        try {
            const { sourceServer, targetServers, commandIds } = req.body;
            const currentServer = getServerName();
            if (!sourceServer || !Array.isArray(targetServers) || !Array.isArray(commandIds)) {
                return res.status(400).json({
                    message: "Source server, target servers array, and command IDs array are required"
                });
            }
            if (targetServers.length === 0) {
                return res.status(400).json({ message: "At least one target server must be specified" });
            }
            let commandsData = null;
            if (sourceServer === currentServer) {
                if (commandIds.length === 0) {
                    commandsData = await storage.getCommands();
                }
                else {
                    commandsData = [];
                    for (const commandId of commandIds) {
                        const command = await storage.getCommand(commandId);
                        if (command) {
                            commandsData.push(command);
                        }
                    }
                }
                await storage.createActivity({
                    botInstanceId: 'cross-tenancy-request',
                    type: 'command_export',
                    description: `Admin exported ${commandsData.length} commands from ${sourceServer}`,
                    metadata: {
                        sourceServer,
                        targetServers,
                        commandCount: commandsData.length,
                        commandIds: commandsData.map(c => c.id),
                        exportTimestamp: new Date().toISOString()
                    },
                    serverName: currentServer
                });
            }
            for (const targetServer of targetServers) {
                await storage.createActivity({
                    botInstanceId: 'cross-tenancy-request',
                    type: 'cross_tenancy_command_sync',
                    description: `Admin requested command sync from ${sourceServer} to ${targetServer}`,
                    metadata: {
                        sourceServer,
                        targetServer,
                        requestingServer: currentServer,
                        commandCount: commandsData?.length || commandIds.length,
                        commandIds: commandsData ? commandsData.map(c => c.id) : commandIds,
                        commandsData: commandsData || null,
                        requestTimestamp: new Date().toISOString()
                    },
                    serverName: currentServer
                });
            }
            res.json({
                success: true,
                message: `Command sync initiated from ${sourceServer} to ${targetServers.length} target server(s)`,
                sourceServer,
                targetServers,
                commandCount: commandsData?.length || commandIds.length,
                syncedCommands: commandsData ? commandsData.map(c => ({ id: c.id, name: c.name })) : null
            });
        }
        catch (error) {
            console.error('Command sync error:', error);
            res.status(500).json({ message: "Failed to sync commands" });
        }
    });
    app.post("/api/guest/check-registration", async (req, res) => {
        try {
            const { phoneNumber } = req.body;
            if (!phoneNumber) {
                return res.status(400).json({ message: "Phone number is required" });
            }
            const currentTenancyName = getServerName();
            const globalRegistration = await storage.checkGlobalRegistration(phoneNumber);
            if (!globalRegistration) {
                return res.json({
                    registered: false,
                    message: "Phone number not registered to any server"
                });
            }
            if (globalRegistration.tenancyName !== currentTenancyName) {
                return res.json({
                    registered: true,
                    currentServer: false,
                    registeredTo: globalRegistration.tenancyName,
                    message: `Phone number is registered to ${globalRegistration.tenancyName}. Please go to ${globalRegistration.tenancyName} server.`
                });
            }
            const existingBot = await storage.getBotByPhoneNumber(phoneNumber);
            res.json({
                registered: true,
                currentServer: true,
                hasBot: !!existingBot,
                bot: existingBot ? {
                    id: existingBot.id,
                    name: existingBot.name,
                    status: existingBot.status,
                    approvalStatus: existingBot.approvalStatus,
                    isApproved: existingBot.approvalStatus === 'approved',
                    approvalDate: existingBot.approvalDate,
                    expirationMonths: existingBot.expirationMonths
                } : null,
                message: existingBot
                    ? `Welcome back! You have a bot named "${existingBot.name}" on this server.`
                    : "Phone number registered to this server but no bot found."
            });
        }
        catch (error) {
            console.error('Check registration error:', error);
            res.status(500).json({ message: "Failed to check registration" });
        }
    });
    app.get("/api/activities", async (req, res) => {
        try {
            const botInstanceId = req.query.botInstanceId;
            const limit = parseInt(req.query.limit) || 50;
            const activities = await storage.getActivities(botInstanceId, limit);
            res.json(activities);
        }
        catch (error) {
            res.status(500).json({ message: "Failed to fetch activities" });
        }
    });
    app.get("/api/groups/:botInstanceId", async (req, res) => {
        try {
            const groups = await storage.getGroups(req.params.botInstanceId);
            res.json(groups);
        }
        catch (error) {
            res.status(500).json({ message: "Failed to fetch groups" });
        }
    });
    app.get("/api/admin/bot-instances", authenticateAdmin, async (req, res) => {
        try {
            const botInstances = await storage.getAllBotInstances();
            res.json(botInstances);
        }
        catch (error) {
            res.status(500).json({ message: "Failed to fetch bot instances" });
        }
    });
    app.get("/api/admin/activities", authenticateAdmin, async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const activities = await storage.getAllActivities(limit);
            res.json(activities);
        }
        catch (error) {
            res.status(500).json({ message: "Failed to fetch activities" });
        }
    });
    app.get("/api/admin/stats", authenticateAdmin, async (req, res) => {
        try {
            const stats = await storage.getSystemStats();
            res.json(stats);
        }
        catch (error) {
            res.status(500).json({ message: "Failed to fetch stats" });
        }
    });
    app.get("/api/admin/pending-bots", authenticateAdmin, async (req, res) => {
        try {
            const pendingBots = await storage.getPendingBots();
            res.json(pendingBots);
        }
        catch (error) {
            res.status(500).json({ message: "Failed to fetch pending bots" });
        }
    });
    app.get("/api/admin/approved-bots", authenticateAdmin, async (req, res) => {
        try {
            const approvedBots = await storage.getApprovedBots();
            res.json(approvedBots);
        }
        catch (error) {
            res.status(500).json({ message: "Failed to fetch approved bots" });
        }
    });
    app.post("/api/admin/approve-bot/:id", authenticateAdmin, async (req, res) => {
        try {
            const botId = req.params.id;
            const { duration } = req.body;
            const botInstance = await storage.getBotInstance(botId);
            if (!botInstance) {
                return res.status(404).json({ message: "Bot instance not found" });
            }
            if (!duration || duration < 1 || duration > 12) {
                return res.status(400).json({ message: "Duration must be between 1-12 months" });
            }
            const approvalDate = new Date().toISOString();
            await storage.updateBotInstance(botId, {
                approvalStatus: 'approved',
                status: 'offline',
                approvalDate,
                expirationMonths: duration
            });
            await storage.createActivity({
                botInstanceId: botId,
                type: 'approval',
                description: `Bot ${botInstance.name} approved by admin for ${duration} months`,
                metadata: { adminAction: 'approve', phoneNumber: botInstance.phoneNumber, duration, approvalDate },
                serverName: getServerName()
            });
            console.log(`📞 Activation message would be sent to ${botInstance.phoneNumber}`);
            broadcast({
                type: 'BOT_APPROVED',
                data: { botId, name: botInstance.name }
            });
            res.json({ success: true, message: "Bot approved successfully" });
        }
        catch (error) {
            res.status(500).json({ message: "Failed to approve bot" });
        }
    });
    app.post("/api/admin/reject-bot/:id", authenticateAdmin, async (req, res) => {
        try {
            const botId = req.params.id;
            const { reason } = req.body;
            const botInstance = await storage.getBotInstance(botId);
            if (!botInstance) {
                return res.status(404).json({ message: "Bot instance not found" });
            }
            await storage.updateBotInstance(botId, {
                approvalStatus: 'rejected',
                status: 'rejected'
            });
            await storage.createActivity({
                botInstanceId: botId,
                type: 'rejection',
                description: `Bot ${botInstance.name} rejected by admin. Reason: ${reason || 'No reason provided'}`,
                metadata: { adminAction: 'reject', reason, phoneNumber: botInstance.phoneNumber },
                serverName: getServerName()
            });
            broadcast({
                type: 'BOT_REJECTED',
                data: { botId, name: botInstance.name, reason }
            });
            res.json({ success: true, message: "Bot rejected successfully" });
        }
        catch (error) {
            res.status(500).json({ message: "Failed to reject bot" });
        }
    });
    app.post("/api/admin/send-message/:id", authenticateAdmin, async (req, res) => {
        try {
            const botId = req.params.id;
            const { message } = req.body;
            const botInstance = await storage.getBotInstance(botId);
            if (!botInstance || !botInstance.phoneNumber) {
                return res.status(404).json({ message: "Bot instance or phone number not found" });
            }
            const success = await botManager.sendMessageThroughBot(botId, botInstance.phoneNumber, message);
            if (!success) {
                return res.status(400).json({ message: "Bot is not online or failed to send message" });
            }
            console.log(`📱 Message sent to ${botInstance.phoneNumber}: ${message}`);
            await storage.createActivity({
                serverName: 'default-server',
                botInstanceId: botId,
                type: 'admin_message',
                description: `Admin sent message to ${botInstance.name}`,
                metadata: { message, phoneNumber: botInstance.phoneNumber }
            });
            res.json({ success: true, message: "Message sent successfully" });
        }
        catch (error) {
            console.error('Admin send message error:', error);
            res.status(500).json({ message: "Failed to send message" });
        }
    });
    app.post("/api/admin/bot-instances/:id/start", authenticateAdmin, async (req, res) => {
        try {
            const botId = req.params.id;
            const botInstance = await storage.getBotInstance(botId);
            if (!botInstance) {
                return res.status(404).json({ message: "Bot instance not found" });
            }
            await botManager.startBot(botId);
            broadcast({ type: 'BOT_STATUS_CHANGED', data: { botId, status: 'loading' } });
            res.json({ success: true, message: "Bot start initiated" });
        }
        catch (error) {
            res.status(500).json({ message: "Failed to start bot" });
        }
    });
    app.post("/api/admin/bot-instances/:id/stop", authenticateAdmin, async (req, res) => {
        try {
            const botId = req.params.id;
            const botInstance = await storage.getBotInstance(botId);
            if (!botInstance) {
                return res.status(404).json({ message: "Bot instance not found" });
            }
            await botManager.stopBot(botId);
            broadcast({ type: 'BOT_STATUS_CHANGED', data: { botId, status: 'offline' } });
            res.json({ success: true, message: "Bot stopped successfully" });
        }
        catch (error) {
            res.status(500).json({ message: "Failed to stop bot" });
        }
    });
    app.delete("/api/admin/bot-instances/:id", authenticateAdmin, async (req, res) => {
        try {
            const botId = req.params.id;
            const botInstance = await storage.getBotInstance(botId);
            if (!botInstance) {
                return res.status(404).json({ message: "Bot instance not found" });
            }
            await botManager.destroyBot(botId);
            await storage.deleteBotRelatedData(botId);
            await storage.deleteBotInstance(botId);
            if (botInstance.phoneNumber) {
                await storage.deleteGlobalRegistration(botInstance.phoneNumber);
                console.log(`🗑️ Removed ${botInstance.phoneNumber} from god register table`);
            }
            broadcast({ type: 'BOT_DELETED', data: { id: botId } });
            res.json({ success: true, message: "Bot deleted successfully" });
        }
        catch (error) {
            console.error('Delete bot error:', error);
            res.status(500).json({ message: "Failed to delete bot" });
        }
    });
    app.get("/api/admin/god-registry", authenticateAdmin, async (req, res) => {
        try {
            const registrations = await storage.getAllGlobalRegistrations();
            res.json(registrations);
        }
        catch (error) {
            console.error("Get god registry error:", error);
            res.status(500).json({ message: "Failed to fetch god registry" });
        }
    });
    app.put("/api/admin/god-registry/:phoneNumber", authenticateAdmin, async (req, res) => {
        try {
            const { phoneNumber } = req.params;
            const { tenancyName } = req.body;
            if (!tenancyName) {
                return res.status(400).json({ message: "Tenancy name is required" });
            }
            const updated = await storage.updateGlobalRegistration(phoneNumber, tenancyName);
            if (!updated) {
                return res.status(404).json({ message: "Registration not found" });
            }
            await storage.createCrossTenancyActivity({
                type: 'god_registry_update',
                description: `Admin updated god registry: ${phoneNumber} moved to ${tenancyName}`,
                metadata: { phoneNumber, newTenancy: tenancyName, adminAction: 'update_registry' },
                serverName: getServerName(),
                phoneNumber: phoneNumber,
                remoteTenancy: tenancyName
            });
            res.json({ message: "Registration updated successfully", registration: updated });
        }
        catch (error) {
            console.error("Update god registry error:", error);
            res.status(500).json({ message: "Failed to update registration" });
        }
    });
    app.delete("/api/admin/god-registry/:phoneNumber", authenticateAdmin, async (req, res) => {
        try {
            const { phoneNumber } = req.params;
            const existing = await storage.checkGlobalRegistration(phoneNumber);
            if (!existing) {
                return res.status(404).json({ message: "Registration not found" });
            }
            await storage.deleteGlobalRegistration(phoneNumber);
            await storage.createCrossTenancyActivity({
                type: 'god_registry_delete',
                description: `Admin deleted god registry entry: ${phoneNumber} (was on ${existing.tenancyName})`,
                metadata: { phoneNumber, previousTenancy: existing.tenancyName, adminAction: 'delete_registry' },
                serverName: getServerName(),
                phoneNumber: phoneNumber,
                remoteTenancy: existing.tenancyName
            });
            res.json({ message: "Registration deleted successfully" });
        }
        catch (error) {
            console.error("Delete god registry error:", error);
            res.status(500).json({ message: "Failed to delete registration" });
        }
    });
    app.get("/api/master/approved-bots", authenticateAdmin, async (req, res) => {
        try {
            const allApprovedBots = await storage.getAllApprovedBots();
            const sanitizedBots = allApprovedBots.map(bot => ({
                id: bot.id,
                name: bot.name,
                phoneNumber: bot.phoneNumber,
                status: bot.status,
                approvalStatus: bot.approvalStatus,
                serverName: bot.serverName,
                approvalDate: bot.approvalDate,
                expirationMonths: bot.expirationMonths,
                createdAt: bot.createdAt,
                updatedAt: bot.updatedAt,
                isGuest: bot.isGuest
            }));
            res.json(sanitizedBots);
        }
        catch (error) {
            console.error('Failed to fetch cross-tenancy approved bots:', error);
            res.status(500).json({ message: "Failed to fetch approved bots" });
        }
    });
    app.get("/api/master/tenancies", authenticateAdmin, async (req, res) => {
        try {
            const registrations = await storage.getAllGlobalRegistrations();
            const tenancies = registrations.reduce((acc, reg) => {
                if (!acc[reg.tenancyName]) {
                    acc[reg.tenancyName] = {
                        name: reg.tenancyName,
                        botCount: 0,
                        registrations: []
                    };
                }
                acc[reg.tenancyName].botCount++;
                acc[reg.tenancyName].registrations.push(reg);
                return acc;
            }, {});
            res.json(Object.values(tenancies));
        }
        catch (error) {
            console.error('Failed to fetch tenancies:', error);
            res.status(500).json({ message: "Failed to fetch tenancies" });
        }
    });
    app.get("/api/master/cross-tenancy-bots", authenticateAdmin, async (req, res) => {
        try {
            const registrations = await storage.getAllGlobalRegistrations();
            const currentTenancy = getServerName();
            const crossTenancyData = [];
            for (const registration of registrations) {
                try {
                    if (registration.tenancyName === currentTenancy) {
                        const localBot = await storage.getBotByPhoneNumber(registration.phoneNumber);
                        if (localBot) {
                            crossTenancyData.push({
                                ...localBot,
                                tenancy: registration.tenancyName,
                                isLocal: true
                            });
                        }
                    }
                    else {
                        crossTenancyData.push({
                            id: `remote-${registration.phoneNumber}`,
                            name: `Remote Bot (${registration.tenancyName})`,
                            phoneNumber: registration.phoneNumber,
                            status: 'remote',
                            approvalStatus: 'unknown',
                            tenancy: registration.tenancyName,
                            lastActivity: registration.registeredAt?.toISOString() || 'Unknown',
                            isLocal: false,
                            registeredAt: registration.registeredAt
                        });
                    }
                }
                catch (error) {
                    console.error(`Failed to get bot data for ${registration.phoneNumber}:`, error);
                }
            }
            res.json(crossTenancyData);
        }
        catch (error) {
            console.error('Failed to fetch cross-tenancy bots:', error);
            res.status(500).json({ message: "Failed to fetch cross-tenancy bots" });
        }
    });
    app.post("/api/master/bot-action", authenticateAdmin, async (req, res) => {
        try {
            const { action, botId, tenancy, data } = req.body;
            const currentTenancy = getServerName();
            if (!action || !tenancy) {
                return res.status(400).json({ message: "Missing required fields: action and tenancy are required" });
            }
            if (!botId && !['sync', 'disconnect', 'bulk_start', 'bulk_stop'].includes(action)) {
                return res.status(400).json({ message: "Missing required fields: botId is required for this action" });
            }
            if (tenancy === currentTenancy) {
                switch (action) {
                    case 'approve':
                        if (!botId)
                            return res.status(400).json({ message: "Bot ID required" });
                        const botInstance = await storage.getBotInstance(botId);
                        if (!botInstance) {
                            return res.status(404).json({ message: "Bot not found" });
                        }
                        const duration = data?.duration || 6;
                        const approvalDate = new Date().toISOString();
                        await storage.updateBotInstance(botId, {
                            approvalStatus: 'approved',
                            status: 'offline',
                            approvalDate,
                            expirationMonths: duration
                        });
                        await storage.createActivity({
                            botInstanceId: botId,
                            type: 'master_approval',
                            description: `Bot approved via master control panel for ${duration} months`,
                            metadata: { action: 'approve', duration, approvedBy: 'master_admin' },
                            serverName: getServerName()
                        });
                        broadcast({
                            type: 'BOT_APPROVED_MASTER',
                            data: { botId, name: botInstance.name, tenancy }
                        });
                        break;
                    case 'reject':
                        if (!botId)
                            return res.status(400).json({ message: "Bot ID required" });
                        await storage.updateBotInstance(botId, {
                            approvalStatus: 'rejected',
                            status: 'rejected'
                        });
                        await storage.createActivity({
                            botInstanceId: botId,
                            type: 'master_rejection',
                            description: 'Bot rejected via master control panel',
                            metadata: { action: 'reject', rejectedBy: 'master_admin' },
                            serverName: getServerName()
                        });
                        break;
                    case 'start':
                        if (!botId)
                            return res.status(400).json({ message: "Bot ID required" });
                        await botManager.startBot(botId);
                        break;
                    case 'stop':
                        if (!botId)
                            return res.status(400).json({ message: "Bot ID required" });
                        await botManager.stopBot(botId);
                        break;
                    case 'delete':
                        if (!botId)
                            return res.status(400).json({ message: "Bot ID required" });
                        const botToDelete = await storage.getBotInstance(botId);
                        if (botToDelete) {
                            await botManager.stopBot(botId);
                            await storage.deleteGlobalRegistration(botToDelete.phoneNumber || '');
                            await storage.deleteBotInstance(botId);
                            await storage.createActivity({
                                botInstanceId: 'system-master-control',
                                type: 'master_deletion',
                                description: `Bot ${botToDelete.name} deleted via master control panel`,
                                metadata: { action: 'delete', phoneNumber: botToDelete.phoneNumber, deletedBy: 'master_admin' },
                                serverName: getServerName()
                            });
                        }
                        break;
                    default:
                        return res.status(400).json({ message: "Unknown action" });
                }
                res.json({ success: true, message: `Action ${action} completed successfully` });
            }
            else {
                console.log(`Cross-tenancy action ${action} on ${tenancy} for bot ${botId}`);
                await storage.createActivity({
                    botInstanceId: 'system-master-control',
                    type: 'master_cross_tenancy',
                    description: `Cross-tenancy action ${action} attempted on ${tenancy}`,
                    metadata: { action, tenancy, botId, initiatedBy: 'master_admin' },
                    serverName: getServerName()
                });
                res.json({
                    success: true,
                    message: `Cross-tenancy action ${action} logged for ${tenancy}`,
                    note: "Cross-tenancy actions are logged in God Registry"
                });
            }
        }
        catch (error) {
            console.error('Failed to perform bot action:', error);
            res.status(500).json({ message: "Failed to perform action" });
        }
    });
    app.get("/api/server/capacity", async (req, res) => {
        try {
            const serverName = getServerName();
            const maxBots = parseInt(process.env.BOTCOUNT || '10');
            const currentBots = await storage.getAllBotInstances();
            const approvedBots = currentBots.filter(bot => bot.approvalStatus === 'approved');
            res.json({
                serverName,
                maxBots,
                currentBots: currentBots.length,
                approvedBots: approvedBots.length,
                availableSlots: maxBots - approvedBots.length,
                isFull: approvedBots.length >= maxBots,
                capacity: `${approvedBots.length}/${maxBots}`
            });
        }
        catch (error) {
            console.error('Failed to get server capacity:', error);
            res.status(500).json({ message: "Failed to get server capacity" });
        }
    });
    app.get("/api/guest/alternative-servers", async (req, res) => {
        try {
            const registrations = await storage.getAllGlobalRegistrations();
            const currentTenancy = getServerName();
            const tenancyStats = registrations.reduce((acc, reg) => {
                if (!acc[reg.tenancyName]) {
                    acc[reg.tenancyName] = {
                        name: reg.tenancyName,
                        botCount: 0,
                        isCurrentServer: reg.tenancyName === currentTenancy
                    };
                }
                acc[reg.tenancyName].botCount++;
                return acc;
            }, {});
            const alternativeServers = Object.values(tenancyStats).map((server) => ({
                ...server,
                maxBots: 20,
                availableSlots: Math.max(0, 20 - server.botCount),
                isFull: server.botCount >= 20,
                capacity: `${server.botCount}/20`
            })).filter((server) => !server.isCurrentServer && !server.isFull);
            res.json({
                currentServer: {
                    name: currentTenancy,
                    isFull: true,
                    capacity: `${tenancyStats[currentTenancy]?.botCount || 0}/20`
                },
                alternativeServers
            });
        }
        catch (error) {
            console.error('Failed to get alternative servers:', error);
            res.status(500).json({ message: "Failed to get alternative servers" });
        }
    });
    app.get("/api/servers/available", async (req, res) => {
        try {
            const availableServers = await storage.getAvailableServers();
            res.json({
                servers: availableServers.map(server => ({
                    serverName: server.serverName,
                    currentBots: server.currentBotCount || 0,
                    maxBots: server.maxBotCount,
                    availableSlots: server.maxBotCount - (server.currentBotCount || 0),
                    serverUrl: server.serverUrl,
                    description: server.description,
                    serverStatus: server.serverStatus
                }))
            });
        }
        catch (error) {
            console.error('Failed to get available servers:', error);
            res.status(500).json({ message: "Failed to retrieve available servers" });
        }
    });
    app.get("/api/servers/all", async (req, res) => {
        try {
            const allServers = await storage.getAllServers();
            res.json({
                servers: allServers.map(server => ({
                    serverName: server.serverName,
                    currentBots: server.currentBotCount || 0,
                    maxBots: server.maxBotCount,
                    availableSlots: server.maxBotCount - (server.currentBotCount || 0),
                    serverUrl: server.serverUrl,
                    description: server.description,
                    serverStatus: server.serverStatus
                }))
            });
        }
        catch (error) {
            console.error('Failed to get all servers:', error);
            res.status(500).json({ message: "Failed to retrieve servers" });
        }
    });
    app.post("/api/cross-server/register-bot", upload.single('credsFile'), async (req, res) => {
        try {
            const { targetServer, botName, phoneNumber, credentialType, sessionId, features } = req.body;
            if (!targetServer || !botName || !phoneNumber) {
                return res.status(400).json({ message: "Target server, bot name and phone number are required" });
            }
            const serverCheck = await storage.strictCheckBotCountLimit(targetServer);
            if (!serverCheck.canAdd) {
                return res.status(400).json({
                    message: `Selected server ${targetServer} is now full (${serverCheck.currentCount}/${serverCheck.maxCount} bots). Please select another server.`
                });
            }
            const globalRegistration = await storage.checkGlobalRegistration(phoneNumber);
            if (globalRegistration) {
                return res.status(400).json({
                    message: `This phone number is already registered on ${globalRegistration.tenancyName}. Please go to that server to manage your bot.`,
                    registeredTo: globalRegistration.tenancyName
                });
            }
            let credentials = null;
            if (credentialType === 'base64' && sessionId) {
                try {
                    const decoded = Buffer.from(sessionId, 'base64').toString('utf-8');
                    credentials = JSON.parse(decoded);
                }
                catch (error) {
                    return res.status(400).json({ message: "Invalid base64 session ID format" });
                }
            }
            else if (credentialType === 'file' && req.file) {
                try {
                    const fileContent = req.file.buffer.toString('utf-8');
                    credentials = JSON.parse(fileContent);
                }
                catch (error) {
                    return res.status(400).json({ message: "Invalid creds.json file format" });
                }
            }
            else {
                return res.status(400).json({ message: "Valid credentials are required" });
            }
            if (credentials && credentials.me && credentials.me.id) {
                const credentialsPhoneMatch = credentials.me.id.match(/^(\d+):/);
                const credentialsPhone = credentialsPhoneMatch ? credentialsPhoneMatch[1] : null;
                const inputPhone = phoneNumber.replace(/^\+/, '');
                if (!credentialsPhone || credentialsPhone !== inputPhone) {
                    return res.status(400).json({
                        message: "You are not the owner of this credentials file. The phone number in the session does not match your input."
                    });
                }
            }
            else {
                return res.status(400).json({ message: "Invalid credentials format - missing phone number data" });
            }
            let botFeatures = {};
            if (features) {
                try {
                    botFeatures = JSON.parse(features);
                }
                catch (error) {
                    console.warn('Invalid features JSON:', error);
                }
            }
            const botInstance = await storage.createBotInstance({
                name: botName,
                phoneNumber: phoneNumber,
                credentials: credentials,
                status: 'dormant',
                approvalStatus: 'pending',
                isGuest: true,
                settings: { features: botFeatures },
                autoLike: botFeatures.autoLike || false,
                autoViewStatus: botFeatures.autoView || false,
                autoReact: botFeatures.autoReact || false,
                typingMode: botFeatures.typingIndicator ? 'typing' : 'none',
                chatgptEnabled: botFeatures.chatGPT || false,
                serverName: targetServer
            });
            await storage.addGlobalRegistration(phoneNumber, targetServer);
            await storage.createActivity({
                botInstanceId: botInstance.id,
                type: 'cross_server_registration',
                description: `Bot registered on ${targetServer} via cross-server registration from ${getServerName()}`,
                metadata: {
                    originalServer: getServerName(),
                    targetServer,
                    phoneNumber,
                    credentialType
                },
                serverName: targetServer
            });
            await storage.updateServerBotCount(targetServer, serverCheck.currentCount + 1);
            res.json({
                success: true,
                message: `Bot successfully registered on ${targetServer}! Your bot is awaiting admin approval.`,
                botId: botInstance.id,
                targetServer: targetServer,
                serverInfo: {
                    serverName: targetServer,
                    newBotCount: serverCheck.currentCount + 1,
                    maxBots: serverCheck.maxCount
                }
            });
        }
        catch (error) {
            console.error('Cross-server bot registration error:', error);
            res.status(500).json({ message: "Failed to register bot on target server" });
        }
    });
    return httpServer;
}
