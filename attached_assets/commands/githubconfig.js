
const { keith } = require("../keizzah/keith");
const fs = require('fs-extra');
const GitHubAPI = require("../keizzah/github");

// GitHub configuration
const GITHUB_TOKEN = process.env.GITHUB_API || "";
const GITHUB_OWNER = "Beltah254";
const GITHUB_REPO = "BELTAH-MD";
const GITHUB_BRANCH = "main";

// Initialize GitHub API
const github = new GitHubAPI(GITHUB_TOKEN);
const GitHubAPI = require("../keizzah/github");
const s = require("../set");

keith({
  nomCom: 'githubconfig',
  aliase: 'checkgithub',
  categorie: "Admin",
  reaction: '🔧'
}, async (bot, client, context) => {
  const { repondre, superUser } = context;

  if (!superUser) {
    return repondre("You are not authorized to use this command");
  }

  const token = process.env.GITHUB_API || "";
  
  if (!token) {
    return repondre("❌ GITHUB_API secret is not set. Please set it using the Secrets tool.");
  }
  
  try {
    // Initialize GitHub API
    const github = new GitHubAPI(token);
    const owner = "Beltah254";
    const repo = "BELTAH-MD";
    
    // Try to get a file to test the API
    repondre("🔍 Testing GitHub API connection...");
    
    const readme = await github.getFileContent(owner, repo, "README.md");
    
    if (readme) {
      repondre(`✅ GitHub API configured correctly!\n\nRepository: ${owner}/${repo}\nAPI Token starts with: ${token.substring(0, 4)}${"*".repeat(token.length - 8)}${token.substring(token.length - 4)}`);
    } else {
      repondre("❌ Could not fetch files from GitHub. The token may be invalid or the repository doesn't exist.");
    }
  } catch (error) {
    repondre(`❌ Error testing GitHub API: ${error.message}`);
  }
});
const { keith } = require("../keizzah/keith");
const fs = require('fs-extra');
const GitHubAPI = require("../keizzah/github");

// GitHub configuration
const GITHUB_TOKEN = process.env.GITHUB_API || "";
const GITHUB_OWNER = "Beltah254";
const GITHUB_REPO = "BELTAH-MD";
const GITHUB_BRANCH = "main";

// Initialize GitHub API
const github = new GitHubAPI(GITHUB_TOKEN);

// Register command to check GitHub connection
keith({
  nomCom: 'checkgithub',
  aliase: 'githubstatus',
  categorie: "Admin",
  reaction: '📊'
}, async (bot, client, context) => {
  const { repondre, superUser } = context;

  if (!superUser) {
    return repondre("⛔ You are not authorized to use this command");
  }

  await repondre("🔍 Checking GitHub API connection...");
  
  // Check if token is provided
  if (!GITHUB_TOKEN) {
    return repondre("❌ GitHub API token is not configured. Please set the GITHUB_API environment variable.");
  }
  
  try {
    // Test a simple API call
    const readme = await github.getFileContent(GITHUB_OWNER, GITHUB_REPO, 'README.md', GITHUB_BRANCH);
    
    if (readme) {
      await repondre(`✅ GitHub API connection successful!\n\nRepository: ${GITHUB_OWNER}/${GITHUB_REPO}\nBranch: ${GITHUB_BRANCH}\nToken: ${GITHUB_TOKEN.substring(0, 4)}...${GITHUB_TOKEN.slice(-4)}`);
      
      // Check for contacts.txt
      const contacts = await github.getFileContent(GITHUB_OWNER, GITHUB_REPO, 'contacts.txt', GITHUB_BRANCH);
      if (contacts) {
        await repondre("✅ contacts.txt file found in repository!");
        
        // Count lines to estimate number of contacts
        const lines = contacts.split('\n').length - 1; // Subtract header
        await repondre(`📊 Approximately ${lines} contacts found in file.`);
      } else {
        await repondre("⚠️ contacts.txt file not found in repository!");
      }
      
      // Check for broadcast logs
      const logs = await github.getFileContent(GITHUB_OWNER, GITHUB_REPO, 'broadcast_logs.json', GITHUB_BRANCH);
      if (logs) {
        try {
          const parsedLogs = JSON.parse(logs);
          await repondre(`✅ broadcast_logs.json found with ${parsedLogs.length} entries.`);
        } catch (e) {
          await repondre("⚠️ broadcast_logs.json found but could not be parsed.");
        }
      } else {
        await repondre("⚠️ broadcast_logs.json not found in repository!");
      }
      
    } else {
      await repondre("⚠️ GitHub API connection successful, but could not read README.md. Check repository permissions.");
    }
  } catch (error) {
    await repondre(`❌ GitHub API connection failed:\n${error.message}\n\nCheck your token and repository settings.`);
  }
});
