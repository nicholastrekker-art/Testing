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

// Presence Help Command
commandRegistry.register({
  name: 'presencehelp',
  aliases: ['helpresence'],
  description: 'Show detailed help for presence modes',
  category: 'SETTINGS',
  handler: async (context: CommandContext) => {
    const { respond } = context;

    const helpText = `
👁️ *PRESENCE MODE GUIDE*

🎯 *What is Presence?*
Presence shows your bot's activity status in WhatsApp (typing, recording, online, etc.)

📋 *Available Modes:*

1️⃣ *typing* - Always show typing indicator
   • Updates every 10 seconds
   • Shows "typing..." in chats
   • Usage: .presence typing

2️⃣ *recording* - Always show recording indicator  
   • Updates every 10 seconds
   • Shows "recording..." in chats
   • Usage: .presence recording

3️⃣ *online* - Always show online status
   • Updates every 10 seconds
   • Shows green "online" indicator
   • Usage: .presence online

4️⃣ *autoswitch* - Alternate typing/recording
   • Switches every 10 seconds
   • Creates dynamic presence effect
   • Usage: .presence autoswitch

5️⃣ *none* - Disable all presence
   • No indicators shown
   • Bot appears offline
   • Usage: .presence none

⚙️ *Current Settings:*
Use .presence (no arguments) to view

🔄 *Apply Changes:*
After setting a mode, restart bot with .restart

💡 *Tips:*
• Restart bot after changing modes
• Changes persist across restarts
• Can change anytime

> Powered by TREKKERMD LIFETIME BOT`;

    await respond(helpText);
  }
});

// Presence Mode Command
commandRegistry.register({
  name: 'presence',
  aliases: ['presencemode', 'setonline'],
  description: 'Configure presence mode (typing, recording, online, auto-switch)',
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

      if (!mode) {
        const currentMode = bot.presenceMode || 'none';
        const autoSwitch = bot.presenceAutoSwitch ? 'Enabled ✅' : 'Disabled ❌';
        const alwaysOnline = bot.alwaysOnline ? 'Enabled ✅' : 'Disabled ❌';

        await respond(`👁️ *Presence Settings*\n\n📊 Current mode: ${currentMode}\n🔄 Auto-switch: ${autoSwitch}\n🟢 Always online: ${alwaysOnline}\n\n*Available modes:*\n• none - No presence indicator\n• typing - Always show typing (updates every 10s)\n• recording - Always show recording (updates every 10s)\n• online - Always show online (updates every 10s)\n• autoswitch - Switch between typing/recording (every 10s)\n\n*Usage:* .presence [mode]\n\n💡 Changes apply immediately, restart bot with .restart if needed.`);
        return;
      }

      const validModes = ['none', 'typing', 'recording', 'online', 'autoswitch'];
      if (!validModes.includes(mode)) {
        await respond('❌ Invalid mode! Use: none, typing, recording, online, or autoswitch');
        return;
      }

      // Update presence settings based on mode
      if (mode === 'autoswitch') {
        await storage.updateBotInstance(botId, { 
          presenceAutoSwitch: true,
          presenceMode: 'none',
          alwaysOnline: false
        });
        await respond('✅ *Auto-switch Enabled!*\n\n🔄 Bot will alternate between typing and recording every 10 seconds.\n⚠️ Restart bot with .restart for changes to take full effect.');
      } else if (mode === 'online') {
        await storage.updateBotInstance(botId, { 
          alwaysOnline: true,
          presenceAutoSwitch: false,
          presenceMode: 'none'
        });
        await respond('✅ *Always Online Enabled!*\n\n🟢 Bot will show as online continuously (updates every 10s).\n⚠️ Restart bot with .restart for changes to take full effect.');
      } else if (mode === 'none') {
        await storage.updateBotInstance(botId, { 
          presenceMode: 'none',
          presenceAutoSwitch: false,
          alwaysOnline: false
        });
        await respond('✅ *Presence Disabled!*\n\n👻 Bot will not show any presence indicator.\n⚠️ Restart bot with .restart for changes to take full effect.');
      } else {
        await storage.updateBotInstance(botId, { 
          presenceMode: mode,
          presenceAutoSwitch: false,
          alwaysOnline: false
        });
        await respond(`✅ *Presence Mode Set to ${mode.toUpperCase()}!*\n\n${mode === 'typing' ? '⌨️ Bot will continuously show typing indicator (updates every 10s).' : '🎤 Bot will continuously show recording indicator (updates every 10s).'}\n\n⚠️ Restart bot with .restart for changes to take full effect.`);
      }

      // Log the activity
      await storage.createActivity({
        serverName: bot.serverName,
        botInstanceId: botId,
        type: 'settings_change',
        description: `Presence mode changed to: ${mode}`,
        metadata: { mode }
      });

    } catch (error) {
      console.error('Error updating presence mode:', error);
      await respond('❌ Failed to update presence mode.');
    }
  }
});

// Typing Mode Command
commandRegistry.register({
  name: 'typing',
  aliases: ['typingmode', 'presencemode'],
  description: 'Configure typing/presence mode',
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

      if (!mode) {
        await respond(`⌨️ *Typing Mode*\n\n📊 Current mode: ${bot.typingMode}\n\n*Available modes:*\n• none - No indicator\n• typing - Always typing\n• recording - Always recording\n• both - Switch between both\n\n*Usage:* .typing [mode]`);
        return;
      }

      const validModes = ['none', 'typing', 'recording', 'both'];
      if (!validModes.includes(mode)) {
        await respond('❌ Invalid mode! Use: none, typing, recording, or both');
        return;
      }

      await storage.updateBotInstance(botId, { typingMode: mode });
      await respond(`✅ Typing mode set to: ${mode}`);

    } catch (error) {
      console.error('Error setting typing mode:', error);
      await respond('❌ Failed to set typing mode.');
    }
  }
});


console.log('✅ Settings management commands loaded successfully');