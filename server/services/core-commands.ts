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
      const antiViewOnceService = getAntiViewOnceService(context.botId || '');

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
      const storedMessage = antideleteService.getStoredMessage(quotedMessageId) as any;

      if (storedMessage && storedMessage.mediaPath) {
        await respond(`📁 *ViewOnce Recovery Attempt*\n\n✅ Found stored media for message ID: ${quotedMessageId}\n📂 Media Type: ${storedMessage.mediaType || 'Unknown'}\n📍 Path: ${storedMessage.mediaPath}\n⏰ Original Time: ${new Date(storedMessage.timestamp).toLocaleString()}`);
      } else {
        await respond(`🔍 *ViewOnce Recovery Attempt*\n\n❌ No stored content found for message ID: ${quotedMessageId}\n\n💡 **Possible reasons:**\n- Message was already processed by WhatsApp\n- ViewOnce was viewed before bot could intercept\n- Message is not a ViewOnce message\n- Anti-ViewOnce was disabled when message was sent\n\n🛡️ Enable Anti-ViewOnce with .antiviewonce on for future messages.`);
      }

    } catch (error) {
      console.error('Error in getviewonce command:', error);
      await respond('❌ Error attempting ViewOnce recovery.');
    }
  }
});

// ============ BAILEYS MESSAGE COMMANDS ============

// Location command
commandRegistry.register({
  name: 'location',
  aliases: ['loc', 'sendlocation'],
  description: 'Send location message',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, args } = context;
    
    if (args.length < 2) {
      return await respond('❌ Please provide latitude and longitude.\n\n*Example:* .location 24.121231 55.1121221');
    }
    
    try {
      const latitude = parseFloat(args[0]);
      const longitude = parseFloat(args[1]);
      
      if (isNaN(latitude) || isNaN(longitude)) {
        return await respond('❌ Invalid coordinates. Please provide valid numbers.');
      }
      
      await client.sendMessage(from, {
        location: {
          degreesLatitude: latitude,
          degreesLongitude: longitude
        }
      });
      
      await respond('✅ Location sent successfully!');
    } catch (error) {
      console.error('Error sending location:', error);
      await respond('❌ Failed to send location message.');
    }
  }
});

// Contact command
commandRegistry.register({
  name: 'sendcontact',
  aliases: ['vcard', 'contact'],
  description: 'Send contact card',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, args } = context;
    
    if (args.length < 2) {
      return await respond('❌ Please provide name and phone number.\n\n*Example:* .sendcontact John 1234567890');
    }
    
    try {
      const name = args[0];
      const phone = args.slice(1).join('');
      
      const vcard = 'BEGIN:VCARD\n'
        + 'VERSION:3.0\n'
        + `FN:${name}\n`
        + `TEL;type=CELL;type=VOICE;waid=${phone}:+${phone}\n`
        + 'END:VCARD';
      
      await client.sendMessage(from, {
        contacts: {
          displayName: name,
          contacts: [{ vcard }]
        }
      });
      
      await respond('✅ Contact card sent successfully!');
    } catch (error) {
      console.error('Error sending contact:', error);
      await respond('❌ Failed to send contact card.');
    }
  }
});

// React command
commandRegistry.register({
  name: 'react',
  aliases: ['reaction', 'emoji'],
  description: 'React to a message (reply to a message)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, args, message } = context;
    
    const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedMessageKey = message.message?.extendedTextMessage?.contextInfo;
    
    if (!quotedMessage || !quotedMessageKey) {
      return await respond('❌ Please reply to a message to react to it.');
    }
    
    if (args.length === 0) {
      return await respond('❌ Please provide an emoji.\n\n*Example:* .react 💖');
    }
    
    try {
      await client.sendMessage(from, {
        react: {
          text: args[0],
          key: {
            remoteJid: from,
            fromMe: quotedMessageKey.participant ? false : true,
            id: quotedMessageKey.stanzaId,
            participant: quotedMessageKey.participant
          }
        }
      });
      
      await respond('✅ Reaction sent!');
    } catch (error) {
      console.error('Error sending reaction:', error);
      await respond('❌ Failed to send reaction.');
    }
  }
});

// Poll command
commandRegistry.register({
  name: 'poll',
  aliases: ['createpoll'],
  description: 'Create a poll',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, args } = context;
    
    if (args.length < 3) {
      return await respond('❌ Please provide poll question and options.\n\n*Example:* .poll "Favorite color?" Red,Blue,Green');
    }
    
    try {
      const question = args[0].replace(/"/g, '');
      const options = args.slice(1).join(' ').split(',').map(opt => opt.trim());
      
      if (options.length < 2) {
        return await respond('❌ Please provide at least 2 options separated by commas.');
      }
      
      await client.sendMessage(from, {
        poll: {
          name: question,
          values: options,
          selectableCount: 1
        }
      });
      
      await respond('✅ Poll created successfully!');
    } catch (error) {
      console.error('Error creating poll:', error);
      await respond('❌ Failed to create poll.');
    }
  }
});

// Delete message command
commandRegistry.register({
  name: 'delete',
  aliases: ['del', 'remove'],
  description: 'Delete a message (reply to message)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, message } = context;
    
    const quotedMessageKey = message.message?.extendedTextMessage?.contextInfo;
    
    if (!quotedMessageKey) {
      return await respond('❌ Please reply to a message to delete it.');
    }
    
    try {
      await client.sendMessage(from, {
        delete: {
          remoteJid: from,
          fromMe: quotedMessageKey.participant ? false : true,
          id: quotedMessageKey.stanzaId,
          participant: quotedMessageKey.participant
        }
      });
      
      await respond('✅ Message deleted!');
    } catch (error) {
      console.error('Error deleting message:', error);
      await respond('❌ Failed to delete message.');
    }
  }
});

// Edit message command
commandRegistry.register({
  name: 'edit',
  aliases: ['editmsg'],
  description: 'Edit a sent message (reply to your message)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, args, message } = context;
    
    const quotedMessageKey = message.message?.extendedTextMessage?.contextInfo;
    
    if (!quotedMessageKey) {
      return await respond('❌ Please reply to your message to edit it.');
    }
    
    if (args.length === 0) {
      return await respond('❌ Please provide the new text.\n\n*Example:* .edit New message text');
    }
    
    try {
      await client.sendMessage(from, {
        text: args.join(' '),
        edit: {
          remoteJid: from,
          fromMe: true,
          id: quotedMessageKey.stanzaId
        }
      });
      
      await respond('✅ Message edited!');
    } catch (error) {
      console.error('Error editing message:', error);
      await respond('❌ Failed to edit message.');
    }
  }
});

// ============ BAILEYS CHAT MODIFIER COMMANDS ============

// Archive command
commandRegistry.register({
  name: 'archive',
  aliases: ['archivechat'],
  description: 'Archive current chat',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, message } = context;
    
    try {
      await client.chatModify(
        { archive: true, lastMessages: [message] },
        from
      );
      
      await respond('✅ Chat archived!');
    } catch (error) {
      console.error('Error archiving chat:', error);
      await respond('❌ Failed to archive chat.');
    }
  }
});

// Unarchive command
commandRegistry.register({
  name: 'unarchive',
  aliases: ['unarchivechat'],
  description: 'Unarchive current chat',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, message } = context;
    
    try {
      await client.chatModify(
        { archive: false, lastMessages: [message] },
        from
      );
      
      await respond('✅ Chat unarchived!');
    } catch (error) {
      console.error('Error unarchiving chat:', error);
      await respond('❌ Failed to unarchive chat.');
    }
  }
});

// Mute command
commandRegistry.register({
  name: 'mute',
  aliases: ['mutechat'],
  description: 'Mute current chat',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, args } = context;
    
    try {
      const duration = args[0] ? parseInt(args[0]) : 8 * 60 * 60; // Default 8 hours
      
      await client.chatModify(
        { mute: duration * 1000 },
        from
      );
      
      await respond(`✅ Chat muted for ${Math.floor(duration / 3600)} hours!`);
    } catch (error) {
      console.error('Error muting chat:', error);
      await respond('❌ Failed to mute chat.');
    }
  }
});

// Unmute command
commandRegistry.register({
  name: 'unmute',
  aliases: ['unmutechat'],
  description: 'Unmute current chat',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from } = context;
    
    try {
      await client.chatModify(
        { mute: null },
        from
      );
      
      await respond('✅ Chat unmuted!');
    } catch (error) {
      console.error('Error unmuting chat:', error);
      await respond('❌ Failed to unmute chat.');
    }
  }
});

// Mark as read command
commandRegistry.register({
  name: 'read',
  aliases: ['markread'],
  description: 'Mark message as read (reply to message)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, message } = context;
    
    const quotedMessageKey = message.message?.extendedTextMessage?.contextInfo;
    
    if (!quotedMessageKey) {
      return await respond('❌ Please reply to a message to mark it as read.');
    }
    
    try {
      await client.readMessages([{
        remoteJid: message.key.remoteJid,
        id: quotedMessageKey.stanzaId,
        participant: quotedMessageKey.participant
      }]);
      
      await respond('✅ Message marked as read!');
    } catch (error) {
      console.error('Error marking message as read:', error);
      await respond('❌ Failed to mark message as read.');
    }
  }
});

// ============ BAILEYS USER QUERY COMMANDS ============

// Check if number exists on WhatsApp
commandRegistry.register({
  name: 'checkwa',
  aliases: ['onwhatsapp', 'checkid'],
  description: 'Check if a number exists on WhatsApp',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, args } = context;
    
    if (args.length === 0) {
      return await respond('❌ Please provide a phone number.\n\n*Example:* .checkwa 1234567890');
    }
    
    try {
      const number = args[0].replace(/[^0-9]/g, '');
      const [result] = await client.onWhatsApp(number);
      
      if (result && result.exists) {
        await respond(`✅ *Number exists on WhatsApp*\n\n📱 Number: ${number}\n✓ JID: ${result.jid}`);
      } else {
        await respond(`❌ Number ${number} is not on WhatsApp`);
      }
    } catch (error) {
      console.error('Error checking WhatsApp number:', error);
      await respond('❌ Failed to check number.');
    }
  }
});

// Get user status
commandRegistry.register({
  name: 'getstatus',
  aliases: ['fetchstatus', 'userstatus'],
  description: 'Get user status (reply to message)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, message } = context;
    
    const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
    
    if (!quotedUser) {
      return await respond('❌ Please reply to a user message to get their status.');
    }
    
    try {
      const status = await client.fetchStatus(quotedUser);
      
      if (status && status.status) {
        const statusInfo = `📝 *User Status*\n\n💬 "${status.status}"\n⏰ Set: ${status.setAt ? new Date(status.setAt).toLocaleString() : 'Unknown'}`;
        await respond(statusInfo);
      } else {
        await respond('❌ User has no status or status is private.');
      }
    } catch (error) {
      console.error('Error fetching status:', error);
      await respond('❌ Failed to fetch status.');
    }
  }
});

// Block user
commandRegistry.register({
  name: 'block',
  aliases: ['blockuser'],
  description: 'Block a user (reply to message)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, message } = context;
    
    const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
    
    if (!quotedUser) {
      return await respond('❌ Please reply to a user message to block them.');
    }
    
    try {
      await client.updateBlockStatus(quotedUser, 'block');
      await respond('✅ User blocked successfully!');
    } catch (error) {
      console.error('Error blocking user:', error);
      await respond('❌ Failed to block user.');
    }
  }
});

// Unblock user
commandRegistry.register({
  name: 'unblock',
  aliases: ['unblockuser'],
  description: 'Unblock a user (provide number)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, args } = context;
    
    if (args.length === 0) {
      return await respond('❌ Please provide a phone number.\n\n*Example:* .unblock 1234567890');
    }
    
    try {
      const number = args[0].replace(/[^0-9]/g, '');
      const jid = `${number}@s.whatsapp.net`;
      
      await client.updateBlockStatus(jid, 'unblock');
      await respond('✅ User unblocked successfully!');
    } catch (error) {
      console.error('Error unblocking user:', error);
      await respond('❌ Failed to unblock user.');
    }
  }
});

// Get blocklist
commandRegistry.register({
  name: 'blocklist',
  aliases: ['getblocklist', 'blocked'],
  description: 'Get list of blocked contacts',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client } = context;
    
    try {
      const blocklist = await client.fetchBlocklist();
      
      if (blocklist && blocklist.length > 0) {
        let message = '🚫 *Blocked Contacts*\n\n';
        blocklist.forEach((jid: string, index: number) => {
          const number = jid.replace('@s.whatsapp.net', '');
          message += `${index + 1}. ${number}\n`;
        });
        await respond(message);
      } else {
        await respond('✅ No blocked contacts.');
      }
    } catch (error) {
      console.error('Error fetching blocklist:', error);
      await respond('❌ Failed to fetch blocklist.');
    }
  }
});

// ============ BAILEYS GROUP COMMANDS ============

// Group info
commandRegistry.register({
  name: 'groupinfo',
  aliases: ['ginfo', 'groupdetails'],
  description: 'Get group information (Group only)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from } = context;
    
    if (!from.endsWith('@g.us')) {
      return await respond('❌ This command only works in groups!');
    }
    
    try {
      const metadata = await client.groupMetadata(from);
      
      let info = `👥 *Group Information*\n\n`;
      info += `📝 *Name:* ${metadata.subject}\n`;
      info += `👤 *Owner:* ${metadata.owner ? metadata.owner.split('@')[0] : 'Unknown'}\n`;
      info += `📅 *Created:* ${new Date(metadata.creation * 1000).toLocaleDateString()}\n`;
      info += `👥 *Participants:* ${metadata.participants.length}\n`;
      info += `📜 *Description:* ${metadata.desc || 'No description'}\n`;
      
      await respond(info);
    } catch (error) {
      console.error('Error fetching group info:', error);
      await respond('❌ Failed to fetch group information.');
    }
  }
});

// Promote member
commandRegistry.register({
  name: 'promote',
  aliases: ['makeadmin'],
  description: 'Promote member to admin (reply to message)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, message } = context;
    
    if (!from.endsWith('@g.us')) {
      return await respond('❌ This command only works in groups!');
    }
    
    const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
    
    if (!quotedUser) {
      return await respond('❌ Please reply to a user message to promote them.');
    }
    
    try {
      await client.groupParticipantsUpdate(from, [quotedUser], 'promote');
      await respond('✅ User promoted to admin!');
    } catch (error) {
      console.error('Error promoting user:', error);
      await respond('❌ Failed to promote user. Make sure bot is admin.');
    }
  }
});

// Demote member
commandRegistry.register({
  name: 'demote',
  aliases: ['removeadmin'],
  description: 'Demote admin to member (reply to message)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, message } = context;
    
    if (!from.endsWith('@g.us')) {
      return await respond('❌ This command only works in groups!');
    }
    
    const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
    
    if (!quotedUser) {
      return await respond('❌ Please reply to a user message to demote them.');
    }
    
    try {
      await client.groupParticipantsUpdate(from, [quotedUser], 'demote');
      await respond('✅ User demoted to member!');
    } catch (error) {
      console.error('Error demoting user:', error);
      await respond('❌ Failed to demote user. Make sure bot is admin.');
    }
  }
});

// Add member
commandRegistry.register({
  name: 'add',
  aliases: ['addmember'],
  description: 'Add member to group (provide number)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, args } = context;
    
    if (!from.endsWith('@g.us')) {
      return await respond('❌ This command only works in groups!');
    }
    
    if (args.length === 0) {
      return await respond('❌ Please provide a phone number.\n\n*Example:* .add 1234567890');
    }
    
    try {
      const number = args[0].replace(/[^0-9]/g, '');
      const jid = `${number}@s.whatsapp.net`;
      
      await client.groupParticipantsUpdate(from, [jid], 'add');
      await respond('✅ User added to group!');
    } catch (error) {
      console.error('Error adding user:', error);
      await respond('❌ Failed to add user. Make sure bot is admin and user privacy allows adding.');
    }
  }
});

// Remove member
commandRegistry.register({
  name: 'remove',
  aliases: ['kick', 'removemember'],
  description: 'Remove member from group (reply to message)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, message } = context;
    
    if (!from.endsWith('@g.us')) {
      return await respond('❌ This command only works in groups!');
    }
    
    const quotedUser = message.message?.extendedTextMessage?.contextInfo?.participant;
    
    if (!quotedUser) {
      return await respond('❌ Please reply to a user message to remove them.');
    }
    
    try {
      await client.groupParticipantsUpdate(from, [quotedUser], 'remove');
      await respond('✅ User removed from group!');
    } catch (error) {
      console.error('Error removing user:', error);
      await respond('❌ Failed to remove user. Make sure bot is admin.');
    }
  }
});

// Change group subject
commandRegistry.register({
  name: 'setname',
  aliases: ['setgroupname', 'changename'],
  description: 'Change group name (Group only)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, args } = context;
    
    if (!from.endsWith('@g.us')) {
      return await respond('❌ This command only works in groups!');
    }
    
    if (args.length === 0) {
      return await respond('❌ Please provide a new group name.\n\n*Example:* .setname My Awesome Group');
    }
    
    try {
      const newName = args.join(' ');
      await client.groupUpdateSubject(from, newName);
      await respond(`✅ Group name changed to: ${newName}`);
    } catch (error) {
      console.error('Error changing group name:', error);
      await respond('❌ Failed to change group name. Make sure bot is admin.');
    }
  }
});

// Change group description
commandRegistry.register({
  name: 'setdesc',
  aliases: ['setdescription', 'changedesc'],
  description: 'Change group description (Group only)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from, args } = context;
    
    if (!from.endsWith('@g.us')) {
      return await respond('❌ This command only works in groups!');
    }
    
    if (args.length === 0) {
      return await respond('❌ Please provide a new description.\n\n*Example:* .setdesc Welcome to our group!');
    }
    
    try {
      const newDesc = args.join(' ');
      await client.groupUpdateDescription(from, newDesc);
      await respond('✅ Group description updated!');
    } catch (error) {
      console.error('Error changing group description:', error);
      await respond('❌ Failed to change description. Make sure bot is admin.');
    }
  }
});

// Get group invite link
commandRegistry.register({
  name: 'invite',
  aliases: ['invitelink', 'grouplink'],
  description: 'Get group invite link (Group only)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from } = context;
    
    if (!from.endsWith('@g.us')) {
      return await respond('❌ This command only works in groups!');
    }
    
    try {
      const code = await client.groupInviteCode(from);
      await respond(`🔗 *Group Invite Link*\n\nhttps://chat.whatsapp.com/${code}`);
    } catch (error) {
      console.error('Error getting invite link:', error);
      await respond('❌ Failed to get invite link. Make sure bot is admin.');
    }
  }
});

// Revoke group invite link
commandRegistry.register({
  name: 'revoke',
  aliases: ['revokelink', 'resetlink'],
  description: 'Revoke and generate new invite link (Group only)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from } = context;
    
    if (!from.endsWith('@g.us')) {
      return await respond('❌ This command only works in groups!');
    }
    
    try {
      const code = await client.groupRevokeInvite(from);
      await respond(`🔗 *New Group Invite Link*\n\nhttps://chat.whatsapp.com/${code}\n\n⚠️ Old link has been revoked!`);
    } catch (error) {
      console.error('Error revoking invite link:', error);
      await respond('❌ Failed to revoke link. Make sure bot is admin.');
    }
  }
});

// Leave group
commandRegistry.register({
  name: 'leave',
  aliases: ['leavegroup', 'exit'],
  description: 'Bot leaves the group (Group only)',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from } = context;
    
    if (!from.endsWith('@g.us')) {
      return await respond('❌ This command only works in groups!');
    }
    
    try {
      await respond('👋 Goodbye! Thanks for using TREKKERMD LIFETIME BOT!');
      await client.groupLeave(from);
    } catch (error) {
      console.error('Error leaving group:', error);
      await respond('❌ Failed to leave group.');
    }
  }
});

// ============ BAILEYS PROFILE COMMANDS ============

// Set bot status
commandRegistry.register({
  name: 'setstatus',
  aliases: ['setbio', 'changestatus'],
  description: 'Set bot status/bio',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, args } = context;
    
    if (args.length === 0) {
      return await respond('❌ Please provide a status text.\n\n*Example:* .setstatus TREKKERMD BOT is online!');
    }
    
    try {
      const status = args.join(' ');
      await client.updateProfileStatus(status);
      await respond(`✅ Status updated to: "${status}"`);
    } catch (error) {
      console.error('Error updating status:', error);
      await respond('❌ Failed to update status.');
    }
  }
});

// Set bot profile name
commandRegistry.register({
  name: 'setprofilename',
  aliases: ['setbotname', 'changeprofilename'],
  description: 'Set bot profile name',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, args } = context;
    
    if (args.length === 0) {
      return await respond('❌ Please provide a name.\n\n*Example:* .setprofilename TREKKERMD BOT');
    }
    
    try {
      const name = args.join(' ');
      await client.updateProfileName(name);
      await respond(`✅ Profile name updated to: ${name}`);
    } catch (error) {
      console.error('Error updating profile name:', error);
      await respond('❌ Failed to update profile name.');
    }
  }
});

// ============ BAILEYS PRESENCE COMMANDS ============

// Update presence
commandRegistry.register({
  name: 'typing',
  aliases: ['composing'],
  description: 'Show typing indicator',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from } = context;
    
    try {
      await client.sendPresenceUpdate('composing', from);
      await respond('✅ Typing indicator sent for 10 seconds!');
      
      setTimeout(async () => {
        await client.sendPresenceUpdate('paused', from);
      }, 10000);
    } catch (error) {
      console.error('Error updating presence:', error);
      await respond('❌ Failed to update presence.');
    }
  }
});

// Recording presence
commandRegistry.register({
  name: 'recording',
  aliases: ['voicenote'],
  description: 'Show recording indicator',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from } = context;
    
    try {
      await client.sendPresenceUpdate('recording', from);
      await respond('✅ Recording indicator sent for 10 seconds!');
      
      setTimeout(async () => {
        await client.sendPresenceUpdate('paused', from);
      }, 10000);
    } catch (error) {
      console.error('Error updating presence:', error);
      await respond('❌ Failed to update presence.');
    }
  }
});

// Online presence
commandRegistry.register({
  name: 'online',
  aliases: ['available'],
  description: 'Show online status',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from } = context;
    
    try {
      await client.sendPresenceUpdate('available', from);
      await respond('✅ Now showing as online!');
    } catch (error) {
      console.error('Error updating presence:', error);
      await respond('❌ Failed to update presence.');
    }
  }
});

// Offline presence
commandRegistry.register({
  name: 'offline',
  aliases: ['unavailable'],
  description: 'Show offline status',
  category: 'BAILEYS',
  handler: async (context: CommandContext) => {
    const { respond, client, from } = context;
    
    try {
      await client.sendPresenceUpdate('unavailable', from);
      await respond('✅ Now showing as offline!');
    } catch (error) {
      console.error('Error updating presence:', error);
      await respond('❌ Failed to update presence.');
    }
  }
});

export { commandRegistry };