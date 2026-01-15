import { db } from "./db";
import { urls, type Url, type InsertUrl } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface IStorage {
  createUrl(insertUrl: InsertUrl, createdBy?: string): Promise<Url>;
  getUrl(shortCode: string): Promise<Url | undefined>;
  incrementVisit(shortCode: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private chars = "23456789bcdfghjkmnpqrstvwxyzBCDFGHJKLMNPQRSTVWXYZ";

  private generateCode(length: number): string {
    let result = "";
    for (let i = 0; i < length; i++) {
      result += this.chars.charAt(Math.floor(Math.random() * this.chars.length));
    }
    return result;
  }

  async createUrl(insertUrl: InsertUrl, createdBy?: string): Promise<Url> {
    let shortCode = "";
    let isUnique = false;
    let length = 5; // Start with 5 characters to ensure professional-length links
    let attempts = 0;
    const maxLength = 20;
    
    while (!isUnique) {
      shortCode = this.generateCode(length);
      const existing = await this.getUrl(shortCode);
      if (!existing) {
        isUnique = true;
      } else {
        attempts++;
        if (attempts > 8) {
          length = Math.min(length + 1, maxLength); // increase length on collisions
          attempts = 0;
        }
      }
    }

    const values: any = { ...insertUrl, shortCode };
    if (createdBy) values.createdBy = createdBy;

    const [url] = await db
      .insert(urls)
      .values(values)
      .returning();
    return url;
  }

  async getUrl(shortCode: string): Promise<Url | undefined> {
    const [url] = await db.select().from(urls).where(eq(urls.shortCode, shortCode));
    return url;
  }

  async incrementVisit(shortCode: string): Promise<void> {
    const url = await this.getUrl(shortCode);
    if (url) {
      await db.update(urls)
        .set({ visitCount: (url.visitCount || 0) + 1 })
        .where(eq(urls.shortCode, shortCode));
    }
  }
}

export const storage = new DatabaseStorage();
