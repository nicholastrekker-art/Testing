
const { keith } = require("../keizzah/keith");
const { Pool } = require("pg");
const s = require("../set");

// Register databasecheck command
keith({
  nomCom: 'databasecheck',
  aliase: 'dbcheck',
  categorie: "Admin",
  reaction: '🛢️'
}, async (bot, client, context) => {
  const { repondre, superUser } = context;
  
  if (!superUser) {
    return repondre("❌ You are not authorized to use this command.");
  }

  await repondre("🔍 Checking database connection and generating report...");
  
  // Get database URL
  const dbUrl = s.DATABASE_URL ? s.DATABASE_URL : "postgresql://flashmd_user:JlUe2Vs0UuBGh0sXz7rxONTeXSOra9XP@dpg-cqbd04tumphs73d2706g-a/flashmd";
  
  // Configure PostgreSQL connection
  const proConfig = {
    connectionString: dbUrl,
    ssl: {
      rejectUnauthorized: false,
    },
    // Set a connection timeout
    connectionTimeoutMillis: 10000, 
  };
  
  // Create a pool
  const pool = new Pool(proConfig);
  
  try {
    // Test connection
    const client = await pool.connect();
    await repondre("✅ Database connection successful!");
    
    // Get database information
    let report = "📊 *DATABASE REPORT* 📊\n\n";
    report += `*Database URL:* ${maskDatabaseUrl(dbUrl)}\n\n`;
    
    try {
      // List all tables
      const tableQuery = `
        SELECT 
          tablename 
        FROM 
          pg_catalog.pg_tables 
        WHERE 
          schemaname != 'pg_catalog' 
          AND schemaname != 'information_schema'
      `;
      
      const tableResult = await client.query(tableQuery);
      const tables = tableResult.rows.map(row => row.tablename);
      
      report += `*Tables in Database (${tables.length}):*\n`;
      if (tables.length > 0) {
        for (const table of tables) {
          report += `- ${table}\n`;
          
          // Count rows in each table
          const countResult = await client.query(`SELECT COUNT(*) FROM "${table}"`);
          const rowCount = countResult.rows[0].count;
          
          // Get column information
          const columnQuery = `
            SELECT 
              column_name, 
              data_type 
            FROM 
              information_schema.columns 
            WHERE 
              table_name = $1
          `;
          
          const columnResult = await client.query(columnQuery, [table]);
          const columns = columnResult.rows.map(row => `${row.column_name} (${row.data_type})`);
          
          report += `  • Rows: ${rowCount}\n`;
          report += `  • Columns: ${columns.length}\n`;
          
          // Sample data (first row) if table has data
          if (rowCount > 0) {
            const sampleResult = await client.query(`SELECT * FROM "${table}" LIMIT 1`);
            if (sampleResult.rows.length > 0) {
              report += `  • Sample data: ${JSON.stringify(sampleResult.rows[0]).substring(0, 100)}${JSON.stringify(sampleResult.rows[0]).length > 100 ? '...' : ''}\n`;
            }
          }
          
          report += '\n';
        }
      } else {
        report += "No tables found in the database.\n\n";
      }
      
      // Check broadcast_logs table (used for broadcasts)
      if (tables.includes('broadcast_logs')) {
        const broadcastLogsCount = await client.query('SELECT COUNT(*) FROM broadcast_logs');
        report += `*Broadcast Logs:*\n`;
        report += `- Total messaged contacts: ${broadcastLogsCount.rows[0].count}\n\n`;
      }
      
      await repondre(report);
      
    } catch (error) {
      report += `\n❌ *Error getting database info:* ${error.message}\n`;
      await repondre(report);
    }
    
    client.release();
    
  } catch (error) {
    await repondre(`❌ *Database Connection Error*\n\n*Error details:* ${error.message}\n\n*Database URL:* ${maskDatabaseUrl(dbUrl)}\n\nPlease check your database configuration in set.js or .env file.`);
  } finally {
    // End pool
    await pool.end();
  }
});

// Function to mask sensitive parts of the database URL
function maskDatabaseUrl(url) {
  try {
    // Simple regex-based approach to mask the password
    return url.replace(/\/\/([^:]+):([^@]+)@/, '//\$1:****@');
  } catch (e) {
    return "MASKED_URL";
  }
}
