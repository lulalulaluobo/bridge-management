import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

import OpenAI from "openai";
import { z } from "zod";

import { openAppDatabase } from "@/lib/inventory/store";

const DEFAULT_HOUSEHOLD_ID = "default-household";
const providerSchema = z.literal("openai");
const credentialInputSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(20).max(500),
  chatModel: z.string().trim().min(1).max(100),
  visionModel: z.string().trim().min(1).max(100),
  transcriptionModel: z.string().trim().min(1).max(100),
});

export type CredentialInput = z.infer<typeof credentialInputSchema>;
export type CredentialSummary = {
  id: string;
  provider: "openai";
  chatModel: string;
  visionModel: string;
  transcriptionModel: string;
  keyMask: string;
  status: "active";
  updatedAt: string;
};

type CredentialRow = {
  id: string;
  provider: "openai";
  chat_model: string;
  vision_model: string;
  transcription_model: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_mask: string;
  updated_at: string;
};

type EncryptedSecret = { ciphertext: string; iv: string; authTag: string };

export class CredentialStore {
  private readonly db = openAppDatabase();

  constructor() {
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_credentials (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        chat_model TEXT NOT NULL,
        vision_model TEXT NOT NULL,
        transcription_model TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        key_mask TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (household_id, provider)
      );
      CREATE TABLE IF NOT EXISTS credential_audit (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        event TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  list(): CredentialSummary[] {
    const rows = this.db.prepare(`SELECT id, provider, chat_model, vision_model, transcription_model, key_mask, updated_at
      FROM llm_credentials WHERE household_id = ? ORDER BY updated_at DESC`).all(DEFAULT_HOUSEHOLD_ID) as CredentialRow[];
    return rows.map(toSummary);
  }

  async verifyAndSave(input: unknown): Promise<CredentialSummary> {
    const value = credentialInputSchema.parse(input);
    await verifyOpenAiKey(value.apiKey);
    const encrypted = encryptSecret(value.apiKey, `${DEFAULT_HOUSEHOLD_ID}:${value.provider}`);
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT id FROM llm_credentials WHERE household_id = ? AND provider = ?").get(DEFAULT_HOUSEHOLD_ID, value.provider) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    const keyMask = maskKey(value.apiKey);
    const event = existing ? "rotated" : "created";

    const save = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO llm_credentials
        (id, household_id, provider, chat_model, vision_model, transcription_model, ciphertext, iv, auth_tag, key_mask, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(household_id, provider) DO UPDATE SET
          chat_model = excluded.chat_model, vision_model = excluded.vision_model, transcription_model = excluded.transcription_model,
          ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag, key_mask = excluded.key_mask, updated_at = excluded.updated_at`)
        .run(id, DEFAULT_HOUSEHOLD_ID, value.provider, value.chatModel, value.visionModel, value.transcriptionModel, encrypted.ciphertext, encrypted.iv, encrypted.authTag, keyMask, now, now);
      this.writeAudit(value.provider, event, now);
    });
    save();
    return { id, provider: value.provider, chatModel: value.chatModel, visionModel: value.visionModel, transcriptionModel: value.transcriptionModel, keyMask, status: "active", updatedAt: now };
  }

  delete(provider: "openai") {
    const now = new Date().toISOString();
    const deleted = this.db.prepare("DELETE FROM llm_credentials WHERE household_id = ? AND provider = ?").run(DEFAULT_HOUSEHOLD_ID, provider);
    if (!deleted.changes) throw new Error("未找到可删除的模型 Key");
    this.writeAudit(provider, "deleted", now);
  }

  getDecryptedOpenAiCredential(): (CredentialSummary & { apiKey: string }) | null {
    const row = this.db.prepare("SELECT * FROM llm_credentials WHERE household_id = ? AND provider = 'openai'").get(DEFAULT_HOUSEHOLD_ID) as CredentialRow | undefined;
    if (!row) return null;
    return { ...toSummary(row), apiKey: decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, `${DEFAULT_HOUSEHOLD_ID}:${row.provider}`) };
  }

  private writeAudit(provider: "openai", event: string, createdAt: string) {
    this.db.prepare("INSERT INTO credential_audit (id, household_id, provider, event, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), DEFAULT_HOUSEHOLD_ID, provider, event, createdAt);
  }
}

export async function verifyOpenAiKey(apiKey: string) {
  try {
    const client = new OpenAI({ apiKey });
    await client.models.list();
  } catch {
    throw new Error("无法验证此 OpenAI Key，请检查权限和网络后重试");
  }
}

function encryptSecret(secret: string, aad: string): EncryptedSecret {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

function decryptSecret(encrypted: EncryptedSecret, aad: string): string {
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(encrypted.iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function getEncryptionKey(): Buffer {
  const encoded = process.env.APP_ENCRYPTION_KEY;
  if (!encoded) throw new Error("服务端未配置 APP_ENCRYPTION_KEY，无法安全保存模型 Key");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY 必须是 32 字节的 Base64 密钥");
  return key;
}

function maskKey(apiKey: string) {
  return `${apiKey.slice(0, 3)}••••${apiKey.slice(-4)}`;
}

function toSummary(row: Pick<CredentialRow, "id" | "provider" | "chat_model" | "vision_model" | "transcription_model" | "key_mask" | "updated_at">): CredentialSummary {
  return { id: row.id, provider: row.provider, chatModel: row.chat_model, visionModel: row.vision_model, transcriptionModel: row.transcription_model, keyMask: row.key_mask, status: "active", updatedAt: row.updated_at };
}

const globalForCredentialStore = globalThis as unknown as { credentialStore?: CredentialStore };

export function getCredentialStore() {
  if (!globalForCredentialStore.credentialStore) globalForCredentialStore.credentialStore = new CredentialStore();
  return globalForCredentialStore.credentialStore;
}
