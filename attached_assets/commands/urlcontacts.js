
const { keith } = require("../keizzah/keith");
const { Pool } = require("pg");
const fs = require('fs-extra');
const axios = require('axios');
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

// Create broadcast logs table if it doesn't exist (same as in broadcast2 command)
async function createBroadcastLogsTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS broadcast_logs (
        id SERIAL PRIMARY KEY,
        phone_number TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("Broadcast logs table created or already exists");
  } finally {
    client.release();
  }
}

// Log a number as having been messaged
async function logMessaged(phoneNumber) {
  const client = await pool.connect();
  try {
    const query = "INSERT INTO broadcast_logs (phone_number) VALUES ($1) ON CONFLICT DO NOTHING";
    await client.query(query, [phoneNumber]);
    return true;
  } catch (error) {
    console.error("Error logging messaged number:", error);
    return false;
  } finally {
    client.release();
  }
}

// Download contacts from URL
async function downloadContacts(url) {
  try {
    const response = await axios.get(url);
    await fs.writeFile('verified_contacts.txt', response.data);
    return true;
  } catch (error) {
    console.error('Error downloading contacts:', error);
    return false;
  }
}

// Parse contacts
function parseContacts(content) {
  const lines = content.split('\n');
  const contacts = [];
  
  for (let i = 1; i < lines.length; i++) { // Skip header
    const line = lines[i].trim();
    if (!line) continue;
    
    const lastComma = line.lastIndexOf(',');
    if (lastComma !== -1) {
      let phoneNumber = line.substring(lastComma + 1).trim();
      
      // Clean phone number
      phoneNumber = phoneNumber.replace(/\+/g, '').replace(/\s+/g, '');
      
      if (phoneNumber) {
        contacts.push(phoneNumber);
      }
    }
  }
  
  return contacts;
}

// Initialize table
createBroadcastLogsTable();

// Register urlcontacts command
keith({
  nomCom: 'urlcontacts',
  aliase: 'importcontacts',
  categorie: "Admin",
  reaction: '📋'
}, async (bot, client, context) => {
  const { repondre, superUser, arg } = context;

  if (!superUser) {
    return repondre("You are not authorized to use this command");
  }

  // Default URL or use provided URL
  const url = arg[0] || 'https://raw.githubusercontent.com/Beltah254/BELTAH-MD/main/verified_contacts.txt';
  
  await repondre(`Downloading contacts from ${url}...`);
  
  // Download contacts file
  const downloaded = await downloadContacts(url);
  if (!downloaded) {
    return repondre("Failed to download contacts file. Please check the URL and try again.");
  }
  
  await repondre("File downloaded! Now processing contacts...");
  
  try {
    const fileContent = await fs.readFile('verified_contacts.txt', 'utf8');
    const contacts = parseContacts(fileContent);
    
    if (contacts.length === 0) {
      return repondre("No valid contacts found in the file.");
    }
    
    await repondre(`Found ${contacts.length} contacts. Starting import to database...`);
    
    // Process contacts in batches to avoid memory overload
    const batchSize = 50;
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < contacts.length; i += batchSize) {
      const batch = contacts.slice(i, i + batchSize);
      await repondre(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(contacts.length/batchSize)}...`);
      
      for (const phoneNumber of batch) {
        const success = await logMessaged(phoneNumber);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }
      }
      
      // Give a progress update
      await repondre(`Progress: ${i + batch.length}/${contacts.length} contacts processed\n` +
                    `✅ Successfully imported: ${successCount}\n` +
                    `❌ Failed imports: ${failCount}`);
    }
    
    // Final report
    await repondre(`Import completed!\n` +
                  `📊 Total contacts from file: ${contacts.length}\n` +
                  `✅ Successfully imported: ${successCount}\n` +
                  `❌ Failed imports: ${failCount}\n\n` +
                  `These contacts will now be skipped during .broadcast2 command to avoid duplicate messages.`);
                  
  } catch (error) {
    console.error('Error processing contacts:', error);
    repondre(`An error occurred: ${error.message}`);
  }
});
