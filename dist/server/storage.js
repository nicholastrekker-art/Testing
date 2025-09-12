import { users, botInstances, commands, activities, groups, godRegister, serverRegistry } from "../shared/schema.js";
import { db, getServerName } from "./db.js";
import { eq, desc, and, sql } from "drizzle-orm";
function getMaxBotCount() {
    const botCount = process.env.BOTCOUNT || '20';
    const parsed = parseInt(botCount, 10);
    if (isNaN(parsed) || parsed <= 0) {
        console.warn(`Invalid BOTCOUNT value "${botCount}", using default value 20`);
        return 20;
    }
    return parsed;
}
export class DatabaseStorage {
    async getUser(id) {
        const [user] = await db.select().from(users).where(eq(users.id, id));
        return user || undefined;
    }
    async getUserByUsername(username) {
        const serverName = getServerName();
        const [user] = await db.select().from(users).where(and(eq(users.username, username), eq(users.serverName, serverName)));
        return user || undefined;
    }
    async createUser(insertUser) {
        const serverName = getServerName();
        const [user] = await db
            .insert(users)
            .values({ ...insertUser, serverName })
            .returning();
        return user;
    }
    async getBotInstance(id) {
        const serverName = getServerName();
        const [botInstance] = await db.select().from(botInstances).where(and(eq(botInstances.id, id), eq(botInstances.serverName, serverName)));
        return botInstance || undefined;
    }
    async getAllBotInstances() {
        const serverName = getServerName();
        return await db.select().from(botInstances).where(eq(botInstances.serverName, serverName)).orderBy(desc(botInstances.createdAt));
    }
    async getBotInstancesForServer(serverName) {
        return await db.select().from(botInstances).where(eq(botInstances.serverName, serverName)).orderBy(desc(botInstances.createdAt));
    }
    async getBotInstancesByApprovalStatus(approvalStatus) {
        const serverName = getServerName();
        return await db.select().from(botInstances).where(and(eq(botInstances.serverName, serverName), eq(botInstances.approvalStatus, approvalStatus))).orderBy(desc(botInstances.createdAt));
    }
    async createBotInstance(insertBotInstance) {
        const serverName = getServerName();
        const [botInstance] = await db
            .insert(botInstances)
            .values({ ...insertBotInstance, serverName })
            .returning();
        await this.updateBotCountAfterChange(serverName);
        console.log(`📊 Updated bot count for ${serverName} after creating bot ${botInstance.name}`);
        return botInstance;
    }
    async updateBotInstance(id, updates) {
        const [botInstance] = await db
            .update(botInstances)
            .set({ ...updates, updatedAt: sql `CURRENT_TIMESTAMP` })
            .where(eq(botInstances.id, id))
            .returning();
        return botInstance;
    }
    async deleteBotInstance(id) {
        const serverName = getServerName();
        const botInstance = await this.getBotInstance(id);
        await db.delete(botInstances).where(and(eq(botInstances.id, id), eq(botInstances.serverName, serverName)));
        await this.updateBotCountAfterChange(serverName);
        console.log(`📊 Updated bot count for ${serverName} after deleting bot ${botInstance?.name || id}`);
    }
    async deleteBotRelatedData(botId) {
        const serverName = getServerName();
        await db.delete(commands).where(and(eq(commands.botInstanceId, botId), eq(commands.serverName, serverName)));
        await db.delete(activities).where(and(eq(activities.botInstanceId, botId), eq(activities.serverName, serverName)));
        await db.delete(groups).where(and(eq(groups.botInstanceId, botId), eq(groups.serverName, serverName)));
        console.log(`🧹 Cleaned up related data for bot ${botId}`);
    }
    async checkBotCountLimit() {
        const serverName = getServerName();
        const maxBots = getMaxBotCount();
        const currentBots = await db.select().from(botInstances).where(eq(botInstances.serverName, serverName));
        return currentBots.length < maxBots;
    }
    async getOldestPendingBot() {
        const serverName = getServerName();
        const [bot] = await db
            .select()
            .from(botInstances)
            .where(and(eq(botInstances.serverName, serverName), eq(botInstances.approvalStatus, 'pending')))
            .orderBy(botInstances.createdAt)
            .limit(1);
        return bot;
    }
    async getBotByPhoneNumber(phoneNumber) {
        const serverName = getServerName();
        const [botInstance] = await db.select().from(botInstances).where(and(eq(botInstances.phoneNumber, phoneNumber), eq(botInstances.serverName, serverName)));
        return botInstance || undefined;
    }
    async getPendingBots() {
        const serverName = getServerName();
        return await db.select().from(botInstances).where(and(eq(botInstances.approvalStatus, 'pending'), eq(botInstances.serverName, serverName))).orderBy(desc(botInstances.createdAt));
    }
    async getApprovedBots() {
        const serverName = getServerName();
        return await db.select().from(botInstances).where(and(eq(botInstances.approvalStatus, 'approved'), eq(botInstances.serverName, serverName))).orderBy(desc(botInstances.createdAt));
    }
    async getAllApprovedBots() {
        return await db.select().from(botInstances)
            .where(eq(botInstances.approvalStatus, 'approved'))
            .orderBy(desc(botInstances.createdAt));
    }
    async checkAndExpireBots() {
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
    async approveBotInstance(id, expirationMonths) {
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
        }
        catch (error) {
            console.error('Error approving bot:', error);
            return false;
        }
    }
    async rejectBotInstance(id) {
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
        }
        catch (error) {
            console.error('Error rejecting bot:', error);
            return false;
        }
    }
    async getCommands(botInstanceId) {
        const serverName = getServerName();
        if (botInstanceId) {
            return await db.select().from(commands).where(and(eq(commands.botInstanceId, botInstanceId), eq(commands.isActive, true), eq(commands.serverName, serverName)));
        }
        return await db.select().from(commands).where(and(eq(commands.isActive, true), eq(commands.serverName, serverName)));
    }
    async getCommand(id) {
        const serverName = getServerName();
        const [command] = await db.select().from(commands).where(and(eq(commands.id, id), eq(commands.serverName, serverName)));
        return command || undefined;
    }
    async createCommand(insertCommand) {
        const serverName = getServerName();
        const [command] = await db
            .insert(commands)
            .values({ ...insertCommand, serverName })
            .returning();
        return command;
    }
    async updateCommand(id, updates) {
        const serverName = getServerName();
        const [command] = await db
            .update(commands)
            .set(updates)
            .where(and(eq(commands.id, id), eq(commands.serverName, serverName)))
            .returning();
        return command;
    }
    async deleteCommand(id) {
        const serverName = getServerName();
        await db.delete(commands).where(and(eq(commands.id, id), eq(commands.serverName, serverName)));
    }
    async getActivities(botInstanceId, limit = 50) {
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
    async createActivity(insertActivity) {
        const serverName = getServerName();
        const [activity] = await db
            .insert(activities)
            .values({ ...insertActivity, serverName })
            .returning();
        return activity;
    }
    async createCrossTenancyActivity(params) {
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
    async getGroups(botInstanceId) {
        const serverName = getServerName();
        return await db.select().from(groups).where(and(eq(groups.botInstanceId, botInstanceId), eq(groups.isActive, true), eq(groups.serverName, serverName)));
    }
    async createGroup(insertGroup) {
        const serverName = getServerName();
        const [group] = await db
            .insert(groups)
            .values({ ...insertGroup, serverName })
            .returning();
        return group;
    }
    async updateGroup(id, updates) {
        const serverName = getServerName();
        const [group] = await db
            .update(groups)
            .set(updates)
            .where(and(eq(groups.id, id), eq(groups.serverName, serverName)))
            .returning();
        return group;
    }
    async deleteGroup(id) {
        const serverName = getServerName();
        await db.delete(groups).where(and(eq(groups.id, id), eq(groups.serverName, serverName)));
    }
    async getDashboardStats() {
        const serverName = getServerName();
        const [totalBotsResult] = await db.select({ count: sql `count(*)` }).from(botInstances).where(eq(botInstances.serverName, serverName));
        const [activeBotsResult] = await db.select({ count: sql `count(*)` }).from(botInstances).where(and(eq(botInstances.status, "online"), eq(botInstances.serverName, serverName)));
        const [messagesResult] = await db.select({ sum: sql `sum(${botInstances.messagesCount})` }).from(botInstances).where(eq(botInstances.serverName, serverName));
        const [commandsResult] = await db.select({ sum: sql `sum(${botInstances.commandsCount})` }).from(botInstances).where(eq(botInstances.serverName, serverName));
        return {
            totalBots: totalBotsResult.count || 0,
            activeBots: activeBotsResult.count || 0,
            messagesCount: messagesResult.sum || 0,
            commandsCount: commandsResult.sum || 0,
        };
    }
    async getAllActivities(limit = 100) {
        const serverName = getServerName();
        return await db.select().from(activities)
            .where(eq(activities.serverName, serverName))
            .orderBy(desc(activities.createdAt))
            .limit(limit);
    }
    async getSystemStats() {
        const serverName = getServerName();
        const [totalBotsResult] = await db.select({ count: sql `count(*)` }).from(botInstances).where(eq(botInstances.serverName, serverName));
        const [onlineBotsResult] = await db.select({ count: sql `count(*)` }).from(botInstances).where(and(eq(botInstances.status, "online"), eq(botInstances.serverName, serverName)));
        const [offlineBotsResult] = await db.select({ count: sql `count(*)` }).from(botInstances).where(and(eq(botInstances.status, "offline"), eq(botInstances.serverName, serverName)));
        const [messagesResult] = await db.select({ sum: sql `sum(${botInstances.messagesCount})` }).from(botInstances).where(eq(botInstances.serverName, serverName));
        const [commandsResult] = await db.select({ sum: sql `sum(${botInstances.commandsCount})` }).from(botInstances).where(eq(botInstances.serverName, serverName));
        const [activitiesResult] = await db.select({ count: sql `count(*)` }).from(activities).where(eq(activities.serverName, serverName));
        return {
            totalBots: totalBotsResult.count || 0,
            onlineBots: onlineBotsResult.count || 0,
            offlineBots: offlineBotsResult.count || 0,
            totalMessages: messagesResult.sum || 0,
            totalCommands: commandsResult.sum || 0,
            recentActivities: activitiesResult.count || 0,
        };
    }
    async checkGlobalRegistration(phoneNumber) {
        const [registration] = await db.select().from(godRegister).where(eq(godRegister.phoneNumber, phoneNumber));
        return registration || undefined;
    }
    async addGlobalRegistration(phoneNumber, tenancyName) {
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
    async deleteGlobalRegistration(phoneNumber) {
        await db.delete(godRegister).where(eq(godRegister.phoneNumber, phoneNumber));
    }
    async getAllGlobalRegistrations() {
        return await db.select().from(godRegister).orderBy(desc(godRegister.registeredAt));
    }
    async updateGlobalRegistration(phoneNumber, tenancyName) {
        const [registration] = await db
            .update(godRegister)
            .set({ tenancyName })
            .where(eq(godRegister.phoneNumber, phoneNumber))
            .returning();
        return registration || undefined;
    }
    async getAllServers() {
        return await db.select().from(serverRegistry).orderBy(serverRegistry.serverName);
    }
    async getServerByName(serverName) {
        const [server] = await db.select().from(serverRegistry).where(eq(serverRegistry.serverName, serverName));
        return server || undefined;
    }
    async createServer(server) {
        const [newServer] = await db
            .insert(serverRegistry)
            .values(server)
            .returning();
        return newServer;
    }
    async updateServerBotCount(serverName, currentBotCount) {
        const [server] = await db
            .update(serverRegistry)
            .set({
            currentBotCount,
            updatedAt: sql `CURRENT_TIMESTAMP`
        })
            .where(eq(serverRegistry.serverName, serverName))
            .returning();
        return server;
    }
    async updateServerInfo(currentServerName, updates) {
        const [server] = await db
            .update(serverRegistry)
            .set({
            serverName: updates.serverName,
            description: updates.description,
            updatedAt: sql `CURRENT_TIMESTAMP`
        })
            .where(eq(serverRegistry.serverName, currentServerName))
            .returning();
        return server;
    }
    async getAvailableServers() {
        return await db
            .select()
            .from(serverRegistry)
            .where(and(eq(serverRegistry.serverStatus, 'active'), sql `${serverRegistry.currentBotCount} < ${serverRegistry.maxBotCount}`))
            .orderBy(serverRegistry.serverName);
    }
    async initializeCurrentServer() {
        const currentServerName = getServerName();
        const maxBots = getMaxBotCount();
        const existingServer = await this.getServerByName(currentServerName);
        if (!existingServer) {
            await this.createServer({
                serverName: currentServerName,
                maxBotCount: maxBots,
                currentBotCount: 0,
                serverStatus: 'active',
                description: `Auto-created server ${currentServerName}`
            });
            console.log(`✅ Created server registry entry for ${currentServerName}`);
        }
        else if (existingServer.maxBotCount !== maxBots) {
            await db
                .update(serverRegistry)
                .set({
                maxBotCount: maxBots,
                updatedAt: sql `CURRENT_TIMESTAMP`
            })
                .where(eq(serverRegistry.serverName, currentServerName));
            console.log(`✅ Updated max bot count for ${currentServerName} to ${maxBots}`);
        }
        const actualBotCount = await db.select().from(botInstances).where(eq(botInstances.serverName, currentServerName));
        await this.updateServerBotCount(currentServerName, actualBotCount.length);
    }
    async updateBotCountAfterChange(serverName) {
        const targetServer = serverName || getServerName();
        const actualBots = await db.select().from(botInstances).where(eq(botInstances.serverName, targetServer));
        const currentCount = actualBots.length;
        await this.updateServerBotCount(targetServer, currentCount);
    }
    async strictCheckBotCountLimit(serverName) {
        const targetServer = serverName || getServerName();
        const actualBots = await db.select().from(botInstances).where(eq(botInstances.serverName, targetServer));
        const currentCount = actualBots.length;
        let maxCount = getMaxBotCount();
        const serverInfo = await this.getServerByName(targetServer);
        if (serverInfo) {
            maxCount = serverInfo.maxBotCount;
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
