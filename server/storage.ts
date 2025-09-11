import { 
  users, 
  botInstances, 
  commands, 
  activities, 
  groups,
  godRegister,
  serverRegistry,
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
  type InsertServerRegistry
} from "@shared/schema";
import { db, getServerName } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";

// Get maximum bot count from environment variables with default fallback
function getMaxBotCount(): number {
  const botCount = process.env.BOTCOUNT || '20';
  const parsed = parseInt(botCount, 10);
  
  if (isNaN(parsed) || parsed <= 0) {
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
  
  // Server registry methods (multi-tenancy management)
  getAllServers(): Promise<ServerRegistry[]>;
  getServerByName(serverName: string): Promise<ServerRegistry | undefined>;
  createServer(server: InsertServerRegistry): Promise<ServerRegistry>;
  updateServerBotCount(serverName: string, currentBotCount: number): Promise<ServerRegistry>;
  updateServerInfo(currentServerName: string, updates: { serverName: string; description?: string | null }): Promise<ServerRegistry>;
  getAvailableServers(): Promise<ServerRegistry[]>;
  initializeCurrentServer(): Promise<void>;
  strictCheckBotCountLimit(serverName?: string): Promise<{ canAdd: boolean; currentCount: number; maxCount: number; }>;
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

  async updateBotInstance(id: string, updates: Partial<BotInstance>): Promise<BotInstance> {
    const [botInstance] = await db
      .update(botInstances)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(botInstances.id, id))
      .returning();
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
  async getActivities(botInstanceId?: string, limit = 50): Promise<Activity[]> {
    const serverName = getServerName();
    if (botInstanceId) {
      return await db.select().from(activities)
        .where(and(eq(activities.botInstanceId, botInstanceId), eq(activities.serverName, serverName)))
        .orderBy(desc(activities.createdAt))
        .limit(limit);
    }
    
    return await db.select().from(activities)
      .where(eq(activities.serverName, serverName))
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
    const actualBotCount = await db.select().from(botInstances).where(eq(botInstances.serverName, currentServerName));
    await this.updateServerBotCount(currentServerName, actualBotCount.length);
  }

  // Helper method to automatically update server bot count based on actual database count
  async updateBotCountAfterChange(serverName?: string): Promise<void> {
    const targetServer = serverName || getServerName();
    
    // Get actual bot count from database
    const actualBots = await db.select().from(botInstances).where(eq(botInstances.serverName, targetServer));
    const currentCount = actualBots.length;
    
    // Update the server registry with the current count
    await this.updateServerBotCount(targetServer, currentCount);
  }

  async strictCheckBotCountLimit(serverName?: string): Promise<{ canAdd: boolean; currentCount: number; maxCount: number; }> {
    const targetServer = serverName || getServerName();
    
    // Get actual bot count from database
    const actualBots = await db.select().from(botInstances).where(eq(botInstances.serverName, targetServer));
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
}

export const storage = new DatabaseStorage();
