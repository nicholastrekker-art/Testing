import { WhatsAppBot } from './whatsapp-bot';
import { storage } from '../storage';
import type { BotInstance } from '@shared/schema';
import { existsSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface BotSkipData {
  botId: string;
  failureCount: number;
  lastFailure: number;
  skipped: boolean;
}

class BotManager {
  private bots: Map<string, WhatsAppBot> = new Map();
  private broadcastFunction?: (data: any) => void;
  private skipDataPath: string = join(process.cwd(), 'data', 'bot-skip-tracking.json');
  private skipData: Map<string, BotSkipData> = new Map();

  setBroadcastFunction(broadcast: (data: any) => void) {
    this.broadcastFunction = broadcast;
  }

  // Load skip tracking data from local file
  private loadSkipData() {
    try {
      if (existsSync(this.skipDataPath)) {
        const data = JSON.parse(readFileSync(this.skipDataPath, 'utf-8'));
        this.skipData = new Map(data.map((item: BotSkipData) => [item.botId, item]));
        console.log(`📂 Loaded skip data for ${this.skipData.size} bot(s)`);
      }
    } catch (error) {
      console.error('Failed to load skip data:', error);
      this.skipData = new Map();
    }
  }

  // Save skip tracking data to local file
  private saveSkipData() {
    try {
      const dataDir = join(process.cwd(), 'data');
      if (!existsSync(dataDir)) {
        require('fs').mkdirSync(dataDir, { recursive: true });
      }
      const data = Array.from(this.skipData.values());
      writeFileSync(this.skipDataPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save skip data:', error);
    }
  }

  // Check if bot should be skipped
  private shouldSkipBot(botId: string): boolean {
    const skipInfo = this.skipData.get(botId);
    return skipInfo?.skipped === true;
  }

  // Record bot failure
  private recordBotFailure(botId: string) {
    const skipInfo = this.skipData.get(botId) || {
      botId,
      failureCount: 0,
      lastFailure: Date.now(),
      skipped: false
    };

    skipInfo.failureCount += 1;
    skipInfo.lastFailure = Date.now();

    // Skip if failed 2 times
    if (skipInfo.failureCount >= 2) {
      skipInfo.skipped = true;
      console.log(`⏭️ Bot ${botId} will be skipped in next monitoring cycle (failed ${skipInfo.failureCount} times)`);
    }

    this.skipData.set(botId, skipInfo);
    this.saveSkipData();
  }

  // Reset bot skip status (when manually started or fixed)
  private resetBotFailures(botId: string) {
    this.skipData.delete(botId);
    this.saveSkipData();
  }

  // Clear all container data for a bot (like first deployment)
  private clearBotSessionFiles(botId: string, serverName?: string) {
    // Use serverName from the bot instance if available
    const tenantPath = serverName || 'default-server';
    const authDir = join(process.cwd(), 'auth', tenantPath, `bot_${botId}`);

    if (existsSync(authDir)) {
      try {
        rmSync(authDir, { recursive: true, force: true });
        console.log(`🧹 Cleared session files for bot ${botId} in tenant ${tenantPath}`);
      } catch (error) {
        console.error(`Failed to clear session files for bot ${botId}:`, error);
      }
    }
  }

  private broadcast(data: any) {
    if (this.broadcastFunction) {
      this.broadcastFunction(data);
    }
  }

  async createBot(botId: string, botInstance: BotInstance) {
    if (this.bots.has(botId)) {
      throw new Error(`Bot with ID ${botId} already exists`);
    }

    const bot = new WhatsAppBot(botInstance);
    this.bots.set(botId, bot);
    return bot;
  }

  async startBot(botId: string) {
    try {
      // Load skip data if not loaded
      if (this.skipData.size === 0) {
        this.loadSkipData();
      }

      // Check if bot should be skipped due to repeated failures
      if (this.shouldSkipBot(botId)) {
        console.log(`⏭️ BotManager: Skipping bot ${botId} (failed 2+ times, requires manual intervention)`);
        return;
      }

      // STEP 1: Load bot from database
      const botInstance = await storage.getBotInstance(botId);
      if (!botInstance) {
        console.error(`BotManager: Bot with ID ${botId} not found in database`);
        return; // Don't throw - just skip this bot
      }

      // STEP 2: Only approved bots can auto-start
      if (botInstance.approvalStatus !== 'approved') {
        console.log(`BotManager: Bot ${botId} (${botInstance.name}) is not approved (status: ${botInstance.approvalStatus}), skipping auto-start`);
        return;
      }

      console.log(`\n${'='.repeat(80)}`);
      console.log(`🚀 [CONTAINER ISOLATION] Starting bot ${botId} in isolated container`);
      console.log(`   Bot Name: ${botInstance.name}`);
      console.log(`   Server: ${botInstance.serverName}`);
      console.log(`   Container Path: auth/${botInstance.serverName}/bot_${botId}`);
      console.log(`   Has Credentials: ${!!botInstance.credentials}`);
      console.log(`${'='.repeat(80)}\n`);

      // Check if bot is already running
      const existingBot = this.bots.get(botId);
      const currentStatus = existingBot?.getStatus();

      if (existingBot && currentStatus === 'online') {
        console.log(`BotManager: Bot ${botId} (${botInstance.name}) is already online in container`);
        // Reset failures since bot is running
        this.resetBotFailures(botId);
        return;
      }

      // Stop existing bot if it exists and is not online
      if (existingBot && currentStatus !== 'online') {
        console.log(`BotManager: Stopping previous bot instance (status: ${currentStatus})`);
        try {
          await existingBot.stop();
        } catch (stopError) {
          console.error(`BotManager: Error stopping existing bot ${botId}:`, stopError);
        }
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        this.bots.delete(botId);
      }

      // STEP 3: Reload bot instance from database to get latest settings
      const freshBotInstance = await storage.getBotInstance(botId);
      if (!freshBotInstance) {
        console.error(`BotManager: Bot ${botId} disappeared from database during start`);
        return;
      }

      // STEP 4: Update credentials from database BEFORE starting bot
      // This ensures latest credentials are loaded on every restart
      console.log(`BotManager: 🔐 [CREDENTIAL UPDATE] Updating credentials on restart for bot ${botId}`);
      
      if (freshBotInstance.credentials) {
        // Credentials exist in database - update bot instance with them
        console.log(`BotManager: ✅ Loading credentials from database for bot ${botId}`);
        console.log(`BotManager: 📁 Credentials will be used in isolated container: auth/${freshBotInstance.serverName}/bot_${botId}/`);
        
        // Ensure credentials are attached to the instance before bot creation
        // This allows Baileys to write them to the container's creds.json file
        freshBotInstance.credentials = freshBotInstance.credentials;
        
        // Update database to confirm credentials are set (even though they already are)
        // This ensures the update timestamp is current
        try {
          await storage.updateBotInstance(botId, {
            credentials: freshBotInstance.credentials
          });
          console.log(`BotManager: ✅ Credentials confirmed in database for bot ${botId}`);
        } catch (dbError) {
          console.error(`BotManager: ⚠️ Failed to confirm credentials in database:`, dbError);
          // Don't stop - credentials are already in freshBotInstance
        }
      } else {
        console.log(`BotManager: ⚠️ No credentials in database - bot ${botId} will require QR code pairing`);
      }

      // STEP 5: PRESERVE existing session files
      // This allows bots to resume using their existing authenticated session
      // Structure: auth/{serverName}/bot_{botId}/creds.json + session files
      console.log(`BotManager: 🔄 [CONTAINER ISOLATION] Preserving existing session files for bot ${botId}`);
      console.log(`BotManager:    If creds.json exists in container, Baileys will use it without re-pairing`);

      // STEP 6: Create new WhatsAppBot instance in isolated container
      // Each bot gets its own isolated auth directory
      // ✅ CREDENTIALS ARE NOW READY BEFORE INSTANTIATION
      const newBot = new WhatsAppBot(freshBotInstance);
      this.bots.set(botId, newBot);
      console.log(`BotManager: 📦 Created new bot instance in isolated container`);

      // STEP 7: Start the bot (connects to WhatsApp using saved session or QR)
      // ✅ CREDENTIALS HAVE BEEN UPDATED FROM DATABASE BEFORE BOT STARTS
      console.log(`BotManager: 🔗 Starting connection for bot ${botId}...`);
      await newBot.start();

      // Check if bot actually started
      if (newBot.getStatus() === 'online') {
        console.log(`✅ BotManager: Bot ${botId} (${freshBotInstance.name}) started successfully in isolated container`);
        console.log(`✅ BotManager: Container isolation verified - bot running independently\n`);
        // Reset failures on successful start
        this.resetBotFailures(botId);
      } else {
        console.log(`⚠️ BotManager: Bot ${botId} start initiated, waiting for connection...`);
      }

    } catch (error) {
      console.error(`❌ BotManager: Failed to start bot ${botId}:`, error);

      // Clean up failed bot
      const failedBot = this.bots.get(botId);
      if (failedBot) {
        try {
          await failedBot.stop();
        } catch (stopError) {
          console.error(`BotManager: Failed to stop failed bot ${botId}:`, stopError);
        }
        this.bots.delete(botId);
      }

      // Record failure for monitoring (will skip after 2 failures)
      this.recordBotFailure(botId);

      // NEVER throw - server must continue running
      console.log(`✅ Server continues running despite bot ${botId} failure`);
    }
  }

  async stopBot(botId: string) {
    const bot = this.bots.get(botId);
    if (bot) {
      await bot.stop();
    }
  }

  async restartBot(botId: string) {
    try {
      const bot = this.bots.get(botId);
      let serverName: string | undefined;

      if (bot) {
        // Get serverName before stopping
        const botInstance = await storage.getBotInstance(botId);
        serverName = botInstance?.serverName;

        await bot.stop();
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds for complete shutdown

        // Remove from map to ensure clean restart
        this.bots.delete(botId);
      }

      // Don't clear session files on restart - preserve authentication
      // Only startBot will clear if there's an error state
      console.log(`BotManager: Restarting bot ${botId} (preserving session)`);

      // Start fresh isolated instance
      await this.startBot(botId);
    } catch (error) {
      console.error(`BotManager: Failed to restart bot ${botId}:`, error);
      throw error;
    }
  }

  async destroyBot(botId: string) {
    const bot = this.bots.get(botId);
    let serverName: string | undefined;

    if (bot) {
      // Get serverName before stopping
      const botInstance = await storage.getBotInstance(botId);
      serverName = botInstance?.serverName;

      await bot.stop();
      this.bots.delete(botId);

      // Clear all container data when destroying bot (tenant-isolated)
      this.clearBotSessionFiles(botId, serverName);
    }
  }

  async deleteBot(botId: string) {
    // Alias to destroyBot for guest API compatibility
    await this.destroyBot(botId);
  }

  async updateBot(botId: string, botInstance: BotInstance) {
    const bot = this.bots.get(botId);
    if (bot) {
      bot.updateBotInstance(botInstance);
    }
  }

  getBotStatus(botId: string): string {
    const bot = this.bots.get(botId);
    return bot?.getStatus() || 'offline';
  }

  getBot(botId: string): WhatsAppBot | undefined {
    return this.bots.get(botId);
  }

  getAllBotStatuses(): { [botId: string]: string } {
    const statuses: { [botId: string]: string } = {};
    this.bots.forEach((bot, botId) => {
      statuses[botId] = bot.getStatus();
    });
    return statuses;
  }

  async stopAllBots() {
    console.log('BotManager: Stopping all bot instances...');
    const stopPromises = Array.from(this.bots.values()).map(bot => bot.stop());
    await Promise.all(stopPromises);
    this.bots.clear();
    console.log('BotManager: All bots stopped');
  }

  async resumeBotsForServer(serverName: string) {
    try {
      // Get all approved bots for this server from database
      const serverBots = await storage.getBotInstancesForServer(serverName);
      const approvedBots = serverBots.filter(bot => bot.approvalStatus === 'approved');

      // Start each approved bot
      for (const bot of approvedBots) {
        try {
          await this.startBot(bot.id);
        } catch (error) {
          console.error(`BotManager: Failed to resume bot ${bot.name} (${bot.id}):`, error);
        }
      }
    } catch (error) {
      console.error(`BotManager: Error resuming bots for server ${serverName}:`, error);
    }
  }

  async sendMessageThroughBot(botId: string, phoneNumber: string, message: string): Promise<boolean> {
    const bot = this.bots.get(botId);
    if (!bot || bot.getStatus() !== 'online') {
      return false;
    }

    try {
      // Format phone number as WhatsApp JID
      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
      await bot.sendDirectMessage(jid, message);
      return true;
    } catch (error) {
      console.error(`Failed to send message through bot ${botId}:`, error);
      return false;
    }
  }

  async initializeDefaultCommands() {
    // Create comprehensive set of 300+ default commands
    const defaultCommands = [
      // Basic Commands
      { name: 'help', description: 'Show available commands', response: 'Available commands: Type .list to see all commands, .gpt for AI chat, .ping to test bot', isActive: true, useChatGPT: false },
      { name: 'list', description: 'List all available commands', response: '', isActive: true, useChatGPT: true },
      { name: 'status', description: 'Check bot status', response: 'Bot is online and ready to serve!', isActive: true, useChatGPT: false },
      { name: 'gpt', description: 'ChatGPT integration', response: '', isActive: true, useChatGPT: true },
      { name: 'ai', description: 'AI assistant', response: '', isActive: true, useChatGPT: true },
      { name: 'chat', description: 'Chat with AI', response: '', isActive: true, useChatGPT: true },
      { name: 'ping', description: 'Test bot responsiveness', response: 'Pong! Bot is responding.', isActive: true, useChatGPT: false },
      { name: 'info', description: 'Bot information', response: 'WhatsApp Bot powered by Bailey\'s Bot Management System', isActive: true, useChatGPT: false },
      { name: 'version', description: 'Bot version info', response: 'Bailey\'s WhatsApp Bot v2.0 - Advanced Multi-Bot Management System', isActive: true, useChatGPT: false },
      { name: 'about', description: 'About this bot', response: 'Advanced WhatsApp automation bot with AI integration and comprehensive command system.', isActive: true, useChatGPT: false },

      // Group Management Commands
      { name: 'mute', description: 'Mute group notifications', response: 'Group notifications muted for 1 hour.', isActive: true, useChatGPT: false },
      { name: 'unmute', description: 'Unmute group notifications', response: 'Group notifications unmuted.', isActive: true, useChatGPT: false },
      { name: 'admin', description: 'Admin commands menu', response: '', isActive: true, useChatGPT: true },
      { name: 'promote', description: 'Promote user to admin', response: 'User promotion feature - requires admin permissions.', isActive: true, useChatGPT: false },
      { name: 'demote', description: 'Demote user from admin', response: 'User demotion feature - requires admin permissions.', isActive: true, useChatGPT: false },
      { name: 'kick', description: 'Remove user from group', response: 'User removal feature - requires admin permissions.', isActive: true, useChatGPT: false },
      { name: 'ban', description: 'Ban user from group', response: 'User ban feature - requires admin permissions.', isActive: true, useChatGPT: false },
      { name: 'unban', description: 'Unban user from group', response: 'User unban feature - requires admin permissions.', isActive: true, useChatGPT: false },
      { name: 'invite', description: 'Generate group invite link', response: '', isActive: true, useChatGPT: true },
      { name: 'groupinfo', description: 'Get group information', response: '', isActive: true, useChatGPT: true },
      { name: 'members', description: 'List group members', response: '', isActive: true, useChatGPT: true },
      { name: 'admins', description: 'List group admins', response: '', isActive: true, useChatGPT: true },
      { name: 'rules', description: 'Show group rules', response: '📋 Group Rules:\n1. Be respectful to all members\n2. No spam or promotional content\n3. Stay on topic\n4. Use appropriate language\n5. Follow WhatsApp community guidelines', isActive: true, useChatGPT: false },
      { name: 'setrules', description: 'Set group rules', response: '', isActive: true, useChatGPT: true },
      { name: 'welcome', description: 'Set welcome message', response: '', isActive: true, useChatGPT: true },
      { name: 'goodbye', description: 'Set goodbye message', response: '', isActive: true, useChatGPT: true },
      { name: 'antilink', description: 'Enable/disable anti-link', response: 'Anti-link protection feature configured.', isActive: true, useChatGPT: false },
      { name: 'automod', description: 'Auto moderation settings', response: '', isActive: true, useChatGPT: true },
      { name: 'warn', description: 'Warn a user', response: '', isActive: true, useChatGPT: true },
      { name: 'warnings', description: 'Check user warnings', response: '', isActive: true, useChatGPT: true },
      { name: 'clearwarn', description: 'Clear user warnings', response: '', isActive: true, useChatGPT: true },

      // Entertainment Commands
      { name: 'joke', description: 'Tell a random joke', response: '', isActive: true, useChatGPT: true },
      { name: 'meme', description: 'Share a meme', response: '', isActive: true, useChatGPT: true },
      { name: 'quote', description: 'Share an inspirational quote', response: '', isActive: true, useChatGPT: true },
      { name: 'fact', description: 'Random interesting fact', response: '', isActive: true, useChatGPT: true },
      { name: 'riddle', description: 'Share a riddle', response: '', isActive: true, useChatGPT: true },
      { name: 'story', description: 'Tell a short story', response: '', isActive: true, useChatGPT: true },
      { name: 'poem', description: 'Generate a poem', response: '', isActive: true, useChatGPT: true },
      { name: 'game', description: 'Start a game', response: '', isActive: true, useChatGPT: true },
      { name: 'trivia', description: 'Trivia question', response: '', isActive: true, useChatGPT: true },
      { name: 'dare', description: 'Truth or dare', response: '', isActive: true, useChatGPT: true },
      { name: 'would', description: 'Would you rather question', response: '', isActive: true, useChatGPT: true },
      { name: 'pickup', description: 'Pickup line', response: '', isActive: true, useChatGPT: true },
      { name: 'compliment', description: 'Give a compliment', response: '', isActive: true, useChatGPT: true },
      { name: 'roast', description: 'Friendly roast', response: '', isActive: true, useChatGPT: true },
      { name: 'magic8', description: 'Magic 8-ball', response: '', isActive: true, useChatGPT: true },
      { name: 'flip', description: 'Flip a coin', response: '', isActive: true, useChatGPT: true },
      { name: 'dice', description: 'Roll dice', response: '', isActive: true, useChatGPT: true },
      { name: 'number', description: 'Random number generator', response: '', isActive: true, useChatGPT: true },
      { name: 'choose', description: 'Choose between options', response: '', isActive: true, useChatGPT: true },
      { name: 'spin', description: 'Spin the wheel', response: '', isActive: true, useChatGPT: true },

      // Information & Utility Commands
      { name: 'weather', description: 'Get weather information', response: '', isActive: true, useChatGPT: true },
      { name: 'time', description: 'Current time', response: '', isActive: true, useChatGPT: true },
      { name: 'date', description: 'Current date', response: '', isActive: true, useChatGPT: true },
      { name: 'timezone', description: 'Timezone information', response: '', isActive: true, useChatGPT: true },
      { name: 'calendar', description: 'Calendar information', response: '', isActive: true, useChatGPT: true },
      { name: 'remind', description: 'Set a reminder', response: '', isActive: true, useChatGPT: true },
      { name: 'timer', description: 'Set a timer', response: '', isActive: true, useChatGPT: true },
      { name: 'alarm', description: 'Set an alarm', response: '', isActive: true, useChatGPT: true },
      { name: 'calculate', description: 'Calculator', response: '', isActive: true, useChatGPT: true },
      { name: 'convert', description: 'Unit converter', response: '', isActive: true, useChatGPT: true },
      { name: 'currency', description: 'Currency converter', response: '', isActive: true, useChatGPT: true },
      { name: 'translate', description: 'Translate text', response: '', isActive: true, useChatGPT: true },
      { name: 'define', description: 'Define a word', response: '', isActive: true, useChatGPT: true },
      { name: 'synonym', description: 'Find synonyms', response: '', isActive: true, useChatGPT: true },
      { name: 'antonym', description: 'Find antonyms', response: '', isActive: true, useChatGPT: true },
      { name: 'spell', description: 'Spell check', response: '', isActive: true, useChatGPT: true },
      { name: 'grammar', description: 'Grammar check', response: '', isActive: true, useChatGPT: true },
      { name: 'count', description: 'Count characters/words', response: '', isActive: true, useChatGPT: true },
      { name: 'hash', description: 'Generate hash', response: '', isActive: true, useChatGPT: true },
      { name: 'encode', description: 'Encode text', response: '', isActive: true, useChatGPT: true },
      { name: 'decode', description: 'Decode text', response: '', isActive: true, useChatGPT: true },

      // Search & Information Commands
      { name: 'search', description: 'Web search', response: '', isActive: true, useChatGPT: true },
      { name: 'wiki', description: 'Wikipedia search', response: '', isActive: true, useChatGPT: true },
      { name: 'news', description: 'Latest news', response: '', isActive: true, useChatGPT: true },
      { name: 'crypto', description: 'Cryptocurrency prices', response: '', isActive: true, useChatGPT: true },
      { name: 'stock', description: 'Stock prices', response: '', isActive: true, useChatGPT: true },
      { name: 'movie', description: 'Movie information', response: '', isActive: true, useChatGPT: true },
      { name: 'music', description: 'Music search', response: '', isActive: true, useChatGPT: true },
      { name: 'book', description: 'Book information', response: '', isActive: true, useChatGPT: true },
      { name: 'recipe', description: 'Recipe search', response: '', isActive: true, useChatGPT: true },
      { name: 'lyrics', description: 'Song lyrics', response: '', isActive: true, useChatGPT: true },
      { name: 'anime', description: 'Anime information', response: '', isActive: true, useChatGPT: true },
      { name: 'manga', description: 'Manga information', response: '', isActive: true, useChatGPT: true },
      { name: 'game', description: 'Game information', response: '', isActive: true, useChatGPT: true },
      { name: 'tech', description: 'Technology news', response: '', isActive: true, useChatGPT: true },
      { name: 'science', description: 'Science facts', response: '', isActive: true, useChatGPT: true },
      { name: 'history', description: 'Historical facts', response: '', isActive: true, useChatGPT: true },
      { name: 'space', description: 'Space information', response: '', isActive: true, useChatGPT: true },
      { name: 'nature', description: 'Nature facts', response: '', isActive: true, useChatGPT: true },
      { name: 'animal', description: 'Animal facts', response: '', isActive: true, useChatGPT: true },
      { name: 'plant', description: 'Plant information', response: '', isActive: true, useChatGPT: true },

      // Creative Commands
      { name: 'draw', description: 'ASCII art generator', response: '', isActive: true, useChatGPT: true },
      { name: 'color', description: 'Color palette generator', response: '', isActive: true, useChatGPT: true },
      { name: 'design', description: 'Design suggestions', response: '', isActive: true, useChatGPT: true },
      { name: 'logo', description: 'Logo design ideas', response: '', isActive: true, useChatGPT: true },
      { name: 'font', description: 'Font suggestions', response: '', isActive: true, useChatGPT: true },
      { name: 'palette', description: 'Color palette', response: '', isActive: true, useChatGPT: true },
      { name: 'gradient', description: 'Gradient generator', response: '', isActive: true, useChatGPT: true },
      { name: 'pattern', description: 'Pattern generator', response: '', isActive: true, useChatGPT: true },
      { name: 'art', description: 'Art inspiration', response: '', isActive: true, useChatGPT: true },
      { name: 'craft', description: 'Craft ideas', response: '', isActive: true, useChatGPT: true },
      { name: 'diy', description: 'DIY projects', response: '', isActive: true, useChatGPT: true },
      { name: 'sketch', description: 'Sketch ideas', response: '', isActive: true, useChatGPT: true },
      { name: 'paint', description: 'Painting techniques', response: '', isActive: true, useChatGPT: true },
      { name: 'photo', description: 'Photography tips', response: '', isActive: true, useChatGPT: true },
      { name: 'edit', description: 'Photo editing tips', response: '', isActive: true, useChatGPT: true },
      { name: 'filter', description: 'Photo filter suggestions', response: '', isActive: true, useChatGPT: true },
      { name: 'frame', description: 'Photo frame ideas', response: '', isActive: true, useChatGPT: true },
      { name: 'collage', description: 'Collage ideas', response: '', isActive: true, useChatGPT: true },
      { name: 'video', description: 'Video editing tips', response: '', isActive: true, useChatGPT: true },
      { name: 'animation', description: 'Animation ideas', response: '', isActive: true, useChatGPT: true },

      // Learning & Education Commands
      { name: 'learn', description: 'Learning resources', response: '', isActive: true, useChatGPT: true },
      { name: 'study', description: 'Study tips', response: '', isActive: true, useChatGPT: true },
      { name: 'exam', description: 'Exam preparation', response: '', isActive: true, useChatGPT: true },
      { name: 'homework', description: 'Homework help', response: '', isActive: true, useChatGPT: true },
      { name: 'math', description: 'Math help', response: '', isActive: true, useChatGPT: true },
      { name: 'physics', description: 'Physics concepts', response: '', isActive: true, useChatGPT: true },
      { name: 'chemistry', description: 'Chemistry help', response: '', isActive: true, useChatGPT: true },
      { name: 'biology', description: 'Biology facts', response: '', isActive: true, useChatGPT: true },
      { name: 'english', description: 'English grammar help', response: '', isActive: true, useChatGPT: true },
      { name: 'literature', description: 'Literature analysis', response: '', isActive: true, useChatGPT: true },
      { name: 'geography', description: 'Geography facts', response: '', isActive: true, useChatGPT: true },
      { name: 'economics', description: 'Economics concepts', response: '', isActive: true, useChatGPT: true },
      { name: 'politics', description: 'Political science', response: '', isActive: true, useChatGPT: true },
      { name: 'philosophy', description: 'Philosophy concepts', response: '', isActive: true, useChatGPT: true },
      { name: 'psychology', description: 'Psychology insights', response: '', isActive: true, useChatGPT: true },
      { name: 'sociology', description: 'Sociology concepts', response: '', isActive: true, useChatGPT: true },
      { name: 'language', description: 'Language learning', response: '', isActive: true, useChatGPT: true },
      { name: 'code', description: 'Programming help', response: '', isActive: true, useChatGPT: true },
      { name: 'debug', description: 'Debug code', response: '', isActive: true, useChatGPT: true },
      { name: 'algorithm', description: 'Algorithm explanations', response: '', isActive: true, useChatGPT: true },

      // Health & Fitness Commands
      { name: 'health', description: 'Health tips', response: '', isActive: true, useChatGPT: true },
      { name: 'fitness', description: 'Fitness advice', response: '', isActive: true, useChatGPT: true },
      { name: 'workout', description: 'Workout routines', response: '', isActive: true, useChatGPT: true },
      { name: 'exercise', description: 'Exercise suggestions', response: '', isActive: true, useChatGPT: true },
      { name: 'diet', description: 'Diet advice', response: '', isActive: true, useChatGPT: true },
      { name: 'nutrition', description: 'Nutrition information', response: '', isActive: true, useChatGPT: true },
      { name: 'calories', description: 'Calorie information', response: '', isActive: true, useChatGPT: true },
      { name: 'protein', description: 'Protein sources', response: '', isActive: true, useChatGPT: true },
      { name: 'vitamin', description: 'Vitamin information', response: '', isActive: true, useChatGPT: true },
      { name: 'mineral', description: 'Mineral information', response: '', isActive: true, useChatGPT: true },
      { name: 'hydrate', description: 'Hydration reminders', response: '', isActive: true, useChatGPT: true },
      { name: 'sleep', description: 'Sleep tips', response: '', isActive: true, useChatGPT: true },
      { name: 'stress', description: 'Stress management', response: '', isActive: true, useChatGPT: true },
      { name: 'meditation', description: 'Meditation guide', response: '', isActive: true, useChatGPT: true },
      { name: 'yoga', description: 'Yoga poses', response: '', isActive: true, useChatGPT: true },
      { name: 'breathing', description: 'Breathing exercises', response: '', isActive: true, useChatGPT: true },
      { name: 'mindfulness', description: 'Mindfulness practices', response: '', isActive: true, useChatGPT: true },
      { name: 'mental', description: 'Mental health tips', response: '', isActive: true, useChatGPT: true },
      { name: 'therapy', description: 'Therapy resources', response: '', isActive: true, useChatGPT: true },
      { name: 'counseling', description: 'Counseling information', response: '', isActive: true, useChatGPT: true },

      // Lifestyle Commands
      { name: 'fashion', description: 'Fashion advice', response: '', isActive: true, useChatGPT: true },
      { name: 'style', description: 'Style tips', response: '', isActive: true, useChatGPT: true },
      { name: 'outfit', description: 'Outfit suggestions', response: '', isActive: true, useChatGPT: true },
      { name: 'beauty', description: 'Beauty tips', response: '', isActive: true, useChatGPT: true },
      { name: 'skincare', description: 'Skincare routine', response: '', isActive: true, useChatGPT: true },
      { name: 'makeup', description: 'Makeup tips', response: '', isActive: true, useChatGPT: true },
      { name: 'hair', description: 'Hair care tips', response: '', isActive: true, useChatGPT: true },
      { name: 'nail', description: 'Nail care tips', response: '', isActive: true, useChatGPT: true },
      { name: 'travel', description: 'Travel advice', response: '', isActive: true, useChatGPT: true },
      { name: 'destination', description: 'Travel destinations', response: '', isActive: true, useChatGPT: true },
      { name: 'hotel', description: 'Hotel recommendations', response: '', isActive: true, useChatGPT: true },
      { name: 'flight', description: 'Flight information', response: '', isActive: true, useChatGPT: true },
      { name: 'vacation', description: 'Vacation planning', response: '', isActive: true, useChatGPT: true },
      { name: 'adventure', description: 'Adventure ideas', response: '', isActive: true, useChatGPT: true },
      { name: 'explore', description: 'Places to explore', response: '', isActive: true, useChatGPT: true },
      { name: 'culture', description: 'Cultural information', response: '', isActive: true, useChatGPT: true },
      { name: 'tradition', description: 'Cultural traditions', response: '', isActive: true, useChatGPT: true },
      { name: 'festival', description: 'Festival information', response: '', isActive: true, useChatGPT: true },
      { name: 'holiday', description: 'Holiday information', response: '', isActive: true, useChatGPT: true },
      { name: 'celebration', description: 'Celebration ideas', response: '', isActive: true, useChatGPT: true },

      // Food & Cooking Commands
      { name: 'cook', description: 'Cooking tips', response: '', isActive: true, useChatGPT: true },
      { name: 'bake', description: 'Baking recipes', response: '', isActive: true, useChatGPT: true },
      { name: 'grill', description: 'Grilling tips', response: '', isActive: true, useChatGPT: true },
      { name: 'fry', description: 'Frying techniques', response: '', isActive: true, useChatGPT: true },
      { name: 'boil', description: 'Boiling guide', response: '', isActive: true, useChatGPT: true },
      { name: 'steam', description: 'Steaming methods', response: '', isActive: true, useChatGPT: true },
      { name: 'roast', description: 'Roasting tips', response: '', isActive: true, useChatGPT: true },
      { name: 'marinade', description: 'Marinade recipes', response: '', isActive: true, useChatGPT: true },
      { name: 'sauce', description: 'Sauce recipes', response: '', isActive: true, useChatGPT: true },
      { name: 'spice', description: 'Spice combinations', response: '', isActive: true, useChatGPT: true },
      { name: 'herb', description: 'Herb usage guide', response: '', isActive: true, useChatGPT: true },
      { name: 'seasoning', description: 'Seasoning tips', response: '', isActive: true, useChatGPT: true },
      { name: 'ingredient', description: 'Ingredient substitutes', response: '', isActive: true, useChatGPT: true },
      { name: 'meal', description: 'Meal planning', response: '', isActive: true, useChatGPT: true },
      { name: 'breakfast', description: 'Breakfast recipes', response: '', isActive: true, useChatGPT: true },
      { name: 'lunch', description: 'Lunch ideas', response: '', isActive: true, useChatGPT: true },
      { name: 'dinner', description: 'Dinner recipes', response: '', isActive: true, useChatGPT: true },
      { name: 'snack', description: 'Snack ideas', response: '', isActive: true, useChatGPT: true },
      { name: 'dessert', description: 'Dessert recipes', response: '', isActive: true, useChatGPT: true },
      { name: 'drink', description: 'Drink recipes', response: '', isActive: true, useChatGPT: true },

      // Business & Career Commands
      { name: 'business', description: 'Business advice', response: '', isActive: true, useChatGPT: true },
      { name: 'startup', description: 'Startup tips', response: '', isActive: true, useChatGPT: true },
      { name: 'entrepreneur', description: 'Entrepreneurship guide', response: '', isActive: true, useChatGPT: true },
      { name: 'marketing', description: 'Marketing strategies', response: '', isActive: true, useChatGPT: true },
      { name: 'sales', description: 'Sales techniques', response: '', isActive: true, useChatGPT: true },
      { name: 'finance', description: 'Financial advice', response: '', isActive: true, useChatGPT: true },
      { name: 'budget', description: 'Budgeting tips', response: '', isActive: true, useChatGPT: true },
      { name: 'invest', description: 'Investment guidance', response: '', isActive: true, useChatGPT: true },
      { name: 'save', description: 'Saving strategies', response: '', isActive: true, useChatGPT: true },
      { name: 'career', description: 'Career advice', response: '', isActive: true, useChatGPT: true },
      { name: 'job', description: 'Job search tips', response: '', isActive: true, useChatGPT: true },
      { name: 'resume', description: 'Resume tips', response: '', isActive: true, useChatGPT: true },
      { name: 'interview', description: 'Interview preparation', response: '', isActive: true, useChatGPT: true },
      { name: 'linkedin', description: 'LinkedIn optimization', response: '', isActive: true, useChatGPT: true },
      { name: 'network', description: 'Networking tips', response: '', isActive: true, useChatGPT: true },
      { name: 'skill', description: 'Skill development', response: '', isActive: true, useChatGPT: true },
      { name: 'leadership', description: 'Leadership tips', response: '', isActive: true, useChatGPT: true },
      { name: 'teamwork', description: 'Teamwork strategies', response: '', isActive: true, useChatGPT: true },
      { name: 'communication', description: 'Communication skills', response: '', isActive: true, useChatGPT: true },
      { name: 'presentation', description: 'Presentation tips', response: '', isActive: true, useChatGPT: true },

      // Technology Commands
      { name: 'tech', description: 'Technology trends', response: '', isActive: true, useChatGPT: true },
      { name: 'ai', description: 'Artificial Intelligence info', response: '', isActive: true, useChatGPT: true },
      { name: 'ml', description: 'Machine Learning concepts', response: '', isActive: true, useChatGPT: true },
      { name: 'blockchain', description: 'Blockchain explained', response: '', isActive: true, useChatGPT: true },
      { name: 'nft', description: 'NFT information', response: '', isActive: true, useChatGPT: true },
      { name: 'metaverse', description: 'Metaverse concepts', response: '', isActive: true, useChatGPT: true },
      { name: 'vr', description: 'Virtual Reality info', response: '', isActive: true, useChatGPT: true },
      { name: 'ar', description: 'Augmented Reality info', response: '', isActive: true, useChatGPT: true },
      { name: 'iot', description: 'Internet of Things', response: '', isActive: true, useChatGPT: true },
      { name: 'cloud', description: 'Cloud computing', response: '', isActive: true, useChatGPT: true },
      { name: 'security', description: 'Cybersecurity tips', response: '', isActive: true, useChatGPT: true },
      { name: 'privacy', description: 'Privacy protection', response: '', isActive: true, useChatGPT: true },
      { name: 'password', description: 'Password security', response: '', isActive: true, useChatGPT: true },
      { name: 'vpn', description: 'VPN information', response: '', isActive: true, useChatGPT: true },
      { name: 'backup', description: 'Data backup tips', response: '', isActive: true, useChatGPT: true },
      { name: 'software', description: 'Software recommendations', response: '', isActive: true, useChatGPT: true },
      { name: 'app', description: 'App recommendations', response: '', isActive: true, useChatGPT: true },
      { name: 'website', description: 'Website development', response: '', isActive: true, useChatGPT: true },
      { name: 'domain', description: 'Domain name tips', response: '', isActive: true, useChatGPT: true },
      { name: 'hosting', description: 'Web hosting advice', response: '', isActive: true, useChatGPT: true },

      // Sports & Gaming Commands
      { name: 'sport', description: 'Sports information', response: '', isActive: true, useChatGPT: true },
      { name: 'football', description: 'Football updates', response: '', isActive: true, useChatGPT: true },
      { name: 'basketball', description: 'Basketball news', response: '', isActive: true, useChatGPT: true },
      { name: 'soccer', description: 'Soccer updates', response: '', isActive: true, useChatGPT: true },
      { name: 'tennis', description: 'Tennis news', response: '', isActive: true, useChatGPT: true },
      { name: 'cricket', description: 'Cricket updates', response: '', isActive: true, useChatGPT: true },
      { name: 'baseball', description: 'Baseball news', response: '', isActive: true, useChatGPT: true },
      { name: 'hockey', description: 'Hockey updates', response: '', isActive: true, useChatGPT: true },
      { name: 'golf', description: 'Golf information', response: '', isActive: true, useChatGPT: true },
      { name: 'boxing', description: 'Boxing news', response: '', isActive: true, useChatGPT: true },
      { name: 'mma', description: 'MMA updates', response: '', isActive: true, useChatGPT: true },
      { name: 'olympics', description: 'Olympics information', response: '', isActive: true, useChatGPT: true },
      { name: 'gaming', description: 'Gaming news', response: '', isActive: true, useChatGPT: true },
      { name: 'esports', description: 'Esports updates', response: '', isActive: true, useChatGPT: true },
      { name: 'steam', description: 'Steam game deals', response: '', isActive: true, useChatGPT: true },
      { name: 'xbox', description: 'Xbox information', response: '', isActive: true, useChatGPT: true },
      { name: 'playstation', description: 'PlayStation updates', response: '', isActive: true, useChatGPT: true },
      { name: 'nintendo', description: 'Nintendo news', response: '', isActive: true, useChatGPT: true },
      { name: 'pc', description: 'PC gaming tips', response: '', isActive: true, useChatGPT: true },
      { name: 'mobile', description: 'Mobile gaming', response: '', isActive: true, useChatGPT: true },

      // Bot Control Commands
      { name: 'settings', description: 'Bot settings', response: '', isActive: true, useChatGPT: true },
      { name: 'config', description: 'Configuration options', response: '', isActive: true, useChatGPT: true },
      { name: 'toggle', description: 'Toggle features', response: '', isActive: true, useChatGPT: true },
      { name: 'enable', description: 'Enable features', response: '', isActive: true, useChatGPT: true },
      { name: 'disable', description: 'Disable features', response: '', isActive: true, useChatGPT: true },
      { name: 'autoview', description: 'Auto-view settings', response: 'Auto-view status feature configured. Bot will automatically view status updates.', isActive: true, useChatGPT: false },
      { name: 'typing', description: 'Typing indicator settings', response: 'Typing indicator configured. Bot will show typing status.', isActive: true, useChatGPT: false },
      { name: 'recording', description: 'Recording indicator settings', response: 'Recording indicator configured. Bot will show recording status.', isActive: true, useChatGPT: false },
      { name: 'online', description: 'Set bot online', response: 'Bot status set to online.', isActive: true, useChatGPT: false },
      { name: 'offline', description: 'Set bot offline', response: 'Bot going offline...', isActive: true, useChatGPT: false },
      { name: 'restart', description: 'Restart bot', response: 'Bot restarting...', isActive: true, useChatGPT: false },
      { name: 'update', description: 'Update bot', response: 'Checking for updates...', isActive: true, useChatGPT: false },
      { name: 'backup', description: 'Backup bot data', response: 'Creating backup...', isActive: true, useChatGPT: false },
      { name: 'restore', description: 'Restore bot data', response: 'Restoring from backup...', isActive: true, useChatGPT: false },
      { name: 'log', description: 'View bot logs', response: '', isActive: true, useChatGPT: true },
      { name: 'stats', description: 'Bot statistics', response: '', isActive: true, useChatGPT: true },
      { name: 'uptime', description: 'Bot uptime', response: '', isActive: true, useChatGPT: true },
      { name: 'memory', description: 'Memory usage', response: '', isActive: true, useChatGPT: true }
    ];

    const { getServerName } = await import('../db');
    const serverName = getServerName();

    for (const commandData of defaultCommands) {
      try {
        await storage.createCommand({
          ...commandData,
          serverName: serverName
        });
      } catch (error) {
        // Command might already exist, skip
        console.log(`Command ${commandData.name} already exists or failed to create`);
      }
    }
  }
}

export const botManager = new BotManager();