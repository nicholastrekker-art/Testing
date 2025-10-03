
import { commandRegistry, type CommandContext } from './command-registry.js';

// Privacy Management Commands
console.log('✅ Loading privacy management commands...');

// Block User Command
commandRegistry.register({
  name: 'block',
  aliases: ['blockuser', 'blk'],
  description: 'Block a user (Owner only)',
  category: 'PRIVACY',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
      const mentionedUsers = message.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      
      let targetUser = quotedUser || (mentionedUsers && mentionedUsers[0]);

      if (!targetUser) {
        if (!from.includes('@g.us')) {
          targetUser = from;
        } else {
          await respond('❌ Please reply to a message or tag a user to block!');
          return;
        }
      }

      await client.updateBlockStatus(targetUser, 'block');
      await respond(`🚫 *User Blocked*\n\n👤 @${targetUser.split('@')[0]} has been blocked successfully!\n\n⚠️ They will no longer be able to message this bot.`);

    } catch (error) {
      console.error('Error blocking user:', error);
      await respond('❌ Failed to block user. Please try again.');
    }
  }
});

// Unblock User Command
commandRegistry.register({
  name: 'unblock',
  aliases: ['unblockuser', 'ublk'],
  description: 'Unblock a user (Owner only)',
  category: 'PRIVACY',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
      const mentionedUsers = message.message?.extendedTextMessage?.contextInfo?.mentionedJid;
      
      let targetUser = quotedUser || (mentionedUsers && mentionedUsers[0]);

      if (!targetUser) {
        if (!from.includes('@g.us')) {
          targetUser = from;
        } else {
          await respond('❌ Please reply to a message or tag a user to unblock!');
          return;
        }
      }

      await client.updateBlockStatus(targetUser, 'unblock');
      await respond(`✅ *User Unblocked*\n\n👤 @${targetUser.split('@')[0]} has been unblocked successfully!\n\n💬 They can now message this bot again.`);

    } catch (error) {
      console.error('Error unblocking user:', error);
      await respond('❌ Failed to unblock user. Please try again.');
    }
  }
});

// Get Privacy Settings Command
commandRegistry.register({
  name: 'privacysettings',
  aliases: ['privacy', 'getprivacy'],
  description: 'Get current privacy settings (Owner only)',
  category: 'PRIVACY',
  handler: async (context: CommandContext) => {
    const { respond, message, client } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      await respond('🔍 Fetching privacy settings...');
      
      const privacySettings = await client.fetchPrivacySettings(true);
      
      let settingsMessage = `🔒 *Privacy Settings*\n\n`;
      settingsMessage += `📱 *Last Seen:* ${privacySettings.lastSeen || 'Not set'}\n`;
      settingsMessage += `🌐 *Online:* ${privacySettings.online || 'Not set'}\n`;
      settingsMessage += `🖼️ *Profile Picture:* ${privacySettings.profile || 'Not set'}\n`;
      settingsMessage += `📝 *Status:* ${privacySettings.status || 'Not set'}\n`;
      settingsMessage += `✓ *Read Receipts:* ${privacySettings.readreceipts || 'Not set'}\n`;
      settingsMessage += `👥 *Groups Add:* ${privacySettings.groupadd || 'Not set'}\n`;
      settingsMessage += `💬 *Default Disappearing:* ${privacySettings.disappearing || 'Not set'}\n`;
      settingsMessage += `\n> Use specific commands to update privacy settings`;

      await respond(settingsMessage);

    } catch (error) {
      console.error('Error fetching privacy settings:', error);
      await respond('❌ Failed to fetch privacy settings. Please try again.');
    }
  }
});

// Get Block List Command
commandRegistry.register({
  name: 'blocklist',
  aliases: ['blocked', 'getblocklist'],
  description: 'Get list of blocked users (Owner only)',
  category: 'PRIVACY',
  handler: async (context: CommandContext) => {
    const { respond, message, client } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      await respond('🔍 Fetching block list...');
      
      const blockList = await client.fetchBlocklist();
      
      if (!blockList || blockList.length === 0) {
        await respond('✅ *Block List*\n\n📋 No users are currently blocked.');
        return;
      }

      let blockMessage = `🚫 *Blocked Users (${blockList.length})*\n\n`;
      blockList.forEach((jid: string, index: number) => {
        blockMessage += `${index + 1}. @${jid.split('@')[0]}\n`;
      });
      blockMessage += `\n> Use .unblock to unblock users`;

      await respond(blockMessage);

    } catch (error) {
      console.error('Error fetching block list:', error);
      await respond('❌ Failed to fetch block list. Please try again.');
    }
  }
});

// Update Last Seen Privacy Command
commandRegistry.register({
  name: 'lastseen',
  aliases: ['updatelastseen', 'setlastseen'],
  description: 'Update last seen privacy (Owner only)',
  category: 'PRIVACY',
  handler: async (context: CommandContext) => {
    const { respond, message, client, args } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!args || args.length === 0) {
      await respond('ℹ️ *Last Seen Privacy*\n\n*Usage:*\n.lastseen all - Everyone can see\n.lastseen contacts - Only contacts\n.lastseen contact_blacklist - Contacts except...\n.lastseen none - Nobody can see');
      return;
    }

    const value = args[0].toLowerCase();
    const validValues = ['all', 'contacts', 'contact_blacklist', 'none'];

    if (!validValues.includes(value)) {
      await respond('❌ Invalid value! Use: all, contacts, contact_blacklist, or none');
      return;
    }

    try {
      await client.updateLastSeenPrivacy(value);
      await respond(`✅ *Last Seen Privacy Updated*\n\n🔒 New setting: *${value}*\n\n> Your last seen privacy has been updated successfully!`);

    } catch (error) {
      console.error('Error updating last seen privacy:', error);
      await respond('❌ Failed to update last seen privacy. Please try again.');
    }
  }
});

// Update Online Privacy Command
commandRegistry.register({
  name: 'onlineprivacy',
  aliases: ['setonline', 'updateonline'],
  description: 'Update online privacy (Owner only)',
  category: 'PRIVACY',
  handler: async (context: CommandContext) => {
    const { respond, message, client, args } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!args || args.length === 0) {
      await respond('ℹ️ *Online Privacy*\n\n*Usage:*\n.onlineprivacy all - Everyone can see\n.onlineprivacy match_last_seen - Same as last seen');
      return;
    }

    const value = args[0].toLowerCase();
    const validValues = ['all', 'match_last_seen'];

    if (!validValues.includes(value)) {
      await respond('❌ Invalid value! Use: all or match_last_seen');
      return;
    }

    try {
      await client.updateOnlinePrivacy(value);
      await respond(`✅ *Online Privacy Updated*\n\n🔒 New setting: *${value}*\n\n> Your online privacy has been updated successfully!`);

    } catch (error) {
      console.error('Error updating online privacy:', error);
      await respond('❌ Failed to update online privacy. Please try again.');
    }
  }
});

// Update Profile Picture Privacy Command
commandRegistry.register({
  name: 'profilepicprivacy',
  aliases: ['ppprivacy', 'setprofilepicprivacy'],
  description: 'Update profile picture privacy (Owner only)',
  category: 'PRIVACY',
  handler: async (context: CommandContext) => {
    const { respond, message, client, args } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!args || args.length === 0) {
      await respond('ℹ️ *Profile Picture Privacy*\n\n*Usage:*\n.profilepicprivacy all - Everyone can see\n.profilepicprivacy contacts - Only contacts\n.profilepicprivacy contact_blacklist - Contacts except...\n.profilepicprivacy none - Nobody can see');
      return;
    }

    const value = args[0].toLowerCase();
    const validValues = ['all', 'contacts', 'contact_blacklist', 'none'];

    if (!validValues.includes(value)) {
      await respond('❌ Invalid value! Use: all, contacts, contact_blacklist, or none');
      return;
    }

    try {
      await client.updateProfilePicturePrivacy(value);
      await respond(`✅ *Profile Picture Privacy Updated*\n\n🔒 New setting: *${value}*\n\n> Your profile picture privacy has been updated successfully!`);

    } catch (error) {
      console.error('Error updating profile picture privacy:', error);
      await respond('❌ Failed to update profile picture privacy. Please try again.');
    }
  }
});

// Update Status Privacy Command
commandRegistry.register({
  name: 'statusprivacy',
  aliases: ['setstatus', 'updatestatusprivacy'],
  description: 'Update status privacy (Owner only)',
  category: 'PRIVACY',
  handler: async (context: CommandContext) => {
    const { respond, message, client, args } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!args || args.length === 0) {
      await respond('ℹ️ *Status Privacy*\n\n*Usage:*\n.statusprivacy all - Everyone can see\n.statusprivacy contacts - Only contacts\n.statusprivacy contact_blacklist - Contacts except...\n.statusprivacy none - Nobody can see');
      return;
    }

    const value = args[0].toLowerCase();
    const validValues = ['all', 'contacts', 'contact_blacklist', 'none'];

    if (!validValues.includes(value)) {
      await respond('❌ Invalid value! Use: all, contacts, contact_blacklist, or none');
      return;
    }

    try {
      await client.updateStatusPrivacy(value);
      await respond(`✅ *Status Privacy Updated*\n\n🔒 New setting: *${value}*\n\n> Your status privacy has been updated successfully!`);

    } catch (error) {
      console.error('Error updating status privacy:', error);
      await respond('❌ Failed to update status privacy. Please try again.');
    }
  }
});

// Update Read Receipts Privacy Command
commandRegistry.register({
  name: 'readreceipts',
  aliases: ['bluecheck', 'updatereadreceipts'],
  description: 'Update read receipts privacy (Owner only)',
  category: 'PRIVACY',
  handler: async (context: CommandContext) => {
    const { respond, message, client, args } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!args || args.length === 0) {
      await respond('ℹ️ *Read Receipts Privacy*\n\n*Usage:*\n.readreceipts all - Blue checks enabled\n.readreceipts none - Blue checks disabled');
      return;
    }

    const value = args[0].toLowerCase();
    const validValues = ['all', 'none'];

    if (!validValues.includes(value)) {
      await respond('❌ Invalid value! Use: all or none');
      return;
    }

    try {
      await client.updateReadReceiptsPrivacy(value);
      await respond(`✅ *Read Receipts Privacy Updated*\n\n🔒 New setting: *${value}*\n\n> Your read receipts privacy has been updated successfully!`);

    } catch (error) {
      console.error('Error updating read receipts privacy:', error);
      await respond('❌ Failed to update read receipts privacy. Please try again.');
    }
  }
});

// Update Groups Add Privacy Command
commandRegistry.register({
  name: 'groupaddprivacy',
  aliases: ['groupadd', 'updategroupadd'],
  description: 'Update who can add you to groups (Owner only)',
  category: 'PRIVACY',
  handler: async (context: CommandContext) => {
    const { respond, message, client, args } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!args || args.length === 0) {
      await respond('ℹ️ *Groups Add Privacy*\n\n*Usage:*\n.groupaddprivacy all - Everyone can add\n.groupaddprivacy contacts - Only contacts\n.groupaddprivacy contact_blacklist - Contacts except...');
      return;
    }

    const value = args[0].toLowerCase();
    const validValues = ['all', 'contacts', 'contact_blacklist'];

    if (!validValues.includes(value)) {
      await respond('❌ Invalid value! Use: all, contacts, or contact_blacklist');
      return;
    }

    try {
      await client.updateGroupsAddPrivacy(value);
      await respond(`✅ *Groups Add Privacy Updated*\n\n🔒 New setting: *${value}*\n\n> Your groups add privacy has been updated successfully!`);

    } catch (error) {
      console.error('Error updating groups add privacy:', error);
      await respond('❌ Failed to update groups add privacy. Please try again.');
    }
  }
});

// Update Default Disappearing Mode Command
commandRegistry.register({
  name: 'disappearing',
  aliases: ['ephemeral', 'disappearingmode'],
  description: 'Update default disappearing messages mode (Owner only)',
  category: 'PRIVACY',
  handler: async (context: CommandContext) => {
    const { respond, message, client, args } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (!args || args.length === 0) {
      await respond('ℹ️ *Disappearing Messages*\n\n*Usage:*\n.disappearing off - Disable (0)\n.disappearing 24h - 24 hours (86400)\n.disappearing 7d - 7 days (604800)\n.disappearing 90d - 90 days (7776000)');
      return;
    }

    const option = args[0].toLowerCase();
    let ephemeral = 0;

    switch (option) {
      case 'off':
      case 'disable':
      case '0':
        ephemeral = 0;
        break;
      case '24h':
      case '1d':
      case 'day':
        ephemeral = 86400;
        break;
      case '7d':
      case 'week':
        ephemeral = 604800;
        break;
      case '90d':
      case '3m':
        ephemeral = 7776000;
        break;
      default:
        await respond('❌ Invalid option! Use: off, 24h, 7d, or 90d');
        return;
    }

    try {
      await client.updateDefaultDisappearingMode(ephemeral);
      
      const timeText = ephemeral === 0 ? 'Disabled' : 
                      ephemeral === 86400 ? '24 hours' :
                      ephemeral === 604800 ? '7 days' : '90 days';

      await respond(`✅ *Disappearing Messages Updated*\n\n🔒 New setting: *${timeText}*\n\n> Default disappearing messages mode has been updated successfully!`);

    } catch (error) {
      console.error('Error updating disappearing mode:', error);
      await respond('❌ Failed to update disappearing messages mode. Please try again.');
    }
  }
});

console.log('✅ Privacy management commands loaded successfully');
