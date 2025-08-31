
const { keith } = require("../keizzah/keith");

// Register castcmds command
keith({
  nomCom: 'castcmds',
  aliase: 'broadcastcommands',
  categorie: "Admin",
  reaction: '📜'
}, async (bot, client, context) => {
  const { repondre } = context;
  
  const message = `*📢 BROADCAST COMMANDS 📢*

*1. .broadcast2* or *.txtsend*
   Downloads contacts from GitHub contacts.txt
   Sends messages with random delays
   Logs sent numbers to prevent duplicate messages
   
*2. .broadcast*
   Original broadcast command for sending messages
   
*3. .wabroadcastresume* or *.resumebroadcast*
   Resumes a broadcast that was interrupted
   Continues from where it left off
   
*4. .castinfo* or *.broadcastinfo*
   Shows detailed information about active broadcasts
   Displays progress, statistics, and estimated time remaining
   
*5. .castpause* or *.pausebroadcast*
   Pauses an active broadcast
   Saves current state for later resumption
   
*6. .castresume* or *.resumebroadcast*
   Resumes a paused broadcast
   Continues from where it was paused
   
*7. .resetlist* or *.clearbroadcastlogs*
   Clears the database of already messaged contacts
   Use with caution - requires confirmation
   
*8. .resetbroadcast*
   Clears all broadcast progress files
   Use with caution - requires confirmation
   
*9. .urlcontacts* or *.importcontacts*
   Imports verified contacts from URL
   Adds them to the "already messaged" list
   
*10. .databasecheck* or *.dbcheck*
   Checks if database connection is working
   Provides report on tables and saved data
   Shows broadcast statistics
   
*11. .githubconfig* or *.checkgithub*
   Checks GitHub API configuration
   Tests connection to the repository
   Verifies contacts.txt availability
   
*12. .gitclone*
   Clone GitHub repositories
   Useful for getting latest bot files

These commands help manage mass message sending while avoiding duplicate messages and server overload.`;

  await repondre(message);
});
