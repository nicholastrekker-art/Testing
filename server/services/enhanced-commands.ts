import { commandRegistry, type CommandContext } from './command-registry.js';
import { storage } from '../storage.js';

// TREKKER-MD Essential Commands
console.log('✅ Enhanced commands loaded successfully');

// Owner Command
commandRegistry.register({
  name: 'owner',
  aliases: ['creator', 'dev'],
  description: 'Show bot owner and contact information',
  category: 'SYSTEM',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    
    const ownerMessage = `
*✅sᴇssɪᴏɴ ɪᴅ ɢᴇɴᴇʀᴀᴛᴇᴅ✅*
______________________________
╔════◇
║『 𝐘𝐎𝐔'𝐕𝐄 𝐂𝐇𝐎𝐒𝐄𝐍 TREKKER-MD LIFETIME BOT  』
╚══════════════╝
╔═════◇
║ 『••• 𝗩𝗶𝘀𝗶𝘁 𝗙𝗼𝗿 𝗛𝗲𝗹𝗽 •••』
║❒ TELEGRAM: https://t.me/trekkermd_
║❒ INSTAGRAM: https://www.instagram.com/nicholaso_tesla?igsh=eG5oNWVuNXF6eGU0
║📞 WhatsApp: +254704897825
║❒ PairSite: https://dc693d3f-99a0-4944-94cc-6b839418279c.e1-us-east-azure.choreoapps.dev/
║❒ 𝐖𝐚𝐂𝐡𝐚𝐧𝐧𝐞𝐥: https://whatsapp.com/channel/0029Vb6vpSv6WaKiG6ZIy73H
║ 💜💜💜
╚══════════════╝ 
 DM the owner only for lifetime TREKKER-MD bot __No expiry__
______________________________

Use the Quoted Session ID to Deploy your Bot.
❤️Support us donations keeps this services running❤️

Powered by TREKKER-MD....ultra fast bot.`;
    
    await respond(ownerMessage);
  }
});

// Ping Command
commandRegistry.register({
  name: 'ping',
  aliases: ['pong', 'speed'],
  description: 'Check bot response time and status',
  category: 'SYSTEM',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    
    const startTime = Date.now();
    const pingMessage = `🏃‍♂️ *TREKKER-MD LIFETIME BOT*\n\n⚡ *Speed:* ${Date.now() - startTime}ms\n🤖 *Status:* Online\n💚 *Health:* Perfect\n\n> Ultra fast response from TREKKER-MD`;
    
    await respond(pingMessage);
  }
});

// Add Custom Command - Admin Only
commandRegistry.register({
  name: 'addcmd',
  aliases: ['addcommand'],
  description: 'Add a custom command (Admin only)',
  category: 'ADMIN',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    
    await respond(`🔧 *Custom Command Management*\n\nTo add custom commands, please use the admin panel:\n\n🌐 Access your bot dashboard\n📝 Navigate to Command Management\n➕ Click 'Add New Command'\n📋 Paste your command code\n💾 Save and deploy\n\n> Commands added through the panel are automatically synced across all bot instances.`);
  }
});

// List Commands
commandRegistry.register({
  name: 'commands',
  aliases: ['cmdlist', 'help'],
  description: 'Show all available commands',
  category: 'SYSTEM',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    
    const allCommands = commandRegistry.getAllCommands();
    const categorizedCommands = commandRegistry.getCommandsByCategory();
    
    let commandsList = `*🤖 TREKKER-MD LIFETIME BOT COMMANDS*\n\n`;
    commandsList += `📊 *Total Commands:* ${allCommands.length}\n`;
    commandsList += `🔧 *Prefix:* .\n\n`;
    
    const sortedCategories = Object.keys(categorizedCommands).sort();
    
    for (const category of sortedCategories) {
      commandsList += `*╭━❮ ${category} ❯━╮*\n`;
      const sortedCommands = categorizedCommands[category].sort((a, b) => a.name.localeCompare(b.name));
      for (const command of sortedCommands) {
        commandsList += `┃✰ .${command.name}\n`;
      }
      commandsList += `╰─────────────━┈⊷\n\n`;
    }
    
    commandsList += `> Powered by TREKKER-MD Team`;
    
    await respond(commandsList);
  }
});

console.log('✅ TREKKER-MD essential commands loaded successfully');