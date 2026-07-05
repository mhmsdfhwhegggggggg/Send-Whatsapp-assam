import {
  pgTable, text, integer, boolean, timestamp, uuid, pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const campaignStatusEnum = pgEnum("campaign_status", ["pending","running","paused","completed"]);
export const messageStatusEnum  = pgEnum("message_status",  ["pending","sent","failed"]);
export const accountStatusEnum  = pgEnum("account_status",  ["initializing","qr","connected","disconnected","logged_out"]);
export const accountEventEnum   = pgEnum("account_event_type", [
  "connected","disconnected","qr_requested","logged_out","send_ok","send_fail","health_warning","suspended",
]);
export const proxyTypeEnum      = pgEnum("proxy_type", ["residential","mobile","datacenter"]);

// ── Groups ─────────────────────────────────────────────────────────────────
export const groupsTable = pgTable("groups", {
  id:          uuid("id").primaryKey().defaultRandom(),
  name:        text("name").notNull(),
  description: text("description"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ── Students ───────────────────────────────────────────────────────────────
export const studentsTable = pgTable("students", {
  id:          uuid("id").primaryKey().defaultRandom(),
  name:        text("name").notNull(),
  phone:       text("phone").notNull().unique(),
  university:  text("university"),
  serviceType: text("service_type"),
  discount:    text("discount"),
  city:        text("city"),
  groupId:     uuid("group_id").references(() => groupsTable.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ── Templates ──────────────────────────────────────────────────────────────
export const templatesTable = pgTable("templates", {
  id:          uuid("id").primaryKey().defaultRandom(),
  name:        text("name").notNull(),
  body:        text("body").notNull(),
  description: text("description"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ── Proxy pool ─────────────────────────────────────────────────────────────
// Each WhatsApp account MUST have its own proxy.
// Residential or mobile proxies only — datacenter IPs are blocked by WhatsApp.
// Format: http://user:pass@host:port
export const proxiesTable = pgTable("proxies", {
  id:          uuid("id").primaryKey().defaultRandom(),
  url:         text("url").notNull().unique(),       // http://user:pass@host:port
  type:        proxyTypeEnum("type").default("residential").notNull(),
  country:     text("country"),                      // ISO-3166 e.g. "SA", "EG"
  isHealthy:   boolean("is_healthy").default(true).notNull(),
  failCount:   integer("fail_count").default(0).notNull(),
  lastChecked: timestamp("last_checked"),
  assignedTo:  uuid("assigned_to"),                  // accountsTable.id (1-to-1)
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ── Accounts ───────────────────────────────────────────────────────────────
export const accountsTable = pgTable("accounts", {
  id:            uuid("id").primaryKey().defaultRandom(),
  label:         text("label").notNull(),
  phoneNumber:   text("phone_number"),
  // REQUIRED in production: each account must use its own residential proxy.
  // Sharing an IP across accounts is one of the top ban causes.
  // Format: http://user:pass@host:port
  proxy:         text("proxy"),
  status:        accountStatusEnum("status").default("initializing").notNull(),
  sentToday:     integer("sent_today").default(0).notNull(),
  lastResetDate: text("last_reset_date"),
  warmUpDay:     integer("warm_up_day").default(0).notNull(),
  totalReplies:  integer("total_replies").default(0).notNull(),
  totalSent:     integer("total_sent").default(0).notNull(),
  // Health score 0–100 — persisted so it survives server restarts
  healthScore:   integer("health_score").default(100).notNull(),
  // Suspension: account placed in cooldown after stress signals
  suspendedUntil: timestamp("suspended_until"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});

// ── Account events log ─────────────────────────────────────────────────────
// Persistent event stream used for early-warning detection.
// Replaces in-memory accountHealth map — survives server restarts.
export const accountEventsTable = pgTable("account_events", {
  id:        uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").references(() => accountsTable.id, { onDelete: "cascade" }).notNull(),
  eventType: accountEventEnum("event_type").notNull(),
  detail:    text("detail"),                         // optional JSON payload
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Campaigns ──────────────────────────────────────────────────────────────
export const campaignsTable = pgTable("campaigns", {
  id:            uuid("id").primaryKey().defaultRandom(),
  name:          text("name").notNull(),
  templateId:    uuid("template_id").references(() => templatesTable.id).notNull(),
  groupIds:      text("group_ids").notNull(),
  accountIds:    text("account_ids").notNull(),
  status:        campaignStatusEnum("status").default("pending").notNull(),
  minDelaySec:   integer("min_delay_sec").default(30).notNull(),
  maxDelaySec:   integer("max_delay_sec").default(90).notNull(),
  batchSize:     integer("batch_size").default(20).notNull(),
  batchPauseMin: integer("batch_pause_min").default(10).notNull(),
  totalMessages: integer("total_messages").default(0).notNull(),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});

// ── Messages ───────────────────────────────────────────────────────────────
export const messagesTable = pgTable("messages", {
  id:          uuid("id").primaryKey().defaultRandom(),
  campaignId:  uuid("campaign_id").references(() => campaignsTable.id, { onDelete: "cascade" }).notNull(),
  studentId:   uuid("student_id"),
  studentName: text("student_name").notNull(),
  phone:       text("phone").notNull(),
  body:        text("body").notNull(),
  status:      messageStatusEnum("status").default("pending").notNull(),
  retryCount:  integer("retry_count").default(0).notNull(),
  accountId:   uuid("account_id"),
  sentAt:      timestamp("sent_at"),
  error:       text("error"),
  // Whether the phone was verified on WhatsApp before sending
  phoneVerified: boolean("phone_verified").default(false),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});

// ── Settings ───────────────────────────────────────────────────────────────
export const settingsTable = pgTable("settings", {
  id:                    integer("id").primaryKey().default(1),
  // Tiered daily limits per account based on warm-up stage
  newAccountDailyLimit:  integer("new_account_daily_limit").default(20).notNull(),
  warmAccountDailyLimit: integer("warm_account_daily_limit").default(80).notNull(),
  hotAccountDailyLimit:  integer("hot_account_daily_limit").default(150).notNull(),
  // Thresholds to determine account tier
  warmUpDaysThreshold:   integer("warm_up_days_threshold").default(7).notNull(),
  hotDaysThreshold:      integer("hot_days_threshold").default(30).notNull(),
  hotReplyThreshold:     integer("hot_reply_threshold").default(20).notNull(),
  // Legacy single limit (kept for migration compat)
  dailyLimitPerAccount:  integer("daily_limit_per_account").default(80).notNull(),
  workingHoursStart:     integer("working_hours_start").default(9).notNull(),
  workingHoursEnd:       integer("working_hours_end").default(22).notNull(),
  spintaxEnabled:        boolean("spintax_enabled").default(true).notNull(),
  invisibleCharsEnabled: boolean("invisible_chars_enabled").default(true).notNull(),
  maxRetries:            integer("max_retries").default(3).notNull(),
  retryDelayMin:         integer("retry_delay_min").default(5).notNull(),
  // Emergency stop — pauses ALL campaigns immediately
  killSwitch:            boolean("kill_switch").default(false).notNull(),
  dedupWindowDays:       integer("dedup_window_days").default(7).notNull(),
  // Phone validation: verify each number is on WhatsApp before sending
  phoneValidationEnabled: boolean("phone_validation_enabled").default(true).notNull(),
  // Early warning: health score below this triggers cooldown
  healthScoreThreshold:  integer("health_score_threshold").default(40).notNull(),
  // Cooldown duration in hours when account health is critical
  cooldownHours:         integer("cooldown_hours").default(24).notNull(),
});

// ── Opt-out list ───────────────────────────────────────────────────────────
export const optOutTable = pgTable("opt_out", {
  id:         uuid("id").primaryKey().defaultRandom(),
  phone:      text("phone").notNull().unique(),
  keyword:    text("keyword"),
  addedAt:    timestamp("added_at").defaultNow().notNull(),
  campaignId: uuid("campaign_id"),
  accountId:  uuid("account_id"),
});

// ── Inbound messages log ───────────────────────────────────────────────────
export const inboundMessagesTable = pgTable("inbound_messages", {
  id:         uuid("id").primaryKey().defaultRandom(),
  phone:      text("phone").notNull(),
  accountId:  uuid("account_id"),
  body:       text("body").notNull(),
  isStopWord: boolean("is_stop_word").default(false).notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});

// ── Zod insert schemas ──────────────────────────────────────────────────────
export const insertGroupSchema    = createInsertSchema(groupsTable).omit({ id: true, createdAt: true });
export const insertStudentSchema  = createInsertSchema(studentsTable).omit({ id: true, createdAt: true });
export const insertTemplateSchema = createInsertSchema(templatesTable).omit({ id: true, createdAt: true });
export const insertProxySchema    = createInsertSchema(proxiesTable).omit({
  id: true, createdAt: true, isHealthy: true, failCount: true, lastChecked: true, assignedTo: true,
});
export const insertAccountSchema  = createInsertSchema(accountsTable).omit({
  id: true, createdAt: true, sentToday: true, lastResetDate: true,
  status: true, phoneNumber: true, warmUpDay: true, totalReplies: true, totalSent: true,
  healthScore: true, suspendedUntil: true,
});
export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({
  id: true, createdAt: true, status: true, totalMessages: true,
});

// ── Types ──────────────────────────────────────────────────────────────────
export type Group          = typeof groupsTable.$inferSelect;
export type Student        = typeof studentsTable.$inferSelect;
export type Template       = typeof templatesTable.$inferSelect;
export type Proxy          = typeof proxiesTable.$inferSelect;
export type Account        = typeof accountsTable.$inferSelect;
export type AccountEvent   = typeof accountEventsTable.$inferSelect;
export type Campaign       = typeof campaignsTable.$inferSelect;
export type Message        = typeof messagesTable.$inferSelect;
export type Settings       = typeof settingsTable.$inferSelect;
export type OptOut         = typeof optOutTable.$inferSelect;
export type InboundMessage = typeof inboundMessagesTable.$inferSelect;
