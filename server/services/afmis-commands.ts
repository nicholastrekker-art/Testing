import { commandRegistry, type CommandContext } from './command-registry.js';
import { storage } from '../storage.js';

// Hardcoded admin numbers
const ADMIN_NUMBERS = ['254704897825', '254799257758'];

// Helper function to check if user is admin
const isAdmin = (phoneNumber: string): boolean => {
  const cleanNumber = phoneNumber.replace(/[@s.whatsapp.net]/g, '');
  return ADMIN_NUMBERS.some(admin => cleanNumber.includes(admin));
};

// Helper function to parse duration
const parseDuration = (duration: string): { months: number; days: number } => {
  const months = duration.match(/(\d+)m/i)?.[1];
  const weeks = duration.match(/(\d+)w/i)?.[1];
  const days = duration.match(/(\d+)d/i)?.[1];

  let totalMonths = 0;
  let totalDays = 0;

  if (months) totalMonths += parseInt(months);
  if (weeks) totalDays += parseInt(weeks) * 7;
  if (days) totalDays += parseInt(days);

  return { months: totalMonths, days: totalDays };
};

// Helper function to add duration to date
const addDuration = (date: Date, months: number, days: number): Date => {
  const newDate = new Date(date);
  if (months > 0) {
    newDate.setMonth(newDate.getMonth() + months);
  }
  if (days > 0) {
    newDate.setDate(newDate.getDate() + days);
  }
  return newDate;
};

// Approve Bot Command
commandRegistry.register({
  name: 'approvebot',
  aliases: ['afmisapprove'],
  description: 'Approve a bot with custom expiry duration (Admin only)',
  category: 'Panel Administrator',
  ownerOnly: false,
  handler: async (context: CommandContext) => {
    const { respond, message, args, sender } = context;

    // Check if sender is admin
    if (!isAdmin(sender)) {
      await respond('❌ *Access Denied*\n\nThis command is restricted to Panel Administrators only.');
      return;
    }

    if (args.length < 2) {
      await respond(`❌ *Invalid Usage*

📋 *Usage:* .approvebot <phone_number> <duration>

*Duration Format:*
• 1m = 1 month
• 1w = 1 week
• 1d = 1 day
• Can combine: 1m2w3d = 1 month, 2 weeks, 3 days

*Examples:*
.approvebot 254704897824 1m
.approvebot 254704897824 2w
.approvebot 254704897824 1m2w
.approvebot 254704897824 3d

> AFMIS Bot Approval System`);
      return;
    }

    const phoneNumber = args[0].replace(/[^\d]/g, '');
    const durationStr = args[1];

    if (!/^\d{10,15}$/.test(phoneNumber)) {
      await respond('❌ Invalid phone number format!\nUse: 254704897824');
      return;
    }

    try {
      // Parse duration
      const { months, days } = parseDuration(durationStr);

      if (months === 0 && days === 0) {
        await respond('❌ Invalid duration format!\n\nUse: 1m (month), 1w (week), 1d (day)\nOr combine: 1m2w3d');
        return;
      }

      // Find bot by phone number
      const bot = await storage.getBotByPhoneNumber(phoneNumber);

      if (!bot) {
        await respond(`❌ *Bot Not Found*\n\n📱 No bot found with number: +${phoneNumber}\n\n💡 Use .pending to see all pending bots.`);
        return;
      }

      // Calculate new expiration date
      const now = new Date();
      const currentExpiry = bot.approvalDate && bot.expirationMonths 
        ? addDuration(new Date(bot.approvalDate), bot.expirationMonths, 0)
        : now;

      const newExpiry = addDuration(currentExpiry, months, days);
      const totalDays = Math.ceil((newExpiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Update bot approval
      await storage.updateBotInstance(bot.id, {
        approvalStatus: 'approved',
        approvalDate: now.toISOString(),
        expirationMonths: months,
        status: bot.status === 'offline' ? 'offline' : bot.status
      });

      // Create activity log
      await storage.createActivity({
        serverName: bot.serverName,
        botInstanceId: bot.id,
        type: 'afmis_approval',
        description: `Bot approved by AFMIS admin for ${months}m ${days}d`,
        metadata: {
          approvedBy: sender,
          duration: durationStr,
          expiryDate: newExpiry.toISOString()
        }
      });

      await respond(`✅ *Bot Approved Successfully*

📱 *Phone:* +${phoneNumber}
🤖 *Bot Name:* ${bot.name}
👤 *Admin:* ${sender.split('@')[0]}

⏰ *Duration Added:*
${months > 0 ? `• ${months} month(s)\n` : ''}${days > 0 ? `• ${days} day(s)\n` : ''}
📅 *Total Days:* ${totalDays} days

📆 *Expiry Date:* ${newExpiry.toLocaleDateString()} ${newExpiry.toLocaleTimeString()}

✅ *Status:* Approved & Active

> AFMIS Bot Approval System`);

    } catch (error) {
      console.error('Approve command error:', error);
      await respond('❌ Failed to approve bot. Please try again.');
    }
  }
});

// Pending Bots Command
commandRegistry.register({
  name: 'pending',
  aliases: ['pendingbots', 'listpending'],
  description: 'List all pending bots awaiting approval (Admin only)',
  category: 'Panel Administrator',
  ownerOnly: false,
  handler: async (context: CommandContext) => {
    const { respond, sender } = context;

    // Check if sender is admin
    if (!isAdmin(sender)) {
      await respond('❌ *Access Denied*\n\nThis command is restricted to Panel Administrators only.');
      return;
    }

    try {
      const pendingBots = await storage.getPendingBots();

      if (pendingBots.length === 0) {
        await respond('✅ *No Pending Bots*\n\nAll bots have been processed.\n\n> AFMIS Bot Management');
        return;
      }

      let message = `📋 *PENDING BOTS LIST*\n\n`;
      message += `📊 *Total:* ${pendingBots.length} bot(s)\n\n`;

      pendingBots.forEach((bot, index) => {
        const registeredDate = new Date(bot.createdAt).toLocaleDateString();
        message += `${index + 1}. *${bot.name}*\n`;
        message += `   📱 +${bot.phoneNumber}\n`;
        message += `   📅 ${registeredDate}\n`;
        message += `   🆔 ${bot.id}\n\n`;
      });

      message += `\n*Quick Approve:*\n`;
      message += `.approvebot <phone> <duration>\n`;
      message += `Example: .approvebot ${pendingBots[0].phoneNumber} 1m\n\n`;
      message += `> AFMIS Bot Management`;

      await respond(message);

    } catch (error) {
      console.error('Pending bots command error:', error);
      await respond('❌ Failed to retrieve pending bots. Please try again.');
    }
  }
});

// AFMIS Help Command
commandRegistry.register({
  name: 'afmis',
  aliases: ['afmishelp'],
  description: 'Show AFMIS admin commands help',
  category: 'Panel Administrator',
  ownerOnly: false,
  handler: async (context: CommandContext) => {
    const { respond, sender } = context;

    // Check if sender is admin
    if (!isAdmin(sender)) {
      await respond('❌ *Access Denied*\n\nThis command is restricted to Panel Administrators only.');
      return;
    }

    const helpMessage = `🔧 *PANEL ADMINISTRATOR COMMANDS*

📋 *Available Commands:*

1️⃣ *.approvebot <phone> <duration>*
   Approve a bot with custom expiry

   *Duration Format:*
   • 1m = 1 month
   • 1w = 1 week  
   • 1d = 1 day
   • Combine: 1m2w3d

   *Example:*
   .approvebot 254704897824 1m
   .approvebot 254704897824 2w5d

2️⃣ *.pending*
   List all pending bots

   *Example:*
   .pending

3️⃣ *.afmis*
   Show this help message

👥 *Authorized Admins:*
• +254704897825
• +254799257758

> Panel Administrator Management System`;

    await respond(helpMessage);
  }
});

console.log('✅ AFMIS admin commands loaded successfully');