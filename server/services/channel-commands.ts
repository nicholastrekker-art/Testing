
import { commandRegistry, type CommandContext } from './command-registry.js';

// Channel Management Commands
console.log('✅ Loading channel management commands...');

// Follow Channel Command
commandRegistry.register({
  name: 'followchannel',
  aliases: ['follow', 'subscribechannel'],
  description: 'Follow the TrekkerMD newsletter channel',
  category: 'GENERAL',
  handler: async (context: CommandContext) => {
    const { respond, client, message } = context;

    try {
      // Hardcoded newsletter channel JID
      const channelJid = '120363421057570812@newsletter';

      await respond('📢 Following TrekkerMD newsletter channel...');

      // Follow the newsletter channel
      await client.newsletterFollow(channelJid);

      await respond(`✅ *Successfully Followed Channel!*\n\n📰 You are now following the TrekkerMD newsletter channel.\n🔔 You'll receive updates from this channel.\n\n> Powered by TREKKERMD LIFETIME BOT`);

      console.log(`Bot ${context.botId}: Successfully followed channel ${channelJid}`);

    } catch (error) {
      console.error('Error following channel:', error);
      
      // Check if already following
      if (error instanceof Error && error.message.includes('already')) {
        await respond('ℹ️ *Already Following*\n\nYou are already following the TrekkerMD newsletter channel!');
      } else {
        await respond('❌ Failed to follow the channel. Please try again later.');
      }
    }
  }
});

console.log('✅ Channel management commands loaded successfully');
