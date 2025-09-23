import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { BotInstance } from '@shared/schema';
import { storage } from '../storage';

interface AutoStatusConfig {
  enabled: boolean;
  reactOn: boolean;
  lastStatusView?: number;
  lastStatusReact?: number;
  throttleDelay: number; // milliseconds between status actions
  autoViewInterval: number; // interval for auto viewing statuses (default 5000ms)
  postedStatusDelay: number; // delay for posted statuses (5-10 seconds)
}

interface StatusViewQueue {
  statusId: string;
  statusSender: string;
  statusKey: any;
  isPosted: boolean; // true if it's a newly posted status
  addedAt: number;
}

export class AutoStatusService {
  private configPath: string;
  private botInstance: BotInstance;
  private statusQueue: StatusViewQueue[] = [];
  private viewInterval: NodeJS.Timeout | null = null;
  private isProcessingQueue: boolean = false;

  constructor(botInstance: BotInstance) {
    this.botInstance = botInstance;
    // Create bot-specific config directory
    const configDir = join(process.cwd(), 'data', 'autostatus');
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    this.configPath = join(configDir, `${botInstance.id}.json`);
    this.initializeConfig();
    this.startAutoViewProcessor();
  }

  private initializeConfig(): void {
    if (!existsSync(this.configPath)) {
      const defaultConfig: AutoStatusConfig = {
        enabled: this.botInstance.autoViewStatus ?? true,
        reactOn: this.botInstance.autoLike ?? true,
        throttleDelay: 3000, // 3 seconds between status actions
        autoViewInterval: 5000, // 5 seconds between auto views
        postedStatusDelay: Math.floor(Math.random() * 5000) + 5000 // 5-10 seconds delay for posted status
      };
      writeFileSync(this.configPath, JSON.stringify(defaultConfig, null, 2));
    }
  }

  private getConfig(): AutoStatusConfig {
    try {
      const configData = readFileSync(this.configPath, 'utf8');
      const config = JSON.parse(configData);
      // Ensure throttleDelay exists for backward compatibility
      if (!config.throttleDelay) {
        config.throttleDelay = 3000;
        this.saveConfig(config);
      }
      return config;
    } catch (error) {
      console.error('Error reading auto status config:', error);
      return { 
        enabled: true, 
        reactOn: true, 
        throttleDelay: 3000,
        autoViewInterval: 5000,
        postedStatusDelay: Math.floor(Math.random() * 5000) + 5000
      };
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

      const config = this.getConfig();
      const now = Date.now();
      
      // Check throttling
      if (config.lastStatusReact && (now - config.lastStatusReact) < config.throttleDelay) {
        console.log(`⏳ Status reaction throttled - waiting ${config.throttleDelay}ms between reactions`);
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

      // Update last reaction time
      config.lastStatusReact = now;
      this.saveConfig(config);
      
      console.log(`✅ Reacted to status from ${statusKey.participant || statusKey.remoteJid}`);
    } catch (error: any) {
      console.error('❌ Error reacting to status:', error.message);
    }
  }

  public async handleStatusUpdate(sock: any, status: any): Promise<void> {
    try {
      if (!this.isAutoStatusEnabled()) {
        return;
      }

      const config = this.getConfig();
      const now = Date.now();
      
      // Check throttling for status viewing
      if (config.lastStatusView && (now - config.lastStatusView) < config.throttleDelay) {
        console.log(`⏳ Status viewing throttled - waiting ${config.throttleDelay}ms between views`);
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
            
            // Update last status view time
            config.lastStatusView = Date.now();
            this.saveConfig(config);
            console.log(`👁️ Viewed status from ${msg.key.participant || msg.key.remoteJid}`);
            
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

  // Enhanced Auto Status Viewing Methods
  private startAutoViewProcessor(): void {
    if (!this.isAutoStatusEnabled()) {
      console.log(`[${this.botInstance.name}] Auto status viewing is disabled`);
      return;
    }

    const config = this.getConfig();
    console.log(`[${this.botInstance.name}] Starting auto status processor with ${config.autoViewInterval}ms interval`);
    
    // Start the interval to process status queue
    this.viewInterval = setInterval(() => {
      this.processStatusQueue();
    }, config.autoViewInterval);

    // Clean up expired status IDs every 30 minutes
    setInterval(async () => {
      await this.cleanupExpiredStatuses();
    }, 30 * 60 * 1000);
  }

  public async addStatusToQueue(statusKey: any, isPosted: boolean = false): Promise<void> {
    if (!this.isAutoStatusEnabled()) {
      return;
    }

    const statusId = statusKey.id;
    const statusSender = statusKey.participant || statusKey.remoteJid;

    // Check if already viewed
    const alreadyViewed = await storage.isStatusAlreadyViewed(this.botInstance.id, statusId);
    if (alreadyViewed) {
      console.log(`[${this.botInstance.name}] Status ${statusId} already viewed, skipping`);
      return;
    }

    // Check if already in queue
    const existsInQueue = this.statusQueue.some(item => item.statusId === statusId);
    if (existsInQueue) {
      console.log(`[${this.botInstance.name}] Status ${statusId} already in queue, skipping`);
      return;
    }

    // Add to queue
    this.statusQueue.push({
      statusId,
      statusSender,
      statusKey,
      isPosted,
      addedAt: Date.now()
    });

    console.log(`[${this.botInstance.name}] Added status ${statusId} to queue (posted: ${isPosted})`);
  }

  private async processStatusQueue(): Promise<void> {
    if (this.isProcessingQueue || this.statusQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    
    try {
      const config = this.getConfig();
      const now = Date.now();
      
      // Find the next status to process
      for (let i = 0; i < this.statusQueue.length; i++) {
        const status = this.statusQueue[i];
        
        // Check delay requirements
        let delayRequired = 0;
        if (status.isPosted) {
          delayRequired = config.postedStatusDelay;
        }
        
        // Check if enough time has passed
        if (now - status.addedAt >= delayRequired) {
          // Remove from queue
          this.statusQueue.splice(i, 1);
          
          // Process the status
          await this.viewStatus(status);
          break; // Process one at a time
        }
      }
    } catch (error) {
      console.error(`[${this.botInstance.name}] Error processing status queue:`, error);
    } finally {
      this.isProcessingQueue = false;
    }
  }

  private async viewStatus(status: StatusViewQueue): Promise<void> {
    try {
      console.log(`[${this.botInstance.name}] Viewing status ${status.statusId} from ${status.statusSender}`);

      // Mark as viewed in database with 24-hour expiration
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      
      await storage.markStatusAsViewed({
        botInstanceId: this.botInstance.id,
        statusId: status.statusId,
        statusSender: status.statusSender,
        expiresAt,
        serverName: this.botInstance.serverName
      });

      // React to status if enabled
      if (this.isStatusReactionEnabled()) {
        setTimeout(async () => {
          await this.reactToStatus(undefined, status.statusKey);
        }, 1000); // Small delay before reacting
      }

      console.log(`[${this.botInstance.name}] Successfully processed status ${status.statusId}`);
    } catch (error) {
      console.error(`[${this.botInstance.name}] Error viewing status ${status.statusId}:`, error);
    }
  }

  private async cleanupExpiredStatuses(): Promise<void> {
    try {
      const deletedCount = await storage.deleteExpiredStatusIds(this.botInstance.id);
      if (deletedCount > 0) {
        console.log(`[${this.botInstance.name}] Cleaned up ${deletedCount} expired status IDs`);
      }
    } catch (error) {
      console.error(`[${this.botInstance.name}] Error cleaning up expired statuses:`, error);
    }
  }

  public async fetchAllStatuses(sock: any): Promise<void> {
    if (!this.isAutoStatusEnabled()) {
      return;
    }

    try {
      console.log(`[${this.botInstance.name}] Fetching all available statuses...`);
      
      // Fetch status updates from WhatsApp
      // This depends on the Baileys implementation - we'll listen for status updates
      // The actual fetching happens through status update events
      
      console.log(`[${this.botInstance.name}] Status fetching listener is active`);
    } catch (error) {
      console.error(`[${this.botInstance.name}] Error fetching statuses:`, error);
    }
  }

  public stopAutoViewProcessor(): void {
    if (this.viewInterval) {
      clearInterval(this.viewInterval);
      this.viewInterval = null;
      console.log(`[${this.botInstance.name}] Auto status processor stopped`);
    }
  }

  public getQueueStatus(): { queueLength: number; processing: boolean } {
    return {
      queueLength: this.statusQueue.length,
      processing: this.isProcessingQueue
    };
  }
}