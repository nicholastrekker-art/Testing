
const { keith } = require("../keizzah/keith");
const { Pool } = require("pg");
const s = require("../set");

// Database configuration
const dbUrl = s.DATABASE_URL ? s.DATABASE_URL : "postgresql://flashmd_user:JlUe2Vs0UuBGh0sXz7rxONTeXSOra9XP@dpg-cqbd04tumphs73d2706g-a/flashmd";
const proConfig = {
  connectionString: dbUrl,
  ssl: {
    rejectUnauthorized: false,
  },
};

const pool = new Pool(proConfig);

// Register resetlist command
keith({
  nomCom: 'resetlist',
  aliase: 'clearbroadcastlogs',
  categorie: "Admin",
  reaction: '🗑️'
}, async (bot, client, context) => {
  const { repondre, superUser, arg } = context;

  if (!superUser) {
    return repondre("You are not authorized to use this command");
  }

  try {
    const client = await pool.connect();
    
    try {
      // Check if table exists first
      const checkTableQuery = `
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'broadcast_logs'
        );
      `;
      const tableExists = await client.query(checkTableQuery);
      
      if (!tableExists.rows[0].exists) {
        return repondre("No broadcast logs found. The table doesn't exist yet.");
      }
      
      // Get count before deletion
      const countQuery = "SELECT COUNT(*) FROM broadcast_logs";
      const countResult = await client.query(countQuery);
      const count = parseInt(countResult.rows[0].count);
      
      // Confirm deletion if requested
      if (arg[0] === "confirm") {
        // Delete all records
        await client.query("TRUNCATE TABLE broadcast_logs");
        
        await repondre(`✅ Successfully cleared broadcast logs!\n📊 Removed ${count} contact(s) from the database.\n\nFuture broadcasts will now send messages to all contacts.`);
      } else {
        // Ask for confirmation
        await repondre(`⚠️ WARNING: You are about to clear ${count} contact(s) from the broadcast logs.\n\nThis means future broadcasts will send messages to these contacts again.\n\nTo confirm, type: .resetlist confirm`);
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error resetting broadcast logs:", error);
    repondre(`An error occurred: ${error.message}`);
  }
});
