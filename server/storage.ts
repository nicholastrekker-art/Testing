import { 
  users, 
  botInstances, 
  commands, 
  activities, 
  groups,
  type User, 
  type InsertUser,
  type BotInstance,
  type InsertBotInstance,
  type Command,
  type InsertCommand,
  type Activity,
  type InsertActivity,
  type Group,
  type InsertGroup
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql } from "drizzle-orm";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Bot Instance methods
  getBotInstance(id: string): Promise<BotInstance | undefined>;
  getAllBotInstances(): Promise<BotInstance[]>;
  createBotInstance(botInstance: InsertBotInstance): Promise<BotInstance>;
  updateBotInstance(id: string, updates: Partial<BotInstance>): Promise<BotInstance>;
  deleteBotInstance(id: string): Promise<void>;
  
  // Command methods
  getCommands(botInstanceId?: string): Promise<Command[]>;
  getCommand(id: string): Promise<Command | undefined>;
  createCommand(command: InsertCommand): Promise<Command>;
  updateCommand(id: string, updates: Partial<Command>): Promise<Command>;
  deleteCommand(id: string): Promise<void>;
  
  // Activity methods
  getActivities(botInstanceId?: string, limit?: number): Promise<Activity[]>;
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
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }
  
  // Bot Instance methods
  async getBotInstance(id: string): Promise<BotInstance | undefined> {
    const [botInstance] = await db.select().from(botInstances).where(eq(botInstances.id, id));
    return botInstance || undefined;
  }

  async getAllBotInstances(): Promise<BotInstance[]> {
    return await db.select().from(botInstances).orderBy(desc(botInstances.createdAt));
  }

  async createBotInstance(insertBotInstance: InsertBotInstance): Promise<BotInstance> {
    const [botInstance] = await db
      .insert(botInstances)
      .values(insertBotInstance)
      .returning();
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
    await db.delete(botInstances).where(eq(botInstances.id, id));
  }
  
  // Command methods
  async getCommands(botInstanceId?: string): Promise<Command[]> {
    if (botInstanceId) {
      return await db.select().from(commands).where(
        and(
          eq(commands.botInstanceId, botInstanceId),
          eq(commands.isActive, true)
        )
      );
    }
    return await db.select().from(commands).where(eq(commands.isActive, true));
  }

  async getCommand(id: string): Promise<Command | undefined> {
    const [command] = await db.select().from(commands).where(eq(commands.id, id));
    return command || undefined;
  }

  async createCommand(insertCommand: InsertCommand): Promise<Command> {
    const [command] = await db
      .insert(commands)
      .values(insertCommand)
      .returning();
    return command;
  }

  async updateCommand(id: string, updates: Partial<Command>): Promise<Command> {
    const [command] = await db
      .update(commands)
      .set(updates)
      .where(eq(commands.id, id))
      .returning();
    return command;
  }

  async deleteCommand(id: string): Promise<void> {
    await db.delete(commands).where(eq(commands.id, id));
  }
  
  // Activity methods
  async getActivities(botInstanceId?: string, limit = 50): Promise<Activity[]> {
    if (botInstanceId) {
      return await db.select().from(activities)
        .where(eq(activities.botInstanceId, botInstanceId))
        .orderBy(desc(activities.createdAt))
        .limit(limit);
    }
    
    return await db.select().from(activities)
      .orderBy(desc(activities.createdAt))
      .limit(limit);
  }

  async createActivity(insertActivity: InsertActivity): Promise<Activity> {
    const [activity] = await db
      .insert(activities)
      .values(insertActivity)
      .returning();
    return activity;
  }
  
  // Group methods
  async getGroups(botInstanceId: string): Promise<Group[]> {
    return await db.select().from(groups).where(
      and(
        eq(groups.botInstanceId, botInstanceId),
        eq(groups.isActive, true)
      )
    );
  }

  async createGroup(insertGroup: InsertGroup): Promise<Group> {
    const [group] = await db
      .insert(groups)
      .values(insertGroup)
      .returning();
    return group;
  }

  async updateGroup(id: string, updates: Partial<Group>): Promise<Group> {
    const [group] = await db
      .update(groups)
      .set(updates)
      .where(eq(groups.id, id))
      .returning();
    return group;
  }

  async deleteGroup(id: string): Promise<void> {
    await db.delete(groups).where(eq(groups.id, id));
  }
  
  // Statistics
  async getDashboardStats(): Promise<{
    totalBots: number;
    activeBots: number;
    messagesCount: number;
    commandsCount: number;
  }> {
    const [totalBotsResult] = await db.select({ count: sql<number>`count(*)` }).from(botInstances);
    const [activeBotsResult] = await db.select({ count: sql<number>`count(*)` }).from(botInstances).where(eq(botInstances.status, "online"));
    const [messagesResult] = await db.select({ sum: sql<number>`sum(${botInstances.messagesCount})` }).from(botInstances);
    const [commandsResult] = await db.select({ sum: sql<number>`sum(${botInstances.commandsCount})` }).from(botInstances);
    
    return {
      totalBots: totalBotsResult.count || 0,
      activeBots: activeBotsResult.count || 0,
      messagesCount: messagesResult.sum || 0,
      commandsCount: commandsResult.sum || 0,
    };
  }
}

export const storage = new DatabaseStorage();
