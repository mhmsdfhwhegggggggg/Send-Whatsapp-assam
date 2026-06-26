import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  uuid,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignStatusEnum = pgEnum("campaign_status", [
  "pending",
  "running",
  "paused",
  "completed",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "pending",
  "sent",
  "failed",
]);

export const accountStatusEnum = pgEnum("account_status", [
  "initializing",
  "qr",
  "connected",
  "disconnected",
  "logged_out",
]);

export const groupsTable = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const studentsTable = pgTable("students", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  university: text("university"),
  serviceType: text("service_type"),
  discount: text("discount"),
  groupId: uuid("group_id").references(() => groupsTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const templatesTable = pgTable("templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const accountsTable = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  phoneNumber: text("phone_number"),
  status: accountStatusEnum("status").default("initializing").notNull(),
  sentToday: integer("sent_today").default(0).notNull(),
  lastResetDate: text("last_reset_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const campaignsTable = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  templateId: uuid("template_id")
    .references(() => templatesTable.id)
    .notNull(),
  groupIds: text("group_ids").notNull(),
  accountIds: text("account_ids").notNull(),
  status: campaignStatusEnum("status").default("pending").notNull(),
  minDelaySec: integer("min_delay_sec").default(5).notNull(),
  maxDelaySec: integer("max_delay_sec").default(25).notNull(),
  batchSize: integer("batch_size").default(50).notNull(),
  batchPauseMin: integer("batch_pause_min").default(5).notNull(),
  totalMessages: integer("total_messages").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messagesTable = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .references(() => campaignsTable.id, { onDelete: "cascade" })
    .notNull(),
  studentId: uuid("student_id"),
  studentName: text("student_name").notNull(),
  phone: text("phone").notNull(),
  body: text("body").notNull(),
  status: messageStatusEnum("status").default("pending").notNull(),
  retryCount: integer("retry_count").default(0).notNull(),
  accountId: uuid("account_id"),
  sentAt: timestamp("sent_at"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const settingsTable = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  dailyLimitPerAccount: integer("daily_limit_per_account").default(500).notNull(),
  workingHoursStart: integer("working_hours_start").default(9).notNull(),
  workingHoursEnd: integer("working_hours_end").default(21).notNull(),
  spintaxEnabled: boolean("spintax_enabled").default(true).notNull(),
  invisibleCharsEnabled: boolean("invisible_chars_enabled").default(true).notNull(),
  maxRetries: integer("max_retries").default(3).notNull(),
  retryDelayMin: integer("retry_delay_min").default(2).notNull(),
});

export const insertGroupSchema = createInsertSchema(groupsTable).omit({
  id: true,
  createdAt: true,
});
export const insertStudentSchema = createInsertSchema(studentsTable).omit({
  id: true,
  createdAt: true,
});
export const insertTemplateSchema = createInsertSchema(templatesTable).omit({
  id: true,
  createdAt: true,
});
export const insertAccountSchema = createInsertSchema(accountsTable).omit({
  id: true,
  createdAt: true,
  sentToday: true,
  lastResetDate: true,
  status: true,
  phoneNumber: true,
});
export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({
  id: true,
  createdAt: true,
  status: true,
  totalMessages: true,
});

export type Group = typeof groupsTable.$inferSelect;
export type Student = typeof studentsTable.$inferSelect;
export type Template = typeof templatesTable.$inferSelect;
export type Account = typeof accountsTable.$inferSelect;
export type Campaign = typeof campaignsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type Settings = typeof settingsTable.$inferSelect;
