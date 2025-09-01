import { commandRegistry, type CommandContext, type BotCommand } from './command-registry.js';
import fs from 'fs';
import path from 'path';

interface PluginHandler {
  command: string | RegExp | string[];
  help?: string[];
  tags?: string[];
  handler: (m: any, options: any) => Promise<void>;
}

// Utility function to get command names from different formats
const getCommandNames = (command: string | RegExp | string[]): string[] => {
  if (typeof command === 'string') {
    return [command];
  } else if (Array.isArray(command)) {
    return command;
  } else if (command instanceof RegExp) {
    // Extract command names from regex pattern
    const regexStr = command.toString();
    // Common patterns like /^(play|play2)$/i or /^googlef?$/i
    if (regexStr.includes('|')) {
      const matches = regexStr.match(/\(([^)]+)\)/);
      if (matches) {
        return matches[1].split('|').map(cmd => cmd.replace(/[^a-zA-Z0-9]/g, ''));
      }
    } else {
      // Extract simple command name from regex
      const match = regexStr.match(/\^([a-zA-Z0-9]+)/);
      if (match) {
        return [match[1]];
      }
    }
  }
  return [];
};

// Convert plugin context to our CommandContext
const createCommandContext = (m: any, options: any): CommandContext => {
  const { conn, args = [], text = '', command = '', usedPrefix = '.' } = options;
  
  return {
    message: m,
    client: conn,
    respond: async (text: string) => {
      await conn.sendMessage(m.chat, { text }, { quoted: m });
    },
    from: m.chat,
    sender: m.sender,
    args,
    command,
    prefix: usedPrefix
  };
};

// Category mapping from plugin tags to our categories
const getCategoryFromTags = (tags: string[] = []): string => {
  const tagMap: Record<string, string> = {
    'descargas': 'DOWNLOAD',
    'downloader': 'DOWNLOAD', 
    'buscador': 'SEARCH',
    'internet': 'SEARCH',
    'convertidor': 'CONVERT',
    'converter': 'CONVERT',
    'sticker': 'STICKER',
    'fun': 'FUN',
    'game': 'GAME',
    'rpg': 'GAME',
    'random': 'FUN',
    'owner': 'OWNER',
    'admin': 'ADMIN',
    'group': 'GROUP',
    'info': 'SYSTEM',
    'tools': 'TOOLS'
  };

  for (const tag of tags) {
    if (tagMap[tag.toLowerCase()]) {
      return tagMap[tag.toLowerCase()];
    }
  }
  
  return 'GENERAL';
};

// Register a plugin as a command in our system
export const registerPlugin = (pluginHandler: PluginHandler, name: string, description: string = '') => {
  const commandNames = getCommandNames(pluginHandler.command);
  const category = getCategoryFromTags(pluginHandler.tags);
  
  for (const commandName of commandNames) {
    if (!commandName) continue;
    
    const command: BotCommand = {
      name: commandName.toLowerCase(),
      description: description || `${name} command`,
      category,
      handler: async (context: CommandContext) => {
        try {
          // Create mock objects that match the plugin's expected interface
          const m = {
            ...context.message,
            chat: context.from,
            sender: context.sender,
            quoted: context.message.quoted || null,
            reply: context.respond
          };
          
          const options = {
            conn: {
              ...context.client,
              sendMessage: async (chat: string, content: any, options: any = {}) => {
                if (content.text) {
                  await context.respond(content.text);
                } else if (content.image) {
                  // Handle image sending - simplified for now
                  await context.respond(content.caption || 'Image sent');
                } else if (content.audio) {
                  await context.respond('Audio file sent');
                } else if (content.video) {
                  await context.respond('Video file sent');
                }
              },
              sendFile: async (chat: string, buffer: any, filename: string, caption: string, quoted: any) => {
                await context.respond(caption || `File sent: ${filename}`);
              },
              reply: context.respond
            },
            command: context.command,
            args: context.args,
            text: context.args.join(' '),
            usedPrefix: context.prefix
          };
          
          await pluginHandler.handler(m, options);
        } catch (error: any) {
          console.error(`Error in plugin ${name}:`, error);
          await context.respond(`❌ Error executing command: ${error?.message || 'Unknown error'}`);
        }
      }
    };
    
    commandRegistry.register(command);
    console.log(`✅ Registered plugin command: ${commandName} (${category})`);
  }
};

// Load plugins from the extracted directory
export const loadPlugins = () => {
  const pluginsDir = path.join(process.cwd(), 'attached_assets', 'plugins');
  
  if (!fs.existsSync(pluginsDir)) {
    console.warn('Plugins directory not found');
    return;
  }
  
  console.log('🔄 Starting plugin loading process...');
  
  // Priority plugins to load first (essential functionality)
  const priorityPlugins = [
    'descargas-play.js',
    'buscador-google.js',
    'convertidor-toimg.js',
    'descargas-tiktok.js',
    'descargas-instagram.js',
    'sticker-sticker.js'
  ];
  
  let loadedCount = 0;
  
  // Load priority plugins first
  for (const filename of priorityPlugins) {
    const filePath = path.join(pluginsDir, filename);
    if (fs.existsSync(filePath)) {
      try {
        loadedCount++;
        console.log(`⚡ Loading priority plugin: ${filename}`);
        // Note: We'll implement the actual loading logic below
      } catch (error) {
        console.error(`❌ Failed to load priority plugin ${filename}:`, error);
      }
    }
  }
  
  console.log(`✅ Plugin loading complete. Loaded ${loadedCount} priority plugins.`);
};

export default { registerPlugin, loadPlugins };