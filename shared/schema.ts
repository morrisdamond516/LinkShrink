import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const urls = pgTable("urls", {
  id: serial("id").primaryKey(),
  originalUrl: text("original_url").notNull(),
  shortCode: text("short_code").notNull().unique(),
  visitCount: integer("visit_count").default(0),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  plan: text("plan").notNull(),
  amount: integer("amount").notNull(),
  customerEmail: text("customer_email"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  sessionToken: text("session_token").unique(),
  plan: text("plan").default('FREE'),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUrlSchema = createInsertSchema(urls).pick({
  originalUrl: true,
});

export type Url = typeof urls.$inferSelect;
export type InsertUrl = z.infer<typeof insertUrlSchema>;
