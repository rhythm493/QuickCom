import fs from 'fs/promises';
import path from 'path';
import { SessionInfo } from './types';

interface SessionEnvelope<T> {
  credentials: T;
  savedAt: string;
  expiresAt: string;
}

/**
 * Generic session manager — replaces the 3 identical copies in blinkit/zepto/instamart.
 * Handles save/load/clear/expiry for any credentials type.
 */
export class SessionManager<T> {
  private filePath: string;

  constructor(
    private providerName: string,
    sessionsDir: string,
    private expiryHours: number,
    /** Validate loaded credentials — return true if all required fields are present */
    private validate: (creds: T) => boolean
  ) {
    this.filePath = path.join(sessionsDir, providerName, `${providerName}-session.json`);
  }

  async save(credentials: T): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    const envelope: SessionEnvelope<T> = {
      credentials,
      savedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.expiryHours * 60 * 60 * 1000).toISOString(),
    };

    await fs.writeFile(this.filePath, JSON.stringify(envelope, null, 2), 'utf-8');
    console.log(`[${this.providerName}] Session saved (expires in ${this.expiryHours}h)`);
  }

  async load(): Promise<T | null> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const envelope: SessionEnvelope<T> = JSON.parse(data);

      // Check expiry
      if (new Date(envelope.expiresAt) <= new Date()) {
        console.log(`[${this.providerName}] Session expired, clearing`);
        await this.clear();
        return null;
      }

      // Validate credentials
      if (!this.validate(envelope.credentials)) {
        console.log(`[${this.providerName}] Session invalid (missing required fields), clearing`);
        await this.clear();
        return null;
      }

      console.log(`[${this.providerName}] Session restored (expires ${envelope.expiresAt})`);
      return envelope.credentials;
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
      console.log(`[${this.providerName}] Session cleared`);
    } catch {
      // File doesn't exist, that's fine
    }
  }

  async getInfo(): Promise<SessionInfo> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const envelope: SessionEnvelope<T> = JSON.parse(data);
      return {
        exists: true,
        savedAt: envelope.savedAt,
        expiresAt: envelope.expiresAt,
        isExpired: new Date(envelope.expiresAt) <= new Date(),
      };
    } catch {
      return { exists: false };
    }
  }
}
