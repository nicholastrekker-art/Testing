import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { BotInstance } from '@shared/schema';
import { storage } from '../storage';

interface AutoStatusConfig {
  enabled: boolean;
  reactOn: boolean;
  lastStatusView?: number;
  lastStatusReact?: number;
  reactThrottleDelay: number; // milliseconds between status reactions only
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
        reactThrottleDelay: 3000, // 3 seconds between status reactions only
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
      // Ensure all required fields exist for backward compatibility
      if (!config.reactThrottleDelay) {
        // Migrate old throttleDelay to reactThrottleDelay
        config.reactThrottleDelay = config.throttleDelay || 3000;
        delete config.throttleDelay;
      }
      if (!config.autoViewInterval) {
        config.autoViewInterval = 5000;
      }
      if (!config.postedStatusDelay) {
        config.postedStatusDelay = Math.floor(Math.random() * 5000) + 5000;
      }
      // Save updated config if any fields were missing
      this.saveConfig(config);
      return config;
    } catch (error) {
      console.error('Error reading auto status config:', error);
      return { 
        enabled: true, 
        reactOn: true, 
        reactThrottleDelay: 3000,
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

  public async reactToStatus(sock: any, statusKey: any, messageTimestamp?: number): Promise<void> {
    try {
      if (!this.isStatusReactionEnabled()) {
        return;
      }

      // Skip reacting to own status updates (fromMe: true)
      if (statusKey.fromMe === true) {
        console.log(`⏭️ Skipping reaction to own status from ${statusKey.participant || statusKey.remoteJid}`);
        return;
      }

      const config = this.getConfig();
      const now = Date.now();
      
      // Check if message is too old (more than 5 minutes old)
      if (messageTimestamp) {
        const messageAge = now - (messageTimestamp * 1000);
        const maxAge = 5 * 60 * 1000; // 5 minutes
        
        if (messageAge > maxAge) {
          console.log(`⏰ Skipping reaction to old status (${Math.floor(messageAge / 1000)}s old) from ${statusKey.participant || statusKey.remoteJid}`);
          return;
        }
      }
      
      // THROTTLING: Check if enough time has passed since last reaction
      if (config.lastStatusReact && (now - config.lastStatusReact) < config.reactThrottleDelay) {
        const waitTime = config.reactThrottleDelay - (now - config.lastStatusReact);
        console.log(`⏳ Status reaction throttled - waiting ${waitTime}ms before next reaction`);
        return;
      }

      // Additional check: Ensure we're not reacting to messages from the bot's own number
      const botNumber = sock.user?.id?.split(':')[0];
      const statusSender = (statusKey.participant || statusKey.remoteJid || '').split('@')[0];
      
      if (botNumber && statusSender && botNumber === statusSender) {
        console.log(`⏭️ Skipping reaction to bot's own message (number match: ${botNumber})`);
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

      // Update last reaction time for throttling
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
      
      // NO THROTTLING FOR VIEWING - Instant view
      // Only small delay to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

      // Handle status from messages.upsert
      if (status.messages && status.messages.length > 0) {
        const msg = status.messages[0];
        if (msg.key && msg.key.remoteJid === 'status@broadcast') {
          try {
            await sock.readMessages([msg.key]);
            
            // Update last status view time (for tracking only, no throttling)
            config.lastStatusView = Date.now();
            this.saveConfig(config);
            console.log(`👁️ Viewed status from ${msg.key.participant || msg.key.remoteJid}`);
            
            // React to status if enabled (has its own throttling)
            await this.reactToStatus(sock, msg.key, msg.messageTimestamp);
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
          
          // React to status if enabled (has its own throttling)
          await this.reactToStatus(sock, status.key, status.messageTimestamp);
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
          
          // React to status if enabled (has its own throttling)
          await this.reactToStatus(sock, status.reaction.key, status.messageTimestamp);
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

  public async addStatusToQueue(statusKey: any, isPosted: boolean = false, messageTimestamp?: number): Promise<void> {
    if (!this.isAutoStatusEnabled()) {
      return;
    }

    const statusId = statusKey.id;
    const statusSender = statusKey.participant || statusKey.remoteJid;

    // Check if message is too old (more than 24 hours)
    if (messageTimestamp) {
      const messageAge = Date.now() - (messageTimestamp * 1000);
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      if (messageAge > maxAge) {
        console.log(`[${this.botInstance.name}] Skipping old status (${Math.floor(messageAge / (60 * 60 * 1000))}h old) from ${statusSender}`);
        return;
      }
    }

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
      statusKey: { ...statusKey, messageTimestamp },
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
          await this.reactToStatus(undefined, status.statusKey, status.statusKey.messageTimestamp);
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
      
      // Try to get status from sock.store first (more reliable)
      if (sock.store && sock.store.messages) {
        const statusMessages = sock.store.messages['status@broadcast'];
        if (statusMessages && statusMessages.length > 0) {
          console.log(`[${this.botInstance.name}] Found ${statusMessages.length} statuses in store`);
          for (const msg of statusMessages) {
            if (msg.key) {
              await this.addStatusToQueue(msg.key, false);
            }
          }
          console.log(`[${this.botInstance.name}] Status fetching from store completed`);
          return;
        }
      }

      // Fallback: Try to fetch from WhatsApp API with timeout protection
      try {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Status fetch timeout')), 10000); // 10 second timeout
        });

        const fetchPromise = sock.query({
          tag: 'iq',
          attrs: {
            to: 'status@broadcast',
            type: 'get',
            xmlns: 'status'
          }
        });

        const statusUpdates = await Promise.race([fetchPromise, timeoutPromise]);

        if (statusUpdates && statusUpdates.content) {
          console.log(`[${this.botInstance.name}] Found ${statusUpdates.content.length} existing statuses`);
          
          for (const status of statusUpdates.content) {
            if (status.key) {
              await this.addStatusToQueue(status.key, false);
            }
          }
        }
        
        console.log(`[${this.botInstance.name}] Status fetching completed`);
      } catch (queryError) {
        console.log(`[${this.botInstance.name}] Direct status query failed (${queryError.message}), continuing with passive monitoring`);
      }
      
    } catch (error) {
      console.log(`[${this.botInstance.name}] Status fetching encountered error (${error.message}), will rely on real-time status updates`);
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