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

// Emoji reactions for status - using only green heart
const STATUS_REACTIONS = ['💚'];

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
  private sock: any = null;

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
    
    // Auto-enable reactions on startup
    const config = this.getConfig();
    if (!config.reactOn) {
      config.reactOn = true;
      this.saveConfig(config);
      console.log(`[${this.botInstance.name}] Auto-enabled status reactions on startup`);
    }
  }

  public setSock(sock: any): void {
    this.sock = sock;
  }

  private initializeConfig(): void {
    if (!existsSync(this.configPath)) {
      const defaultConfig: AutoStatusConfig = {
        enabled: this.botInstance.autoViewStatus ?? true,
        reactOn: true,
        reactThrottleDelay: 2000, // 2 seconds between status reactions
        autoViewInterval: 3000, // 3 seconds between auto views
        postedStatusDelay: Math.floor(Math.random() * 3000) + 2000 // 2-5 seconds delay for posted status
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
    // Always check the bot instance's autoViewStatus from database
    // This ensures the setting is always up-to-date when toggled via commands
    return this.botInstance.autoViewStatus ?? true;
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
    if (!this.isStatusReactionEnabled() || !sock) {
      return;
    }

    try {
      // Select random emoji from reactions list
      const emoji = STATUS_REACTIONS[Math.floor(Math.random() * STATUS_REACTIONS.length)];
      
      // Send emoji reaction to status
      await sock.sendMessage('status@broadcast', {
        react: {
          text: emoji,
          key: statusKey,
        }
      });
      
      console.log(`[${this.botInstance.name}] ✅ Reacted to status with ${emoji}`);
    } catch (error: any) {
      console.error(`[${this.botInstance.name}] ❌ Error reacting to status:`, error?.message || error);
    }
  }

  public async handleStatusUpdate(sock: any, status: any): Promise<void> {
    try {
      // Store sock reference for queue processing
      if (!this.sock) {
        this.sock = sock;
      }

      // ALWAYS reload bot instance to get latest settings from database
      const freshBot = await storage.getBotInstance(this.botInstance.id);
      if (freshBot) {
        this.botInstance = freshBot;
        console.log(`[${this.botInstance.name}] Reloaded bot settings - autoViewStatus: ${freshBot.autoViewStatus}`);
      }

      if (!this.isAutoStatusEnabled()) {
        console.log(`[${this.botInstance.name}] Auto view status disabled - skipping status update`);
        return;
      }

      // Handle status from messages.upsert
      if (status.messages && status.messages.length > 0) {
        for (const msg of status.messages) {
          if (msg.key && msg.key.remoteJid === 'status@broadcast') {
            console.log(`[${this.botInstance.name}] Detected new status from ${msg.key.participant || msg.key.remoteJid}`);
            // Add to queue for processing with proper delays
            await this.addStatusToQueue(msg.key, false, msg.messageTimestamp);
          }
        }
        return;
      }

      // Handle direct status updates
      if (status.key && status.key.remoteJid === 'status@broadcast') {
        console.log(`[${this.botInstance.name}] Detected status update from ${status.key.participant || status.key.remoteJid}`);
        await this.addStatusToQueue(status.key, false, status.messageTimestamp);
        return;
      }

      // Handle status in reactions
      if (status.reaction && status.reaction.key.remoteJid === 'status@broadcast') {
        console.log(`[${this.botInstance.name}] Detected status reaction from ${status.reaction.key.participant || status.reaction.key.remoteJid}`);
        await this.addStatusToQueue(status.reaction.key, false, status.messageTimestamp);
        return;
      }
    } catch (error: any) {
      console.error(`[${this.botInstance.name}] ❌ Error in auto status view:`, error.message);
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
    // Always start the processor interval, but processStatusQueue will check if autoview is enabled
    // This allows real-time enable/disable via .autoview command without needing to restart the bot
    const config = this.getConfig();
    console.log(`[${this.botInstance.name}] Starting auto status processor (will check autoview setting on each run)`);
    
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

    // Reload bot instance to get latest autoViewStatus setting from database
    const freshBot = await storage.getBotInstance(this.botInstance.id);
    if (freshBot) {
      this.botInstance = freshBot;
    }

    // Check if autoview is still enabled after reload
    if (!this.isAutoStatusEnabled()) {
      console.log(`[${this.botInstance.name}] Auto status viewing disabled - clearing queue`);
      this.statusQueue = []; // Clear queue when disabled
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
      console.log(`[${this.botInstance.name}] 👁️ Viewing status ${status.statusId} from ${status.statusSender}`);

      // Actually view the status on WhatsApp if sock is available
      if (this.sock) {
        try {
          await this.sock.readMessages([status.statusKey]);
          console.log(`[${this.botInstance.name}] ✅ Status viewed on WhatsApp`);
        } catch (err: any) {
          if (err.message?.includes('rate-overlimit')) {
            console.log(`[${this.botInstance.name}] ⚠️ Rate limit hit, waiting before retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
              await this.sock.readMessages([status.statusKey]);
              console.log(`[${this.botInstance.name}] ✅ Status viewed on WhatsApp (retry successful)`);
            } catch (retryErr: any) {
              console.error(`[${this.botInstance.name}] ❌ Failed to view status after retry:`, retryErr.message);
            }
          } else {
            console.error(`[${this.botInstance.name}] ❌ Error viewing status on WhatsApp:`, err.message);
          }
        }
      } else {
        console.warn(`[${this.botInstance.name}] ⚠️ Cannot view status - sock not available`);
      }

      // Mark as viewed in database with 24-hour expiration
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      
      await storage.markStatusAsViewed({
        botInstanceId: this.botInstance.id,
        statusId: status.statusId,
        statusSender: status.statusSender,
        expiresAt,
        serverName: this.botInstance.serverName
      });

      // React to status if enabled (with delay after viewing)
      if (this.isStatusReactionEnabled()) {
        setTimeout(async () => {
          await this.reactToStatus(this.sock, status.statusKey, status.statusKey.messageTimestamp);
        }, 1500); // 1.5 second delay before reacting to avoid rate limits
      }

      console.log(`[${this.botInstance.name}] ✅ Successfully processed status ${status.statusId}`);
    } catch (error) {
      console.error(`[${this.botInstance.name}] ❌ Error viewing status ${status.statusId}:`, error);
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
      } catch (queryError: any) {
        console.log(`[${this.botInstance.name}] Direct status query failed (${queryError?.message || 'unknown error'}), continuing with passive monitoring`);
      }
      
    } catch (error: any) {
      console.log(`[${this.botInstance.name}] Status fetching encountered error (${error?.message || 'unknown error'}), will rely on real-time status updates`);
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