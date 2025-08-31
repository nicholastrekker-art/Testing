
const { keith } = require("../keizzah/keith");
const fs = require('fs-extra');

function formatDate(dateString) {
  try {
    const date = new Date(dateString);
    return date.toLocaleString();
  } catch (e) {
    return "Invalid Date";
  }
}

// Register command to get broadcast information
keith({
  nomCom: 'castinfo',
  aliase: 'broadcastinfo',
  categorie: "Admin",
  reaction: '📊'
}, async (bot, client, context) => {
  const { repondre, superUser } = context;

  if (!superUser) {
    return repondre("You are not authorized to use this command");
  }

  // Create attached_assets directory if it doesn't exist
  await fs.ensureDir('attached_assets');
  
  const progressFiles = [
    'broadcast_progress.json',
    'attached_assets/broadcast_progress.json',
    'attached_assets/check_progress.json'
  ];
  
  let foundProgress = false;
  let message = "*📊 BROADCAST INFORMATION 📊*\n\n";
  
  // Check each progress file
  for (const file of progressFiles) {
    if (await fs.pathExists(file)) {
      foundProgress = true;
      try {
        const progressData = await fs.readJSON(file);
        const isActive = progressData.isActive !== undefined ? progressData.isActive : true;
        const isPaused = progressData.isPaused || false;
        const timestamp = progressData.timestamp || progressData.lastActive || "Unknown";
        const current = progressData.currentIndex || 0;
        const total = progressData.totalContacts || 0;
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        const remaining = total - current;
        
        // Get stats information
        const stats = progressData.stats || {};
        const successCount = stats.successCount || 0;
        const registeredCount = stats.registeredCount || 0;
        const notRegisteredCount = stats.notRegisteredCount || 0;
        const alreadyMessagedCount = stats.alreadyMessagedCount || 0;
        
        message += `*File:* ${file}\n`;
        if (isPaused) {
          message += `*Status:* 🟡 Paused\n`;
        } else {
          message += `*Status:* ${isActive ? "🟢 Active" : "🔴 Inactive"}\n`;
        }
        message += `*Last Updated:* ${formatDate(timestamp)}\n`;
        message += `*Progress:* ${current}/${total} (${percent}%)\n`;
        message += `*Remaining:* ${remaining} contacts\n\n`;
        
        message += `*Statistics:*\n`;
        message += `✅ Successfully sent: ${successCount}\n`;
        message += `📱 Registered on WhatsApp: ${registeredCount}\n`;
        message += `❌ Not registered: ${notRegisteredCount}\n`;
        message += `⏭️ Already messaged: ${alreadyMessagedCount}\n\n`;
        
        // Estimate remaining time based on average time per message
        if (isActive && !isPaused && current > 0 && timestamp) {
          const startTime = new Date(progressData.startTimestamp || timestamp).getTime();
          const currentTime = new Date().getTime();
          const elapsedTimeMs = currentTime - startTime;
          const msPerContact = elapsedTimeMs / current;
          const remainingTimeMs = remaining * msPerContact;
          
          // Convert to hours, minutes
          const remainingHours = Math.floor(remainingTimeMs / (1000 * 60 * 60));
          const remainingMinutes = Math.floor((remainingTimeMs % (1000 * 60 * 60)) / (1000 * 60));
          
          message += `*Estimated time remaining:* ${remainingHours}h ${remainingMinutes}m\n\n`;
        }
      } catch (error) {
        message += `*File:* ${file}\n`;
        message += `*Error:* Could not parse file (${error.message})\n\n`;
      }
    }
  }
  
  if (!foundProgress) {
    message += "No active broadcasts found.\n";
    message += "Use `.broadcast2` to start a new broadcast.\n";
  } else {
    message += "*Available Commands:*\n";
    message += "• `.broadcast2` - Continue the most recent broadcast\n";
    message += "• `.broadcast2 restart` - Start a new broadcast\n";
    message += "• `.castpause` - Pause the current broadcast\n";
    message += "• `.castresume` - Resume a paused broadcast\n";
    message += "• `.resetbroadcast` - Clear all progress files\n";
  }
  
  await repondre(message);
});
