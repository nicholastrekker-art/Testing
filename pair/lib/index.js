const fs = require('fs').promises; 

// Simple in-memory session storage (no MongoDB needed)
const sessionStorage = new Map();

function giftedId(num = 22) {
  let result = "";
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const charactersLength = characters.length;

  for (let i = 0; i < num; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
}

async function downloadCreds(sessionId) {  
  try {
    // Validate Base64 format
    try {
      Buffer.from(sessionId, 'base64').toString();
    } catch (e) {
      throw new Error('Invalid SESSION_ID: Must be valid Base64 format');
    }

    // Get from local storage
    const sessionData = sessionStorage.get(sessionId);

    if (!sessionData?.credsData) {
      throw new Error('No sessionData found in local storage');
    }

    // Decode Base64 back to JSON
    const decodedCreds = Buffer.from(sessionData.credsData, 'base64').toString('utf8');
    return JSON.parse(decodedCreds);
  } catch (error) {
    console.error('Download Error:', error.message);
    throw error;
  }
}

// Function to access sessionStorage from other modules
function getSessionStorage() {
  return sessionStorage;
}

async function removeFile(filePath) {
  try {
    await fs.access(filePath);
    await fs.rm(filePath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Remove Error:', error.message);
    }
    return false;
  }
}

module.exports = { 
  downloadCreds, 
  removeFile, 
  giftedId,
  getSessionStorage,
  sessionStorage
};