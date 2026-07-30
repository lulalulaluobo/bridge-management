import { z } from "zod";

export const providerSchema = z.enum(["openai", "deepseek", "qwen", "custom"]);
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

export type CredentialSummary = {
  id: string;
  provider: Provider;
  label: string;
  baseUrl: string | null;
  isActive: boolean;
  chatModel: string;
  visionModel: string;
  transcriptionModel: string;
  keyMask: string;
  status: "active";
  updatedAt: string;
};
