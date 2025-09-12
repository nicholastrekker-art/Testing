import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const exists = promisify(fs.exists);
const generateChecksum = (content) => {
    const str = JSON.stringify(content, Object.keys(content).sort());
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
};
const scanExistingCreds = async () => {
    const authDir = path.join(process.cwd(), 'auth');
    const credsFiles = [];
    if (!fs.existsSync(authDir)) {
        return credsFiles;
    }
    const authFolders = fs.readdirSync(authDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
    for (const folder of authFolders) {
        const credsPath = path.join(authDir, folder, 'creds.json');
        if (fs.existsSync(credsPath)) {
            try {
                const content = JSON.parse(await readFile(credsPath, 'utf8'));
                const checksum = generateChecksum(content);
                credsFiles.push({
                    path: credsPath,
                    content,
                    checksum
                });
            }
            catch (error) {
                console.warn(`Warning: Could not read creds file ${credsPath}:`, error);
            }
        }
    }
    return credsFiles;
};
export const validateCredsUniqueness = async (newCredsContent) => {
    try {
        const existingCreds = await scanExistingCreds();
        const newChecksum = generateChecksum(newCredsContent);
        for (const existing of existingCreds) {
            if (existing.checksum === newChecksum) {
                return {
                    exists: true,
                    existingPath: existing.path,
                    message: `⚠️ Your creds.json already exists in the database at: ${existing.path}\n\nThe credentials you're trying to add are identical to an existing bot instance. Please use the existing bot or create new credentials.`
                };
            }
        }
        return {
            exists: false,
            message: '✅ Credentials are unique and can be added.'
        };
    }
    catch (error) {
        console.error('Error validating creds uniqueness:', error);
        return {
            exists: false,
            message: '⚠️ Could not validate credential uniqueness. Proceeding with caution.'
        };
    }
};
export const getCredsStats = async () => {
    try {
        const existingCreds = await scanExistingCreds();
        const uniqueChecksums = new Set(existingCreds.map(cred => cred.checksum));
        return {
            totalBots: existingCreds.length,
            activeBots: existingCreds.length,
            uniqueCredentials: uniqueChecksums.size
        };
    }
    catch (error) {
        console.error('Error getting creds stats:', error);
        return {
            totalBots: 0,
            activeBots: 0,
            uniqueCredentials: 0
        };
    }
};
export const cleanupDuplicateCreds = async () => {
    try {
        const existingCreds = await scanExistingCreds();
        const seenChecksums = new Set();
        const duplicates = [];
        const errors = [];
        for (const cred of existingCreds) {
            if (seenChecksums.has(cred.checksum)) {
                duplicates.push(cred.path);
            }
            else {
                seenChecksums.add(cred.checksum);
            }
        }
        console.log(`Found ${duplicates.length} duplicate credential files:`, duplicates);
        return {
            removed: 0,
            errors
        };
    }
    catch (error) {
        console.error('Error cleaning up duplicate creds:', error);
        return {
            removed: 0,
            errors: [error instanceof Error ? error.message : 'Unknown error occurred']
        };
    }
};
export default {
    validateCredsUniqueness,
    getCredsStats,
    cleanupDuplicateCreds
};
