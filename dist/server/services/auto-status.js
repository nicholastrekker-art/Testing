import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
export class AutoStatusService {
    configPath;
    botInstance;
    constructor(botInstance) {
        this.botInstance = botInstance;
        const configDir = join(process.cwd(), 'data', 'autostatus');
        if (!existsSync(configDir)) {
            mkdirSync(configDir, { recursive: true });
        }
        this.configPath = join(configDir, `${botInstance.id}.json`);
        this.initializeConfig();
    }
    initializeConfig() {
        if (!existsSync(this.configPath)) {
            const defaultConfig = {
                enabled: this.botInstance.autoViewStatus ?? true,
                reactOn: this.botInstance.autoLike ?? true,
                throttleDelay: 3000
            };
            writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2));
        }
    }
    getConfig() {
        try {
            const configData = readFileSync(this.configPath, 'utf8');
            const config = JSON.parse(configData);
            if (!config.throttleDelay) {
                config.throttleDelay = 3000;
                this.saveConfig(config);
            }
            return config;
        }
        catch (error) {
            console.error('Error reading auto status config:', error);
            return { enabled: true, reactOn: true, throttleDelay: 3000 };
        }
    }
    saveConfig(config) {
        try {
            writeFileSync(this.configPath, JSON.stringify(config, null, 2));
        }
        catch (error) {
            console.error('Error saving auto status config:', error);
        }
    }
    isAutoStatusEnabled() {
        return this.getConfig().enabled;
    }
    isStatusReactionEnabled() {
        return this.getConfig().reactOn;
    }
    setAutoStatusEnabled(enabled) {
        const config = this.getConfig();
        config.enabled = enabled;
        this.saveConfig(config);
    }
    setStatusReactionEnabled(enabled) {
        const config = this.getConfig();
        config.reactOn = enabled;
        this.saveConfig(config);
    }
    async reactToStatus(sock, statusKey) {
        try {
            if (!this.isStatusReactionEnabled()) {
                return;
            }
            const config = this.getConfig();
            const now = Date.now();
            if (config.lastStatusReact && (now - config.lastStatusReact) < config.throttleDelay) {
                console.log(`⏳ Status reaction throttled - waiting ${config.throttleDelay}ms between reactions`);
                return;
            }
            await sock.relayMessage('status@broadcast', {
                reactionMessage: {
                    key: {
                        remoteJid: 'status@broadcast',
                        id: statusKey.id,
                        participant: statusKey.participant || statusKey.remoteJid,
                        fromMe: false
                    },
                    text: '💚'
                }
            }, {
                messageId: statusKey.id,
                statusJidList: [statusKey.remoteJid, statusKey.participant || statusKey.remoteJid]
            });
            config.lastStatusReact = now;
            this.saveConfig(config);
            console.log(`✅ Reacted to status from ${statusKey.participant || statusKey.remoteJid}`);
        }
        catch (error) {
            console.error('❌ Error reacting to status:', error.message);
        }
    }
    async handleStatusUpdate(sock, status) {
        try {
            if (!this.isAutoStatusEnabled()) {
                return;
            }
            const config = this.getConfig();
            const now = Date.now();
            if (config.lastStatusView && (now - config.lastStatusView) < config.throttleDelay) {
                console.log(`⏳ Status viewing throttled - waiting ${config.throttleDelay}ms between views`);
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (status.messages && status.messages.length > 0) {
                const msg = status.messages[0];
                if (msg.key && msg.key.remoteJid === 'status@broadcast') {
                    try {
                        await sock.readMessages([msg.key]);
                        config.lastStatusView = Date.now();
                        this.saveConfig(config);
                        console.log(`👁️ Viewed status from ${msg.key.participant || msg.key.remoteJid}`);
                        await this.reactToStatus(sock, msg.key);
                    }
                    catch (err) {
                        if (err.message?.includes('rate-overlimit')) {
                            console.log('⚠️ Rate limit hit, waiting before retrying...');
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            await sock.readMessages([msg.key]);
                        }
                        else {
                            throw err;
                        }
                    }
                    return;
                }
            }
            if (status.key && status.key.remoteJid === 'status@broadcast') {
                try {
                    await sock.readMessages([status.key]);
                    await this.reactToStatus(sock, status.key);
                }
                catch (err) {
                    if (err.message?.includes('rate-overlimit')) {
                        console.log('⚠️ Rate limit hit, waiting before retrying...');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await sock.readMessages([status.key]);
                    }
                    else {
                        throw err;
                    }
                }
                return;
            }
            if (status.reaction && status.reaction.key.remoteJid === 'status@broadcast') {
                try {
                    await sock.readMessages([status.reaction.key]);
                    await this.reactToStatus(sock, status.reaction.key);
                }
                catch (err) {
                    if (err.message?.includes('rate-overlimit')) {
                        console.log('⚠️ Rate limit hit, waiting before retrying...');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await sock.readMessages([status.reaction.key]);
                    }
                    else {
                        throw err;
                    }
                }
                return;
            }
        }
        catch (error) {
            console.error('❌ Error in auto status view:', error.message);
        }
    }
    getStatusMessage() {
        const config = this.getConfig();
        const status = config.enabled ? 'enabled' : 'disabled';
        const reactStatus = config.reactOn ? 'enabled' : 'disabled';
        return `🔄 *Auto Status Settings*\n\n📱 *Auto Status View:* ${status}\n💫 *Status Reactions:* ${reactStatus}\n\n*Commands:*\n.autostatus on - Enable auto status view\n.autostatus off - Disable auto status view\n.autostatus react on - Enable status reactions\n.autostatus react off - Disable status reactions`;
    }
}
