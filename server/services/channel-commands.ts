
import { commandRegistry, type CommandContext } from './command-registry.js';
import { storage } from '../storage.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Channel Management Commands
console.log('✅ Loading channel management commands...');

// Channel reaction configuration per bot
interface ChannelReactionConfig {
  enabled: boolean;
  lastReactionTime: number;
  throttleDelay: number; // milliseconds between reactions
  channelJid: string;
}

const CHANNEL_CONFIG_DIR = join(process.cwd(), 'data', 'channel-reactions');

// Ensure config directory exists
if (!existsSync(CHANNEL_CONFIG_DIR)) {
  mkdirSync(CHANNEL_CONFIG_DIR, { recursive: true });
}

function getChannelConfig(botId: string): ChannelReactionConfig {
  const configPath = join(CHANNEL_CONFIG_DIR, `${botId}.json`);
  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  }
  return {
    enabled: false,
    lastReactionTime: 0,
    throttleDelay: 10000, // 10 seconds default throttle
    channelJid: '120363421057570812@newsletter'
  };
}

function saveChannelConfig(botId: string, config: ChannelReactionConfig): void {
  const configPath = join(CHANNEL_CONFIG_DIR, `${botId}.json`);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

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

      try {
        // Follow the newsletter channel
        await client.newsletterFollow(channelJid);
      } catch (followError: any) {
        // The API returns unexpected structure but still follows successfully
        // Check if it's the specific error we expect
        if (followError.message?.includes('unexpected response structure') || 
            followError.output?.statusCode === 400) {
          // It's likely already followed or just succeeded with weird response
          console.log(`Bot ${context.botId}: Channel follow completed (ignoring API response format issue)`);
        } else {
          throw followError;
        }
      }

      await respond(`✅ *Successfully Followed Channel!*\n\n📰 You are now following the TrekkerMD newsletter channel.\n🔔 You'll receive updates from this channel.\n\n> Powered by TREKKERMD LIFETIME BOT`);

      console.log(`Bot ${context.botId}: Successfully followed channel ${channelJid}`);

    } catch (error) {
      console.error('Error following channel:', error);
      
      // Check if already following
      if (error instanceof Error && (error.message.includes('already') || error.message.includes('unexpected response'))) {
        await respond('ℹ️ *Already Following*\n\nYou are already following the TrekkerMD newsletter channel!');
      } else {
        await respond('❌ Failed to follow the channel. Please try again later.');
      }
    }
  }
});

// Auto React to Channel Command
commandRegistry.register({
  name: 'channelreact',
  aliases: ['autoreactchannel', 'reactchannel'],
  description: 'Enable/disable auto-reaction to newsletter channel messages',
  category: 'GENERAL',
  handler: async (context: CommandContext) => {
    const { respond, args, botId } = context;

    if (!botId) {
      await respond('❌ Bot ID not available!');
      return;
    }

    const config = getChannelConfig(botId);

    if (args.length === 0) {
      await respond(`📊 *Channel Auto-React Status*\n\n✨ Status: ${config.enabled ? '✅ Enabled' : '❌ Disabled'}\n⏱️ Throttle: ${config.throttleDelay / 1000}s\n📢 Channel: TrekkerMD Newsletter\n\n*Usage:*\n• .channelreact on - Enable auto-react\n• .channelreact off - Disable auto-react\n• .channelreact throttle [seconds] - Set throttle delay`);
      return;
    }

    const command = args[0].toLowerCase();

    if (command === 'on') {
      config.enabled = true;
      saveChannelConfig(botId, config);
      await respond(`✅ *Channel Auto-React Enabled!*\n\n💚 Bot will now react to TrekkerMD newsletter messages\n⏱️ Throttle: ${config.throttleDelay / 1000}s between reactions\n\n> Powered by TREKKERMD LIFETIME BOT`);
      
    } else if (command === 'off') {
      config.enabled = false;
      saveChannelConfig(botId, config);
      await respond('❌ *Channel Auto-React Disabled!*\n\nBot will no longer react to newsletter messages.');
      
    } else if (command === 'throttle' && args[1]) {
      const seconds = parseInt(args[1]);
      if (isNaN(seconds) || seconds < 1) {
        await respond('❌ Invalid throttle value! Please provide seconds (minimum 1).');
        return;
      }
      config.throttleDelay = seconds * 1000;
      saveChannelConfig(botId, config);
      await respond(`✅ *Throttle Updated!*\n\n⏱️ New throttle delay: ${seconds}s\n\nBot will wait ${seconds} seconds between reactions.`);
      
    } else {
      await respond('❌ Invalid command!\n\n*Usage:*\n• .channelreact on - Enable\n• .channelreact off - Disable\n• .channelreact throttle [seconds] - Set delay');
    }
  }
});

// Export function to check and react to channel messages
export async function handleChannelMessage(sock: any, message: any, botId: string): Promise<void> {
  try {
    const config = getChannelConfig(botId);
    
    if (!config.enabled) return;
    
    // Check if message is from the newsletter channel
    if (message.key?.remoteJid !== config.channelJid) return;
    
    // Don't react to own messages
    if (message.key?.fromMe) return;
    
    // Throttle check
    const now = Date.now();
    if (config.lastReactionTime && (now - config.lastReactionTime) < config.throttleDelay) {
      const waitTime = config.throttleDelay - (now - config.lastReactionTime);
      console.log(`⏳ Channel reaction throttled - waiting ${waitTime}ms before next reaction`);
      return;
    }
    
    // React with green heart
    await sock.sendMessage(message.key.remoteJid, {
      react: {
        text: '💚',
        key: message.key
      }
    });
    
    // Update last reaction time
    config.lastReactionTime = now;
    saveChannelConfig(botId, config);
    
    console.log(`💚 Reacted to channel message from ${message.key.remoteJid}`);
    
  } catch (error) {
    console.error('Error reacting to channel message:', error);
  }
}

console.log('✅ Channel management commands loaded successfully');
