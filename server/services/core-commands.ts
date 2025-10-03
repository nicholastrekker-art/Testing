import { commandRegistry, type CommandContext } from './command-registry.js';
import { antideleteService } from './antidelete.js';
import { getAntiViewOnceService } from './antiviewonce.js';
import moment from 'moment-timezone';
import os from 'os';
import axios from 'axios';
import { join } from 'path';

// Utility functions from the original commands
const toFancyUppercaseFont = (text: string) => {
  const fonts: Record<string, string> = {
    'A': '𝐀', 'B': '𝐁', 'C': '𝐂', 'D': '𝐃', 'E': '𝐄', 'F': '𝐅', 'G': '𝐆', 'H': '𝐇', 'I': '𝐈', 'J': '𝐉', 'K': '𝐊', 'L': '𝐋', 'M': '𝐌',
    'N': '𝐍', 'O': '𝐎', 'P': '𝐏', 'Q': '𝐐', 'R': '𝐑', 'S': '𝐒', 'T': '𝐓', 'U': '𝐔', 'V': '𝐕', 'W': '𝐖', 'X': '𝐗', 'Y': '𝐘', 'Z': '𝐙'
  };
  return text.split('').map(char => fonts[char] || char).join('');
};

const toFancyLowercaseFont = (text: string) => {
  const fonts: Record<string, string> = {
    'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ғ', 'g': 'ɢ', 'h': 'ʜ', 'i': 'ɪ', 'j': 'ᴊ', 'k': 'ᴋ', 'l': 'ʟ', 'm': 'ᴍ',
    'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ', 's': '𝚜', 't': 'ᴛ', 'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x', 'y': 'ʏ', 'z': 'ᴢ'
  };
  return text.split('').map(char => fonts[char] || char).join('');
};

const formatUptime = (seconds: number) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  return [
    days > 0 ? `${days} ${days === 1 ? "day" : "days"}` : '',
    hours > 0 ? `${hours} ${hours === 1 ? "hour" : "hours"}` : '',
    minutes > 0 ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : '',
    remainingSeconds > 0 ? `${remainingSeconds} ${remainingSeconds === 1 ? "second" : "seconds"}` : ''
  ].filter(Boolean).join(', ');
};

const formatMemory = (bytes: number) => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(1)}${units[unit]}`;
};

const quotes = [
  "Dream big, work hard.",
  "Stay humble, hustle hard.",
  "Believe in yourself.",
  "Success is earned, not given.",
  "Actions speak louder than words.",
  "The best is yet to come.",
  "Keep pushing forward.",
  "Do more than just exist.",
  "Progress, not perfection.",
  "Stay positive, work hard."
];

const getRandomQuote = () => {
  const randomIndex = Math.floor(Math.random() * quotes.length);
  return quotes[randomIndex];
};

// Register menu command
commandRegistry.register({
  name: 'menu',
  aliases: ['liste', 'helplist', 'commandlist'],
  description: 'Show bot menu with all commands',
  category: 'SYSTEM',
  handler: async (context: CommandContext) => {
    const { respond, client, message, from } = context;

    // Get commands from both registry and database
    const registryCommands = commandRegistry.getAllCommands();

    // Just use registry commands for now - database integration will be handled separately
    const allCommands = registryCommands;

    const categorizedCommands = commandRegistry.getCommandsByCategory();

    moment.tz.setDefault("Africa/Nairobi");
    const currentTime = moment();
    const formattedTime = currentTime.format("HH:mm:ss");
    const formattedDate = currentTime.format("DD/MM/YYYY");
    const currentHour = currentTime.hour();

    const greetings = ["Good Morning 🌄", "Good Afternoon 🌃", "Good Evening ⛅", "Good Night 🌙"];
    const greeting = currentHour < 12 ? greetings[0] : currentHour < 17 ? greetings[1] : currentHour < 21 ? greetings[2] : greetings[3];

    const randomQuote = getRandomQuote();
    const mode = "Public"; // Default mode

    let responseMessage = `
${greeting}, *User*

╭━❮ TREKKERMD LIFETIME BOT ❯━╮
┃ *👤ʙᴏᴛ ᴏᴡɴᴇʀ:* TrekkerMD
┃ *🥏ᴘʀᴇғɪx:* *[ . ]*
┃ *🕒ᴛɪᴍᴇ:* ${formattedTime}
┃ *🛸ᴄᴏᴍᴍᴀɴᴅꜱ:* ${allCommands.length}
┃ *📆ᴅᴀᴛᴇ:* ${formattedDate}
┃ *🧑‍💻ᴍᴏᴅᴇ:* ${mode}
┃ *📼ʀᴀᴍ:* ${formatMemory(os.totalmem() - os.freemem())}/${formatMemory(os.totalmem())}
┃ *⏳ᴜᴘᴛɪᴍᴇ:* ${formatUptime(process.uptime())}
╰─────────────━┈⊷
> *${randomQuote}*

`;

    let commandsList = "";
    const sortedCategories = Object.keys(categorizedCommands).sort();

    for (const category of sortedCategories) {
      commandsList += `\n*╭━❮ ${toFancyUppercaseFont(category)} ❯━╮*`;
      const sortedCommands = categorizedCommands[category].sort((a, b) => a.name.localeCompare(b.name));
      for (const command of sortedCommands) {
        commandsList += `\n┃✰ ${toFancyLowercaseFont(command.name)}`;
      }
      commandsList += "\n╰─────────────━┈⊷";
    }

    commandsList += "\n\n> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴛʀᴇᴋᴋᴇʀᴍᴅ ᴛᴇᴀᴍ\n";

    try {
      // Auto-rotate through all available icons in icons/ directory (root level)
      const { readFileSync, existsSync, readdirSync } = await import('fs');
      const iconsDir = join(process.cwd(), 'icons');

      // Check if icons directory exists
      if (existsSync(iconsDir)) {
        // Get all icon files in the directory (supports .jpg, .jpeg, .png)
        const iconFiles = readdirSync(iconsDir).filter(file =>
          file.toLowerCase().match(/\.(jpg|jpeg|png)$/i)
        ).sort(); // Sort to ensure consistent order

        if (iconFiles.length > 0) {
          // Use timestamp-based rotation to cycle through icons systematically
          const rotationIndex = Math.floor(Date.now() / 10000) % iconFiles.length; // Changes every 10 seconds
          const selectedIcon = iconFiles[rotationIndex];
          const imagePath = join(iconsDir, selectedIcon);

          console.log(`📸 [Menu] Using icon: ${selectedIcon} (${rotationIndex + 1}/${iconFiles.length}) from ${iconsDir}`);
          console.log(`📂 [Menu] Available icons: ${iconFiles.join(', ')}`);

          await client.sendMessage(from, {
            image: { url: imagePath },
            caption: responseMessage + commandsList
          });
        } else {
          console.log(`⚠️ [Menu] No valid image files found in ${iconsDir}, using text-only menu`);
          await respond(responseMessage + commandsList);
        }
      } else {
        console.log(`⚠️ [Menu] Icons directory ${iconsDir} doesn't exist, using text-only menu`);
        await respond(responseMessage + commandsList);
      }
    } catch (error) {
      console.error('Error sending menu with image:', error);
      // Fallback to text-only menu
      await respond(responseMessage + commandsList);
    }
  }
});

// Register list command
commandRegistry.register({
  name: 'list',
  aliases: ['commands', 'cmdlist'],
  description: 'Show detailed command list',
  category: 'SYSTEM',
  handler: async (context: CommandContext) => {
    const { respond } = context;

    const commands = commandRegistry.getAllCommands();
    const categorizedCommands = commandRegistry.getCommandsByCategory();

    moment.tz.setDefault("Africa/Nairobi");
    const currentTime = moment();
    const formattedTime = currentTime.format("HH:mm:ss");
    const formattedDate = currentTime.format("DD/MM/YYYY");
    const currentHour = currentTime.hour();

    const greetings = ["Good Morning 🌄", "Good Afternoon 🌃", "Good Evening ⛅", "Good Night 🌙"];
    const greeting = currentHour < 12 ? greetings[0] : currentHour < 17 ? greetings[1] : currentHour < 21 ? greetings[2] : greetings[3];

    const randomQuote = getRandomQuote();
    const mode = "Public";

    let responseMessage = `
${greeting}, *User*

╭━━━ 〔 TREKKERMD LIFETIME BOT 〕━━━┈⊷
┃╭──────────────
┃│▸ *ʙᴏᴛ ᴏᴡɴᴇʀ:* TrekkerMD
┃│▸ *ᴘʀᴇғɪx:* *[ . ]*
┃│▸ *ᴛɪᴍᴇ:* ${formattedTime}
┃│▸ *ᴄᴏᴍᴍᴀɴᴅꜱ:* ${commands.length}
┃│▸ *ᴅᴀᴛᴇ:* ${formattedDate}
┃│▸ *ᴍᴏᴅᴇ:* ${mode}
┃│▸ *ᴛɪᴍᴇ ᴢᴏɴᴇ:* Africa/Nairobi
┃│▸ *ʀᴀᴍ:* ${formatMemory(os.totalmem() - os.freemem())}/${formatMemory(os.totalmem())}
┃│▸ *ᴜᴘᴛɪᴍᴇ:* ${formatUptime(process.uptime())}
┃╰──────────────
╰━━━━━━━━━━━━━━━┈⊷
> *${randomQuote}*

`;

    let commandsList = "*𝐓𝐑𝐄𝐊𝐊𝐄𝐑𝐌𝐃 𝐋𝐈𝐅𝐄𝐓𝐈𝐌𝐄 𝐁𝐎𝐓 𝐂𝐎𝐌𝐌𝐀𝐍𝐃𝐒*\n";
    const sortedCategories = Object.keys(categorizedCommands).sort();
    let commandIndex = 1;

    for (const category of sortedCategories) {
      commandsList += `\n*╭─────「 ${toFancyUppercaseFont(category)} 」──┈⊷*\n│◦│╭───────────────`;
      const sortedCommands = categorizedCommands[category].sort((a, b) => a.name.localeCompare(b.name));
      for (const command of sortedCommands) {
        commandsList += `\n│◦│ ${commandIndex++}. ${toFancyLowercaseFont(command.name)}`;
      }
      commandsList += "\n│◦╰─────────────\n╰──────────────┈⊷\n";
    }

    commandsList += "\n> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴛʀᴇᴋᴋᴇʀᴍᴅ ᴛᴇᴀᴍ\n";

    await respond(responseMessage + commandsList);
  }
});

// Register help command
commandRegistry.register({
  name: 'help',
  aliases: ['h', 'commands'],
  description: 'Show help information',
  category: 'SYSTEM',
  handler: async (context: CommandContext) => {
    const { respond, args } = context;

    if (args.length > 0) {
      // Show help for specific command
      const commandName = args[0].toLowerCase();
      const command = commandRegistry.get(commandName);

      if (command) {
        let helpText = `*Command Help: ${command.name}*\n\n`;
        helpText += `📝 *Description:* ${command.description}\n`;
        helpText += `📂 *Category:* ${command.category}\n`;

        if (command.aliases && command.aliases.length > 0) {
          helpText += `🔄 *Aliases:* ${command.aliases.join(', ')}\n`;
        }

        helpText += `\n💡 *Usage:* .${command.name}`;

        await respond(helpText);
      } else {
        await respond(`❌ Command "${commandName}" not found. Use .help to see all commands.`);
      }
    } else {
      // Show general help
      const commands = commandRegistry.getAllCommands();
      const helpText = `
🤖 *TREKKERMD LIFETIME BOT HELP*

📝 *Available Commands:* ${commands.length}
🔧 *Prefix:* . (dot)

*Quick Commands:*
• .menu - Show command menu
• .list - Show detailed command list
• .help [command] - Show help for specific command

*Categories:*
${Object.keys(commandRegistry.getCommandsByCategory()).map(cat => `• ${cat}`).join('\n')}

💡 *Example:* .help menu
📱 Type .menu to see all available commands!

> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴛʀᴇᴋᴋᴇʀᴍᴅ ᴛᴇᴀᴍ`;

      await respond(helpText);
    }
  }
});

// Register a test command
commandRegistry.register({
  name: 'ping',
  aliases: ['test'],
  description: 'Test bot responsiveness',
  category: 'GENERAL',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    const startTime = Date.now();

    await respond(`🏓 *Pong!*\n\n⚡ *Response time:* ${Date.now() - startTime}ms\n🤖 *Bot Status:* Online\n✅ *TREKKERMD LIFETIME BOT* is working perfectly!`);
  }
});

// Register owner command
commandRegistry.register({
  name: 'owner',
  aliases: ['dev', 'developer'],
  description: 'Show bot owner information',
  category: 'GENERAL',
  handler: async (context: CommandContext) => {
    const { respond } = context;

    const ownerInfo = `
👤 *Bot Owner Information*

*Name:* TrekkerMD
*Bot:* TREKKERMD LIFETIME BOT
*Version:* 2.0.0
*Platform:* Baileys WhatsApp Bot

📞 *Contact:* Available via WhatsApp
🌍 *Region:* Kenya (Africa/Nairobi)

> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴛʀᴇᴋᴋᴇʀᴍᴅ ᴛᴇᴀᴍ`;

    await respond(ownerInfo);
  }
});

// Register status command
commandRegistry.register({
  name: 'status',
  aliases: ['info', 'stats'],
  description: 'Show bot status and system information',
  category: 'SYSTEM',
  handler: async (context: CommandContext) => {
    const { respond } = context;

    moment.tz.setDefault("Africa/Nairobi");
    const currentTime = moment();
    const formattedTime = currentTime.format("HH:mm:ss");
    const formattedDate = currentTime.format("DD/MM/YYYY");

    const statusInfo = `
📊 *TREKKERMD LIFETIME BOT STATUS*

🤖 *Bot Information:*
┃ Status: Online ✅
┃ Commands: ${commandRegistry.getAllCommands().length}
┃ Uptime: ${formatUptime(process.uptime())}
┃ Version: 2.0.0

💻 *System Information:*
┃ RAM Usage: ${formatMemory(os.totalmem() - os.freemem())}/${formatMemory(os.totalmem())}
┃ Platform: ${os.platform()}
┃ Node.js: ${process.version}

⏰ *Time Information:*
┃ Current Time: ${formattedTime}
┃ Date: ${formattedDate}
┃ Timezone: Africa/Nairobi

🌐 *Connection:* Baileys WhatsApp Native
✅ *All systems operational!*

> ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴛʀᴇᴋᴋᴇʀᴍᴅ ᴛᴇᴀᴍ`;

    await respond(statusInfo);
  }
});

// Register fun commands
commandRegistry.register({
  name: 'advice',
  aliases: ['wisdom', 'wise'],
  description: 'Get some wise advice',
  category: 'FUN',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    try {
      const response = await axios.get('https://api.adviceslip.com/advice');
      const advice = response.data.slip.advice;
      await respond(`💡 *Here's some advice:*\n\n"${advice}"\n\n✨ Hope that helps!`);
    } catch (error) {
      await respond('❌ Sorry, I couldn\'t fetch any advice right now. Try again later!');
    }
  }
});

commandRegistry.register({
  name: 'fact',
  aliases: ['funfact'],
  description: 'Get an interesting random fact',
  category: 'FUN',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    try {
      const response = await axios.get('https://nekos.life/api/v2/fact');
      const fact = response.data.fact;
      await respond(`🧠 *Random Fact:*\n\n${fact}\n\n🌟 Powered by TREKKERMD LIFETIME BOT`);
    } catch (error) {
      await respond('❌ Sorry, I couldn\'t fetch a fact right now. Try again later!');
    }
  }
});

commandRegistry.register({
  name: 'quotes',
  aliases: ['quote', 'inspiration'],
  description: 'Get an inspiring quote',
  category: 'FUN',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    try {
      const response = await axios.get('https://favqs.com/api/qotd');
      const quote = response.data.quote;
      await respond(`📜 *Daily Quote:*\n\n"${quote.body}"\n\n*- ${quote.author}*\n\n✨ Powered by TREKKERMD LIFETIME BOT`);
    } catch (error) {
      await respond('❌ Sorry, I couldn\'t fetch a quote right now. Try again later!');
    }
  }
});

commandRegistry.register({
  name: 'trivia',
  aliases: ['quiz', 'question'],
  description: 'Get a trivia question to test your knowledge',
  category: 'FUN',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    try {
      const response = await axios.get('https://opentdb.com/api.php?amount=1&type=multiple');
      const trivia = response.data.results[0];
      const question = trivia.question;
      const correctAnswer = trivia.correct_answer;
      const answers = [...trivia.incorrect_answers, correctAnswer].sort();

      const answerChoices = answers.map((answer, index) => `${index + 1}. ${answer}`).join('\n');

      await respond(`🤔 *Trivia Question:*\n\n${question}\n\n${answerChoices}\n\n⏰ I'll reveal the answer in 10 seconds...`);

      setTimeout(async () => {
        await respond(`✅ *Correct Answer:* ${correctAnswer}\n\nDid you get it right? Try another trivia!`);
      }, 10000);
    } catch (error) {
      await respond('❌ Sorry, I couldn\'t fetch a trivia question right now. Try again later!');
    }
  }
});

// Register download commands
commandRegistry.register({
  name: 'play',
  aliases: ['song', 'audio', 'mp3'],
  description: 'Download audio from YouTube',
  category: 'DOWNLOAD',
  handler: async (context: CommandContext) => {
    const { respond, args } = context;

    if (!args.length) {
      return await respond('❌ Please provide a song name or YouTube URL.\n\n*Example:* .play Ed Sheeran Perfect');
    }

    const query = args.join(' ');
    await respond(`🔍 Searching for: *${query}*\nPlease wait...`);

    try {
      // This is a placeholder - in real implementation you'd integrate with YouTube API
      await respond(`🎵 *Audio Download*\n\n📝 *Title:* ${query}\n🎧 *Format:* MP3\n⬇️ *Status:* Processing...\n\n⚠️ *Note:* Audio download functionality requires YouTube API integration.`);
    } catch (error) {
      await respond('❌ Sorry, audio download is currently unavailable. Please try again later.');
    }
  }
});

commandRegistry.register({
  name: 'video',
  aliases: ['mp4', 'ytdl'],
  description: 'Download video from YouTube',
  category: 'DOWNLOAD',
  handler: async (context: CommandContext) => {
    const { respond, args } = context;

    if (!args.length) {
      return await respond('❌ Please provide a video name or YouTube URL.\n\n*Example:* .video Funny cats compilation');
    }

    const query = args.join(' ');
    await respond(`🔍 Searching for: *${query}*\nPlease wait...`);

    try {
      // This is a placeholder - in real implementation you'd integrate with YouTube API
      await respond(`🎬 *Video Download*\n\n📝 *Title:* ${query}\n📱 *Format:* MP4\n⬇️ *Status:* Processing...\n\n⚠️ *Note:* Video download functionality requires YouTube API integration.`);
    } catch (error) {
      await respond('❌ Sorry, video download is currently unavailable. Please try again later.');
    }
  }
});

commandRegistry.register({
  name: 'instagram',
  aliases: ['ig', 'igdl', 'insta'],
  description: 'Download Instagram video',
  category: 'DOWNLOAD',
  handler: async (context: CommandContext) => {
    const { respond, args } = context;

    if (!args.length) {
      return await respond('❌ Please provide an Instagram video URL.\n\n*Example:* .instagram https://www.instagram.com/p/...');
    }

    const url = args[0];
    if (!url.includes('instagram.com')) {
      return await respond('❌ Please provide a valid Instagram URL.');
    }

    await respond(`📸 *Instagram Download*\n\n🔗 *URL:* Processing...\n⬇️ *Status:* Fetching media...\n\n⚠️ *Note:* Instagram download functionality requires API integration.`);
  }
});

commandRegistry.register({
  name: 'facebook',
  aliases: ['fb', 'fbdl'],
  description: 'Download Facebook video',
  category: 'DOWNLOAD',
  handler: async (context: CommandContext) => {
    const { respond, args } = context;

    if (!args.length) {
      return await respond('❌ Please provide a Facebook video URL.\n\n*Example:* .facebook https://www.facebook.com/...');
    }

    const url = args[0];
    if (!url.includes('facebook.com')) {
      return await respond('❌ Please provide a valid Facebook URL.');
    }

    await respond(`📘 *Facebook Download*\n\n🔗 *URL:* Processing...\n⬇️ *Status:* Fetching media...\n\n⚠️ *Note:* Facebook download functionality requires API integration.`);
  }
});

commandRegistry.register({
  name: 'tiktok',
  aliases: ['tikdl', 'tiktokdl'],
  description: 'Download TikTok video',
  category: 'DOWNLOAD',
  handler: async (context: CommandContext) => {
    const { respond, args } = context;

    if (!args.length) {
      return await respond('❌ Please provide a TikTok video URL.\n\n*Example:* .tiktok https://tiktok.com/@user/video/...');
    }

    const url = args[0];
    if (!url.includes('tiktok.com')) {
      return await respond('❌ Please provide a valid TikTok URL.');
    }

    await respond(`🎵 *TikTok Download*\n\n🔗 *URL:* Processing...\n⬇️ *Status:* Fetching media...\n\n⚠️ *Note:* TikTok download functionality requires API integration.`);
  }
});

// Register general commands
commandRegistry.register({
  name: 'participants',
  aliases: ['members', 'groupmembers'],
  description: 'List group members (Group only)',
  category: 'GENERAL',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    await respond('👥 *Group Members*\n\n⚠️ This command works only in group chats.\n\n📋 It will show all group participants when used in a group.');
  }
});

// Register system commands
commandRegistry.register({
  name: 'uptime',
  aliases: ['runtime', 'running'],
  description: 'Check bot uptime',
  category: 'SYSTEM',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    const uptime = formatUptime(process.uptime());
    await respond(`⏰ *Bot Uptime:* ${uptime}\n\n✅ TREKKERMD LIFETIME BOT is running smoothly!`);
  }
});

commandRegistry.register({
  name: 'fetch',
  aliases: ['get', 'download'],
  description: 'Fetch content from URL',
  category: 'SYSTEM',
  handler: async (context: CommandContext) => {
    const { respond, args } = context;

    if (!args.length) {
      return await respond('❌ Please provide a URL.\n\n*Example:* .fetch https://example.com');
    }

    const url = args[0];
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return await respond('❌ URL must start with http:// or https://');
    }

    await respond(`🔍 *Fetching URL:* ${url}\n\n⚠️ *Note:* Fetch functionality requires additional security implementation.`);
  }
});

// Register profile picture and user management commands
commandRegistry.register({
  name: 'dp',
  aliases: ['getdp', 'profilepic'],
  description: 'Get profile picture of a user',
  category: 'GENERAL',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from } = context;

    try {
      // Get quoted message or tagged user
      const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
      const mentionedUsers = message.message?.extendedTextMessage?.contextInfo?.mentionedJid;

      let targetUser = quotedUser || (mentionedUsers && mentionedUsers[0]);

      // If no user specified, check if in private conversation
      if (!targetUser) {
        // Check if this is a private conversation (not a group)
        if (!from.includes('@g.us')) {
          // In private conversation, use the other participant's JID
          targetUser = from;
        } else {
          // In group, use sender
          targetUser = message.key.participant || message.key.remoteJid;
        }
      }

      await respond('🖼️ *Getting profile picture...*\nPlease wait...');

      // Get profile picture URL
      const ppUrl = await client.profilePictureUrl(targetUser, 'image');

      if (ppUrl) {
        await client.sendMessage(from, {
          image: { url: ppUrl },
          caption: `📸 *Profile Picture*\n\n👤 *User:* @${targetUser.split('@')[0]}\n🔗 *High Quality:* Yes\n\n> Powered by TREKKERMD LIFETIME BOT`,
          mentions: [targetUser]
        });
      } else {
        await respond('❌ This user has no profile picture or privacy settings prevent access.');
      }

    } catch (error) {
      console.error('Error getting profile picture:', error);
      await respond('❌ Failed to get profile picture. User may have privacy settings enabled or no profile picture set.');
    }
  }
});

commandRegistry.register({
  name: 'block',
  aliases: ['blockuser'],
  description: 'Block a user (Owner only)',
  category: 'ADMIN',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from } = context;

    // Check if sender is bot owner
    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
      const mentionedUsers = message.message?.extendedTextMessage?.contextInfo?.mentionedJid;

      let targetUser = quotedUser || (mentionedUsers && mentionedUsers[0]);

      // If no user specified, check if in private conversation
      if (!targetUser) {
        // Check if this is a private conversation (not a group)
        if (!from.includes('@g.us')) {
          // In private conversation, use the other participant's JID
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

commandRegistry.register({
  name: 'unblock',
  aliases: ['unblockuser'],
  description: 'Unblock a user (Owner only)',
  category: 'ADMIN',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from } = context;

    // Check if sender is bot owner
    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
      const mentionedUsers = message.message?.extendedTextMessage?.contextInfo?.mentionedJid;

      let targetUser = quotedUser || (mentionedUsers && mentionedUsers[0]);

      // If no user specified, check if in private conversation
      if (!targetUser) {
        // Check if this is a private conversation (not a group)
        if (!from.includes('@g.us')) {
          // In private conversation, use the other participant's JID
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

commandRegistry.register({
  name: 'setdp',
  aliases: ['setprofilepic', 'updateprofile'],
  description: 'Set bot profile picture (Owner only)',
  category: 'ADMIN',
  handler: async (context: CommandContext) => {
    const { respond, message, client } = context;

    // Check if sender is bot owner
    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      // Check if message has an image
      const imageMessage = message.message?.imageMessage;
      const quotedImageMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

      if (!imageMessage && !quotedImageMessage) {
        await respond('❌ Please send an image or reply to an image to set as profile picture!');
        return;
      }

      await respond('🖼️ *Setting profile picture...*\nPlease wait...');

      // Download the image
      const imageMsg = imageMessage || quotedImageMessage;
      const buffer = await client.downloadMediaMessage(imageMsg);

      // Set profile picture
      await client.updateProfilePicture(client.user.id, buffer);
      await respond('✅ *Profile Picture Updated*\n\n📸 Bot profile picture has been successfully updated!\n\n> Changes may take a few minutes to appear for all users.');

    } catch (error) {
      console.error('Error setting profile picture:', error);
      await respond('❌ Failed to set profile picture. Please ensure you sent a valid image.');
    }
  }
});

commandRegistry.register({
  name: 'bio',
  aliases: ['getbio', 'about'],
  description: 'Get user bio/status message',
  category: 'GENERAL',
  handler: async (context: CommandContext) => {
    const { respond, message, client, args, from } = context;

    try {
      // Get quoted message or tagged user
      const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
      const mentionedUsers = message.message?.extendedTextMessage?.contextInfo?.mentionedJid;

      let targetUser = quotedUser || (mentionedUsers && mentionedUsers[0]);

      // If no user specified, check if in private conversation
      if (!targetUser) {
        // Check if this is a private conversation (not a group)
        if (!from.includes('@g.us')) {
          // In private conversation, use the other participant's JID
          targetUser = from;
        } else {
          // In group, use sender
          targetUser = message.key.participant || message.key.remoteJid;
        }
      }

      // If command has "set" as first argument, handle setting bio (owner only)
      if (args.length > 0 && args[0].toLowerCase() === 'set') {
        if (!message.key.fromMe) {
          await respond('❌ Only the bot owner can set bio!');
          return;
        }

        const newBio = args.slice(1).join(' ');
        if (!newBio) {
          await respond('❌ Please provide a bio to set!\n\n*Example:* .bio set Your new bio here');
          return;
        }

        await client.updateProfileStatus(newBio);
        await respond(`✅ *Bio Updated*\n\n📝 New bio: "${newBio}"\n\n> Bio has been successfully updated!`);
        return;
      }

      await respond('📄 *Getting user bio...*\nPlease wait...');

      // Get user status/bio
      const status = await client.fetchStatus(targetUser);

      if (status && status.status) {
        const bioInfo = `📋 *User Bio Information*\n\n👤 *User:* @${targetUser.split('@')[0]}\n📝 *Bio:* ${status.status}\n📅 *Last Updated:* ${new Date(status.setAt).toLocaleString()}\n\n> Powered by TREKKERMD LIFETIME BOT`;
        await respond(bioInfo);
      } else {
        await respond(`📋 *User Bio Information*\n\n👤 *User:* @${targetUser.split('@')[0]}\n📝 *Bio:* No bio set or privacy settings prevent access.\n\n> Powered by TREKKERMD LIFETIME BOT`);
      }

    } catch (error) {
      console.error('Error getting user bio:', error);
      await respond('❌ Failed to get user bio. User may have privacy settings enabled or bio is not accessible.');
    }
  }
});

// Register animation commands
commandRegistry.register({
  name: 'happy',
  aliases: ['smile', 'joy'],
  description: 'Send happy emoji animation',
  category: 'FUN',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    const happyEmojis = ['😃', '😄', '😁', '😊', '😎', '🥳', '😸', '😹', '🌞', '🌈'];
    const randomEmoji = happyEmojis[Math.floor(Math.random() * happyEmojis.length)];
    await respond(`${randomEmoji} *Feeling Happy!* ${randomEmoji}\n\n✨ Spread the joy and happiness! ✨`);
  }
});

commandRegistry.register({
  name: 'sad',
  aliases: ['cry', 'heartbroken'],
  description: 'Send sad emoji animation',
  category: 'FUN',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    const sadEmojis = ['😢', '😭', '💔', '😞', '😔', '🥺', '😿'];
    const randomEmoji = sadEmojis[Math.floor(Math.random() * sadEmojis.length)];
    await respond(`${randomEmoji} *Feeling Sad* ${randomEmoji}\n\n💙 Hope you feel better soon! 💙`);
  }
});

commandRegistry.register({
  name: 'angry',
  aliases: ['mad', 'rage'],
  description: 'Send angry emoji animation',
  category: 'FUN',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    const angryEmojis = ['😡', '😠', '🤬', '😤', '😾'];
    const randomEmoji = angryEmojis[Math.floor(Math.random() * angryEmojis.length)];
    await respond(`${randomEmoji} *Feeling Angry!* ${randomEmoji}\n\n T*ake a deep breath and calm down!* 🌪️`);
  }
});

commandRegistry.register({
  name: 'love',
  aliases: ['heart', 'hrt'],
  description: 'Send love emoji animation',
  category: 'FUN',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    const loveEmojis = ['💖', '💗', '💕', '❤️', '💛', '💚', '💙', '💜', '🖤', '🤍', '♥️'];
    const randomEmoji = loveEmojis[Math.floor(Math.random() * loveEmojis.length)];
    await respond(`${randomEmoji} *Sending Love!* ${randomEmoji}\n\n💝 Love and peace to everyone! 💝`);
  }
});

commandRegistry.register({
  name: 'truth',
  aliases: ['truthgame'],
  description: 'Get a truth question',
  category: 'FUN',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    const truthQuestions = [
      'What\'s the most embarrassing thing you\'ve ever done?',
      'What\'s your biggest fear?',
      'What\'s the last lie you told?',
      'What\'s your biggest secret?',
      'Who was your first crush?',
      'What\'s something you\'ve never told anyone?',
      'What\'s your worst habit?',
      'What\'s the most childish thing you still do?'
    ];
    const randomTruth = truthQuestions[Math.floor(Math.random() * truthQuestions.length)];
    await respond(`🎯 *Truth Question:*\n\n${randomTruth}\n\n💭 Answer honestly!`);
  }
});

commandRegistry.register({
  name: 'dare',
  aliases: ['daregame'],
  description: 'Get a dare challenge',
  category: 'FUN',
  handler: async (context: CommandContext) => {
    const { respond } = context;
    const dareQuestions = [
      'Send a funny selfie to the group',
      'Do 10 push-ups',
      'Sing your favorite song',
      'Dance for 30 seconds',
      'Tell a joke',
      'Share an embarrassing story',
      'Do your best animal impression',
      'Call a random contact and say something funny'
    ];
    const randomDare = dareQuestions[Math.floor(Math.random() * dareQuestions.length)];
    await respond(`🎯 *Dare Challenge:*\n\n${randomDare}\n\n💪 Are you brave enough?`);
  }
});

// Add all the other categories as placeholders for now
const categoryCommands = {
  'ANIME': ['anime', 'manga', 'waifu'],
  'LOGO': ['logo', 'textlogo', 'banner'],
  'STICKER': ['sticker', 'stick', 's'],
  'CONVERT': ['convert', 'toimg', 'tovideo'],
  'GROUP': ['promote', 'demote', 'kick', 'add', 'tagall'],
  'ADMIN': ['antilink', 'welcome', 'goodbye', 'mute'],
  'AI': ['gpt', 'ai', 'chatgpt', 'bard'],
  'TOOLS': ['qr', 'weather', 'translate', 'calculator'],
  'SEARCH': ['google', 'image', 'lyrics', 'news'],
  'GAME': ['tictactoe', 'guess', 'riddle', 'math']
};

// Essential TREKKER-MD commands only - custom commands managed through admin panel
// Placeholder commands removed - using clean command system

// Plugin system completely removed - using clean TREKKER-MD command system
console.log('🧹 Plugin system disabled - Clean TREKKER-MD commands only');

// Register antidelete command
commandRegistry.register({
  name: 'antidelete',
  aliases: ['antidel', 'savedeleted'],
  description: 'Configure antidelete functionality (Owner only)',
  category: 'ADMIN',
  handler: async (context: CommandContext) => {
    const { respond, message, client, args } = context;

    // Extract match from args
    const match = args.length > 0 ? args[0].toLowerCase() : undefined;

    // Call antidelete service handler
    await antideleteService.handleAntideleteCommand(client, message.key.remoteJid!, message, match);
  }
});

// Register anti-viewonce command
commandRegistry.register({
  name: 'antiviewonce',
  aliases: ['aviewonce', 'viewonce'],
  description: 'Enable or disable anti-viewonce feature',
  category: 'ADMIN',
  handler: async (context: CommandContext) => {
    const { respond, message, client, args } = context;

    // Check if sender is bot owner (from own number)
    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      const { getAntiViewOnceService } = await import('./antiviewonce.js');
      const antiViewOnceService = getAntiViewOnceService(context.botId);

      if (!args || args.length === 0) {
        const statusMessage = antiViewOnceService.getStatusMessage();
        await respond(statusMessage);
        return;
      }

      const command = args[0].toLowerCase();

      if (command === 'on') {
        antiViewOnceService.setEnabled(true);
        await respond('✅ Anti ViewOnce has been enabled!\nAll ViewOnce messages will now be intercepted and saved.');
      } else if (command === 'off') {
        antiViewOnceService.setEnabled(false);
        await respond('❌ Anti ViewOnce has been disabled.');
      } else {
        await respond('❌ Invalid command. Use: .antiviewonce on/off');
      }
    } catch (error) {
      console.error('Error in antiviewonce command:', error);
      await respond('❌ Error managing anti-viewonce settings.');
    }
  }
});

// Register getviewonce command for attempting ViewOnce recovery
commandRegistry.register({
  name: 'getviewonce',
  aliases: ['getvo', 'recoverviewonce'],
  description: 'Attempt to recover ViewOnce content from a quoted message',
  category: 'ADMIN',
  handler: async (context: CommandContext) => {
    const { respond, message, client } = context;

    // Check if sender is bot owner
    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      // Check if this is a reply to a message
      const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
      const quotedMessageId = message.message?.extendedTextMessage?.contextInfo?.stanzaId;

      if (!quotedMessage && !quotedMessageId) {
        await respond('❌ Please reply to a message to attempt ViewOnce recovery.');
        return;
      }

      console.log(`🔍 [GetViewOnce] Attempting recovery for message ID: ${quotedMessageId}`);
      console.log(`🔍 [GetViewOnce] Quoted message structure:`, JSON.stringify(quotedMessage, null, 2));

      // Import antidelete service to check stored messages
      const { antideleteService } = await import('./antidelete.js');
      const storedMessage = antideleteService.getStoredMessage(quotedMessageId);

      if (storedMessage && storedMessage.mediaPath) {
        await respond(`📁 *ViewOnce Recovery Attempt*\n\n✅ Found stored media for message ID: ${quotedMessageId}\n📂 Media Type: ${storedMessage.mediaType}\n📍 Path: ${storedMessage.mediaPath}\n⏰ Original Time: ${new Date(storedMessage.timestamp).toLocaleString()}`);
      } else {
        await respond(`🔍 *ViewOnce Recovery Attempt*\n\n❌ No stored content found for message ID: ${quotedMessageId}\n\n💡 **Possible reasons:**\n- Message was already processed by WhatsApp\n- ViewOnce was viewed before bot could intercept\n- Message is not a ViewOnce message\n- Anti-ViewOnce was disabled when message was sent\n\n🛡️ Enable Anti-ViewOnce with .antiviewonce on for future messages.`);
      }

    } catch (error) {
      console.error('Error in getviewonce command:', error);
      await respond('❌ Error attempting ViewOnce recovery.');
    }
  }
});

// Group Management Commands

// Create Group
commandRegistry.register({
  name: 'creategroup',
  aliases: ['newgroup', 'makegroup'],
  description: 'Create a new WhatsApp group (Owner only)',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, message, client, args } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (args.length < 2) {
      await respond('❌ Usage: .creategroup <group name> @user1 @user2...\n\nExample: .creategroup "My Group" @254712345678');
      return;
    }

    try {
      const groupName = args[0].replace(/['"]/g, '');
      const mentionedUsers = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

      if (mentionedUsers.length === 0) {
        await respond('❌ Please mention at least one user to add to the group!');
        return;
      }

      const group = await client.groupCreate(groupName, mentionedUsers);
      await respond(`✅ *Group Created Successfully!*\n\n📋 *Name:* ${groupName}\n🆔 *Group ID:* ${group.gid}\n👥 *Members:* ${mentionedUsers.length}\n\n> Group created by TREKKERMD LIFETIME BOT`);

      // Send welcome message to the new group
      await client.sendMessage(group.id, { 
        text: `🎉 *Welcome to ${groupName}!*\n\n✨ This group was created by TREKKERMD LIFETIME BOT\n👋 Say hello everyone!` 
      });

    } catch (error) {
      console.error('Error creating group:', error);
      await respond('❌ Failed to create group. Make sure all mentioned users are valid WhatsApp numbers.');
    }
  }
});

// Change Group Subject/Name
commandRegistry.register({
  name: 'setname',
  aliases: ['changename', 'groupname'],
  description: 'Change group name (Admin only)',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from, args } = context;

    if (!from.endsWith('@g.us')) {
      await respond('❌ This command can only be used in group chats!');
      return;
    }

    if (args.length === 0) {
      await respond('❌ Usage: .setname <new group name>\n\nExample: .setname My Awesome Group');
      return;
    }

    try {
      const groupMetadata = await client.groupMetadata(from);
      const senderNumber = message.key.participant || message.key.remoteJid;
      const senderIsAdmin = groupMetadata.participants.find((p: any) => p.id === senderNumber)?.admin;

      if (!senderIsAdmin) {
        await respond('❌ Only group admins can change the group name!');
        return;
      }

      const newName = args.join(' ');
      await client.groupUpdateSubject(from, newName);
      await respond(`✅ *Group Name Updated!*\n\n📝 *New Name:* ${newName}\n\n> Updated by TREKKERMD LIFETIME BOT`);

    } catch (error) {
      console.error('Error changing group name:', error);
      await respond('❌ Failed to change group name!');
    }
  }
});

// Change Group Description
commandRegistry.register({
  name: 'setdesc',
  aliases: ['changedesc', 'groupdesc'],
  description: 'Change group description (Admin only)',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from, args } = context;

    if (!from.endsWith('@g.us')) {
      await respond('❌ This command can only be used in group chats!');
      return;
    }

    if (args.length === 0) {
      await respond('❌ Usage: .setdesc <new description>\n\nExample: .setdesc Welcome to our community group!');
      return;
    }

    try {
      const groupMetadata = await client.groupMetadata(from);
      const senderNumber = message.key.participant || message.key.remoteJid;
      const senderIsAdmin = groupMetadata.participants.find((p: any) => p.id === senderNumber)?.admin;

      if (!senderIsAdmin) {
        await respond('❌ Only group admins can change the group description!');
        return;
      }

      const newDesc = args.join(' ');
      await client.groupUpdateDescription(from, newDesc);
      await respond(`✅ *Group Description Updated!*\n\n📝 *New Description:* ${newDesc}\n\n> Updated by TREKKERMD LIFETIME BOT`);

    } catch (error) {
      console.error('Error changing group description:', error);
      await respond('❌ Failed to change group description!');
    }
  }
});

// Group Settings - Announcement Mode
commandRegistry.register({
  name: 'announce',
  aliases: ['announcement', 'adminonly'],
  description: 'Toggle announcement mode (Admin only)',
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
        await respond('❌ Only group admins can change group settings!');
        return;
      }

      const mode = args[0]?.toLowerCase();
      if (mode === 'on' || mode === 'enable') {
        await client.groupSettingUpdate(from, 'announcement');
        await respond('✅ *Announcement Mode Enabled*\n\n🔒 Only admins can send messages now.\n\n> Updated by TREKKERMD LIFETIME BOT');
      } else if (mode === 'off' || mode === 'disable') {
        await client.groupSettingUpdate(from, 'not_announcement');
        await respond('✅ *Announcement Mode Disabled*\n\n🔓 Everyone can send messages now.\n\n> Updated by TREKKERMD LIFETIME BOT');
      } else {
        await respond('❌ Usage: .announce on/off\n\n*on* - Only admins can send messages\n*off* - Everyone can send messages');
      }

    } catch (error) {
      console.error('Error changing announcement mode:', error);
      await respond('❌ Failed to change announcement mode!');
    }
  }
});

// Lock/Unlock Group Settings
commandRegistry.register({
  name: 'locksettings',
  aliases: ['lockgroup', 'grouplock'],
  description: 'Lock/unlock group settings (Admin only)',
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
        await respond('❌ Only group admins can change group settings!');
        return;
      }

      const mode = args[0]?.toLowerCase();
      if (mode === 'on' || mode === 'lock') {
        await client.groupSettingUpdate(from, 'locked');
        await respond('✅ *Group Settings Locked*\n\n🔒 Only admins can modify group settings now.\n\n> Updated by TREKKERMD LIFETIME BOT');
      } else if (mode === 'off' || mode === 'unlock') {
        await client.groupSettingUpdate(from, 'unlocked');
        await respond('✅ *Group Settings Unlocked*\n\n🔓 Everyone can modify group settings now.\n\n> Updated by TREKKERMD LIFETIME BOT');
      } else {
        await respond('❌ Usage: .locksettings on/off\n\n*on* - Only admins can modify settings\n*off* - Everyone can modify settings');
      }

    } catch (error) {
      console.error('Error changing group lock settings:', error);
      await respond('❌ Failed to change group lock settings!');
    }
  }
});

// Leave Group
commandRegistry.register({
  name: 'leave',
  aliases: ['leavegroup', 'exit'],
  description: 'Leave the group (Owner only)',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, message, client, from } = context;

    if (!from.endsWith('@g.us')) {
      await respond('❌ This command can only be used in group chats!');
      return;
    }

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      await respond('👋 *Goodbye everyone!*\n\n🤖 TREKKERMD LIFETIME BOT is leaving the group.\n\n> Thank you for using our service!');
      
      // Wait a bit before leaving
      setTimeout(async () => {
        await client.groupLeave(from);
      }, 2000);

    } catch (error) {
      console.error('Error leaving group:', error);
      await respond('❌ Failed to leave the group!');
    }
  }
});

// Revoke Invite Link
commandRegistry.register({
  name: 'revoke',
  aliases: ['revokelink', 'resetlink'],
  description: 'Revoke and generate new group invite link (Admin only)',
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
        await respond('❌ Only group admins can revoke invite links!');
        return;
      }

      const code = await client.groupRevokeInvite(from);
      const inviteLink = `https://chat.whatsapp.com/${code}`;
      await respond(`✅ *Invite Link Revoked!*\n\n🔗 *New Invite Link:*\n${inviteLink}\n\n⚠️ Old link is no longer valid.\n\n> Updated by TREKKERMD LIFETIME BOT`);

    } catch (error) {
      console.error('Error revoking invite link:', error);
      await respond('❌ Failed to revoke invite link!');
    }
  }
});

// Join Group via Invite Code
commandRegistry.register({
  name: 'join',
  aliases: ['joingroup', 'acceptinvite'],
  description: 'Join a group using invite code (Owner only)',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, message, client, args } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    if (args.length === 0) {
      await respond('❌ Usage: .join <invite_code>\n\nExample: .join ABC123DEF456\nor\n.join https://chat.whatsapp.com/ABC123DEF456');
      return;
    }

    try {
      // Extract code from link if full URL is provided
      let code = args[0];
      if (code.includes('chat.whatsapp.com/')) {
        code = code.split('chat.whatsapp.com/')[1];
      }

      const response = await client.groupAcceptInvite(code);
      await respond(`✅ *Successfully Joined Group!*\n\n🆔 *Group ID:* ${response}\n\n> Joined by TREKKERMD LIFETIME BOT`);

    } catch (error) {
      console.error('Error joining group:', error);
      await respond('❌ Failed to join group. Invalid invite code or link expired.');
    }
  }
});

// Get Group Invite Info
commandRegistry.register({
  name: 'groupinviteinfo',
  aliases: ['inviteinfo', 'checklink'],
  description: 'Get group information from invite code',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, args, client } = context;

    if (args.length === 0) {
      await respond('❌ Usage: .groupinviteinfo <invite_code>\n\nExample: .groupinviteinfo ABC123DEF456');
      return;
    }

    try {
      let code = args[0];
      if (code.includes('chat.whatsapp.com/')) {
        code = code.split('chat.whatsapp.com/')[1];
      }

      const info = await client.groupGetInviteInfo(code);
      const infoText = `📋 *Group Invite Information*\n\n` +
        `🏷️ *Name:* ${info.subject}\n` +
        `👥 *Size:* ${info.size} members\n` +
        `📝 *Description:* ${info.desc || 'No description'}\n` +
        `🆔 *Group ID:* ${info.id}\n\n` +
        `> Information retrieved by TREKKERMD LIFETIME BOT`;

      await respond(infoText);

    } catch (error) {
      console.error('Error getting invite info:', error);
      await respond('❌ Failed to get group information. Invalid invite code.');
    }
  }
});

// Toggle Disappearing Messages
commandRegistry.register({
  name: 'disappear',
  aliases: ['ephemeral', 'vanish'],
  description: 'Toggle disappearing messages (Admin only)',
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
        await respond('❌ Only group admins can change disappearing message settings!');
        return;
      }

      const timeOptions: Record<string, number> = {
        'off': 0,
        '24h': 86400,
        '7d': 604800,
        '90d': 7776000
      };

      const option = args[0]?.toLowerCase();
      const seconds = timeOptions[option];

      if (seconds === undefined) {
        await respond('❌ Usage: .disappear <time>\n\n*Options:*\n• off - Disable\n• 24h - 24 hours\n• 7d - 7 days\n• 90d - 90 days');
        return;
      }

      await client.groupToggleEphemeral(from, seconds);
      
      const timeText = option === 'off' ? 'Disabled' : option.toUpperCase();
      await respond(`✅ *Disappearing Messages ${option === 'off' ? 'Disabled' : 'Enabled'}*\n\n⏱️ *Duration:* ${timeText}\n\n> Updated by TREKKERMD LIFETIME BOT`);

    } catch (error) {
      console.error('Error toggling disappearing messages:', error);
      await respond('❌ Failed to update disappearing message settings!');
    }
  }
});

// Change Add Mode
commandRegistry.register({
  name: 'addmode',
  aliases: ['memberadd', 'addpermission'],
  description: 'Change who can add members (Admin only)',
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
        await respond('❌ Only group admins can change member add settings!');
        return;
      }

      const mode = args[0]?.toLowerCase();
      if (mode === 'all' || mode === 'everyone') {
        await client.groupMemberAddMode(from, 'all_member_add');
        await respond('✅ *Add Mode Updated*\n\n👥 Everyone can add members now.\n\n> Updated by TREKKERMD LIFETIME BOT');
      } else if (mode === 'admin' || mode === 'admins') {
        await client.groupMemberAddMode(from, 'admin_add');
        await respond('✅ *Add Mode Updated*\n\n👑 Only admins can add members now.\n\n> Updated by TREKKERMD LIFETIME BOT');
      } else {
        await respond('❌ Usage: .addmode <mode>\n\n*Options:*\n• all - Everyone can add\n• admin - Only admins can add');
      }

    } catch (error) {
      console.error('Error changing add mode:', error);
      await respond('❌ Failed to update member add settings!');
    }
  }
});

// Get Join Request List
commandRegistry.register({
  name: 'requests',
  aliases: ['joinrequests', 'pendingrequests'],
  description: 'View pending join requests (Admin only)',
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
        await respond('❌ Only group admins can view join requests!');
        return;
      }

      const requests = await client.groupRequestParticipantsList(from);
      
      if (!requests || requests.length === 0) {
        await respond('✅ No pending join requests.');
        return;
      }

      let requestList = '📋 *Pending Join Requests*\n\n';
      requests.forEach((req: any, index: number) => {
        requestList += `${index + 1}. @${req.jid.split('@')[0]}\n`;
      });
      requestList += '\n> Use .approverequest or .rejectrequest to manage requests';

      await client.sendMessage(from, {
        text: requestList,
        mentions: requests.map((r: any) => r.jid)
      });

    } catch (error) {
      console.error('Error getting join requests:', error);
      await respond('❌ Failed to get join requests!');
    }
  }
});

// Approve Join Request
commandRegistry.register({
  name: 'approverequest',
  aliases: ['approve', 'acceptrequest'],
  description: 'Approve join request (Admin only)',
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
        await respond('❌ Only group admins can approve join requests!');
        return;
      }

      const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
      const mentionedUsers = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

      const usersToApprove = quotedUser ? [quotedUser] : mentionedUsers;

      if (usersToApprove.length === 0) {
        await respond('❌ Please reply to a message or mention users to approve!');
        return;
      }

      await client.groupRequestParticipantsUpdate(from, usersToApprove, 'approve');
      await respond(`✅ *Join Request Approved*\n\n👥 ${usersToApprove.length} user(s) approved.\n\n> Approved by TREKKERMD LIFETIME BOT`);

    } catch (error) {
      console.error('Error approving request:', error);
      await respond('❌ Failed to approve join request!');
    }
  }
});

// Reject Join Request
commandRegistry.register({
  name: 'rejectrequest',
  aliases: ['reject', 'denyrequest'],
  description: 'Reject join request (Admin only)',
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
        await respond('❌ Only group admins can reject join requests!');
        return;
      }

      const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
      const mentionedUsers = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

      const usersToReject = quotedUser ? [quotedUser] : mentionedUsers;

      if (usersToReject.length === 0) {
        await respond('❌ Please reply to a message or mention users to reject!');
        return;
      }

      await client.groupRequestParticipantsUpdate(from, usersToReject, 'reject');
      await respond(`✅ *Join Request Rejected*\n\n👥 ${usersToReject.length} user(s) rejected.\n\n> Rejected by TREKKERMD LIFETIME BOT`);

    } catch (error) {
      console.error('Error rejecting request:', error);
      await respond('❌ Failed to reject join request!');
    }
  }
});

// Get All Groups
commandRegistry.register({
  name: 'mygroups',
  aliases: ['groups', 'allgroups'],
  description: 'List all groups bot is in (Owner only)',
  category: 'GROUP',
  handler: async (context: CommandContext) => {
    const { respond, message, client } = context;

    if (!message.key.fromMe) {
      await respond('❌ This command can only be used by the bot owner!');
      return;
    }

    try {
      const groups = await client.groupFetchAllParticipating();
      const groupList = Object.values(groups);

      if (groupList.length === 0) {
        await respond('❌ Bot is not in any groups.');
        return;
      }

      let groupsText = `📋 *Bot Groups (${groupList.length})*\n\n`;
      groupList.forEach((group: any, index: number) => {
        groupsText += `${index + 1}. *${group.subject}*\n`;
        groupsText += `   👥 ${group.participants.length} members\n`;
        groupsText += `   🆔 ${group.id}\n\n`;
      });
      groupsText += '> Powered by TREKKERMD LIFETIME BOT';

      await respond(groupsText);

    } catch (error) {
      console.error('Error getting groups:', error);
      await respond('❌ Failed to get group list!');
    }
  }
});

// Load core commands and privacy commands
console.log('✅ Core commands module loaded successfully');