import {
  users,
  botInstances,
  commands,
  activities,
  groups,
  godRegister,
  serverRegistry,
  viewedStatusIds,
  externalBotConnections,
  type User,
  type InsertUser,
  type BotInstance,
  type InsertBotInstance,
  type Command,
  type InsertCommand,
  type Activity,
  type InsertActivity,
  type Group,
  type InsertGroup,
  type GodRegister,
  type InsertGodRegister,
  type ServerRegistry,
  type InsertServerRegistry,
  type ViewedStatusId,
  type InsertViewedStatusId,
  type ExternalBotConnection,
  type InsertExternalBotConnection
} from "@shared/schema";
import { db, getServerName } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";
import crypto from 'crypto';

// Get maximum bot count from environment variables with default fallback
function getMaxBotCount(): number {
  const botCount = process.env.BOTCOUNT || '20';
  const parsed = parseInt(botCount, 10);

  if (isNaN(parsed) || parsed < 0) {
    console.warn(`Invalid BOTCOUNT value "${botCount}", using default value 20`);
    return 20;
  }

  return parsed;
}

export interface IStorage {
  getAllApprovedBots(): Promise<BotInstance[]>;
  createCrossTenancyActivity(params: {
    type: string;
    description: string;
    metadata?: any;
    serverName: string;
    botInstanceId?: string;
    remoteTenancy?: string;
    remoteBotId?: string;
    phoneNumber?: string;
  }): Promise<Activity>;
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Bot Instance methods
  getBotInstance(id: string): Promise<BotInstance | undefined>;
  getAllBotInstances(): Promise<BotInstance[]>;
  getBotInstancesForServer(serverName: string): Promise<BotInstance[]>;
  createBotInstance(botInstance: InsertBotInstance): Promise<BotInstance>;
  createBotInstanceForServer(serverName: string, botInstance: InsertBotInstance): Promise<BotInstance>;
  updateBotInstance(id: string, updates: Partial<BotInstance>): Promise<BotInstance>;
  deleteBotInstance(id: string): Promise<void>;
  checkBotCountLimit(): Promise<boolean>;
  getOldestPendingBot(): Promise<BotInstance | undefined>;

  // Command methods
  getCommands(botInstanceId?: string): Promise<Command[]>;
  getCommand(id: string): Promise<Command | undefined>;
  createCommand(command: InsertCommand): Promise<Command>;
  updateCommand(id: string, updates: Partial<Command>): Promise<Command>;
  deleteCommand(id: string): Promise<void>;

  // Activity methods
  getActivities(botInstanceId?: string, limit?: number): Promise<Activity[]>;
  getAllActivities(limit?: number): Promise<Activity[]>;
  createActivity(activity: InsertActivity): Promise<Activity>;
  getRecentActivities(limit?: number): Promise<Activity[]>;

  // Group methods
  getGroups(botInstanceId: string): Promise<Group[]>;
  createGroup(group: InsertGroup): Promise<Group>;
  updateGroup(id: string, updates: Partial<Group>): Promise<Group>;
  deleteGroup(id: string): Promise<void>;

  // Statistics
  getDashboardStats(): Promise<{
    totalBots: number;
    activeBots: number;
    messagesCount: number;
    commandsCount: number;
  }>;

  getSystemStats(): Promise<{
    totalBots: number;
    onlineBots: number;
    offlineBots: number;
    totalMessages: number;
    totalCommands: number;
    recentActivities: number;
  }>;

  // Global registration methods (tenant-independent)
  checkGlobalRegistration(phoneNumber: string): Promise<GodRegister | undefined>;
  addGlobalRegistration(phoneNumber: string, tenancyName: string): Promise<GodRegister>;
  deleteGlobalRegistration(phoneNumber: string): Promise<void>;
  getAllGlobalRegistrations(): Promise<GodRegister[]>;
  updateGlobalRegistration(phoneNumber: string, tenancyName: string): Promise<GodRegister | undefined>;

  // Cross-server registration with rollback support
  createCrossServerRegistration(phoneNumber: string, targetServerName: string, botData: InsertBotInstance): Promise<{
    success: boolean;
    botInstance?: BotInstance;
    globalRegistration?: GodRegister;
    error?: string;
  }>;
  rollbackCrossServerRegistration(phoneNumber: string, botId?: string, targetServerName?: string): Promise<void>;

  // Server registry methods (multi-tenancy management)
  getAllServers(): Promise<ServerRegistry[]>;
  getServerByName(serverName: string): Promise<ServerRegistry | undefined>;
  createServer(server: InsertServerRegistry): Promise<ServerRegistry>;
  updateServerBotCount(serverName: string, currentBotCount: number): Promise<ServerRegistry>;
  updateServerInfo(currentServerName: string, updates: { serverName: string; description?: string | null }): Promise<ServerRegistry>;
  getAvailableServers(): Promise<ServerRegistry[]>;
  initializeCurrentServer(): Promise<void>;
  strictCheckBotCountLimit(serverName?: string): Promise<{ canAdd: boolean; currentCount: number; maxCount: number; }>;

  // Enhanced credential management methods
  getBotInstancesForAutoStart(): Promise<BotInstance[]>;
  analyzeInactiveBots(): Promise<void>;
  updateBotCredentialStatus(id: string, credentialData: {
    credentialVerified: boolean;
    credentialPhone?: string;
    invalidReason?: string;
    credentials?: any;
    autoStart?: boolean;
    authMessageSentAt?: Date | null;
  }): Promise<BotInstance>;

  // Cross-server update methods
  updateBotInstanceOnServer(id: string, targetServerName: string, updates: Partial<BotInstance>): Promise<BotInstance>;
  updateBotCredentialStatusOnServer(id: string, targetServerName: string, credentialData: {
    credentialVerified: boolean;
    credentialPhone?: string;
    invalidReason?: string;
    credentials?: any;
    autoStart?: boolean;
    authMessageSentAt?: Date | null;
  }): Promise<BotInstance>;
  markBotAsInactive(id: string, reason: string): Promise<void>;
  setBotAutoStart(id: string, autoStart: boolean): Promise<BotInstance>;
  setAuthMessageSent(id: string): Promise<BotInstance>;

  // Viewed Status IDs methods
  markStatusAsViewed(viewedStatus: InsertViewedStatusId): Promise<ViewedStatusId>;
  isStatusAlreadyViewed(botInstanceId: string, statusId: string): Promise<boolean>;
  getViewedStatusIds(botInstanceId: string): Promise<ViewedStatusId[]>;
  deleteExpiredStatusIds(botInstanceId: string): Promise<number>;
  cleanupAllExpiredStatusIds(): Promise<number>;

  // External Bot Connection methods
  createExternalBotConnection(connection: InsertExternalBotConnection): Promise<ExternalBotConnection>;
  getExternalBotConnection(phoneNumber: string, currentServerName?: string): Promise<ExternalBotConnection | undefined>;
  updateExternalBotConnection(id: string, updates: Partial<ExternalBotConnection>): Promise<ExternalBotConnection>;
  deleteExternalBotConnection(id: string): Promise<void>;
  getActiveExternalConnections(currentServerName?: string): Promise<ExternalBotConnection[]>;
  validateExternalBotCredentials(phoneNumber: string, credentials: any): Promise<{
    valid: boolean;
    ownerJid?: string;
    originServerName?: string;
    remoteBotId?: string;
    features?: any;
    error?: string;
  }>;
  cleanupExpiredExternalConnections(): Promise<number>;

  // Master Control methods for cross-server management
  getAllBotsAcrossServers(): Promise<BotInstance[]>;
  approveBotCrossServer(id: string, targetServerName: string, expirationMonths?: number): Promise<BotInstance>;
  revokeBotApproval(id: string, targetServerName: string): Promise<BotInstance>;
  deleteBotCrossServer(id: string, targetServerName: string): Promise<void>;
  deleteServer(serverName: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const serverName = getServerName();
    const [user] = await db.select().from(users).where(and(eq(users.username, username), eq(users.serverName, serverName)));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const serverName = getServerName();
    const [user] = await db
      .insert(users)
      .values({ ...insertUser, serverName })
      .returning();
    return user;
  }

  // Bot Instance methods
  async getBotInstance(id: string): Promise<BotInstance | undefined> {
    const serverName = getServerName();
    const [botInstance] = await db.select().from(botInstances).where(and(eq(botInstances.id, id), eq(botInstances.serverName, serverName)));
    return botInstance || undefined;
  }

  async getAllBotInstances(): Promise<BotInstance[]> {
    const serverName = getServerName();
    return await db.select().from(botInstances).where(eq(botInstances.serverName, serverName)).orderBy(desc(botInstances.createdAt));
  }

  async getBotInstancesForServer(serverName: string): Promise<BotInstance[]> {
    return await db.select().from(botInstances).where(eq(botInstances.serverName, serverName)).orderBy(desc(botInstances.createdAt));
  }

  async getBotInstancesByApprovalStatus(approvalStatus: string): Promise<BotInstance[]> {
    const serverName = getServerName();
    return await db.select().from(botInstances).where(
      and(
        eq(botInstances.serverName, serverName),
        eq(botInstances.approvalStatus, approvalStatus)
      )
    ).orderBy(desc(botInstances.createdAt));
  }

  async createBotInstance(insertBotInstance: InsertBotInstance): Promise<BotInstance> {
    const serverName = getServerName();
    const [botInstance] = await db
      .insert(botInstances)
      .values({ ...insertBotInstance, serverName })
      .returning();

    // Auto-update server bot count in registry after bot creation
    await this.updateBotCountAfterChange(serverName);
    console.log(`📊 Updated bot count for ${serverName} after creating bot ${botInstance.name}`);

    return botInstance;
  }

  // NEW: Create bot instance on specific server (for cross-server registration)
  async createBotInstanceForServer(targetServerName: string, insertBotInstance: InsertBotInstance): Promise<BotInstance> {
    console.log(`🎯 Creating bot on target server: ${targetServerName} (current context: ${getServerName()})`);

    // Create bot directly on target server by specifying serverName explicitly
    const [botInstance] = await db
      .insert(botInstances)
      .values({ ...insertBotInstance, serverName: targetServerName })
      .returning();

    // Auto-update target server bot count in registry after bot creation
    await this.updateBotCountAfterChange(targetServerName);
    console.log(`📊 Updated bot count for ${targetServerName} after creating bot ${botInstance.name}`);

    return botInstance;
  }

  async updateBotInstance(id: string, updates: Partial<BotInstance>): Promise<BotInstance> {
    // CRITICAL SECURITY FIX: Scope by serverName to prevent cross-tenant data writes
    const serverName = getServerName();
    const [botInstance] = await db
      .update(botInstances)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(botInstances.id, id), eq(botInstances.serverName, serverName)))
      .returning();

    if (!botInstance) {
      throw new Error(`Bot ${id} not found on server ${serverName} or access denied`);
    }

    return botInstance;
  }

  async deleteBotInstance(id: string): Promise<void> {
    const serverName = getServerName();

    // Get bot info before deletion for logging
    const botInstance = await this.getBotInstance(id);

    await db.delete(botInstances).where(and(eq(botInstances.id, id), eq(botInstances.serverName, serverName)));

    // Auto-update server bot count in registry after bot deletion
    await this.updateBotCountAfterChange(serverName);
    console.log(`📊 Updated bot count for ${serverName} after deleting bot ${botInstance?.name || id}`);
  }

  // Delete all related data when a bot is deleted
  async deleteBotRelatedData(botId: string): Promise<void> {
    const serverName = getServerName();

    // Delete bot-specific commands
    await db.delete(commands).where(and(eq(commands.botInstanceId, botId), eq(commands.serverName, serverName)));

    // Delete bot activities
    await db.delete(activities).where(and(eq(activities.botInstanceId, botId), eq(activities.serverName, serverName)));

    // Delete bot groups
    await db.delete(groups).where(and(eq(groups.botInstanceId, botId), eq(groups.serverName, serverName)));

    console.log(`🧹 Cleaned up related data for bot ${botId}`);
  }

  async checkBotCountLimit(): Promise<boolean> {
    const serverName = getServerName();
    const maxBots = getMaxBotCount();
    const currentBots = await db.select().from(botInstances).where(eq(botInstances.serverName, serverName));
    return currentBots.length < maxBots;
  }

  async getOldestPendingBot(): Promise<BotInstance | undefined> {
    const serverName = getServerName();
    const [bot] = await db
      .select()
      .from(botInstances)
      .where(and(
        eq(botInstances.serverName, serverName),
        eq(botInstances.approvalStatus, 'pending')
      ))
      .orderBy(botInstances.createdAt)
      .limit(1);
    return bot;
  }

  async getBotByPhoneNumber(phoneNumber: string): Promise<BotInstance | undefined> {
    const serverName = getServerName();
    const [botInstance] = await db.select().from(botInstances).where(and(eq(botInstances.phoneNumber, phoneNumber), eq(botInstances.serverName, serverName)));
    return botInstance || undefined;
  }

  async getPendingBots(): Promise<BotInstance[]> {
    const serverName = getServerName();
    return await db.select().from(botInstances).where(and(eq(botInstances.approvalStatus, 'pending'), eq(botInstances.serverName, serverName))).orderBy(desc(botInstances.createdAt));
  }

  async getApprovedBots(): Promise<BotInstance[]> {
    const serverName = getServerName();
    return await db.select().from(botInstances).where(and(eq(botInstances.approvalStatus, 'approved'), eq(botInstances.serverName, serverName))).orderBy(desc(botInstances.createdAt));
  }

  // Cross-tenancy approved bots - shows approved bots from ALL servers
  async getAllApprovedBots(): Promise<BotInstance[]> {
    return await db.select().from(botInstances)
      .where(eq(botInstances.approvalStatus, 'approved'))
      .orderBy(desc(botInstances.createdAt));
  }

  async checkAndExpireBots(): Promise<void> {
    console.log('🔄 Checking for expired bots...');
    const approvedBots = await this.getApprovedBots();
    const now = new Date();

    for (const bot of approvedBots) {
      if (bot.approvalDate && bot.expirationMonths) {
        const approvalDate = new Date(bot.approvalDate);
        const expirationDate = new Date(approvalDate);
        expirationDate.setMonth(expirationDate.getMonth() + bot.expirationMonths);

        if (now > expirationDate) {
          console.log(`⏰ Bot ${bot.name} (${bot.phoneNumber}) expired - moving back to pending`);
          await this.updateBotInstance(bot.id, {
            approvalStatus: 'pending',
            status: 'offline',
            approvalDate: null,
            expirationMonths: null
          });

          await this.createActivity({
            botInstanceId: bot.id,
            type: 'expiration',
            description: `Bot ${bot.name} expired after ${bot.expirationMonths} months`,
            metadata: { originalApprovalDate: bot.approvalDate, expiredOn: now.toISOString() },
            serverName: getServerName()
          });
        }
      }
    }
  }

  async approveBotInstance(id: string, expirationMonths?: number): Promise<boolean> {
    const serverName = getServerName();
    const now = new Date();

    try {
      const result = await db.update(botInstances)
        .set({
          approvalStatus: 'approved',
          approvalDate: now.toISOString(),
          expirationMonths: expirationMonths || null
        })
        .where(and(eq(botInstances.id, id), eq(botInstances.serverName, serverName)))
        .returning();

      if (result.length > 0) {
        await this.createActivity({
          botInstanceId: id,
          type: 'approval',
          description: `Bot approved by admin${expirationMonths ? ` for ${expirationMonths} months` : ' with unlimited access'}`,
          metadata: { approvalDate: now.toISOString(), expirationMonths },
          serverName: getServerName()
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error approving bot:', error);
      return false;
    }
  }

  async rejectBotInstance(id: string): Promise<boolean> {
    const serverName = getServerName();

    try {
      const result = await db.delete(botInstances)
        .where(and(eq(botInstances.id, id), eq(botInstances.serverName, serverName)))
        .returning();

      if (result.length > 0) {
        await this.createActivity({
          botInstanceId: id,
          type: 'rejection',
          description: `Bot rejected and removed by admin`,
          metadata: { rejectionDate: new Date().toISOString() },
          serverName: getServerName()
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error rejecting bot:', error);
      return false;
    }
  }

  // Command methods
  async getCommands(botInstanceId?: string): Promise<Command[]> {
    const serverName = getServerName();
    if (botInstanceId) {
      return await db.select().from(commands).where(
        and(
          eq(commands.botInstanceId, botInstanceId),
          eq(commands.isActive, true),
          eq(commands.serverName, serverName)
        )
      );
    }
    return await db.select().from(commands).where(and(eq(commands.isActive, true), eq(commands.serverName, serverName)));
  }

  async getCommand(id: string): Promise<Command | undefined> {
    const serverName = getServerName();
    const [command] = await db.select().from(commands).where(and(eq(commands.id, id), eq(commands.serverName, serverName)));
    return command || undefined;
  }

  async createCommand(insertCommand: InsertCommand): Promise<Command> {
    const serverName = getServerName();
    const [command] = await db
      .insert(commands)
      .values({ ...insertCommand, serverName })
      .returning();
    return command;
  }

  async updateCommand(id: string, updates: Partial<Command>): Promise<Command> {
    const serverName = getServerName();
    const [command] = await db
      .update(commands)
      .set(updates)
      .where(and(eq(commands.id, id), eq(commands.serverName, serverName)))
      .returning();
    return command;
  }

  async deleteCommand(id: string): Promise<void> {
    const serverName = getServerName();
    await db.delete(commands).where(and(eq(commands.id, id), eq(commands.serverName, serverName)));
  }

  // Activity methods
  async getActivities(botInstanceId?: string, limit: number = 20): Promise<Activity[]> {
    const query = db.select().from(activities);

    if (botInstanceId) {
      query.where(and(
        eq(activities.botInstanceId, botInstanceId),
        eq(activities.serverName, getServerName())
      ));
    } else {
      query.where(eq(activities.serverName, getServerName()));
    }

    return query.orderBy(desc(activities.createdAt)).limit(limit);
  }

  async getRecentActivities(limit: number = 50): Promise<Activity[]> {
    return db.select()
      .from(activities)
      .where(eq(activities.serverName, getServerName()))
      .orderBy(desc(activities.createdAt))
      .limit(limit);
  }

  async createActivity(insertActivity: InsertActivity): Promise<Activity> {
    const serverName = getServerName();
    const [activity] = await db
      .insert(activities)
      .values({ ...insertActivity, serverName })
      .returning();
    return activity;
  }

  // Cross-tenancy activity logging - supports remote bot activities
  async createCrossTenancyActivity(params: {
    type: string;
    description: string;
    metadata?: any;
    serverName: string;
    // Either local bot or cross-tenancy identification
    botInstanceId?: string;
    remoteTenancy?: string;
    remoteBotId?: string;
    phoneNumber?: string;
  }): Promise<Activity> {
    const [newActivity] = await db.insert(activities).values({
      botInstanceId: params.botInstanceId || null,
      type: params.type,
      description: params.description,
      metadata: params.metadata || {},
      serverName: params.serverName,
      remoteTenancy: params.remoteTenancy || null,
      remoteBotId: params.remoteBotId || null,
      phoneNumber: params.phoneNumber || null,
    }).returning();
    return newActivity;
  }

  // Group methods
  async getGroups(botInstanceId: string): Promise<Group[]> {
    const serverName = getServerName();
    return await db.select().from(groups).where(
      and(
        eq(groups.botInstanceId, botInstanceId),
        eq(groups.isActive, true),
        eq(groups.serverName, serverName)
      )
    );
  }

  async createGroup(insertGroup: InsertGroup): Promise<Group> {
    const serverName = getServerName();
    const [group] = await db
      .insert(groups)
      .values({ ...insertGroup, serverName })
      .returning();
    return group;
  }

  async updateGroup(id: string, updates: Partial<Group>): Promise<Group> {
    const serverName = getServerName();
    const [group] = await db
      .update(groups)
      .set(updates)
      .where(and(eq(groups.id, id), eq(groups.serverName, serverName)))
      .returning();
    return group;
  }

  async deleteGroup(id: string): Promise<void> {
    const serverName = getServerName();
    await db.delete(groups).where(and(eq(groups.id, id), eq(groups.serverName, serverName)));
  }

  // Statistics
  async getDashboardStats(): Promise<{
    totalBots: number;
    activeBots: number;
    messagesCount: number;
    commandsCount: number;
  }> {
    const serverName = getServerName();
    const [totalBotsResult] = await db.select({ count: sql<number>`count(*)` }).from(botInstances).where(eq(botInstances.serverName, serverName));
    const [activeBotsResult] = await db.select({ count: sql<number>`count(*)` }).from(botInstances).where(and(eq(botInstances.status, "online"), eq(botInstances.serverName, serverName)));
    const [messagesResult] = await db.select({ sum: sql<number>`sum(${botInstances.messagesCount})` }).from(botInstances).where(eq(botInstances.serverName, serverName));
    const [commandsResult] = await db.select({ sum: sql<number>`sum(${botInstances.commandsCount})` }).from(botInstances).where(eq(botInstances.serverName, serverName));

    return {
      totalBots: totalBotsResult.count || 0,
      activeBots: activeBotsResult.count || 0,
      messagesCount: messagesResult.sum || 0,
      commandsCount: commandsResult.sum || 0,
    };
  }

  async getAllActivities(limit = 100): Promise<Activity[]> {
    const serverName = getServerName();
    return await db.select().from(activities)
      .where(eq(activities.serverName, serverName))
      .orderBy(desc(activities.createdAt))
      .limit(limit);
  }

  async getSystemStats(): Promise<{
    totalBots: number;
    onlineBots: number;
    offlineBots: number;
    totalMessages: number;
    totalCommands: number;
    recentActivities: number;
  }> {
    const serverName = getServerName();
    const [totalBotsResult] = await db.select({ count: sql<number>`count(*)` }).from(botInstances).where(eq(botInstances.serverName, serverName));
    const [onlineBotsResult] = await db.select({ count: sql<number>`count(*)` }).from(botInstances).where(and(eq(botInstances.status, "online"), eq(botInstances.serverName, serverName)));
    const [offlineBotsResult] = await db.select({ count: sql<number>`count(*)` }).from(botInstances).where(and(eq(botInstances.status, "offline"), eq(botInstances.serverName, serverName)));
    const [messagesResult] = await db.select({ sum: sql<number>`sum(${botInstances.messagesCount})` }).from(botInstances).where(eq(botInstances.serverName, serverName));
    const [commandsResult] = await db.select({ sum: sql<number>`sum(${botInstances.commandsCount})` }).from(botInstances).where(eq(botInstances.serverName, serverName));
    const [activitiesResult] = await db.select({ count: sql<number>`count(*)` }).from(activities).where(eq(activities.serverName, serverName));

    return {
      totalBots: totalBotsResult.count || 0,
      onlineBots: onlineBotsResult.count || 0,
      offlineBots: offlineBotsResult.count || 0,
      totalMessages: messagesResult.sum || 0,
      totalCommands: commandsResult.sum || 0,
      recentActivities: activitiesResult.count || 0,
    };
  }

  // Global registration methods (tenant-independent)
  async checkGlobalRegistration(phoneNumber: string): Promise<GodRegister | undefined> {
    const [registration] = await db.select().from(godRegister).where(eq(godRegister.phoneNumber, phoneNumber));
    return registration || undefined;
  }

  async addGlobalRegistration(phoneNumber: string, tenancyName: string): Promise<GodRegister> {
    // Check if phone number already exists
    const existing = await this.checkGlobalRegistration(phoneNumber);
    if (existing) {
      throw new Error(`Phone number ${phoneNumber} is already registered on ${existing.tenancyName}`);
    }

    const [registration] = await db
      .insert(godRegister)
      .values({ phoneNumber, tenancyName })
      .returning();
    return registration;
  }

  async deleteGlobalRegistration(phoneNumber: string): Promise<void> {
    await db.delete(godRegister).where(eq(godRegister.phoneNumber, phoneNumber));
  }

  async getAllGlobalRegistrations(): Promise<GodRegister[]> {
    return await db.select().from(godRegister).orderBy(desc(godRegister.registeredAt));
  }

  async updateGlobalRegistration(phoneNumber: string, tenancyName: string): Promise<GodRegister | undefined> {
    const [registration] = await db
      .update(godRegister)
      .set({ tenancyName })
      .where(eq(godRegister.phoneNumber, phoneNumber))
      .returning();
    return registration || undefined;
  }

  // Cross-server registration with atomic rollback support
  async createCrossServerRegistration(phoneNumber: string, targetServerName: string, botData: InsertBotInstance): Promise<{
    success: boolean;
    botInstance?: BotInstance;
    globalRegistration?: GodRegister;
    error?: string;
  }> {
    console.log(`🔄 Starting cross-server registration: ${phoneNumber} -> ${targetServerName}`);

    let globalRegistration: GodRegister | undefined;
    let botInstance: BotInstance | undefined;

    try {
      // Step 1: Re-check target server capacity to prevent race conditions
      const capacityCheck = await this.strictCheckBotCountLimit(targetServerName);
      if (!capacityCheck.canAdd) {
        return {
          success: false,
          error: `Target server ${targetServerName} is at capacity (${capacityCheck.currentCount}/${capacityCheck.maxCount}). Please choose a different server.`
        };
      }
      console.log(`✅ Target server ${targetServerName} capacity OK: ${capacityCheck.currentCount}/${capacityCheck.maxCount}`);

      // Step 2: Add global registration first (this will fail if phone already exists)
      try {
        globalRegistration = await this.addGlobalRegistration(phoneNumber, targetServerName);
        console.log(`✅ Global registration created: ${phoneNumber} -> ${targetServerName}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        if (errorMsg.includes('already registered')) {
          return {
            success: false,
            error: `Phone number ${phoneNumber} is already registered. Each phone can only be used once.`
          };
        }
        throw error; // Re-throw unexpected errors
      }

      // Step 3: Create bot on target server
      try {
        botInstance = await this.createBotInstanceForServer(targetServerName, botData);
        console.log(`✅ Bot created on target server: ${botInstance.id} on ${targetServerName}`);

        // Step 4: Log cross-tenancy activity for audit trail
        await this.createCrossTenancyActivity({
          type: 'cross_server_registration',
          description: `Bot registered on ${targetServerName} from ${getServerName()}`,
          metadata: {
            sourceServer: getServerName(),
            targetServer: targetServerName,
            botId: botInstance.id,
            botName: botInstance.name
          },
          serverName: targetServerName, // Log to target server
          botInstanceId: botInstance.id,
          phoneNumber: phoneNumber
        });

        return {
          success: true,
          botInstance,
          globalRegistration
        };

      } catch (botError) {
        console.error(`❌ Bot creation failed on ${targetServerName}:`, botError);

        // Rollback: Remove global registration
        await this.deleteGlobalRegistration(phoneNumber);
        console.log(`🔄 Rolled back global registration for ${phoneNumber}`);

        return {
          success: false,
          error: `Failed to create bot on ${targetServerName}: ${botError instanceof Error ? botError.message : 'Unknown error'}`
        };
      }

    } catch (error) {
      console.error(`❌ Cross-server registration failed for ${phoneNumber}:`, error);

      // Comprehensive rollback
      await this.rollbackCrossServerRegistration(phoneNumber, botInstance?.id, targetServerName);

      return {
        success: false,
        error: `Registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  // Comprehensive rollback for failed cross-server registrations
  async rollbackCrossServerRegistration(phoneNumber: string, botId?: string, targetServerName?: string): Promise<void> {
    console.log(`🔄 Rolling back cross-server registration for ${phoneNumber}`);

    try {
      // Remove global registration
      await this.deleteGlobalRegistration(phoneNumber);
      console.log(`✅ Removed global registration for ${phoneNumber}`);
    } catch (error) {
      console.warn(`⚠️ Failed to remove global registration for ${phoneNumber}:`, error);
    }

    if (botId && targetServerName) {
      try {
        // Remove bot instance from target server
        await db.delete(botInstances).where(
          and(
            eq(botInstances.id, botId),
            eq(botInstances.serverName, targetServerName)
          )
        );

        // Update target server bot count
        await this.updateBotCountAfterChange(targetServerName);

        console.log(`✅ Removed bot ${botId} from ${targetServerName}`);
      } catch (error) {
        console.warn(`⚠️ Failed to remove bot ${botId} from ${targetServerName}:`, error);
      }
    }

    console.log(`🔄 Rollback completed for ${phoneNumber}`);
  }

  // Server registry methods (multi-tenancy management)
  async getAllServers(): Promise<ServerRegistry[]> {
    return await db.select().from(serverRegistry).orderBy(serverRegistry.serverName);
  }

  async getServerByName(serverName: string): Promise<ServerRegistry | undefined> {
    const [server] = await db.select().from(serverRegistry).where(eq(serverRegistry.serverName, serverName));
    return server || undefined;
  }

  async createServer(server: InsertServerRegistry): Promise<ServerRegistry> {
    const [newServer] = await db
      .insert(serverRegistry)
      .values(server)
      .returning();
    return newServer;
  }

  async updateServerBotCount(serverName: string, currentBotCount: number): Promise<ServerRegistry> {
    const [server] = await db
      .update(serverRegistry)
      .set({
        currentBotCount,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(eq(serverRegistry.serverName, serverName))
      .returning();
    return server;
  }

  async updateServerInfo(currentServerName: string, updates: { serverName: string; description?: string | null }): Promise<ServerRegistry> {
    const [server] = await db
      .update(serverRegistry)
      .set({
        serverName: updates.serverName,
        description: updates.description,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(eq(serverRegistry.serverName, currentServerName))
      .returning();
    return server;
  }

  async getAvailableServers(): Promise<ServerRegistry[]> {
    // Get servers that have capacity (currentBotCount < maxBotCount) and are active
    return await db
      .select()
      .from(serverRegistry)
      .where(
        and(
          eq(serverRegistry.serverStatus, 'active'),
          sql`${serverRegistry.currentBotCount} < ${serverRegistry.maxBotCount}`
        )
      )
      .orderBy(serverRegistry.serverName);
  }

  async initializeCurrentServer(): Promise<void> {
    const currentServerName = getServerName();
    const maxBots = getMaxBotCount();

    // Check if current server exists in registry
    const existingServer = await this.getServerByName(currentServerName);

    if (!existingServer) {
      // Create new server entry
      await this.createServer({
        serverName: currentServerName,
        maxBotCount: maxBots,
        currentBotCount: 0,
        serverStatus: 'active',
        description: `Auto-created server ${currentServerName}`
      });
      console.log(`✅ Created server registry entry for ${currentServerName}`);
    } else if (existingServer.maxBotCount !== maxBots) {
      // Update max bot count if BOTCOUNT environment variable changed
      await db
        .update(serverRegistry)
        .set({
          maxBotCount: maxBots,
          updatedAt: sql`CURRENT_TIMESTAMP`
        })
        .where(eq(serverRegistry.serverName, currentServerName));
      console.log(`✅ Updated max bot count for ${currentServerName} to ${maxBots}`);
    }

    // Update current bot count to reflect actual database state
    const actualBotCount = await this.getBotInstancesForServer(currentServerName);
    await this.updateServerBotCount(currentServerName, actualBotCount.length);
  }

  // Helper method to automatically update server bot count based on actual database count
  async updateBotCountAfterChange(serverName?: string): Promise<void> {
    const targetServer = serverName || getServerName();

    // Get actual bot count from database
    const actualBots = await this.getBotInstancesForServer(targetServer);
    const currentCount = actualBots.length;

    // Update the server registry with the current count
    await this.updateServerBotCount(targetServer, currentCount);
  }

  async strictCheckBotCountLimit(serverName?: string): Promise<{ canAdd: boolean; currentCount: number; maxCount: number; }> {
    const targetServer = serverName || getServerName();

    // Get actual bot count from database
    const actualBots = await this.getBotInstancesForServer(targetServer);
    const currentCount = actualBots.length;

    // Get max count from server registry or fallback to environment variable
    let maxCount = getMaxBotCount(); // Default fallback
    const serverInfo = await this.getServerByName(targetServer);
    if (serverInfo) {
      maxCount = serverInfo.maxBotCount;
      // Update the current count in registry to keep it in sync
      await this.updateServerBotCount(targetServer, currentCount);
    }

    const canAdd = currentCount < maxCount;

    return {
      canAdd,
      currentCount,
      maxCount
    };
  }

  // Enhanced credential management methods
  async getBotInstancesForAutoStart(): Promise<BotInstance[]> {
    const serverName = getServerName();
    return await db.select().from(botInstances).where(
      and(
        eq(botInstances.serverName, serverName),
        eq(botInstances.approvalStatus, 'approved'),
        eq(botInstances.autoStart, true),
        eq(botInstances.credentialVerified, true)
      )
    ).orderBy(desc(botInstances.createdAt));
  }

  async analyzeInactiveBots(): Promise<void> {
    console.log('🔍 Analyzing inactive bots...');
    const serverName = getServerName();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Find bots that are offline and haven't been active for 7+ days
    const inactiveBots = await db.select().from(botInstances).where(
      and(
        eq(botInstances.serverName, serverName),
        eq(botInstances.status, 'offline'),
        sql`${botInstances.lastActivity} < ${sevenDaysAgo.toISOString()} OR ${botInstances.lastActivity} IS NULL`
      )
    );

    for (const bot of inactiveBots) {
      if (bot.autoStart) {
        console.log(`🔄 Marking inactive bot ${bot.name} (${bot.phoneNumber}) as non-auto-start`);
        await this.markBotAsInactive(bot.id, 'Inactive for more than 7 days');
      }
    }

    // Find bots with invalid credentials (status offline and recently tried to connect)
    const recentlyFailedBots = await db.select().from(botInstances).where(
      and(
        eq(botInstances.serverName, serverName),
        eq(botInstances.status, 'offline'),
        sql`${botInstances.lastActivity} > ${sevenDaysAgo.toISOString()}`
      )
    );

    for (const bot of recentlyFailedBots) {
      if (bot.autoStart && !bot.credentialVerified) {
        console.log(`🔄 Marking bot with invalid credentials ${bot.name} (${bot.phoneNumber}) as non-auto-start`);
        await this.markBotAsInactive(bot.id, 'Invalid or expired credentials');
      }
    }
  }

  async updateBotCredentialStatus(id: string, credentialData: {
    credentialVerified: boolean;
    credentialPhone?: string;
    invalidReason?: string;
    credentials?: any;
    autoStart?: boolean;
    authMessageSentAt?: Date | null;
  }): Promise<BotInstance> {
    const updateData: any = {
      credentialVerified: credentialData.credentialVerified,
      updatedAt: sql`CURRENT_TIMESTAMP`
    };

    if (credentialData.credentialPhone) {
      updateData.credentialPhone = credentialData.credentialPhone;
    }
    if (credentialData.invalidReason !== undefined) {
      updateData.invalidReason = credentialData.invalidReason;
    }
    if (credentialData.credentials) {
      updateData.credentials = credentialData.credentials;
    }
    if (credentialData.autoStart !== undefined) {
      updateData.autoStart = credentialData.autoStart;
    }
    if (credentialData.authMessageSentAt !== undefined) {
      updateData.authMessageSentAt = credentialData.authMessageSentAt;
    }

    const [botInstance] = await db
      .update(botInstances)
      .set(updateData)
      .where(eq(botInstances.id, id))
      .returning();

    return botInstance;
  }

  // Cross-server bot update methods for cross-server operations
  async updateBotInstanceOnServer(id: string, targetServerName: string, updates: Partial<BotInstance>): Promise<BotInstance> {
    const [botInstance] = await db
      .update(botInstances)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(botInstances.id, id), eq(botInstances.serverName, targetServerName)))
      .returning();

    if (!botInstance) {
      throw new Error(`Bot ${id} not found on server ${targetServerName} or access denied`);
    }

    return botInstance;
  }

  async updateBotCredentialStatusOnServer(id: string, targetServerName: string, credentialData: {
    credentialVerified: boolean;
    credentialPhone?: string;
    invalidReason?: string;
    credentials?: any;
    autoStart?: boolean;
    authMessageSentAt?: Date | null;
  }): Promise<BotInstance> {
    const updateData: any = {
      credentialVerified: credentialData.credentialVerified,
      updatedAt: sql`CURRENT_TIMESTAMP`
    };

    if (credentialData.credentialPhone) {
      updateData.credentialPhone = credentialData.credentialPhone;
    }
    if (credentialData.invalidReason !== undefined) {
      updateData.invalidReason = credentialData.invalidReason;
    }
    if (credentialData.credentials) {
      updateData.credentials = credentialData.credentials;
    }
    if (credentialData.autoStart !== undefined) {
      updateData.autoStart = credentialData.autoStart;
    }
    if (credentialData.authMessageSentAt !== undefined) {
      updateData.authMessageSentAt = credentialData.authMessageSentAt;
    }

    const [botInstance] = await db
      .update(botInstances)
      .set(updateData)
      .where(and(eq(botInstances.id, id), eq(botInstances.serverName, targetServerName)))
      .returning();

    if (!botInstance) {
      throw new Error(`Bot ${id} not found on server ${targetServerName} or access denied`);
    }

    return botInstance;
  }

  async markBotAsInactive(id: string, reason: string): Promise<void> {
    await db
      .update(botInstances)
      .set({
        autoStart: false,
        invalidReason: reason,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(eq(botInstances.id, id));

    // Create activity record
    await this.createActivity({
      botInstanceId: id,
      type: 'inactivity',
      description: `Bot marked as inactive: ${reason}`,
      metadata: { reason, timestamp: new Date().toISOString() },
      serverName: getServerName()
    });
  }

  async setBotAutoStart(id: string, autoStart: boolean): Promise<BotInstance> {
    const [botInstance] = await db
      .update(botInstances)
      .set({
        autoStart,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(eq(botInstances.id, id))
      .returning();

    return botInstance;
  }

  async setAuthMessageSent(id: string): Promise<BotInstance> {
    const [botInstance] = await db
      .update(botInstances)
      .set({
        authMessageSentAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(eq(botInstances.id, id))
      .returning();

    return botInstance;
  }

  // Viewed Status IDs methods implementation
  async markStatusAsViewed(insertViewedStatus: InsertViewedStatusId): Promise<ViewedStatusId> {
    const serverName = getServerName();
    const [viewedStatus] = await db
      .insert(viewedStatusIds)
      .values({ ...insertViewedStatus, serverName })
      .returning();
    return viewedStatus;
  }

  async isStatusAlreadyViewed(botInstanceId: string, statusId: string): Promise<boolean> {
    const serverName = getServerName();
    const [existingView] = await db
      .select()
      .from(viewedStatusIds)
      .where(
        and(
          eq(viewedStatusIds.botInstanceId, botInstanceId),
          eq(viewedStatusIds.statusId, statusId),
          eq(viewedStatusIds.serverName, serverName)
        )
      )
      .limit(1);
    return !!existingView;
  }

  async getViewedStatusIds(botInstanceId: string): Promise<ViewedStatusId[]> {
    const serverName = getServerName();
    return await db
      .select()
      .from(viewedStatusIds)
      .where(
        and(
          eq(viewedStatusIds.botInstanceId, botInstanceId),
          eq(viewedStatusIds.serverName, serverName)
        )
      )
      .orderBy(desc(viewedStatusIds.viewedAt));
  }

  async deleteExpiredStatusIds(botInstanceId: string): Promise<number> {
    const serverName = getServerName();
    const now = new Date().toISOString();

    const result = await db
      .delete(viewedStatusIds)
      .where(
        and(
          eq(viewedStatusIds.botInstanceId, botInstanceId),
          eq(viewedStatusIds.serverName, serverName),
          sql`${viewedStatusIds.expiresAt} < ${now}`
        )
      )
      .returning();

    return result.length;
  }

  async cleanupAllExpiredStatusIds(): Promise<number> {
    const now = new Date().toISOString();

    const result = await db
      .delete(viewedStatusIds)
      .where(sql`${viewedStatusIds.expiresAt} < ${now}`)
      .returning();

    return result.length;
  }

  // External Bot Connection methods
  async createExternalBotConnection(connection: InsertExternalBotConnection): Promise<ExternalBotConnection> {
    const [newConnection] = await db
      .insert(externalBotConnections)
      .values(connection)
      .returning();
    return newConnection;
  }

  async getExternalBotConnection(phoneNumber: string, currentServerName?: string): Promise<ExternalBotConnection | undefined> {
    const serverName = currentServerName || getServerName();
    const [connection] = await db
      .select()
      .from(externalBotConnections)
      .where(
        and(
          eq(externalBotConnections.phoneNumber, phoneNumber),
          eq(externalBotConnections.currentServerName, serverName),
          sql`${externalBotConnections.expiresAt} > CURRENT_TIMESTAMP`
        )
      )
      .orderBy(desc(externalBotConnections.createdAt))
      .limit(1);
    return connection || undefined;
  }

  async updateExternalBotConnection(id: string, updates: Partial<ExternalBotConnection>): Promise<ExternalBotConnection> {
    const currentServerName = getServerName();
    const [connection] = await db
      .update(externalBotConnections)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          eq(externalBotConnections.id, id),
          eq(externalBotConnections.currentServerName, currentServerName)
        )
      )
      .returning();
    
    if (!connection) {
      throw new Error(`External bot connection ${id} not found on server ${currentServerName} or access denied`);
    }
    
    return connection;
  }

  async deleteExternalBotConnection(id: string): Promise<void> {
    const currentServerName = getServerName();
    await db.delete(externalBotConnections).where(
      and(
        eq(externalBotConnections.id, id),
        eq(externalBotConnections.currentServerName, currentServerName)
      )
    );
  }

  async getActiveExternalConnections(currentServerName?: string): Promise<ExternalBotConnection[]> {
    const serverName = currentServerName || getServerName();
    return await db
      .select()
      .from(externalBotConnections)
      .where(
        and(
          eq(externalBotConnections.currentServerName, serverName),
          sql`${externalBotConnections.expiresAt} > CURRENT_TIMESTAMP`
        )
      )
      .orderBy(desc(externalBotConnections.connectionEstablishedAt));
  }

  async validateExternalBotCredentials(phoneNumber: string, credentials: any): Promise<{
    valid: boolean;
    ownerJid?: string;
    originServerName?: string;
    remoteBotId?: string;
    features?: any;
    error?: string;
  }> {
    try {
      // First check if this phone number is registered in the God Registry
      const globalRegistration = await this.checkGlobalRegistration(phoneNumber);
      if (!globalRegistration) {
        return { valid: false, error: "Bot not found in global registry" };
      }

      const originServerName = globalRegistration.tenancyName;
      const currentServerName = getServerName();

      // If it's on the same server, handle locally
      if (originServerName === currentServerName) {
        const localBot = await this.getBotByPhoneNumber(phoneNumber);
        if (!localBot) {
          return { valid: false, error: "Bot not found on local server" };
        }

        // Validate credentials match the local bot
        const credentialsMatch = localBot.credentials && JSON.stringify(localBot.credentials) === JSON.stringify(credentials);
        if (!credentialsMatch) {
          return { valid: false, error: "Invalid credentials provided" };
        }

        return {
          valid: true,
          ownerJid: localBot.phoneNumber + "@s.whatsapp.net",
          originServerName: originServerName,
          remoteBotId: localBot.id,
          features: {
            autoLike: localBot.autoLike,
            autoReact: localBot.autoReact,
            autoViewStatus: localBot.autoViewStatus,
            chatgptEnabled: localBot.chatgptEnabled,
            typingMode: localBot.typingMode,
            presenceMode: localBot.presenceMode,
            alwaysOnline: localBot.alwaysOnline,
            presenceAutoSwitch: localBot.presenceAutoSwitch
          }
        };
      } else {
        // For remote servers, use CrossTenancyClient to validate on origin server
        console.log(`External bot validation for ${phoneNumber} from server ${originServerName}`);
        
        const { crossTenancyClient } = await import('./services/crossTenancyClient');
        
        // Call the origin server to validate credentials without storing locally
        // We'll create a custom validation endpoint call using the private makeRequest method
        const validationResponse = await (crossTenancyClient as any).makeRequest(
          originServerName,
          '/internal/tenants/bots/validate-credentials',
          {
            serverName: currentServerName,
            action: 'validateCredentials',
            data: { phoneNumber, credentials },
            timestamp: Date.now(),
            nonce: crypto.randomBytes(16).toString('hex')
          }
        );

        if (validationResponse.success && validationResponse.data) {
          return {
            valid: true,
            ownerJid: validationResponse.data.ownerJid || (phoneNumber + "@s.whatsapp.net"),
            originServerName: originServerName,
            remoteBotId: validationResponse.data.botId || `remote_${phoneNumber}`,
            features: validationResponse.data.features || {
              autoLike: false,
              autoReact: false,
              autoViewStatus: false,
              chatgptEnabled: false,
              typingMode: "recording",
              presenceMode: "available",
              alwaysOnline: false,
              presenceAutoSwitch: false
            }
          };
        } else {
          return {
            valid: false,
            error: validationResponse.error || "Remote server validation failed"
          };
        }
      }
    } catch (error) {
      console.error('External bot credential validation error:', error);
      return { 
        valid: false, 
        error: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  async cleanupExpiredExternalConnections(): Promise<number> {
    const result = await db
      .delete(externalBotConnections)
      .where(sql`${externalBotConnections.expiresAt} <= CURRENT_TIMESTAMP`)
      .returning();
    
    console.log(`🧹 Cleaned up ${result.length} expired external bot connections`);
    return result.length;
  }

  // Master Control methods for cross-server management
  async getAllBotsAcrossServers(): Promise<BotInstance[]> {
    return await db.select().from(botInstances).orderBy(desc(botInstances.createdAt));
  }

  async approveBotCrossServer(id: string, targetServerName: string, expirationMonths?: number): Promise<BotInstance> {
    const now = new Date();
    
    const [botInstance] = await db
      .update(botInstances)
      .set({
        approvalStatus: 'approved',
        approvalDate: now.toISOString(),
        expirationMonths: expirationMonths || null,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(and(eq(botInstances.id, id), eq(botInstances.serverName, targetServerName)))
      .returning();

    if (!botInstance) {
      throw new Error(`Bot ${id} not found on server ${targetServerName}`);
    }

    await this.createCrossTenancyActivity({
      type: 'approval',
      description: `Bot approved by master control${expirationMonths ? ` for ${expirationMonths} months` : ' with unlimited access'}`,
      metadata: { approvalDate: now.toISOString(), expirationMonths, approvedBy: 'master_control' },
      serverName: targetServerName,
      botInstanceId: id
    });

    return botInstance;
  }

  async revokeBotApproval(id: string, targetServerName: string): Promise<BotInstance> {
    const [botInstance] = await db
      .update(botInstances)
      .set({
        approvalStatus: 'pending',
        status: 'offline',
        approvalDate: null,
        expirationMonths: null,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .where(and(eq(botInstances.id, id), eq(botInstances.serverName, targetServerName)))
      .returning();

    if (!botInstance) {
      throw new Error(`Bot ${id} not found on server ${targetServerName}`);
    }

    await this.createCrossTenancyActivity({
      type: 'revocation',
      description: `Bot approval revoked by master control`,
      metadata: { revokedAt: new Date().toISOString(), revokedBy: 'master_control' },
      serverName: targetServerName,
      botInstanceId: id
    });

    return botInstance;
  }

  async deleteBotCrossServer(id: string, targetServerName: string): Promise<void> {
    const botInstance = await db
      .select()
      .from(botInstances)
      .where(and(eq(botInstances.id, id), eq(botInstances.serverName, targetServerName)))
      .limit(1);

    if (botInstance.length === 0) {
      throw new Error(`Bot ${id} not found on server ${targetServerName}`);
    }

    const bot = botInstance[0];

    if (bot.phoneNumber) {
      await this.deleteGlobalRegistration(bot.phoneNumber);
    }

    await db.delete(botInstances).where(and(eq(botInstances.id, id), eq(botInstances.serverName, targetServerName)));

    await this.updateBotCountAfterChange(targetServerName);

    await this.createCrossTenancyActivity({
      type: 'deletion',
      description: `Bot ${bot.name} deleted by master control`,
      metadata: { deletedAt: new Date().toISOString(), deletedBy: 'master_control', botName: bot.name },
      serverName: targetServerName,
      phoneNumber: bot.phoneNumber || undefined
    });

    console.log(`📊 Updated bot count for ${targetServerName} after deleting bot ${bot.name || id}`);
  }

  async deleteServer(serverName: string): Promise<void> {
    const serverBots = await this.getBotInstancesForServer(serverName);
    
    if (serverBots.length > 0) {
      throw new Error(`Cannot delete server ${serverName}: ${serverBots.length} bots still exist on this server`);
    }

    await db.delete(serverRegistry).where(eq(serverRegistry.serverName, serverName));
    
    console.log(`🗑️ Deleted server ${serverName} from registry`);
  }
}

export const storage = new DatabaseStorage();