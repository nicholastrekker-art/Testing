
const { keith } = require("../keizzah/keith");
const fs = require('fs-extra');
const path = require('path');

// Helper function to format date
function formatDate(dateString) {
  try {
    const date = new Date(dateString);
    return date.toLocaleString();
  } catch (e) {
    return "Invalid Date";
  }
}

// Register command to check broadcast progress
keith({
  nomCom: 'checkprogress',
  aliase: 'broadcaststatus',
  categorie: "Admin",
  reaction: '📊'
}, async (bot, client, context) => {
  const { repondre, superUser, arg } = context;

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
  let message = "*📊 BROADCAST PROGRESS REPORT 📊*\n\n";
  
  // Check each progress file
  for (const file of progressFiles) {
    if (await fs.pathExists(file)) {
      foundProgress = true;
      try {
        const progressData = await fs.readJSON(file);
        const isActive = progressData.isActive !== undefined ? progressData.isActive : true;
        const timestamp = progressData.timestamp || progressData.lastActive || "Unknown";
        const current = progressData.currentIndex || 0;
        const total = progressData.totalContacts || 0;
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        
        message += `*File:* ${file}\n`;
        message += `*Status:* ${isActive ? "🟢 Active" : "🔴 Inactive"}\n`;
        message += `*Last Updated:* ${formatDate(timestamp)}\n`;
        message += `*Progress:* ${current}/${total} (${percent}%)\n`;
        
        // Show stats if available
        if (progressData.stats) {
          if (progressData.stats.successCount !== undefined) {
            message += `*Successfully sent:* ${progressData.stats.successCount}\n`;
          }
          if (progressData.stats.alreadyMessagedCount !== undefined) {
            message += `*Already messaged:* ${progressData.stats.alreadyMessagedCount}\n`;
          }
        }
        message += "\n";
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
    message += "*Commands:*\n";
    message += "• `.broadcast2` - Continue the most recent broadcast\n";
    message += "• `.broadcast2 restart` - Start a new broadcast\n";
    message += "• `.resetbroadcast` - Clear all progress files\n";
  }
  
  // Handle arguments
  if (arg.includes("reset") || arg.includes("clear")) {
    if (arg.includes("confirm")) {
      // Clear all progress files
      for (const file of progressFiles) {
        if (await fs.pathExists(file)) {
          await fs.remove(file);
        }
      }
      return repondre("✅ All broadcast progress files have been cleared. You can start a fresh broadcast now.");
    } else {
      return repondre("⚠️ This will clear all broadcast progress. To confirm, type: `.checkprogress reset confirm`");
    }
  }
  
  await repondre(message);
});

// Register command to reset broadcast progress
keith({
  nomCom: 'resetbroadcast',
  aliase: 'clearbroadcastprogress',
  categorie: "Admin",
  reaction: '🗑️'
}, async (bot, client, context) => {
  const { repondre, superUser, arg } = context;

  if (!superUser) {
    return repondre("You are not authorized to use this command");
  }
  
  const progressFiles = [
    'broadcast_progress.json',
    'attached_assets/broadcast_progress.json',
    'attached_assets/check_progress.json'
  ];
  
  if (arg.includes("confirm")) {
    // Clear all progress files
    let clearedCount = 0;
    for (const file of progressFiles) {
      if (await fs.pathExists(file)) {
        await fs.remove(file);
        clearedCount++;
      }
    }
    
    if (clearedCount > 0) {
      return repondre(`✅ Cleared ${clearedCount} broadcast progress files. You can start a fresh broadcast now.`);
    } else {
      return repondre("No broadcast progress files found to clear.");
    }
  } else {
    return repondre("⚠️ This will clear all broadcast progress and you'll need to start over. To confirm, type: `.resetbroadcast confirm`");
  }
});
