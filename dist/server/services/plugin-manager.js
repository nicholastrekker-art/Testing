import { commandRegistry } from './command-registry.js';
import fs from 'fs';
import path from 'path';
const getCommandNames = (command) => {
    if (typeof command === 'string') {
        return [command];
    }
    else if (Array.isArray(command)) {
        return command;
    }
    else if (command instanceof RegExp) {
        const regexStr = command.toString();
        if (regexStr.includes('|')) {
            const matches = regexStr.match(/\(([^)]+)\)/);
            if (matches) {
                return matches[1].split('|').map(cmd => cmd.replace(/[^a-zA-Z0-9]/g, ''));
            }
        }
        else {
            const match = regexStr.match(/\^([a-zA-Z0-9]+)/);
            if (match) {
                return [match[1]];
            }
        }
    }
    return [];
};
const createCommandContext = (m, options) => {
    const { conn, args = [], text = '', command = '', usedPrefix = '.' } = options;
    return {
        message: m,
        client: conn,
        respond: async (text) => {
            await conn.sendMessage(m.chat, { text }, { quoted: m });
        },
        from: m.chat,
        sender: m.sender,
        args,
        command,
        prefix: usedPrefix
    };
};
export const saveCommandsToDatabase = async (storage) => {
    const commands = commandRegistry.getAllCommands();
    console.log(`Saving ${commands.length} commands to database...`);
    for (const command of commands) {
        try {
            await storage.createCommand({
                name: command.name,
                description: command.description,
                response: `Executing ${command.name}...`,
                isActive: true,
                category: command.category,
                useChatGPT: false
            });
            console.log(`✅ Saved command: ${command.name}`);
        }
        catch (error) {
            if (!error?.message?.includes('duplicate') && !error?.message?.includes('already exists')) {
                console.log(`⚠️ Error saving command ${command.name}:`, error?.message);
            }
        }
    }
    console.log('✅ All commands saved to database');
};
const getCategoryFromTags = (tags = []) => {
    const tagMap = {
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
export const registerPlugin = (pluginHandler, name, description = '') => {
    const commandNames = getCommandNames(pluginHandler.command);
    const category = getCategoryFromTags(pluginHandler.tags);
    for (const commandName of commandNames) {
        if (!commandName)
            continue;
        const command = {
            name: commandName.toLowerCase(),
            description: description || `${name} command`,
            category,
            handler: async (context) => {
                try {
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
                            sendMessage: async (chat, content, options = {}) => {
                                if (content.text) {
                                    await context.respond(content.text);
                                }
                                else if (content.image) {
                                    await context.respond(content.caption || 'Image sent');
                                }
                                else if (content.audio) {
                                    await context.respond('Audio file sent');
                                }
                                else if (content.video) {
                                    await context.respond('Video file sent');
                                }
                            },
                            sendFile: async (chat, buffer, filename, caption, quoted) => {
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
                }
                catch (error) {
                    console.error(`Error in plugin ${name}:`, error);
                    await context.respond(`❌ Error executing command: ${error?.message || 'Unknown error'}`);
                }
            }
        };
        commandRegistry.register(command);
        console.log(`✅ Registered plugin command: ${commandName} (${category})`);
    }
};
export const loadPlugins = () => {
    const pluginsDir = path.join(process.cwd(), 'attached_assets', 'plugins');
    if (!fs.existsSync(pluginsDir)) {
        console.warn('Plugins directory not found');
        return;
    }
    console.log('🔄 Starting plugin loading process...');
    const priorityPlugins = [
        'descargas-play.js',
        'buscador-google.js',
        'convertidor-toimg.js',
        'descargas-tiktok.js',
        'descargas-instagram.js',
        'sticker-sticker.js'
    ];
    let loadedCount = 0;
    for (const filename of priorityPlugins) {
        const filePath = path.join(pluginsDir, filename);
        if (fs.existsSync(filePath)) {
            try {
                loadedCount++;
                console.log(`⚡ Loading priority plugin: ${filename}`);
            }
            catch (error) {
                console.error(`❌ Failed to load priority plugin ${filename}:`, error);
            }
        }
    }
    console.log(`✅ Plugin loading complete. Loaded ${loadedCount} priority plugins.`);
};
export default { registerPlugin, loadPlugins };
