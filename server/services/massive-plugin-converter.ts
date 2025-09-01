import { commandRegistry, type CommandContext, type BotCommand } from './command-registry.js';
import fs from 'fs';
import path from 'path';

interface ExtractedCommand {
  name: string;
  aliases: string[];
  description: string;
  category: string;
  originalFile: string;
}

// Enhanced command extraction from plugin files
export class MassivePluginConverter {
  
  // Extract command names from regex patterns
  private extractCommandNames(commandRegex: string): string[] {
    const commands: string[] = [];
    
    // Handle array format: ['cmd1', 'cmd2', 'cmd3']
    if (commandRegex.includes('[') && commandRegex.includes(']')) {
      const arrayMatch = commandRegex.match(/\[(.*?)\]/);
      if (arrayMatch) {
        const commandsStr = arrayMatch[1];
        const matches = commandsStr.match(/'([^']+)'/g);
        if (matches) {
          commands.push(...matches.map(m => m.replace(/'/g, '')));
        }
      }
    }
    
    // Handle regex format: /^(cmd1|cmd2)$/i
    if (commandRegex.includes('|')) {
      const regexMatch = commandRegex.match(/\^?\(?([^)$]+)\)?\$/);
      if (regexMatch) {
        const commandsStr = regexMatch[1];
        commands.push(...commandsStr.split('|').map(cmd => cmd.replace(/[^a-zA-Z0-9]/g, '')));
      }
    }
    
    // Handle single command regex: /^command$/i
    if (!commandRegex.includes('|') && !commandRegex.includes('[')) {
      const singleMatch = commandRegex.match(/\^([a-zA-Z0-9]+)/);
      if (singleMatch) {
        commands.push(singleMatch[1]);
      }
    }
    
    return commands.filter(cmd => cmd.length > 0);
  }

  // Map plugin tags to our categories
  private mapCategory(tags: string[]): string {
    const categoryMap: Record<string, string> = {
      'internet': 'SEARCH',
      'buscador': 'SEARCH', 
      'search': 'SEARCH',
      'downloader': 'DOWNLOAD',
      'descargas': 'DOWNLOAD',
      'download': 'DOWNLOAD',
      'convertidor': 'CONVERT',
      'converter': 'CONVERT',
      'sticker': 'STICKER',
      'fun': 'FUN',
      'game': 'GAME',
      'rpg': 'GAME',
      'xp': 'GAME',
      'random': 'FUN',
      'owner': 'OWNER',
      'admin': 'ADMIN',
      'group': 'GROUP',
      'info': 'SYSTEM',
      'tools': 'TOOLS',
      'audio': 'AUDIO',
      'adult': 'ADULT',
      'anime': 'ANIME'
    };
    
    for (const tag of tags) {
      if (categoryMap[tag.toLowerCase()]) {
        return categoryMap[tag.toLowerCase()];
      }
    }
    return 'GENERAL';
  }

  // Extract commands from a single plugin file
  private extractFromFile(filePath: string): ExtractedCommand[] {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const fileName = path.basename(filePath, '.js');
      const commands: ExtractedCommand[] = [];
      
      // Extract handler.command
      const commandMatches = content.match(/handler\.command\s*=\s*(.+);?/);
      if (!commandMatches) return [];
      
      const commandRegex = commandMatches[1];
      const commandNames = this.extractCommandNames(commandRegex);
      
      // Extract handler.help
      let description = `${fileName} command`;
      const helpMatches = content.match(/handler\.help\s*=\s*\[(.*?)\]/s);
      if (helpMatches) {
        const helpStr = helpMatches[1];
        const firstHelp = helpStr.match(/'([^']+)'/);
        if (firstHelp) {
          description = firstHelp[1].replace(/<[^>]*>/g, ' ').trim();
        }
      }
      
      // Extract handler.tags
      let tags: string[] = ['general'];
      const tagMatches = content.match(/handler\.tags\s*=\s*\[(.*?)\]/);
      if (tagMatches) {
        const tagStr = tagMatches[1];
        const tagItems = tagStr.match(/'([^']+)'/g);
        if (tagItems) {
          tags = tagItems.map(t => t.replace(/'/g, ''));
        }
      }
      
      const category = this.mapCategory(tags);
      
      // Create command entries
      if (commandNames.length > 0) {
        const mainCommand = commandNames[0];
        const aliases = commandNames.slice(1);
        
        commands.push({
          name: mainCommand,
          aliases,
          description,
          category,
          originalFile: fileName
        });
      }
      
      return commands;
    } catch (error) {
      console.log(`Error processing ${filePath}:`, error);
      return [];
    }
  }

  // Convert all plugin files to TypeScript commands
  public async convertAllPlugins(): Promise<ExtractedCommand[]> {
    const pluginDir = path.join(process.cwd(), 'attached_assets', 'plugins');
    const pluginFiles = fs.readdirSync(pluginDir).filter(f => f.endsWith('.js'));
    
    console.log(`🔄 Processing ${pluginFiles.length} plugin files...`);
    
    const allCommands: ExtractedCommand[] = [];
    
    for (const file of pluginFiles) {
      const filePath = path.join(pluginDir, file);
      const commands = this.extractFromFile(filePath);
      allCommands.push(...commands);
    }
    
    console.log(`✅ Extracted ${allCommands.length} commands from ${pluginFiles.length} files`);
    return allCommands;
  }

  // Register all extracted commands in the command registry
  public registerCommands(extractedCommands: ExtractedCommand[]): void {
    console.log(`🚀 Registering ${extractedCommands.length} commands...`);
    
    for (const cmd of extractedCommands) {
      try {
        const botCommand: BotCommand = {
          name: cmd.name,
          aliases: cmd.aliases,
          description: cmd.description,
          category: cmd.category,
          handler: async (context: CommandContext) => {
            const { respond, args, command } = context;
            
            // Generic handler for all plugin commands
            let response = `🤖 *${cmd.name.toUpperCase()} Command*\n\n`;
            response += `📝 *Description:* ${cmd.description}\n`;
            response += `📂 *Category:* ${cmd.category}\n`;
            response += `📄 *Source:* ${cmd.originalFile}\n\n`;
            
            if (args.length > 0) {
              response += `📋 *Input:* ${args.join(' ')}\n\n`;
            }
            
            // Add category-specific functionality
            switch (cmd.category) {
              case 'SEARCH':
                response += `🔍 *Search functionality for "${args.join(' ') || 'your query'}"*\n`;
                response += `💡 This command would search and return results\n`;
                break;
                
              case 'DOWNLOAD':
                response += `⬇️ *Download functionality*\n`;
                response += `💡 This command would download media content\n`;
                break;
                
              case 'CONVERT':
                response += `🔄 *Conversion functionality*\n`;
                response += `💡 This command would convert media formats\n`;
                break;
                
              case 'GAME':
              case 'FUN':
                response += `🎮 *${cmd.category.toLowerCase()} functionality*\n`;
                response += `💡 This command provides entertainment features\n`;
                break;
                
              default:
                response += `⚙️ *${cmd.category} functionality*\n`;
                response += `💡 This command performs ${cmd.category.toLowerCase()} operations\n`;
            }
            
            response += `\n🔧 *Status:* Command loaded from plugin system\n`;
            response += `⚠️ *Note:* This is a converted plugin command. Full functionality requires additional integration.`;
            
            await respond(response);
          }
        };
        
        commandRegistry.register(botCommand);
        
      } catch (error) {
        console.log(`Error registering command ${cmd.name}:`, error);
      }
    }
    
    console.log(`✅ Successfully registered ${extractedCommands.length} commands!`);
  }
}

// Export singleton instance
export const massiveConverter = new MassivePluginConverter();

console.log('🔧 Massive Plugin Converter loaded');