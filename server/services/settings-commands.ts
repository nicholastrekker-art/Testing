
import { commandRegistry, type CommandContext } from './command-registry.js';
import { storage } from '../storage.js';

console.log('✅ Loading settings management commands...');

// Auto View Status Command
commandRegistry.register({
  name: 'autoview',
  aliases: ['viewstatus', 'autoviewstatus'],
  description: 'Toggle auto view status feature',
  category: 'SETTINGS',
  handler: async (context: CommandContext) => {
    const { respond, message, args, botId } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!botId) {
      await respond('❌ Bot ID not found.');
      return;
    }

    try {
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        await respond('❌ Bot not found.');
        return;
      }

      const command = args[0]?.toLowerCase();
      let newStatus: boolean;

      if (command === 'on' || command === 'enable') {
        newStatus = true;
      } else if (command === 'off' || command === 'disable') {
        newStatus = false;
      } else {
        const currentStatus = bot.autoViewStatus ? 'enabled' : 'disabled';
        await respond(`👁️ *Auto View Status*\n\n📊 Current status: ${currentStatus}\n\n*Usage:*\n.autoview on - Enable auto view\n.autoview off - Disable auto view`);
        return;
      }

      await storage.updateBotInstance(botId, { autoViewStatus: newStatus });
      await respond(`✅ *Auto View Status ${newStatus ? 'Enabled' : 'Disabled'}*\n\n👁️ Bot will ${newStatus ? 'now automatically view' : 'no longer view'} WhatsApp statuses.`);

    } catch (error) {
      console.error('Error toggling auto view:', error);
      await respond('❌ Failed to toggle auto view status.');
    }
  }
});

// Auto Read / Blue Ticks Command
commandRegistry.register({
  name: 'autoread',
  aliases: ['blueticks', 'readreceipt'],
  description: 'Toggle auto read receipts (blue ticks)',
  category: 'SETTINGS',
  handler: async (context: CommandContext) => {
    const { respond, message, args, botId } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!botId) {
      await respond('❌ Bot ID not found.');
      return;
    }

    try {
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        await respond('❌ Bot not found.');
        return;
      }

      const command = args[0]?.toLowerCase();
      const settings = bot.settings as any || {};
      let newStatus: boolean;

      if (command === 'on' || command === 'enable') {
        newStatus = true;
      } else if (command === 'off' || command === 'disable') {
        newStatus = false;
      } else {
        const currentStatus = settings.autoRead ? 'enabled' : 'disabled';
        await respond(`✓✓ *Auto Read Receipts*\n\n📊 Current status: ${currentStatus}\n\n*Usage:*\n.autoread on - Enable blue ticks\n.autoread off - Disable blue ticks`);
        return;
      }

      await storage.updateBotInstance(botId, { 
        settings: { ...settings, autoRead: newStatus }
      });
      await respond(`✅ *Auto Read ${newStatus ? 'Enabled' : 'Disabled'}*\n\n✓✓ Blue ticks are ${newStatus ? 'now enabled' : 'now disabled'}.`);

    } catch (error) {
      console.error('Error toggling auto read:', error);
      await respond('❌ Failed to toggle auto read receipts.');
    }
  }
});

// Restart Bot Command
commandRegistry.register({
  name: 'restart',
  aliases: ['reboot', 'reload'],
  description: 'Restart the bot',
  category: 'SETTINGS',
  handler: async (context: CommandContext) => {
    const { respond, message, botId } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!botId) {
      await respond('❌ Bot ID not found.');
      return;
    }

    try {
      await respond('🔄 *Restarting Bot...*\n\nPlease wait while the bot restarts.');
      
      const { botManager } = await import('./bot-manager.js');
      await botManager.restartBot(botId);

      setTimeout(async () => {
        await respond('✅ *Bot Restarted Successfully*\n\n🤖 Bot is now online and ready!');
      }, 3000);

    } catch (error) {
      console.error('Error restarting bot:', error);
      await respond('❌ Failed to restart bot.');
    }
  }
});

// Start Bot Command
commandRegistry.register({
  name: 'start',
  aliases: ['startbot', 'boton'],
  description: 'Start the bot if offline',
  category: 'SETTINGS',
  handler: async (context: CommandContext) => {
    const { respond, message, botId } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!botId) {
      await respond('❌ Bot ID not found.');
      return;
    }

    try {
      const { botManager } = await import('./bot-manager.js');
      const isRunning = botManager.isBotRunning(botId);

      if (isRunning) {
        await respond('✅ *Bot Already Running*\n\n🤖 Bot is already online!');
        return;
      }

      await respond('🚀 *Starting Bot...*\n\nPlease wait while the bot starts.');
      await botManager.startBot(botId);

      setTimeout(async () => {
        await respond('✅ *Bot Started Successfully*\n\n🤖 Bot is now online and ready!');
      }, 3000);

    } catch (error) {
      console.error('Error starting bot:', error);
      await respond('❌ Failed to start bot.');
    }
  }
});

// Presence Mode Command
commandRegistry.register({
  name: 'presence',
  aliases: ['presencemode', 'status'],
  description: 'Manage bot presence mode',
  category: 'SETTINGS',
  handler: async (context: CommandContext) => {
    const { respond, message, args, botId } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!botId) {
      await respond('❌ Bot ID not found.');
      return;
    }

    try {
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        await respond('❌ Bot not found.');
        return;
      }

      const mode = args[0]?.toLowerCase();
      const validModes = ['online', 'typing', 'recording', 'none'];

      if (!mode || !validModes.includes(mode)) {
        const currentMode = bot.presenceMode || 'none';
        await respond(`👁️ *Presence Mode*\n\n📊 Current mode: ${currentMode}\n\n*Available modes:*\n• online - Always online\n• typing - Always typing\n• recording - Always recording\n• none - No presence\n\n*Usage:* .presence <mode>`);
        return;
      }

      await storage.updateBotInstance(botId, { presenceMode: mode });
      await respond(`✅ *Presence Mode Updated*\n\n👁️ Mode set to: ${mode}\n\n> Bot presence updated successfully!`);

    } catch (error) {
      console.error('Error updating presence mode:', error);
      await respond('❌ Failed to update presence mode.');
    }
  }
});

// Auto React Command
commandRegistry.register({
  name: 'autoreact',
  aliases: ['autoemo', 'autoemoji'],
  description: 'Toggle auto react to messages',
  category: 'SETTINGS',
  handler: async (context: CommandContext) => {
    const { respond, message, args, botId } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!botId) {
      await respond('❌ Bot ID not found.');
      return;
    }

    try {
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        await respond('❌ Bot not found.');
        return;
      }

      const command = args[0]?.toLowerCase();
      let newStatus: boolean;

      if (command === 'on' || command === 'enable') {
        newStatus = true;
      } else if (command === 'off' || command === 'disable') {
        newStatus = false;
      } else {
        const currentStatus = bot.autoReact ? 'enabled' : 'disabled';
        await respond(`😊 *Auto React*\n\n📊 Current status: ${currentStatus}\n\n*Usage:*\n.autoreact on - Enable auto react\n.autoreact off - Disable auto react`);
        return;
      }

      // Auto-react is disabled by default and cannot be enabled
      await storage.updateBotInstance(botId, { autoReact: false });
      await respond(`❌ *Auto React Feature Disabled*\n\n⚠️ Auto-react feature is no longer available and remains disabled.`);

    } catch (error) {
      console.error('Error toggling auto react:', error);
      await respond('❌ Failed to toggle auto react.');
    }
  }
});

// Auto Like Command
commandRegistry.register({
  name: 'autolike',
  aliases: ['likeauto', 'autolikestatus'],
  description: 'Toggle auto like status updates',
  category: 'SETTINGS',
  handler: async (context: CommandContext) => {
    const { respond, message, args, botId } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!botId) {
      await respond('❌ Bot ID not found.');
      return;
    }

    try {
      const bot = await storage.getBotInstance(botId);
      if (!bot) {
        await respond('❌ Bot not found.');
        return;
      }

      const command = args[0]?.toLowerCase();
      let newStatus: boolean;

      if (command === 'on' || command === 'enable') {
        newStatus = true;
      } else if (command === 'off' || command === 'disable') {
        newStatus = false;
      } else {
        const currentStatus = bot.autoLike ? 'enabled' : 'disabled';
        await respond(`❤️ *Auto Like Status*\n\n📊 Current status: ${currentStatus}\n\n*Usage:*\n.autolike on - Enable auto like\n.autolike off - Disable auto like`);
        return;
      }

      // Auto-like is disabled by default and cannot be enabled
      await storage.updateBotInstance(botId, { autoLike: false });
      await respond(`❌ *Auto Like Feature Disabled*\n\n⚠️ Auto-like feature is no longer available and remains disabled.`);

    } catch (error) {
      console.error('Error toggling auto like:', error);
      await respond('❌ Failed to toggle auto like.');
    }
  }
});

console.log('✅ Settings management commands loaded successfully');
