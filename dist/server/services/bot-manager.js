import { WhatsAppBot } from './whatsapp-bot.js';
import { storage } from '../storage.js';
class BotManager {
    bots = new Map();
    broadcastFunction;
    setBroadcastFunction(broadcast) {
        this.broadcastFunction = broadcast;
    }
    broadcast(data) {
        if (this.broadcastFunction) {
            this.broadcastFunction(data);
        }
    }
    async createBot(botId, botInstance) {
        if (this.bots.has(botId)) {
            throw new Error(`Bot with ID ${botId} already exists`);
        }
        const bot = new WhatsAppBot(botInstance);
        this.bots.set(botId, bot);
        return bot;
    }
    async startBot(botId) {
        try {
            console.log(`BotManager: Starting bot ${botId}...`);
            const existingBot = this.bots.get(botId);
            const currentStatus = existingBot?.getStatus();
            if (existingBot && currentStatus === 'online') {
                console.log(`BotManager: Bot ${botId} is already online, not restarting`);
                return;
            }
            const botInstance = await storage.getBotInstance(botId);
            if (!botInstance) {
                throw new Error(`Bot with ID ${botId} not found`);
            }
            if (existingBot && currentStatus === 'offline') {
                console.log(`BotManager: Stopping offline bot ${botId} before restart`);
                await existingBot.stop();
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            if (!existingBot || currentStatus === 'offline') {
                console.log(`BotManager: Creating new isolated bot instance for ${botId}`);
                const newBot = new WhatsAppBot(botInstance);
                this.bots.set(botId, newBot);
                await newBot.start();
                console.log(`BotManager: Bot ${botId} started successfully in isolated container`);
            }
            else {
                console.log(`BotManager: Bot ${botId} instance already exists and is healthy`);
            }
        }
        catch (error) {
            console.error(`BotManager: Failed to start bot ${botId}:`, error);
            const failedBot = this.bots.get(botId);
            if (failedBot) {
                try {
                    await failedBot.stop();
                }
                catch (stopError) {
                    console.error(`BotManager: Failed to stop failed bot ${botId}:`, stopError);
                }
                this.bots.delete(botId);
            }
            throw error;
        }
    }
    async stopBot(botId) {
        const bot = this.bots.get(botId);
        if (bot) {
            await bot.stop();
        }
    }
    async restartBot(botId) {
        try {
            console.log(`BotManager: Restarting bot ${botId}...`);
            const bot = this.bots.get(botId);
            if (bot) {
                console.log(`BotManager: Stopping bot ${botId} for restart`);
                await bot.stop();
                await new Promise(resolve => setTimeout(resolve, 3000));
                this.bots.delete(botId);
            }
            await this.startBot(botId);
            console.log(`BotManager: Bot ${botId} restarted successfully`);
        }
        catch (error) {
            console.error(`BotManager: Failed to restart bot ${botId}:`, error);
            throw error;
        }
    }
    async destroyBot(botId) {
        const bot = this.bots.get(botId);
        if (bot) {
            await bot.stop();
            this.bots.delete(botId);
        }
    }
    async updateBot(botId, botInstance) {
        const bot = this.bots.get(botId);
        if (bot) {
            bot.updateBotInstance(botInstance);
        }
    }
    getBotStatus(botId) {
        const bot = this.bots.get(botId);
        return bot?.getStatus() || 'offline';
    }
    getAllBotStatuses() {
        const statuses = {};
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
    async resumeBotsForServer(serverName) {
        console.log(`BotManager: Resuming bots for server: ${serverName}`);
        try {
            const serverBots = await storage.getBotInstancesForServer(serverName);
            const approvedBots = serverBots.filter(bot => bot.approvalStatus === 'approved');
            console.log(`BotManager: Found ${approvedBots.length} approved bots for server ${serverName}`);
            for (const bot of approvedBots) {
                try {
                    await this.startBot(bot.id);
                    console.log(`BotManager: Resumed bot ${bot.name} (${bot.id})`);
                }
                catch (error) {
                    console.error(`BotManager: Failed to resume bot ${bot.name} (${bot.id}):`, error);
                }
            }
            console.log(`BotManager: Finished resuming bots for server ${serverName}`);
        }
        catch (error) {
            console.error(`BotManager: Error resuming bots for server ${serverName}:`, error);
        }
    }
    async sendMessageThroughBot(botId, phoneNumber, message) {
        const bot = this.bots.get(botId);
        if (!bot || bot.getStatus() !== 'online') {
            return false;
        }
        try {
            const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
            await bot.sendDirectMessage(jid, message);
            return true;
        }
        catch (error) {
            console.error(`Failed to send message through bot ${botId}:`, error);
            return false;
        }
    }
    async initializeDefaultCommands() {
        const defaultCommands = [
            { name: 'help', description: 'Show available commands', response: 'Available commands: Type .list to see all commands, .gpt for AI chat, .ping to test bot', isActive: true, useChatGPT: false },
            { name: 'list', description: 'List all available commands', response: '', isActive: true, useChatGPT: true },
            { name: 'status', description: 'Check bot status', response: 'Bot is online and ready to serve!', isActive: true, useChatGPT: false },
            { name: 'gpt', description: 'ChatGPT integration', response: '', isActive: true, useChatGPT: true },
            { name: 'ai', description: 'AI assistant', response: '', isActive: true, useChatGPT: true },
            { name: 'chat', description: 'Chat with AI', response: '', isActive: true, useChatGPT: true },
            { name: 'ping', description: 'Test bot responsiveness', response: 'Pong! Bot is responding.', isActive: true, useChatGPT: false },
            { name: 'info', description: 'Bot information', response: 'WhatsApp Bot powered by Bailey\'s Bot Management System', isActive: true, useChatGPT: false },
            { name: 'version', description: 'Bot version info', response: 'Bailey\'s WhatsApp Bot v2.0 - Advanced Multi-Bot Management System', isActive: true, useChatGPT: false },
            { name: 'about', description: 'About this bot', response: 'Advanced WhatsApp automation bot with AI integration, auto-features, and comprehensive command system.', isActive: true, useChatGPT: false },
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
            { name: 'rules', description: 'Show group rules', response: '📋 Group Rules:\\n1. Be respectful to all members\\n2. No spam or promotional content\\n3. Stay on topic\\n4. Use appropriate language\\n5. Follow WhatsApp community guidelines', isActive: true, useChatGPT: false },
            { name: 'setrules', description: 'Set group rules', response: '', isActive: true, useChatGPT: true },
            { name: 'welcome', description: 'Set welcome message', response: '', isActive: true, useChatGPT: true },
            { name: 'goodbye', description: 'Set goodbye message', response: '', isActive: true, useChatGPT: true },
            { name: 'antilink', description: 'Enable/disable anti-link', response: 'Anti-link protection feature configured.', isActive: true, useChatGPT: false },
            { name: 'automod', description: 'Auto moderation settings', response: '', isActive: true, useChatGPT: true },
            { name: 'warn', description: 'Warn a user', response: '', isActive: true, useChatGPT: true },
            { name: 'warnings', description: 'Check user warnings', response: '', isActive: true, useChatGPT: true },
            { name: 'clearwarn', description: 'Clear user warnings', response: '', isActive: true, useChatGPT: true },
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
            { name: 'settings', description: 'Bot settings', response: '', isActive: true, useChatGPT: true },
            { name: 'config', description: 'Configuration options', response: '', isActive: true, useChatGPT: true },
            { name: 'toggle', description: 'Toggle features', response: '', isActive: true, useChatGPT: true },
            { name: 'enable', description: 'Enable features', response: '', isActive: true, useChatGPT: true },
            { name: 'disable', description: 'Disable features', response: '', isActive: true, useChatGPT: true },
            { name: 'autolike', description: 'Auto-like settings', response: 'Auto-like feature configured. Bot will automatically like status updates.', isActive: true, useChatGPT: false },
            { name: 'autoreact', description: 'Auto-react settings', response: 'Auto-react feature configured. Bot will automatically react to messages.', isActive: true, useChatGPT: false },
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
        const { getServerName } = await import('../db.js');
        const serverName = getServerName();
        for (const commandData of defaultCommands) {
            try {
                await storage.createCommand({
                    ...commandData,
                    serverName: serverName
                });
            }
            catch (error) {
                console.log(`Command ${commandData.name} already exists or failed to create`);
            }
        }
    }
}
export const botManager = new BotManager();
