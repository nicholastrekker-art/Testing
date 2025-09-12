import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
export const godRegister = pgTable("god_register", {
    id: varchar("id").primaryKey().default(sql `gen_random_uuid()`),
    phoneNumber: text("phone_number").notNull().unique(),
    tenancyName: text("tenancy_name").notNull(),
    registeredAt: timestamp("registered_at").default(sql `CURRENT_TIMESTAMP`),
});
export const serverRegistry = pgTable("server_registry", {
    id: varchar("id").primaryKey().default(sql `gen_random_uuid()`),
    serverName: text("server_name").notNull().unique(),
    maxBotCount: integer("max_bot_count").notNull(),
    currentBotCount: integer("current_bot_count").default(0),
    serverStatus: text("server_status").default("active"),
    serverUrl: text("server_url"),
    description: text("description"),
    createdAt: timestamp("created_at").default(sql `CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at").default(sql `CURRENT_TIMESTAMP`),
});
export const users = pgTable("users", {
    id: varchar("id").primaryKey().default(sql `gen_random_uuid()`),
    username: text("username").notNull().unique(),
    password: text("password").notNull(),
    role: text("role").notNull().default("user"),
    serverName: text("server_name").notNull(),
    createdAt: timestamp("created_at").default(sql `CURRENT_TIMESTAMP`),
});
export const botInstances = pgTable("bot_instances", {
    id: varchar("id").primaryKey().default(sql `gen_random_uuid()`),
    name: text("name").notNull(),
    phoneNumber: text("phone_number"),
    status: text("status").notNull().default("offline"),
    credentials: jsonb("credentials"),
    settings: jsonb("settings").default({}),
    autoLike: boolean("auto_like").default(true),
    autoViewStatus: boolean("auto_view_status").default(true),
    autoReact: boolean("auto_react").default(true),
    typingMode: text("typing_mode").default("recording"),
    chatgptEnabled: boolean("chatgpt_enabled").default(false),
    lastActivity: timestamp("last_activity"),
    messagesCount: integer("messages_count").default(0),
    commandsCount: integer("commands_count").default(0),
    approvalStatus: text("approval_status").default("pending"),
    isGuest: boolean("is_guest").default(false),
    approvalDate: text("approval_date"),
    expirationMonths: integer("expiration_months"),
    serverName: text("server_name").notNull(),
    createdAt: timestamp("created_at").default(sql `CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at").default(sql `CURRENT_TIMESTAMP`),
});
export const commands = pgTable("commands", {
    id: varchar("id").primaryKey().default(sql `gen_random_uuid()`),
    name: text("name").notNull(),
    description: text("description").notNull(),
    response: text("response"),
    isActive: boolean("is_active").default(true),
    useChatGPT: boolean("use_chatgpt").default(false),
    botInstanceId: varchar("bot_instance_id"),
    serverName: text("server_name").notNull(),
    createdAt: timestamp("created_at").default(sql `CURRENT_TIMESTAMP`),
});
export const activities = pgTable("activities", {
    id: varchar("id").primaryKey().default(sql `gen_random_uuid()`),
    botInstanceId: varchar("bot_instance_id"),
    type: text("type").notNull(),
    description: text("description").notNull(),
    metadata: jsonb("metadata").default({}),
    serverName: text("server_name").notNull(),
    remoteTenancy: text("remote_tenancy"),
    remoteBotId: text("remote_bot_id"),
    phoneNumber: text("phone_number"),
    createdAt: timestamp("created_at").default(sql `CURRENT_TIMESTAMP`),
});
export const groups = pgTable("groups", {
    id: varchar("id").primaryKey().default(sql `gen_random_uuid()`),
    whatsappId: text("whatsapp_id").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    participantCount: integer("participant_count").default(0),
    botInstanceId: varchar("bot_instance_id").notNull(),
    isActive: boolean("is_active").default(true),
    serverName: text("server_name").notNull(),
    createdAt: timestamp("created_at").default(sql `CURRENT_TIMESTAMP`),
});
export const botInstancesRelations = relations(botInstances, ({ many }) => ({
    commands: many(commands),
    activities: many(activities),
    groups: many(groups),
}));
export const commandsRelations = relations(commands, ({ one }) => ({
    botInstance: one(botInstances, {
        fields: [commands.botInstanceId],
        references: [botInstances.id],
    }),
}));
export const activitiesRelations = relations(activities, ({ one }) => ({
    botInstance: one(botInstances, {
        fields: [activities.botInstanceId],
        references: [botInstances.id],
    }),
}));
export const groupsRelations = relations(groups, ({ one }) => ({
    botInstance: one(botInstances, {
        fields: [groups.botInstanceId],
        references: [botInstances.id],
    }),
}));
export const insertUserSchema = createInsertSchema(users).pick({
    username: true,
    password: true,
    role: true,
});
export const insertBotInstanceSchema = createInsertSchema(botInstances).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    lastActivity: true,
    messagesCount: true,
    commandsCount: true,
});
export const insertCommandSchema = createInsertSchema(commands).omit({
    id: true,
    createdAt: true,
});
export const insertActivitySchema = createInsertSchema(activities).omit({
    id: true,
    createdAt: true,
});
export const insertGroupSchema = createInsertSchema(groups).omit({
    id: true,
    createdAt: true,
});
export const insertGodRegisterSchema = createInsertSchema(godRegister).omit({
    id: true,
    registeredAt: true,
});
export const insertServerRegistrySchema = createInsertSchema(serverRegistry).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
