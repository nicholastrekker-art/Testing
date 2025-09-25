import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Global registration table - stores registrations across all tenants
export const godRegister = pgTable("god_register", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: text("phone_number").notNull().unique(),
  tenancyName: text("tenancy_name").notNull(), // SERVER1, SERVER2, etc
  registeredAt: timestamp("registered_at").default(sql`CURRENT_TIMESTAMP`),
});

// Server registry table for multi-tenancy management
export const serverRegistry = pgTable("server_registry", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  serverName: text("server_name").notNull().unique(), // SERVER1, SERVER2, SERVER3, etc
  maxBotCount: integer("max_bot_count").notNull(), // Maximum bots allowed on this server
  currentBotCount: integer("current_bot_count").default(0), // Current number of bots
  serverStatus: text("server_status").default("active"), // active, inactive, maintenance
  serverUrl: text("server_url"), // URL to access this server
  baseUrl: text("base_url"), // Base URL for API communication between servers
  sharedSecret: text("shared_secret"), // Secret for JWT authentication between servers
  description: text("description"), // Optional description of this server
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("user"), // user, admin
  serverName: text("server_name").notNull(), // isolate by server instance
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const botInstances = pgTable("bot_instances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  phoneNumber: text("phone_number"),
  status: text("status").notNull().default("offline"), // online, offline, error, loading
  credentials: jsonb("credentials"), // encrypted creds.json data
  settings: jsonb("settings").default({}), // bot configuration
  autoLike: boolean("auto_like").default(true),
  autoViewStatus: boolean("auto_view_status").default(true),
  autoReact: boolean("auto_react").default(true),
  typingMode: text("typing_mode").default("recording"), // none, typing, recording, both
  presenceMode: text("presence_mode").default("available"), // available, unavailable, composing, recording
  alwaysOnline: boolean("always_online").default(false),
  presenceAutoSwitch: boolean("presence_auto_switch").default(false), // switches between typing/recording every 30s
  chatgptEnabled: boolean("chatgpt_enabled").default(false),
  lastActivity: timestamp("last_activity"),
  messagesCount: integer("messages_count").default(0),
  commandsCount: integer("commands_count").default(0),
  approvalStatus: text("approval_status").default("pending"), // pending, approved, rejected
  isGuest: boolean("is_guest").default(false),
  approvalDate: text("approval_date"), // Date when bot was approved
  expirationMonths: integer("expiration_months"), // Duration in months
  autoStart: boolean("auto_start").default(true), // whether bot should auto-start on server restart
  credentialVerified: boolean("credential_verified").default(false), // whether credentials are verified
  credentialPhone: text("credential_phone"), // phone number extracted from verified credentials
  invalidReason: text("invalid_reason"), // reason why bot is considered invalid
  authMessageSentAt: timestamp("auth_message_sent_at"), // timestamp when auth message was sent
  serverName: text("server_name").notNull(), // isolate by server instance
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const commands = pgTable("commands", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(), // command name without prefix
  description: text("description").notNull(),
  response: text("response"), // static response or template
  isActive: boolean("is_active").default(true),
  useChatGPT: boolean("use_chatgpt").default(false),
  botInstanceId: varchar("bot_instance_id"), // null for global commands
  serverName: text("server_name").notNull(), // isolate by server instance
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const activities = pgTable("activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  botInstanceId: varchar("bot_instance_id"), // nullable for local bot activities
  type: text("type").notNull(), // command, message, auto_like, auto_react, error, etc.
  description: text("description").notNull(),
  metadata: jsonb("metadata").default({}),
  serverName: text("server_name").notNull(), // isolate by server instance
  // Cross-tenancy fields for remote bot activities
  remoteTenancy: text("remote_tenancy"), // Tenancy/server name for cross-server activities
  remoteBotId: text("remote_bot_id"), // Bot ID on remote server
  phoneNumber: text("phone_number"), // Phone number for cross-tenancy identification
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const groups = pgTable("groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  whatsappId: text("whatsapp_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  participantCount: integer("participant_count").default(0),
  botInstanceId: varchar("bot_instance_id").notNull(),
  isActive: boolean("is_active").default(true),
  serverName: text("server_name").notNull(), // isolate by server instance
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Table to track viewed status IDs
export const viewedStatusIds = pgTable("viewed_status_ids", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  botInstanceId: varchar("bot_instance_id").notNull(),
  statusId: text("status_id").notNull(), // WhatsApp status ID
  statusSender: text("status_sender").notNull(), // Who posted the status
  viewedAt: timestamp("viewed_at").default(sql`CURRENT_TIMESTAMP`),
  expiresAt: timestamp("expires_at").notNull(), // When status expires (24h from posting)
  serverName: text("server_name").notNull(),
});

// External bot connections table - tracks temporary connections to external bots
export const externalBotConnections = pgTable("external_bot_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: text("phone_number").notNull(), // Bot's phone number
  ownerJid: text("owner_jid").notNull(), // WhatsApp JID of the bot owner
  originServerName: text("origin_server_name").notNull(), // Server where bot is actually hosted
  remoteBotId: text("remote_bot_id").notNull(), // Bot ID on the origin server
  sessionData: jsonb("session_data"), // Temporary session data for connection
  credentialsValid: boolean("credentials_valid").default(false),
  lastValidation: timestamp("last_validation"),
  connectionEstablishedAt: timestamp("connection_established_at"),
  notificationSentAt: timestamp("notification_sent_at"), // When WhatsApp notification was sent
  features: jsonb("features").default({}), // Available features from origin server
  tempToken: text("temp_token"), // Temporary authentication token for the session
  expiresAt: timestamp("expires_at").notNull().default(sql`CURRENT_TIMESTAMP + INTERVAL '24 hours'`), // Connection expires after 24 hours
  currentServerName: text("current_server_name").notNull(), // Server handling the connection
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// Relations
export const botInstancesRelations = relations(botInstances, ({ many }) => ({
  commands: many(commands),
  activities: many(activities),
  groups: many(groups),
  viewedStatusIds: many(viewedStatusIds),
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

export const viewedStatusIdsRelations = relations(viewedStatusIds, ({ one }) => ({
  botInstance: one(botInstances, {
    fields: [viewedStatusIds.botInstanceId],
    references: [botInstances.id],
  }),
}));

export const externalBotConnectionsRelations = relations(externalBotConnections, ({ one }) => ({
  originServer: one(serverRegistry, {
    fields: [externalBotConnections.originServerName],
    references: [serverRegistry.serverName],
  }),
  currentServer: one(serverRegistry, {
    fields: [externalBotConnections.currentServerName],
    references: [serverRegistry.serverName],
  }),
}));

// Schemas
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

export const insertViewedStatusIdSchema = createInsertSchema(viewedStatusIds).omit({
  id: true,
  viewedAt: true,
});

export const insertExternalBotConnectionSchema = createInsertSchema(externalBotConnections).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type BotInstance = typeof botInstances.$inferSelect;
export type InsertBotInstance = z.infer<typeof insertBotInstanceSchema>;

export type Command = typeof commands.$inferSelect;
export type InsertCommand = z.infer<typeof insertCommandSchema>;

export type Activity = typeof activities.$inferSelect;
export type InsertActivity = z.infer<typeof insertActivitySchema>;

export type Group = typeof groups.$inferSelect;
export type InsertGroup = z.infer<typeof insertGroupSchema>;

export type GodRegister = typeof godRegister.$inferSelect;
export type InsertGodRegister = z.infer<typeof insertGodRegisterSchema>;

export type ServerRegistry = typeof serverRegistry.$inferSelect;
export type InsertServerRegistry = z.infer<typeof insertServerRegistrySchema>;

export type ViewedStatusId = typeof viewedStatusIds.$inferSelect;
export type InsertViewedStatusId = z.infer<typeof insertViewedStatusIdSchema>;

export type ExternalBotConnection = typeof externalBotConnections.$inferSelect;
export type InsertExternalBotConnection = z.infer<typeof insertExternalBotConnectionSchema>;
