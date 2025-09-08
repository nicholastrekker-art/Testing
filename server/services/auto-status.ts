import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { BotInstance } from '@shared/schema';

interface AutoStatusConfig {
  enabled: boolean;
  reactOn: boolean;
}

export class AutoStatusService {
  private configPath: string;
  private botInstance: BotInstance;

  constructor(botInstance: BotInstance) {
    this.botInstance = botInstance;
    // Create bot-specific config directory
    const configDir = join(process.cwd(), 'data', 'autostatus');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    this.configPath = join(configDir, `${botInstance.id}.json`);
    this.initializeConfig();
  }

  private initializeConfig(): void {
    if (!existsSync(this.configPath)) {
      const defaultConfig: AutoStatusConfig = {
        enabled: this.botInstance.autoViewStatus || false,
        reactOn: this.botInstance.autoLike || false
      };
      writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2));
    }
  }

  private getConfig(): AutoStatusConfig {
    try {
      const configData = readFileSync(this.configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      console.error('Error reading auto status config:', error);
      return { enabled: false, reactOn: false };
    }
  }

  private saveConfig(config: AutoStatusConfig): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error('Error saving auto status config:', error);
    }
  }

  public isAutoStatusEnabled(): boolean {
    return this.getConfig().enabled;
  }

  public isStatusReactionEnabled(): boolean {
    return this.getConfig().reactOn;
  }

  public setAutoStatusEnabled(enabled: boolean): void {
    const config = this.getConfig();
    config.enabled = enabled;
    this.saveConfig(config);
  }

  public setStatusReactionEnabled(enabled: boolean): void {
    const config = this.getConfig();
    config.reactOn = enabled;
    this.saveConfig(config);
  }

  public async reactToStatus(sock: any, statusKey: any): Promise<void> {
    try {
      if (!this.isStatusReactionEnabled()) {
        return;
      }

      // Use the proper relayMessage method for status reactions
      await sock.relayMessage(
        'status@broadcast',
        {
          reactionMessage: {
            key: {
              remoteJid: 'status@broadcast',
              id: statusKey.id,
              participant: statusKey.participant || statusKey.remoteJid,
              fromMe: false
            },
            text: '💚'
          }
        },
        {
          messageId: statusKey.id,
          statusJidList: [statusKey.remoteJid, statusKey.participant || statusKey.remoteJid]
        }
      );
    } catch (error: any) {
      console.error('❌ Error reacting to status:', error.message);
    }
  }

  public async handleStatusUpdate(sock: any, status: any): Promise<void> {
    try {
      if (!this.isAutoStatusEnabled()) {
        return;
      }

      // Add delay to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Handle status from messages.upsert
      if (status.messages && status.messages.length > 0) {
        const msg = status.messages[0];
        if (msg.key && msg.key.remoteJid === 'status@broadcast') {
          try {
            await sock.readMessages([msg.key]);
            
            // React to status if enabled
            await this.reactToStatus(sock, msg.key);
          } catch (err: any) {
            if (err.message?.includes('rate-overlimit')) {
              console.log('⚠️ Rate limit hit, waiting before retrying...');
              await new Promise(resolve => setTimeout(resolve, 2000));
              await sock.readMessages([msg.key]);
            } else {
              throw err;
            }
          }
          return;
        }
      }

      // Handle direct status updates
      if (status.key && status.key.remoteJid === 'status@broadcast') {
        try {
          await sock.readMessages([status.key]);
          
          // React to status if enabled
          await this.reactToStatus(sock, status.key);
        } catch (err: any) {
          if (err.message?.includes('rate-overlimit')) {
            console.log('⚠️ Rate limit hit, waiting before retrying...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            await sock.readMessages([status.key]);
          } else {
            throw err;
          }
        }
        return;
      }

      // Handle status in reactions
      if (status.reaction && status.reaction.key.remoteJid === 'status@broadcast') {
        try {
          await sock.readMessages([status.reaction.key]);
          
          // React to status if enabled
          await this.reactToStatus(sock, status.reaction.key);
        } catch (err: any) {
          if (err.message?.includes('rate-overlimit')) {
            console.log('⚠️ Rate limit hit, waiting before retrying...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            await sock.readMessages([status.reaction.key]);
          } else {
            throw err;
          }
        }
        return;
      }
    } catch (error: any) {
      console.error('❌ Error in auto status view:', error.message);
    }
  }

  public getStatusMessage(): string {
    const config = this.getConfig();
    const status = config.enabled ? 'enabled' : 'disabled';
    const reactStatus = config.reactOn ? 'enabled' : 'disabled';
    
    return `🔄 *Auto Status Settings*\n\n📱 *Auto Status View:* ${status}\n💫 *Status Reactions:* ${reactStatus}\n\n*Commands:*\n.autostatus on - Enable auto status view\n.autostatus off - Disable auto status view\n.autostatus react on - Enable status reactions\n.autostatus react off - Disable status reactions`;
  }
}