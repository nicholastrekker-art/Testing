import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("user"), // user, admin
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const botInstances = pgTable("bot_instances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  phoneNumber: text("phone_number"),
  status: text("status").notNull().default("offline"), // online, offline, error, loading
  credentials: jsonb("credentials"), // encrypted creds.json data
  settings: jsonb("settings").default({}), // bot configuration
  autoLike: boolean("auto_like").default(false),
  autoViewStatus: boolean("auto_view_status").default(false),
  autoReact: boolean("auto_react").default(false),
  typingMode: text("typing_mode").default("none"), // none, typing, recording, both
  chatgptEnabled: boolean("chatgpt_enabled").default(false),
  lastActivity: timestamp("last_activity"),
  messagesCount: integer("messages_count").default(0),
  commandsCount: integer("commands_count").default(0),
  approvalStatus: text("approval_status").default("pending"), // pending, approved, rejected
  isGuest: boolean("is_guest").default(false),
  approvalDate: text("approval_date"), // Date when bot was approved
  expirationMonths: integer("expiration_months"), // Duration in months
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
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const activities = pgTable("activities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  botInstanceId: varchar("bot_instance_id").notNull(),
  type: text("type").notNull(), // command, message, auto_like, auto_react, error, etc.
  description: text("description").notNull(),
  metadata: jsonb("metadata").default({}),
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
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Relations
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
