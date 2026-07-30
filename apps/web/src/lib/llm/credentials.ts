import "server-only";

import { randomUUID } from "node:crypto";

import OpenAI from "openai";
import { z } from "zod";

import { openAppDatabase } from "@/lib/inventory/store";
import { decryptSecret, encryptSecret } from "@/lib/llm/crypto";

const DEFAULT_HOUSEHOLD_ID = "default-household";
const providerSchema = z.enum(["openai", "deepseek", "qwen", "custom"]);
export type Provider = z.infer<typeof providerSchema>;

/** 每家供应商的预设：baseURL（OpenAI 官方走 SDK 默认，故为 undefined）、推荐模型名、语音转写模型、UI 展示文案。 */
export const providerDefaults = {
  openai: { baseURL: undefined, defaultModel: "gpt-4o-mini", transcriptionModel: "gpt-4o-transcribe", title: "OpenAI", description: "GPT-4o 等多模态模型，可同时对话与拍照识别" },
  deepseek: { baseURL: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", transcriptionModel: "local-paraformer", title: "DeepSeek", description: "性价比高；注意 deepseek-chat 不支持视觉，拍照识别需改用其他家" },
  qwen: { baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-vl-max", transcriptionModel: "local-paraformer", title: "千问", description: "Qwen-VL 多模态，可同时对话与拍照识别" },
  custom: { baseURL: "", defaultModel: "", transcriptionModel: "local-paraformer", title: "自定义兼容", description: "任意 OpenAI 兼容端点（OpenRouter / Groq / Ollama 等），需自填 baseURL 与模型名" },
} as const satisfies Record<Provider, { baseURL: string | undefined; defaultModel: string; transcriptionModel: string; title: string; description: string }>;

/** 统一解析某条凭据实际请求的 baseURL：custom 用用户自填，其余走供应商预设，OpenAI 官方返回 undefined（SDK 默认）。 */
export function providerBaseURL(provider: Provider, customBaseUrl?: string | null): string | undefined {
  if (provider === "custom") return customBaseUrl?.trim() || undefined;
  return providerDefaults[provider].baseURL;
}

const credentialInputSchema = z.object({
  provider: providerSchema,
  apiKey: z.string().trim().min(20).max(500),
  model: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(40).optional(),
  baseUrl: z.string().trim().max(300).optional(),
});

export type CredentialInput = z.infer<typeof credentialInputSchema>;
export type CredentialSummary = {
  id: string;
  provider: Provider;
  label: string;
  baseUrl: string | null;
  chatModel: string;
  visionModel: string;
  transcriptionModel: string;
  isActive: boolean;
  keyMask: string;
  status: "active";
  updatedAt: string;
};

type CredentialRow = {
  id: string;
  provider: Provider;
  label: string | null;
  base_url: string | null;
  is_active: number;
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
    this.ensureSchema();
  }

  /** 建表（新库）+ 存量表迁移（加列、去 UNIQUE 约束、回填 label/is_active）。幂等。 */
  private ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_credentials (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        label TEXT,
        base_url TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        chat_model TEXT NOT NULL,
        vision_model TEXT NOT NULL,
        transcription_model TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        key_mask TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS credential_audit (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        event TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // 为旧表补齐新列
    const cols = new Set((this.db.prepare("PRAGMA table_info(llm_credentials)").all() as Array<{ name: string }>).map((column) => column.name));
    if (!cols.has("label")) this.db.exec("ALTER TABLE llm_credentials ADD COLUMN label TEXT");
    if (!cols.has("base_url")) this.db.exec("ALTER TABLE llm_credentials ADD COLUMN base_url TEXT");
    if (!cols.has("is_active")) this.db.exec("ALTER TABLE llm_credentials ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1");
    this.db.exec("UPDATE llm_credentials SET label = provider WHERE label IS NULL OR label = ''");

    // 去掉旧版的 UNIQUE(household_id, provider) 约束，允许同供应商保存多条
    const tableSql = (this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'llm_credentials'").get() as { sql?: string } | undefined)?.sql ?? "";
    if (/UNIQUE\s*\(\s*household_id\s*,\s*provider\s*\)/i.test(tableSql)) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE llm_credentials_new (
            id TEXT PRIMARY KEY,
            household_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            label TEXT,
            base_url TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            chat_model TEXT NOT NULL,
            vision_model TEXT NOT NULL,
            transcription_model TEXT NOT NULL,
            ciphertext TEXT NOT NULL,
            iv TEXT NOT NULL,
            auth_tag TEXT NOT NULL,
            key_mask TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          INSERT INTO llm_credentials_new (id, household_id, provider, label, base_url, is_active, chat_model, vision_model, transcription_model, ciphertext, iv, auth_tag, key_mask, created_at, updated_at)
          SELECT id, household_id, provider, COALESCE(label, provider), base_url, is_active, chat_model, vision_model, transcription_model, ciphertext, iv, auth_tag, key_mask, created_at, updated_at FROM llm_credentials;
          DROP TABLE llm_credentials;
          ALTER TABLE llm_credentials_new RENAME TO llm_credentials;
        `);
      })();
    }

    // 迁移后：保证每个家庭至多一条启用项（保留最早一条）
    this.db.exec(`UPDATE llm_credentials SET is_active = 0
      WHERE is_active = 1 AND rowid NOT IN (
        SELECT MIN(rowid) FROM llm_credentials WHERE is_active = 1 GROUP BY household_id
      )`);
  }

  list(): CredentialSummary[] {
    const rows = this.db.prepare(`SELECT id, provider, label, base_url, is_active, chat_model, vision_model, transcription_model, key_mask, updated_at
      FROM llm_credentials WHERE household_id = ?
      ORDER BY is_active DESC, updated_at DESC`).all(this.householdId) as CredentialRow[];
    return rows.map(toSummary);
  }

  /** 当前启用项（同时承担对话与拍照识别）。 */
  getActive(): CredentialSummary | null {
    const row = this.db.prepare(`SELECT id, provider, label, base_url, is_active, chat_model, vision_model, transcription_model, key_mask, updated_at
      FROM llm_credentials WHERE household_id = ? AND is_active = 1 LIMIT 1`).get(this.householdId) as CredentialRow | undefined;
    return row ? toSummary(row) : null;
  }

  /** 解密后的当前启用项（供 agent / 识别 / 菜谱等服务端逻辑使用）。 */
  getDecryptedActiveCredential(): (CredentialSummary & { apiKey: string; baseUrl: string | null }) | null {
    const row = this.db.prepare(`SELECT * FROM llm_credentials WHERE household_id = ? AND is_active = 1 LIMIT 1`).get(this.householdId) as CredentialRow | undefined;
    if (!row) return null;
    return { ...decryptCredential(row, this.householdId), baseUrl: row.base_url };
  }

  /** 新建/更新一条凭据并自动设为启用（保存即可用）。模型名由用户指定，统一多模态：chat_model = vision_model = model。 */
  async verifyAndSave(input: unknown): Promise<CredentialSummary> {
    const value = credentialInputSchema.parse(input);
    if (value.provider === "custom" && !value.baseUrl) throw new Error("自定义供应商需要填写 baseURL");
    const baseURL = providerBaseURL(value.provider, value.baseUrl);
    await verifyProviderKey(baseURL, value.apiKey);
    const transcriptionModel = providerDefaults[value.provider].transcriptionModel;
    const encrypted = encryptSecret(value.apiKey, `${this.householdId}:${value.provider}`, getEncryptionKey());
    const now = new Date().toISOString();
    const id = randomUUID();
    const keyMask = maskKey(value.apiKey);
    const label = value.label?.trim() || providerDefaults[value.provider].title;
    const baseUrl = value.provider === "custom" ? value.baseUrl!.trim() : null;

    const save = this.db.transaction(() => {
      this.db.prepare(`UPDATE llm_credentials SET is_active = 0 WHERE household_id = ?`).run(this.householdId);
      this.db.prepare(`INSERT INTO llm_credentials
        (id, household_id, provider, label, base_url, is_active, chat_model, vision_model, transcription_model, ciphertext, iv, auth_tag, key_mask, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, this.householdId, value.provider, label, baseUrl, value.model, value.model, transcriptionModel, encrypted.ciphertext, encrypted.iv, encrypted.authTag, keyMask, now, now);
      this.writeAudit(value.provider, "created", now);
    });
    save();
    return { id, provider: value.provider, label, baseUrl, isActive: true, chatModel: value.model, visionModel: value.model, transcriptionModel, keyMask, status: "active", updatedAt: now };
  }

  /** 切换启用项到指定 id。 */
  activate(id: string): CredentialSummary {
    const now = new Date().toISOString();
    const run = this.db.transaction(() => {
      const row = this.db.prepare("SELECT provider FROM llm_credentials WHERE id = ? AND household_id = ?").get(id, this.householdId) as { provider: Provider } | undefined;
      if (!row) throw new Error("未找到该模型配置");
      this.db.prepare("UPDATE llm_credentials SET is_active = 0 WHERE household_id = ?").run(this.householdId);
      const changed = this.db.prepare("UPDATE llm_credentials SET is_active = 1, updated_at = ? WHERE id = ? AND household_id = ?").run(now, id, this.householdId);
      if (!changed.changes) throw new Error("未找到该模型配置");
      this.writeAudit(row.provider, "rotated", now);
    });
    run();
    const active = this.getActive();
    if (!active) throw new Error("启用失败");
    return active;
  }

  /** 删除指定 id；若删的是启用项，自动把最近的一条设为启用。 */
  delete(id: string) {
    const now = new Date().toISOString();
    const run = this.db.transaction(() => {
      const row = this.db.prepare("SELECT provider, is_active FROM llm_credentials WHERE id = ? AND household_id = ?").get(id, this.householdId) as { provider: Provider; is_active: number } | undefined;
      if (!row) throw new Error("未找到可删除的模型配置");
      const deleted = this.db.prepare("DELETE FROM llm_credentials WHERE id = ? AND household_id = ?").run(id, this.householdId);
      if (!deleted.changes) throw new Error("未找到可删除的模型配置");
      if (row.is_active === 1) {
        this.db.prepare(`UPDATE llm_credentials SET is_active = 1, updated_at = ?
          WHERE id = (SELECT id FROM llm_credentials WHERE household_id = ? ORDER BY updated_at DESC LIMIT 1)`).run(now, this.householdId);
      }
      this.writeAudit(row.provider, "deleted", now);
    });
    run();
  }

  /** 兼容旧调用：返回当前启用项（对话用，多模态模型即可胜任）。 */
  getDecryptedChatCredential(): (CredentialSummary & { apiKey: string }) | null {
    return this.getDecryptedActiveCredential();
  }

  /** 兼容旧调用：返回当前启用项（拍照识别用，需视觉能力）。 */
  getDecryptedVisionCredential(): (CredentialSummary & { apiKey: string }) | null {
    return this.getDecryptedActiveCredential();
  }

  private writeAudit(provider: Provider, event: string, createdAt: string) {
    this.db.prepare("INSERT INTO credential_audit (id, household_id, provider, event, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), this.householdId, provider, event, createdAt);
  }
}

export async function verifyProviderKey(baseURL: string | undefined, apiKey: string) {
  try {
    const client = new OpenAI({ apiKey, baseURL });
    await client.models.list();
  } catch {
    throw new Error("无法验证此模型 Key，请检查权限、baseURL 和网络后重试");
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

function toSummary(row: Pick<CredentialRow, "id" | "provider" | "label" | "base_url" | "is_active" | "chat_model" | "vision_model" | "transcription_model" | "key_mask" | "updated_at">): CredentialSummary {
  return { id: row.id, provider: providerSchema.parse(row.provider), label: row.label ?? providerDefaults[providerSchema.parse(row.provider)].title, baseUrl: row.base_url, isActive: row.is_active === 1, chatModel: row.chat_model, visionModel: row.vision_model, transcriptionModel: row.transcription_model, keyMask: row.key_mask, status: "active", updatedAt: row.updated_at };
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
