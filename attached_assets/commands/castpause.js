
const { keith } = require("../keizzah/keith");
const fs = require('fs-extra');

// Register command to pause broadcast
keith({
  nomCom: 'castpause',
  aliase: 'pausebroadcast',
  categorie: "Admin",
  reaction: '⏸️'
}, async (bot, client, context) => {
  const { repondre, superUser } = context;

  if (!superUser) {
    return repondre("You are not authorized to use this command");
  }
  
  const progressFiles = [
    'broadcast_progress.json',
    'attached_assets/broadcast_progress.json'
  ];
  
  let pausedCount = 0;
  
  // Check each progress file
  for (const file of progressFiles) {
    if (await fs.pathExists(file)) {
      try {
        const progressData = await fs.readJSON(file);
        
        // Only pause active broadcasts
        if (progressData.isActive && !progressData.isPaused) {
          progressData.isPaused = true;
          progressData.pausedTimestamp = new Date().toISOString();
          
          // Save the updated progress data
          await fs.writeJSON(file, progressData);
          
          pausedCount++;
        }
      } catch (error) {
        console.error(`Error pausing broadcast in ${file}:`, error);
      }
    }
  }
  
  if (pausedCount > 0) {
    await repondre(`⏸️ Paused ${pausedCount} active broadcast(s). Use \`.castresume\` to continue the broadcast.`);
  } else {
    await repondre("No active broadcasts found to pause.");
  }
});
