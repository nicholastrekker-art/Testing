import { commandRegistry, type CommandContext } from './command-registry.js';
import { storage } from '../storage.js';
import { AutoStatusService } from './auto-status.js';

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
║❒ 𝐖a𝐂𝐡𝐚𝐧𝐧𝐞𝐥: https://whatsapp.com/channel/0029Vb6vpSv6WaKiG6ZIy73H
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

// Auto Status Command
commandRegistry.register({
  name: 'autostatus',
  aliases: ['statusview', 'autoview'],
  description: 'Manage auto status viewing and reactions',
  category: 'AUTOMATION',
  handler: async (context: CommandContext) => {
    const { respond, message, args, client } = context;

    // Check if sender is bot owner (from own number)
    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      // Get bot instance from the context (we'll need to find a way to pass this)
      // For now, we'll create a dummy autoStatus service
      // This will be properly integrated when we update the WhatsApp bot service

      const channelInfo = {
        contextInfo: {
          forwardingScore: 1,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: '120363161513685998@newsletter',
            newsletterName: 'TREKKER-MD LIFETIME BOT',
            serverMessageId: -1
          }
        }
      };

      // If no arguments, show current status
      if (!args || args.length === 0) {
        const statusMessage = `🔄 *Auto Status Settings*\n\n📱 *Auto Status View:* enabled/disabled\n💫 *Status Reactions:* enabled/disabled\n\n*Commands:*\n.autostatus on - Enable auto status view\n.autostatus off - Disable auto status view\n.autostatus react on - Enable status reactions\n.autostatus react off - Disable status reactions`;
        await respond(statusMessage);
        return;
      }

      // Handle on/off commands
      const command = args[0].toLowerCase();

      if (command === 'on') {
        await respond('✅ Auto status view has been enabled!\nBot will now automatically view all contact statuses.');
      } else if (command === 'off') {
        await respond('❌ Auto status view has been disabled!\nBot will no longer automatically view statuses.');
      } else if (command === 'react') {
        // Handle react subcommand
        if (!args[1]) {
          await respond('❌ Please specify on/off for reactions!\nUse: .autostatus react on/off');
          return;
        }

        const reactCommand = args[1].toLowerCase();
        if (reactCommand === 'on') {
          await respond('💫 Status reactions have been enabled!\nBot will now react to status updates.');
        } else if (reactCommand === 'off') {
          await respond('❌ Status reactions have been disabled!\nBot will no longer react to status updates.');
        } else {
          await respond('❌ Invalid reaction command! Use: .autostatus react on/off');
        }
      } else {
        await respond('❌ Invalid command! Use:\n.autostatus on/off - Enable/disable auto status view\n.autostatus react on/off - Enable/disable status reactions');
      }

    } catch (error) {
      console.error('Error in autostatus command:', error);
      await respond('❌ Error occurred while managing auto status!\n' + (error as Error).message);
    }
  }
});

// Anti ViewOnce Command
commandRegistry.register({
  name: 'antiviewonce',
  aliases: ['viewonce'],
  description: 'Intercept and save ViewOnce messages',
  category: 'AUTOMATION',
  handler: async (context: CommandContext) => {
    const { respond, message, args, client, from } = context;

    // Check if sender is bot owner (from own number)
    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      // This command works in both private chats and group chats
      // Remove the group-only restriction

      // Get group settings
      const chat = storage.getChat(from);

      // If no arguments, show current status
      if (!args || args.length === 0) {
        const statusMessage = `🔄 *Anti ViewOnce Settings*\n\n` +
          `👁️ *Status:* ${chat?.antiviewonce ? 'Enabled' : 'Disabled'}\n` +
          `\n*Commands:*\n` +
          `.antiviewonce on - Enable anti ViewOnce\n` +
          `.antiviewonce off - Disable anti ViewOnce`;
        await respond(statusMessage);
        return;
      }

      // Handle on/off commands
      const command = args[0].toLowerCase();

      if (command === 'on') {
        storage.updateChat(from, { antiviewonce: true });
        await respond('✅ Anti ViewOnce has been enabled!\nAll ViewOnce messages will now be intercepted and saved.');
      } else if (command === 'off') {
        storage.updateChat(from, { antiviewonce: false });
        await respond('❌ Anti ViewOnce has been disabled!\nViewOnce messages will no longer be intercepted.');
      } else {
        await respond('❌ Invalid command! Use: .antiviewonce on/off');
      }

    } catch (error) {
      console.error('Error in antiviewonce command:', error);
      await respond('❌ Error occurred while managing Anti ViewOnce!\n' + (error as Error).message);
    }
  }
});


// Group Management Commands
commandRegistry.register({
  name: 'promote',
  aliases: ['admin'],
  description: 'Promote user to admin (Group admin only)',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from } = context;

    // Check if it's a group chat
    if (!from.endsWith('@g.us')) {
      await respond('❌ This command can only be used in group chats!');
      return;
    }

    try {
      // Get quoted message or tagged user
      const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;

      if (!quotedUser && !quotedMessage) {
        await respond('❌ Please reply to a message or tag a user to promote!');
        return;
      }

      const userToPromote = quotedUser;

      // Get group metadata to check admin status
      const groupMetadata = await client.groupMetadata(from);
      const botNumber = client.user?.id.split(':')[0] + '@s.whatsapp.net';
      const senderNumber = message.key.participant || message.key.remoteJid;

      // Check if sender is admin
      const senderIsAdmin = groupMetadata.participants.find((p: any) => p.id === senderNumber)?.admin;
      if (!senderIsAdmin) {
        await respond('❌ Only group admins can promote users!');
        return;
      }

      // Check if bot is admin
      const botIsAdmin = groupMetadata.participants.find((p: any) => p.id === botNumber)?.admin;
      if (!botIsAdmin) {
        await respond('❌ Bot needs admin privileges to promote users!');
        return;
      }

      // Promote user
      await client.groupParticipantsUpdate(from, [userToPromote], 'promote');
      await respond(`✅ Successfully promoted @${userToPromote.split('@')[0]} to admin!`);

    } catch (error) {
      console.error('Error promoting user:', error);
      await respond('❌ Failed to promote user. Make sure I have admin privileges!');
    }
  }
});

commandRegistry.register({
  name: 'demote',
  aliases: ['unadmin'],
  description: 'Demote user from admin (Group admin only)',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from } = context;

    if (!from.endsWith('@g.us')) {
      await respond('❌ This command can only be used in group chats!');
      return;
    }

    try {
      const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;

      if (!quotedUser) {
        await respond('❌ Please reply to a message to demote the user!');
        return;
      }

      const groupMetadata = await client.groupMetadata(from);
      const botNumber = client.user?.id.split(':')[0] + '@s.whatsapp.net';
      const senderNumber = message.key.participant || message.key.remoteJid;

      const senderIsAdmin = groupMetadata.participants.find((p: any) => p.id === senderNumber)?.admin;
      if (!senderIsAdmin) {
        await respond('❌ Only group admins can demote users!');
        return;
      }

      const botIsAdmin = groupMetadata.participants.find((p: any) => p.id === botNumber)?.admin;
      if (!botIsAdmin) {
        await respond('❌ Bot needs admin privileges to demote users!');
        return;
      }

      await client.groupParticipantsUpdate(from, [quotedUser], 'demote');
      await respond(`✅ Successfully demoted @${quotedUser.split('@')[0]} from admin!`);

    } catch (error) {
      console.error('Error demoting user:', error);
      await respond('❌ Failed to demote user. Make sure I have admin privileges!');
    }
  }
});

commandRegistry.register({
  name: 'kick',
  aliases: ['remove'],
  description: 'Remove user from group (Group admin only)',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from } = context;

    if (!from.endsWith('@g.us')) {
      await respond('❌ This command can only be used in group chats!');
      return;
    }

    try {
      const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;

      if (!quotedUser) {
        await respond('❌ Please reply to a message to remove the user!');
        return;
      }

      const groupMetadata = await client.groupMetadata(from);
      const botNumber = client.user?.id.split(':')[0] + '@s.whatsapp.net';
      const senderNumber = message.key.participant || message.key.remoteJid;

      const senderIsAdmin = groupMetadata.participants.find((p: any) => p.id === senderNumber)?.admin;
      if (!senderIsAdmin) {
        await respond('❌ Only group admins can remove users!');
        return;
      }

      const botIsAdmin = groupMetadata.participants.find((p: any) => p.id === botNumber)?.admin;
      if (!botIsAdmin) {
        await respond('❌ Bot needs admin privileges to remove users!');
        return;
      }

      await client.groupParticipantsUpdate(from, [quotedUser], 'remove');
      await respond(`✅ Successfully removed @${quotedUser.split('@')[0]} from the group!`);

    } catch (error) {
      console.error('Error removing user:', error);
      await respond('❌ Failed to remove user. Make sure I have admin privileges!');
    }
  }
});

commandRegistry.register({
  name: 'tagall',
  aliases: ['everyone', 'all'],
  description: 'Tag all group members (Group admin only)',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from, args } = context;

    if (!from.endsWith('@g.us')) {
      await respond('❌ This command can only be used in group chats!');
      return;
    }

    try {
      const groupMetadata = await client.groupMetadata(from);
      const senderNumber = message.key.participant || message.key.remoteJid;

      const senderIsAdmin = groupMetadata.participants.find((p: any) => p.id === senderNumber)?.admin;
      if (!senderIsAdmin) {
        await respond('❌ Only group admins can tag everyone!');
        return;
      }

      const participants = groupMetadata.participants.map((p: any) => p.id);
      const messageText = args.length > 0 ? args.join(' ') : 'Group announcement';

      let tagMessage = `📢 *${messageText}*\n\n`;
      participants.forEach((participant: any, index: number) => {
        tagMessage += `${index + 1}. @${participant.split('@')[0]}\n`;
      });

      await client.sendMessage(from, {
        text: tagMessage,
        mentions: participants
      });

    } catch (error) {
      console.error('Error tagging all:', error);
      await respond('❌ Failed to tag all members!');
    }
  }
});

commandRegistry.register({
  name: 'groupinfo',
  aliases: ['ginfo'],
  description: 'Get group information',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, client, from } = context;

    if (!from.endsWith('@g.us')) {
      await respond('❌ This command can only be used in group chats!');
      return;
    }

    try {
      const groupMetadata = await client.groupMetadata(from);
      const adminCount = groupMetadata.participants.filter((p: any) => p.admin).length;
      const memberCount = groupMetadata.participants.length;

      const groupInfo = `📋 *Group Information*\n\n` +
        `🏷️ *Name:* ${groupMetadata.subject}\n` +
        `📝 *Description:* ${groupMetadata.desc || 'No description'}\n` +
        `👥 *Total Members:* ${memberCount}\n` +
        `👑 *Admins:* ${adminCount}\n` +
        `📅 *Created:* ${new Date(groupMetadata.creation * 1000).toDateString()}\n` +
        `🆔 *Group ID:* ${from}`;

      await respond(groupInfo);

    } catch (error) {
      console.error('Error getting group info:', error);
      await respond('❌ Failed to get group information!');
    }
  }
});

commandRegistry.register({
  name: 'invite',
  aliases: ['link'],
  description: 'Generate group invite link (Group admin only)',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from } = context;

    if (!from.endsWith('@g.us')) {
      await respond('❌ This command can only be used in group chats!');
      return;
    }

    try {
      const groupMetadata = await client.groupMetadata(from);
      const senderNumber = message.key.participant || message.key.remoteJid;

      const senderIsAdmin = groupMetadata.participants.find((p: any) => p.id === senderNumber)?.admin;
      if (!senderIsAdmin) {
        await respond('❌ Only group admins can generate invite links!');
        return;
      }

      const inviteCode = await client.groupInviteCode(from);
      const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;

      await respond(`🔗 *Group Invite Link*\n\n${inviteLink}\n\n⚠️ Share this link carefully!`);

    } catch (error) {
      console.error('Error generating invite link:', error);
      await respond('❌ Failed to generate invite link! Make sure I have admin privileges.');
    }
  }
});

console.log('✅ TREKKER-MD essential commands loaded successfully');