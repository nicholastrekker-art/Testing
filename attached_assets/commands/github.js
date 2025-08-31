const axios = require('axios');
const fs = require('fs-extra');

class GitHubAPI {
  constructor(token) {
    this.token = token;
    this.baseURL = 'https://api.github.com';
    this.headers = {
      'Authorization': `token ${this.token}`,
      'Accept': 'application/vnd.github.v3+json'
    };
  }

  // Get file content from GitHub repository
  async getFileContent(owner, repo, path, branch = 'main') {
    try {
      const response = await axios.get(
        `${this.baseURL}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
        { headers: this.headers }
      );

      if (response.data.content) {
        // Decode base64 content
        return Buffer.from(response.data.content, 'base64').toString('utf8');
      }
      return null;
    } catch (error) {
      console.error(`Error getting file content: ${error.message}`);
      return null;
    }
  }

  // Update or create file in GitHub repository
  async updateFile(owner, repo, path, content, message, branch = 'main') {
    try {
      // First try to get the file to get its SHA
      let sha = null;
      try {
        const fileResponse = await axios.get(
          `${this.baseURL}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
          { headers: this.headers }
        );
        sha = fileResponse.data.sha;
      } catch (error) {
        // File doesn't exist, will be created
      }

      // Prepare request data
      const requestData = {
        message,
        content: Buffer.from(content).toString('base64'),
        branch
      };

      // Add SHA if updating an existing file
      if (sha) {
        requestData.sha = sha;
      }

      // Make request to update or create file
      const response = await axios.put(
        `${this.baseURL}/repos/${owner}/${repo}/contents/${path}`,
        requestData,
        { headers: this.headers }
      );

      return response.data;
    } catch (error) {
      console.error(`Error updating file: ${error.message}`);
      return null;
    }
  }

  // Download file from GitHub and save locally
  async downloadFile(owner, repo, path, localPath, branch = 'main') {
    try {
      const content = await this.getFileContent(owner, repo, path, branch);
      if (content) {
        await fs.writeFile(localPath, content);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error downloading file: ${error.message}`);
      return false;
    }
  }

  // Sync broadcast logs between local and GitHub
  async syncBroadcastLogs(owner, repo, path = 'broadcast_logs.json', branch = 'main') {
    try {
      // Get remote logs
      const remoteContent = await this.getFileContent(owner, repo, path, branch);
      let remoteLogs = [];

      if (remoteContent) {
        remoteLogs = JSON.parse(remoteContent);
      }

      // Get local logs
      let localLogs = [];
      if (await fs.pathExists('broadcast_logs.json')) {
        localLogs = await fs.readJSON('broadcast_logs.json');
      }

      // Merge logs (avoid duplicates by phone number)
      const phoneNumbers = new Set();
      const mergedLogs = [];

      // Add remote logs first
      for (const log of remoteLogs) {
        if (!phoneNumbers.has(log.phone_number)) {
          phoneNumbers.add(log.phone_number);
          mergedLogs.push(log);
        }
      }

      // Add local logs
      for (const log of localLogs) {
        if (!phoneNumbers.has(log.phone_number)) {
          phoneNumbers.add(log.phone_number);
          mergedLogs.push(log);
        }
      }

      // Save merged logs locally
      await fs.writeJSON('broadcast_logs.json', mergedLogs);

      // Upload merged logs to GitHub
      await this.updateFile(
        owner, 
        repo, 
        path, 
        JSON.stringify(mergedLogs, null, 2),
        'Update broadcast logs',
        branch
      );

      return mergedLogs.length;
    } catch (error) {
      console.error(`Error syncing broadcast logs: ${error.message}`);
      return -1;
    }
  }

  // Check if a file exists in the repository
  async fileExists(owner, repo, path, branch = "main") {
    try {
      const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
        headers: this.headers,
        validateStatus: (status) => status === 200 || status === 404
      });

      return response.status === 200;
    } catch (error) {
      console.error(`Error checking file existence: ${error.message}`);
      return false;
    }
  }
}

module.exports = GitHubAPI;