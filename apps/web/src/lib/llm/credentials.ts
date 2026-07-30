import "server-only";

import { randomUUID } from "node:crypto";

import OpenAI from "openai";
import { z } from "zod";

import { openAppDatabase } from "@/lib/inventory/store";
import { decryptSecret, encryptSecret } from "@/lib/llm/crypto";

const DEFAULT_HOUSEHOLD_ID = "default-household";
const providerSchema = z.enum(["openai", "deepseek", "qwen"]);
const credentialInputSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(20).max(500),
});

const providerModels = {
  deepseek: { chatModel: "deepseek-chat", visionModel: "qwen-vl-max", transcriptionModel: "local-paraformer" },
  qwen: { chatModel: "qwen-vl-max", visionModel: "qwen-vl-max", transcriptionModel: "local-paraformer" },
  openai: { chatModel: "gpt-4o-mini", visionModel: "gpt-4o-mini", transcriptionModel: "gpt-4o-transcribe" },
} as const;

export type CredentialInput = z.infer<typeof credentialInputSchema>;
export type CredentialSummary = {
  id: string;
  provider: z.infer<typeof providerSchema>;
  chatModel: string;
  visionModel: string;
  transcriptionModel: string;
  keyMask: string;
  status: "active";
  updatedAt: string;
};

type CredentialRow = {
  id: string;
  provider: z.infer<typeof providerSchema>;
  chat_model: string;
  vision_model: string;
  transcription_model: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  key_mask: string;
  updated_at: string;
};

export class CredentialStore {
  private readonly db = openAppDatabase();

  constructor(private readonly householdId = DEFAULT_HOUSEHOLD_ID) {
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
      FROM llm_credentials WHERE household_id = ?
      ORDER BY CASE provider WHEN 'deepseek' THEN 0 WHEN 'qwen' THEN 1 ELSE 2 END, updated_at DESC`).all(this.householdId) as CredentialRow[];
    return rows.map(toSummary);
  }

  async verifyAndSave(input: unknown): Promise<CredentialSummary> {
    const value = credentialInputSchema.parse(input);
    await verifyProviderKey(value.provider, value.apiKey);
    const models = providerModels[value.provider];
    const encrypted = encryptSecret(value.apiKey, `${this.householdId}:${value.provider}`, getEncryptionKey());
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT id FROM llm_credentials WHERE household_id = ? AND provider = ?").get(this.householdId, value.provider) as { id: string } | undefined;
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
        .run(id, this.householdId, value.provider, models.chatModel, models.visionModel, models.transcriptionModel, encrypted.ciphertext, encrypted.iv, encrypted.authTag, keyMask, now, now);
      this.writeAudit(value.provider, event, now);
    });
    save();
    return { id, provider: value.provider, ...models, keyMask, status: "active", updatedAt: now };
  }

  delete(provider: CredentialSummary["provider"]) {
    const now = new Date().toISOString();
    const deleted = this.db.prepare("DELETE FROM llm_credentials WHERE household_id = ? AND provider = ?").run(this.householdId, provider);
    if (!deleted.changes) throw new Error("未找到可删除的模型 Key");
    this.writeAudit(provider, "deleted", now);
  }

  getDecryptedChatCredential(): (CredentialSummary & { provider: "openai" | "deepseek"; apiKey: string }) | null {
    const row = this.db.prepare(`SELECT * FROM llm_credentials WHERE household_id = ? AND provider IN ('deepseek', 'openai')
      ORDER BY CASE provider WHEN 'deepseek' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`).get(this.householdId) as CredentialRow | undefined;
    if (!row) return null;
    return decryptCredential(row, this.householdId) as CredentialSummary & { provider: "openai" | "deepseek"; apiKey: string };
  }

  getDecryptedVisionCredential(): (CredentialSummary & { provider: "openai" | "qwen"; apiKey: string }) | null {
    const row = this.db.prepare(`SELECT * FROM llm_credentials WHERE household_id = ? AND provider IN ('qwen', 'openai')
      ORDER BY CASE provider WHEN 'qwen' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`).get(this.householdId) as CredentialRow | undefined;
    if (!row) return null;
    return decryptCredential(row, this.householdId) as CredentialSummary & { provider: "openai" | "qwen"; apiKey: string };
  }

  private writeAudit(provider: CredentialSummary["provider"], event: string, createdAt: string) {
    this.db.prepare("INSERT INTO credential_audit (id, household_id, provider, event, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), this.householdId, provider, event, createdAt);
  }
}

export async function verifyProviderKey(provider: CredentialSummary["provider"], apiKey: string) {
  try {
    const baseURL = provider === "deepseek" ? "https://api.deepseek.com/v1" : provider === "qwen" ? "https://dashscope.aliyuncs.com/compatible-mode/v1" : undefined;
    const client = new OpenAI({ apiKey, baseURL });
    await client.models.list();
  } catch {
    throw new Error("无法验证此模型 Key，请检查权限和网络后重试");
  }
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
  return { id: row.id, provider: providerSchema.parse(row.provider), chatModel: row.chat_model, visionModel: row.vision_model, transcriptionModel: row.transcription_model, keyMask: row.key_mask, status: "active", updatedAt: row.updated_at };
}

function decryptCredential(row: CredentialRow, householdId: string) {
  return { ...toSummary(row), apiKey: decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, `${householdId}:${row.provider}`, getEncryptionKey()) };
}

const globalForCredentialStore = globalThis as unknown as { credentialStore?: CredentialStore };

export function getCredentialStore(householdId = DEFAULT_HOUSEHOLD_ID) {
  if (householdId !== DEFAULT_HOUSEHOLD_ID) return new CredentialStore(householdId);
  if (!globalForCredentialStore.credentialStore) globalForCredentialStore.credentialStore = new CredentialStore();
  return globalForCredentialStore.credentialStore;
}
