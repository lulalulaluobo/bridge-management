# 模型设置独立页面 + 统一多模态模型 + 模型列表持久化

## 背景结论（已核实）

- `llm_credentials` 表已是「多行列表」结构，但当前 `UNIQUE(household_id, provider)` 限制每家供应商只能一条；模型名被硬编码在 `providerModels` 常量里（用户不可选）。
- chat 与 image **本就可用同一个多模态模型**：`openai`/`qwen` 两条已把 chatModel==visionModel 设成同一模型，唯一例外是 `deepseek-chat`（无视觉）。所以"统一成单一多模态模型"在数据层已成立，断点只是：硬编码模型名 + 两个返回不同行的 getter。
- **不引入 aisuite**（符合你笔记决策树：当前厂商都是 OpenAI 兼容，原生 openai SDK + base_url 即可）。aisuite 已 clone 到 `references/aisuite/` 仅作参考。

## 总体方案

每个家庭可保存「多条模型配置」（供应商 + 自定义模型名 + Key），其中**一条标记为启用**。启用的那条同时承担对话 + 拍照识别（必须是多模态模型）。设置入口从"更多"页的折叠块改为**点击按钮进入的独立全屏页面**（与现有"操作记录/收藏菜谱"subPage 模式一致）。

---

## 改动清单

### 1. 数据层 `src/lib/llm/credentials.ts`（核心）
- **provider 枚举扩展**：`openai | deepseek | qwen | custom`。新增 `custom` = 用户自填 `baseURL`，可接任意 OpenAI 兼容端点（OpenRouter/Groq/本地 Ollama 等），落地你笔记"零依赖统一法"。
- **Schema 迁移**（构造函数内幂等执行，SQLite 标准 `CREATE _new / INSERT SELECT / DROP / RENAME` 事务）：
  - 去掉 `UNIQUE(household_id, provider)`（允许同供应商多条）
  - 新增列：`label`(用户备注名)、`is_active`(INTEGER 0/1)、`base_url`(custom 用，其他供应商留空走预设)
  - 迁移已有行：`label=provider`、`is_active=1`（把存量视为启用，不丢 key）
- **模型名由用户输入**：`verifyAndSave` 入参增加 `model`(自定义模型名) + 可选 `label` + 可选 `baseUrl`。保存时 `chat_model = vision_model = model`（统一多模态），`transcription_model` 仍按供应商预设。
- **统一 getter**：新增 `getDecryptedActiveCredential()`（返回 `is_active=1` 的那条）。`getDecryptedChatCredential` / `getDecryptedVisionCredential` 改为**委托**它（消费方无需改动，字段 `.chatModel/.visionModel/.apiKey/.provider` 不变）。
- **集中 baseURL 逻辑**：新增 `providerBaseURL(provider, customUrl)` 助手，消除 decision.ts/recipes.ts/recognition.ts 里重复的三元判断。
- **list/getActive/setActive/delete** 支持多列表 + 启用切换。

### 2. API `src/app/api/settings/llm-credentials/route.ts`
- `POST`：接收 `{ provider, apiKey, model, label?, baseUrl? }`，保存后**自动设为启用**（新建即用，符合"保存一次就能用"）。
- `PATCH`（新增）：`{ id, action: "activate" }` 切换启用项。
- `DELETE`：按 `id` 删除（不再按 provider）。删除启用的那条时，若还有其他条，自动启用最新的一条。

### 3. UI — 独立页面 `src/components/llm-settings.tsx`（重写为全屏页）
- 改为与 `FavoritesView` 同构的全屏组件：`useEffect` 挂载时 `GET /api/settings/llm-credentials`，自带返回按钮（复用现有悬浮返回样式）。
- **「更多」页改造**（`inventory-dashboard.tsx`）：
  - `SubPage` 类型加 `"llm"`；新增 `subPage === "llm"` 渲染分支。
  - `MoreView` 里把原 `<details>` 折叠块换成一张"模型设置"入口卡片（与操作记录/收藏卡片样式一致），点击 `setSubPage("llm")`。
  - 移除 `initialCredentials` 透传链路（页面改为自取数据，与 FavoritesView 一致）。

### 4. 页面内容
- **供应商选择**（4 个：OpenAI / DeepSeek / 千问 / 自定义兼容），选择后自动填入预设 baseURL。
- **模型名输入**（自定义，带预设默认值如 `qwen-vl-max`、`gpt-4o-mini`）。
- **备注名**（可选，如"我的 Qwen 主号"）。
- **API Key**（password，minLength 20，保存调用 `models.list()` 验证）。
- **已保存列表**：每条显示 `备注 · 供应商 · 模型名 · key掩码` + 「启用中」徽标；提供「启用」「删除」操作；**同时只能启用一条**。
- 提示文案说明：需选支持视觉(多模态)的模型，一条配置即可同时用于对话与拍照识别；语音转写优先本地、仅 OpenAI 可作云端兜底。

---

## 兼容性 & 风险
- **存量 key 不丢**：迁移把现有行标为 `is_active=1`，行为不变。
- **消费方零改动**：`decision.ts`/`recipes.ts`/`recognition.ts` 继续调旧 getter（已委托到 active 项）；字段不变。
- **多模态前提**：若用户启用 deepseek-chat（非多模态），拍照识别会失败——页面提示明确告知"需选视觉模型"，由用户自担。
- 不引入 aisuite，零新增依赖，符合 Ponytail 原则。

## 验证
- `npx tsc --noEmit` 类型检查
- `npx vitest run`（如 store 测试涉及 credential 需同步）
- `npx eslint` 改动文件
- 手动：添加一条 Qwen-VL 配置 → 启用 → 对话 + 拍照均生效；添加第二条 → 切换启用 → 立即切换

是否按此方案实施？