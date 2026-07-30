# 本地中文语音服务（测试）

本服务使用 Silero VAD v5 过滤静音/噪声，再使用 FunASR Paraformer 转写中文。DeepSeek 仅用于 Web App 后续的文本理解与回复。

```bash
cd services/local-asr
uv sync
bash start.sh
curl http://127.0.0.1:8787/health
```

首次启动会下载约 1GB 的 Paraformer 模型到 ModelScope 缓存；后续启动复用缓存。Web App 启动时设置：

```bash
LOCAL_ASR_URL=http://127.0.0.1:8787 corepack pnpm exec next start --port 3012
```

语音接口为 `POST /transcribe`（multipart 字段 `audio`）。它在无有效人声、识别为空或服务不可用时返回错误；Web App 会保留文字输入作为降级路径。
