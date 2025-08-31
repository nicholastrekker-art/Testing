
const { keith } = require("../keizzah/keith");
const fs = require('fs-extra');

// Register command to resume paused broadcast
keith({
  nomCom: 'castresume',
  aliase: 'resumebroadcast',
  categorie: "Admin",
  reaction: '▶️'
}, async (bot, client, context) => {
  const { repondre, superUser } = context;

  if (!superUser) {
    return repondre("You are not authorized to use this command");
  }
  
  const progressFiles = [
    'broadcast_progress.json',
    'attached_assets/broadcast_progress.json'
  ];
  
  let resumedCount = 0;
  
  // Check each progress file
  for (const file of progressFiles) {
    if (await fs.pathExists(file)) {
      try {
        const progressData = await fs.readJSON(file);
        
        // Only resume paused broadcasts
        if (progressData.isPaused) {
          progressData.isPaused = false;
          progressData.isActive = true;
          progressData.resumedTimestamp = new Date().toISOString();
          
          // Save the updated progress data
          await fs.writeJSON(file, progressData);
          
          resumedCount++;
        }
      } catch (error) {
        console.error(`Error resuming broadcast in ${file}:`, error);
      }
    }
  }
  
  if (resumedCount > 0) {
    await repondre(`▶️ Resumed ${resumedCount} paused broadcast(s). Use \`.broadcast2\` to continue sending messages.`);
  } else {
    await repondre("No paused broadcasts found to resume.");
  }
});
