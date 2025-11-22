/**
 * Bot Isolation Service
 * 
 * Ensures each bot instance runs commands in its own isolated container
 * with per-bot message deduplication and command execution locks.
 * 
 * Prevents:
 * - Duplicate command execution across bots
 * - Cross-bot message processing interference
 * - Concurrent command execution within a single bot
 */

interface ProcessedMessageEntry {
  messageId: string;
  timestamp: number;
  from: string;
  botId: string;
}

interface CommandLock {
  botId: string;
  commandName: string;
  timestamp: number;
  processId: string;
}

export class BotIsolationService {
  // Per-bot message deduplication (container isolation)
  private botProcessedMessages: Map<string, Map<string, number>> = new Map();
  
  // Per-bot command execution locks
  private botCommandLocks: Map<string, Map<string, CommandLock>> = new Map();
  
  // TTL for processed messages (5 seconds)
  private readonly MESSAGE_DEDUP_TTL = 5000;
  
  // TTL for command locks (30 seconds)
  private readonly COMMAND_LOCK_TTL = 30000;
  
  // Unique process ID for this instance
  private processId: string = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  constructor() {
    // Start cleanup interval (every 60 seconds)
    this.startCleanupInterval();
  }

  /**
   * Initialize bot container if not exists
   */
  private ensureBotContainer(botId: string): void {
    if (!this.botProcessedMessages.has(botId)) {
      this.botProcessedMessages.set(botId, new Map());
    }
    if (!this.botCommandLocks.has(botId)) {
      this.botCommandLocks.set(botId, new Map());
    }
  }

  /**
   * Check if a message has already been processed by this bot
   * Returns true if message was already processed (duplicate), false if new
   */
  public isMessageProcessed(botId: string, messageId: string): boolean {
    this.ensureBotContainer(botId);
    const botMessages = this.botProcessedMessages.get(botId);
    
    if (!botMessages) return false;
    
    const lastProcessedTime = botMessages.get(messageId);
    if (!lastProcessedTime) return false;
    
    // Check if still within TTL window
    const age = Date.now() - lastProcessedTime;
    if (age > this.MESSAGE_DEDUP_TTL) {
      botMessages.delete(messageId);
      return false;
    }
    
    return true;
  }

  /**
   * Mark a message as processed for this bot
   */
  public markMessageAsProcessed(botId: string, messageId: string): void {
    this.ensureBotContainer(botId);
    const botMessages = this.botProcessedMessages.get(botId);
    
    if (botMessages) {
      botMessages.set(messageId, Date.now());
      console.log(`[BotIsolation-${botId}] Marked message ${messageId} as processed`);
    }
  }

  /**
   * Acquire lock for command execution in this bot
   * Returns true if lock acquired (first execution), false if already locked
   */
  public acquireCommandLock(botId: string, commandName: string): boolean {
    this.ensureBotContainer(botId);
    const botLocks = this.botCommandLocks.get(botId);
    
    if (!botLocks) return false;
    
    const lockKey = `${commandName}`;
    const existingLock = botLocks.get(lockKey);
    
    // Check if lock exists and is still valid
    if (existingLock) {
      const age = Date.now() - existingLock.timestamp;
      if (age < this.COMMAND_LOCK_TTL) {
        console.log(`[BotIsolation-${botId}] Command ${commandName} already locked (age: ${age}ms)`);
        return false; // Lock already held
      } else {
        // Lock expired, remove it
        botLocks.delete(lockKey);
      }
    }
    
    // Create new lock
    const newLock: CommandLock = {
      botId,
      commandName,
      timestamp: Date.now(),
      processId: this.processId
    };
    
    botLocks.set(lockKey, newLock);
    console.log(`[BotIsolation-${botId}] Acquired lock for command ${commandName}`);
    return true;
  }

  /**
   * Release lock for command execution
   */
  public releaseCommandLock(botId: string, commandName: string): void {
    this.ensureBotContainer(botId);
    const botLocks = this.botCommandLocks.get(botId);
    
    if (botLocks) {
      const lockKey = `${commandName}`;
      botLocks.delete(lockKey);
      console.log(`[BotIsolation-${botId}] Released lock for command ${commandName}`);
    }
  }

  /**
   * Get isolation statistics for monitoring
   */
  public getIsolationStats(botId: string): {
    messagesCached: number;
    locksHeld: number;
    botId: string;
  } {
    return {
      botId,
      messagesCached: this.botProcessedMessages.get(botId)?.size || 0,
      locksHeld: this.botCommandLocks.get(botId)?.size || 0
    };
  }

  /**
   * Clean up expired entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    
    // Clean expired messages
    const botIdsToDelete: string[] = [];
    this.botProcessedMessages.forEach((messages, botId) => {
      const messageIdsToDelete: string[] = [];
      messages.forEach((timestamp, messageId) => {
        if (now - timestamp > this.MESSAGE_DEDUP_TTL) {
          messageIdsToDelete.push(messageId);
        }
      });
      
      messageIdsToDelete.forEach(messageId => messages.delete(messageId));
      
      // Remove empty bot containers
      if (messages.size === 0) {
        botIdsToDelete.push(botId);
      }
    });
    
    botIdsToDelete.forEach(botId => this.botProcessedMessages.delete(botId));
    
    // Clean expired command locks
    const lockBotIdsToDelete: string[] = [];
    this.botCommandLocks.forEach((locks, botId) => {
      const commandNamesToDelete: string[] = [];
      locks.forEach((lock, commandName) => {
        if (now - lock.timestamp > this.COMMAND_LOCK_TTL) {
          commandNamesToDelete.push(commandName);
        }
      });
      
      commandNamesToDelete.forEach(commandName => locks.delete(commandName));
      
      // Remove empty bot containers
      if (locks.size === 0) {
        lockBotIdsToDelete.push(botId);
      }
    });
    
    lockBotIdsToDelete.forEach(botId => this.botCommandLocks.delete(botId));
  }

  /**
   * Start periodic cleanup
   */
  private startCleanupInterval(): void {
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 60000); // Every 60 seconds
  }

  /**
   * Get all active bots in isolation system
   */
  public getActiveBots(): string[] {
    const bots = new Set<string>();
    this.botProcessedMessages.forEach((_, botId) => {
      bots.add(botId);
    });
    this.botCommandLocks.forEach((_, botId) => {
      bots.add(botId);
    });
    return Array.from(bots);
  }

  /**
   * Clear all isolation data for a bot (e.g., during bot restart)
   */
  public clearBotContainer(botId: string): void {
    this.botProcessedMessages.delete(botId);
    this.botCommandLocks.delete(botId);
    console.log(`[BotIsolation-${botId}] Cleared isolation container`);
  }
}

// Global instance (one per server)
export const botIsolationService = new BotIsolationService();
