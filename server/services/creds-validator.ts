import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { db, getServerName } from '../db';
import { botInstances, godRegister } from '@shared/schema';
import { eq } from 'drizzle-orm';

const readFile = promisify(fs.readFile);

export const extractPhoneNumber = (credentials: any): string | null => {
  if (!credentials) return null;

  let phoneNumber: string | null = null;

  if (credentials?.creds?.me?.lid) {
    const lidMatch = credentials.creds.me.lid.match(/^(\d+)[@:]/);
    phoneNumber = lidMatch ? lidMatch[1] : null;
  }

  if (!phoneNumber && credentials?.creds?.me?.id) {
    const phoneMatch = credentials.creds.me.id.match(/^(\d+)[@:]/);
    phoneNumber = phoneMatch ? phoneMatch[1] : null;
  }

  if (!phoneNumber && credentials?.me?.id) {
    const phoneMatch = credentials.me.id.match(/^(\d+)[@:]/);
    phoneNumber = phoneMatch ? phoneMatch[1] : null;
  }

  if (!phoneNumber && credentials?.me?.lid) {
    const lidMatch = credentials.me.lid.match(/^(\d+)[@:]/);
    phoneNumber = lidMatch ? lidMatch[1] : null;
  }

  if (!phoneNumber && credentials?.creds) {
    const credsStr = JSON.stringify(credentials.creds);
    const phoneMatches = credsStr.match(/(\d{10,15})/g);
    if (phoneMatches && phoneMatches.length > 0) {
      const validPhones = phoneMatches.filter(num => 
        num.length >= 10 && num.length <= 15 && 
        !num.startsWith('0') &&
        parseInt(num) > 1000000000
      );
      if (validPhones.length > 0) {
        phoneNumber = validPhones[0];
      }
    }
  }

  if (!phoneNumber) {
    const findPhoneInObject = (obj: any, depth = 0): string | null => {
      if (depth > 5 || !obj || typeof obj !== 'object') return null;

      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          const phoneMatch = value.match(/(\d{10,15}):/);
          if (phoneMatch) return phoneMatch[1];

          if (key.toLowerCase().includes('phone') || key.toLowerCase().includes('number')) {
            const cleanNumber = value.replace(/\D/g, '');
            if (cleanNumber.length >= 10 && cleanNumber.length <= 15) {
              return cleanNumber;
            }
          }
        } else if (typeof value === 'object') {
          const found = findPhoneInObject(value, depth + 1);
          if (found) return found;
        }
      }
      return null;
    };

    phoneNumber = findPhoneInObject(credentials);
  }

  return phoneNumber;
};

interface CredsInfo {
  path: string;
  content: any;
  checksum: string;
}

// Generate a simple checksum for creds content
const generateChecksum = (content: any): string => {
  const str = JSON.stringify(content, Object.keys(content).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
};

// Scan all auth directories for creds.json files
const scanExistingCreds = async (): Promise<CredsInfo[]> => {
  const authDir = path.join(process.cwd(), 'auth');
  const credsFiles: CredsInfo[] = [];
  
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
      } catch (error) {
        console.warn(`Warning: Could not read creds file ${credsPath}:`, error);
      }
    }
  }
  
  return credsFiles;
};

// Check if credentials already exist in database by phone number (cross-server search)
export const validateCredentialsByPhoneNumber = async (credentials: any): Promise<{
  isValid: boolean;
  message?: string;
  phoneNumber?: string;
  alreadyRegistered?: boolean;
}> => {
  try {
    const phoneNumber = extractPhoneNumber(credentials);
    
    if (!phoneNumber) {
      return {
        isValid: false,
        message: "❌ Cannot extract phone number from credentials. Invalid credential format."
      };
    }

    const currentServerName = getServerName();

    // First check global registration
    const [globalRegistration] = await db.select().from(godRegister).where(eq(godRegister.phoneNumber, phoneNumber));
    
    if (globalRegistration) {
      // Phone number is globally registered - block registration regardless of bot existence
      const isCurrentServer = globalRegistration.tenancyName === currentServerName;
      
      return {
        isValid: false,
        message: isCurrentServer 
          ? "❌ This phone number is already registered on this server. You can update your bot credentials if you own this bot."
          : "❌ This phone number is already registered on another server. Please use that server to manage your bot.",
        phoneNumber,
        alreadyRegistered: true
      };
    }

    // Fallback: Check if bot exists in current database without global registration (catch inconsistent data)
    const [existingBot] = await db.select().from(botInstances).where(eq(botInstances.phoneNumber, phoneNumber));
    
    if (existingBot) {
      return {
        isValid: false,
        message: "❌ This phone number is already registered in the system. Please contact support if you need assistance.",
        phoneNumber,
        alreadyRegistered: true
      };
    }

    // Phone number is available for new registration
    return {
      isValid: true,
      message: `✅ Phone number ${phoneNumber} is available for registration.`,
      phoneNumber
    };

  } catch (error) {
    console.error('Error validating credentials by phone number:', error);
    return {
      isValid: false,
      message: '⚠️ Could not validate credentials. Please try again.'
    };
  }
};

// Legacy function - Check if a creds.json already exists with the same content (file-based)
export const validateCredsUniqueness = async (newCredsContent: any): Promise<{
  exists: boolean;
  existingPath?: string;
  message: string;
}> => {
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
  } catch (error) {
    console.error('Error validating creds uniqueness:', error);
    return {
      exists: false,
      message: '⚠️ Could not validate credential uniqueness. Proceeding with caution.'
    };
  }
};

// Get statistics about existing creds
export const getCredsStats = async (): Promise<{
  totalBots: number;
  activeBots: number;
  uniqueCredentials: number;
}> => {
  try {
    const existingCreds = await scanExistingCreds();
    const uniqueChecksums = new Set(existingCreds.map(cred => cred.checksum));
    
    return {
      totalBots: existingCreds.length,
      activeBots: existingCreds.length, // This would need to be determined by actual bot status
      uniqueCredentials: uniqueChecksums.size
    };
  } catch (error) {
    console.error('Error getting creds stats:', error);
    return {
      totalBots: 0,
      activeBots: 0,
      uniqueCredentials: 0
    };
  }
};

// Clean up duplicate or invalid creds
export const cleanupDuplicateCreds = async (): Promise<{
  removed: number;
  errors: string[];
}> => {
  try {
    const existingCreds = await scanExistingCreds();
    const seenChecksums = new Set<string>();
    const duplicates: string[] = [];
    const errors: string[] = [];
    
    for (const cred of existingCreds) {
      if (seenChecksums.has(cred.checksum)) {
        duplicates.push(cred.path);
      } else {
        seenChecksums.add(cred.checksum);
      }
    }
    
    // Note: We're not actually removing files here for safety
    // In a real implementation, you might want to move them to a backup folder
    console.log(`Found ${duplicates.length} duplicate credential files:`, duplicates);
    
    return {
      removed: 0, // We're not actually removing anything for safety
      errors
    };
  } catch (error) {
    console.error('Error cleaning up duplicate creds:', error);
    return {
      removed: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error occurred']
    };
  }
};

export const decodeCredentials = (base64Data: string): any => {
  try {
    // Remove TREKKER~ prefix if present
    let cleanedBase64 = base64Data.trim();
    if (cleanedBase64.startsWith('TREKKER~')) {
      console.log('🔧 Removing TREKKER~ prefix from credentials');
      cleanedBase64 = cleanedBase64.substring(8); // Remove 'TREKKER~' (8 characters)
    }
    
    const jsonString = Buffer.from(cleanedBase64, 'base64').toString('utf8');
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Error decoding credentials:', error);
    throw new Error('Invalid credentials format');
  }
};

export const validateBaileysCredentials = (credentials: any): {
  valid: boolean;
  error?: string;
  normalized?: any;
} => {
  try {
    if (!credentials || typeof credentials !== 'object') {
      return {
        valid: false,
        error: 'Credentials must be a valid object'
      };
    }

    // Check if it's already wrapped in creds object
    if (credentials.creds) {
      // Already in expected format
      const requiredFields = ['noiseKey', 'signedIdentityKey', 'signedPreKey', 'registrationId'];
      const missingFields = requiredFields.filter(field => !credentials.creds[field]);
      
      if (missingFields.length > 0) {
        return {
          valid: false,
          error: `Missing required fields in creds: ${missingFields.join(', ')}`
        };
      }

      return {
        valid: true,
        normalized: credentials
      };
    }

    // Check if it's Baileys v7 format (fields at root level)
    const v7RequiredFields = ['noiseKey', 'signedIdentityKey', 'signedPreKey', 'registrationId'];
    const hasV7Fields = v7RequiredFields.every(field => credentials[field]);

    if (hasV7Fields) {
      // Check if it also has 'me' field (phone number info) - this is the most common v7 format
      if (credentials.me && (credentials.me.id || credentials.me.lid)) {
        console.log('✅ Detected Baileys v7 format with me field - this is the standard pairing format');
        // Keep the original structure as-is, it's already valid
        return {
          valid: true,
          normalized: credentials
        };
      }
      
      // Fallback: wrap in creds object if no 'me' field
      console.log('✅ Detected Baileys v7 format, wrapping in creds object');
      return {
        valid: true,
        normalized: {
          creds: credentials,
          keys: {}
        }
      };
    }

    // Check for me object (alternative format)
    if (credentials.me) {
      return {
        valid: true,
        normalized: credentials
      };
    }

    return {
      valid: false,
      error: 'Invalid Baileys credentials format: missing required fields'
    };
  } catch (error) {
    console.error('Error validating Baileys credentials:', error);
    return {
      valid: false,
      error: 'Failed to validate credentials'
    };
  }
};

export default {
  validateCredsUniqueness,
  getCredsStats,
  cleanupDuplicateCreds,
  decodeCredentials,
  validateBaileysCredentials,
  extractPhoneNumber
};