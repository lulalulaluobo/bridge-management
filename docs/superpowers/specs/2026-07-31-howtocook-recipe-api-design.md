# 用 HowToCook 本地索引替换下厨房抓取层 — 设计文档

- 日期:2026-07-31
- 状态:已批准,待实现
- 作者:与用户协作
- 相关文件:`apps/web/src/lib/xiachufang.ts`、`apps/web/src/lib/recipes.ts`、`apps/web/src/app/api/favorites/route.ts`、`apps/web/src/components/meal-recommendations.tsx`、`apps/web/src/components/favorites-view.tsx`

## 1. 背景与动机

当前菜式推荐的"增强层"由 `apps/web/src/lib/xiachufang.ts` 实现,它**不是官方 API,而是对 `xiachufang.com` 的 HTML 正则抓取**:

- `searchXiachufang(keyword)` 抓 `xiachufang.com/search/`
- `getXiachufangRecipeDetail(recipeId)` 抓菜谱详情页

这带来两个问题:
1. **版权与合规风险**:非官方抓取,图片来自 `chuimg.com`(需 `referrerPolicy="no-referrer"` 绕防盗链),数据归属下厨房。
2. **脆弱性**:页面改版或验证码即失效(现已有 LLM 步骤兜底缓解,但数据源本身不稳定)。

**目标**:彻底删除下厨房抓取层,改用版权干净、离线可用、结构稳定的开源数据源 **HowToCook**(Anduin2017/HowToCook,Unlicense,369 道家常菜,Markdown 组织,含 jpeg 预览图)。

菜式推荐主流程**不变**:仍由 LLM 基于冰箱库存生成菜名 → HowToCook 仅负责回填结构化详情(封面/难度/卡路里/原料/步骤/小贴士)。匹配不到的菜名自动落入已有的 LLM 步骤兜底。

## 2. 现状(已核对)

- 框架:Next.js 16 App Router,React 19,better-sqlite3,vitest,`server-only` 模块单例模式。
- `xiachufang.ts` 被 `recipes.ts`(推荐)与 `api/favorites/route.ts`(收藏补全)两处调用,依赖两个导出函数及其返回形状。
- 推荐核心 `recommendMeals()`(`recipes.ts:58-208`):LLM 出 3-5 道菜 → 每道调 `searchXiachufang(name,3)` 取首条 → `getXiachufangRecipeDetail(id)` 回填;若拿不到步骤则调 `generateFallbackRecipeSteps()`(LLM)兜底。
- 收藏 `POST /api/favorites`(`route.ts:22-93`):保存时若缺步骤/原料,先调 `getXiachufangRecipeDetail(recipeId)`,再 LLM 兜底。
- 数据库 `saved_recipes` 表(`favorites.ts:38-55`)含 `score`、`cooked` 两列;`SavedRecipe` 类型同名字段。**改名需 DB 迁移**,本设计避免迁移。
- UI(`meal-recommendations.tsx` / `favorites-view.tsx`)渲染封面图、`⭐ <score> 分`、`<cooked> 人做过`、步骤图片;多处用 `referrerPolicy="no-referrer"`(专为下厨房防盗链)。

## 3. HowToCook 数据规范(已验证)

实测两个真实菜谱(`麻婆豆腐`、`西红柿炒鸡蛋`),Markdown 结构高度统一:

```markdown
# <菜名>的做法

![<预览图名>](./<n>.jpeg)            ← 可选封面图(本地 jpeg)

<简介段落>

预估烹饪难度：★★                      ← 星级难度,天然对应"评分"
预估卡路里：252 大卡                   ← 卡路里

## 必备原料和工具                       ← 原料列表(用 * 或 - )
* 西红柿
* 鸡蛋

## 计算                               ← 用量计算(同原料维度)
* 西红柿 = 1 个 * 份数

## 操作                               ← 编号步骤(1. 2. …,可含 - 子项)
1. 西红柿洗净
2. 切成小块

  - 子步骤说明

## 附加内容                           ← 小贴士/变化(末尾常含模板致谢语)
- 防止糊锅
如果您遵循本指南…请提出 Issue 或 Pull request 。
```

- 数据量:**369 个 `.md`**,11 个分类目录(`aquatic`/`breakfast`/`condiment`/`dessert`/`drink`/`meat_dish`/`semi-finished`/`soup`/`staple`/`template`/`vegetable_dish`)。
- 同一菜可有多个变体于同一目录(如 `dishes/meat_dish/红烧肉/{简易红烧肉,南派红烧肉}.md`),每个 md 独立索引。
- 许可证:Unlicense(公有领域等效),无版权负担。

## 4. 目标与边界

### 做什么
- **删除** `apps/web/src/lib/xiachufang.ts`。
- **删除** `references/xiachufang-api/`(仓库内未接入的 Toapi Python 参考库)。
- **新建** `apps/web/src/lib/howtocook.ts`:导出与 xiachufang **形状相同**的函数,作为 drop-in。
- **引入** HowToCook 为 git submodule,新增同步脚本将 `dishes/**` 复制为静态资源。
- **调整** `recipes.ts`、`api/favorites/route.ts` 的 import 与函数名。
- **调整** UI 标签与空字段占位。

### 不做什么(范围控制)
- 不改推荐主流程(`recommendMeals` 的 LLM 调用、zod schema、`assertSafeRecommendations` 安全校验)。
- 不改 `saved_recipes` 表结构,不做 DB 迁移(见 §7 语义重映射)。
- 不改 API 路由形状(`/api/recommendations`、`/api/recommendations/photo`、`/api/favorites` 的请求/响应结构)。
- 不引入新的运行时依赖。

## 5. 架构

```
                            ┌─────────────────────────────┐
  LLM(推荐核心,不变)  ──►   │  recipes.ts recommendMeals   │
                            └──────────────┬──────────────┘
                                           │ 菜名
                                           ▼
                            ┌─────────────────────────────┐
        本地内存索引(单例) ►│      howtocook.ts (新)        │  ◄─ searchRecipes / getRecipeDetail
                            │                              │
   git submodule ──同步──►  │  解析 vendor/howtocook/dishes │
   (HowToCook Markdown)     │  ↓ public/howtocook/dishes   │  (静态图片由 Next 服务)
                            └──────────────┬──────────────┘
                                           │ 无匹配 → 返回 []
                                           ▼
                            ┌─────────────────────────────┐
                            │ generateFallbackRecipeSteps  │ (已有,LLM 出步骤,不变)
                            └─────────────────────────────┘
```

HowToCook 作为**纯增强层**,与原 xiachufang 层角色完全一致,只是数据从"网络抓取"变为"本地索引"。

## 6. 组件设计

### 6.1 数据接入:submodule + 同步脚本

- `git submodule add https://github.com/Anduin2017/HowToCook apps/web/vendor/howtocook`
- 新增 `apps/web/scripts/sync-howtocook.mjs`:
  - 递归把 `apps/web/vendor/howtocook/dishes/**` 拷到 `apps/web/public/howtocook/dishes/`(**包含 `.md` 与 `.jpeg/.jpg/.png` 图片**)。
  - 幂等:先清空目标 `dishes/` 再拷贝。
  - 拷贝完成后打印菜谱与图片计数,便于 CI 校验。
- `apps/web/package.json` 新增脚本:
  - `"sync:recipes": "node scripts/sync-howtocook.mjs"`
  - `predev`、`prebuild` 钩子调用 `sync:recipes`,保证开发与构建前数据就绪。
- `.gitignore` 增加忽略 `apps/web/public/howtocook/`(派生产物)与 `apps/web/vendor/howtocook/`(submodule 内容,由 git 管理)。
- README 增补:克隆后 `git submodule update --init --recursive`,以及 submodule 的用途说明。
- **构建守卫**:`sync-howtocook.mjs` 若源目录缺失或拷贝后 `.md` 数为 0,以非零码退出并打印"请先 `git submodule update --init --recursive`"。

### 6.2 索引与解析器 — `apps/web/src/lib/howtocook.ts`

导出类型(与 xiachufang 同名同形,调用方无需改类型):

```ts
export type HowToCookSearchResult = {
  id: string; name: string; url: string; cover: string; score: string; cooked: string;
};
export type HowToCookIngredient = { name: string; unit: string };
export type HowToCookStep = { step: number; desc: string; img: string };
export type HowToCookRecipeDetail = {
  id: string; name: string; url: string; cover: string; score: string; cooked: string;
  ingredients: HowToCookIngredient[]; steps: HowToCookStep[]; tips: string;
};
export async function searchRecipes(keyword: string, limit?: number): Promise<HowToCookSearchResult[]>;
export async function getRecipeDetail(recipeId: string): Promise<HowToCookRecipeDetail | null>;
```

> 注:`async` 是为了保持与 xiachufang 函数签名兼容(当前调用点都用 `await`),即便内部是同步内存查找。函数名从 `searchXiachufang`/`getXiachufangRecipeDetail` 改为 `searchRecipes`/`getRecipeDetail`。

**索引构建(单例、惰性、进程级缓存):**
- 模块加载时不解析;首次调用 `searchRecipes`/`getRecipeDetail` 时用 `globalThis` 单例(沿用项目现有模式,如 `getFavoritesStore`)构建一次。
- 递归扫描 `apps/web/public/howtocook/dishes/**/*.md`,对每个 md 调 `parseRecipe()` 得到 `HowToCookRecipeDetail`(并缓存为搜索索引)。
- 路径解析基准:`process.cwd()`。允许用 `HOWTOCOOK_DIR` 环境变量覆盖(便于测试 fixture)。

**`parseRecipe(absPath)` — 严格按 §3 规范提取:**

| 字段 | 规则 |
|---|---|
| `id` | 相对路径去 `.md` 并规范化,如 `vegetable_dish/西红柿炒鸡蛋`;变体保留文件名区分,如 `meat_dish/红烧肉/简易红烧肉` |
| `name` | `# X的做法` → 去"的做法"及空白;无 H1 则用文件名(去 `.md`) |
| `cover` | 正文首个 `![alt](./x.jpeg)` 的相对路径 → `/howtocook/dishes/<所在目录>/x.jpeg`;无则为 `""` |
| `score` | 行匹配 `预估烹饪难度：([★☆]+)` → 保留星号字符串,如 `"★★★"`;无则 `""` |
| `cooked` | 行匹配 `预估卡路里：(\d+)\s*大卡` → `"<数字> 大卡"`,如 `"252 大卡"`;无则 `""` |
| `ingredients` | 合并 `## 必备原料和工具` 与 `## 计算` 两个小节:`name` 取列表项文本(去 `*`/`-` 及尾部括号备注);`unit` 从 `## 计算` 行内 `=`/数量处尽量抽取(如 `1 个`),抽不到给 `""` |
| `steps` | `## 操作` 下,按 `^\d+\.\s` 切分顶级步骤;紧随的缩进 `- ` 子项合并进该步骤 `desc`(以换行连接);`step` 自增编号;`img` 暂为 `""`(HowToCook 步骤多无配图) |
| `tips` | `## 附加内容` 全文;剥除末尾模板语 `如果您遵循本指南…Issue 或 Pull request 。` 及多余空行;无则 `""` |
| `url` | GitHub 源链接:`https://github.com/Anduin2017/HowToCook/blob/master/<相对路径>` |

`## 计算` 节中的"份数"换算说明不解析为固定数量,仅用于 `unit` 提示;最终用量由用户按份数自行把握(UI 文案注明"参考用量")。

### 6.3 菜名匹配 — `searchRecipes(keyword, limit = 6)`

HowToCook 无原生搜索,自建轻量匹配器:

1. **规范化** `normalize()`:`zh-CN` 小写、去所有空白、去"的做法/做法"后缀(复用 `recipes.ts` 已有 `normalize` 思路)。
2. **同义词归一**:维护一个小映射表(约 10 对,可后续扩展),建索引时与查询时都先归一,提升召回:
   - 番茄↔西红柿、土豆↔马铃薯、瘦肉↔里脊、元葱↔洋葱、地瓜↔红薯、苞菜↔圆白菜↔卷心菜、朝天椒↔小米椒、鸡蛋白↔蛋清 等。
3. **精确命中**:归一化菜名 == 归一化关键词 → 满分。
4. **包含关系**:菜名包含关键词或反之 → 次高分。
5. **n-gram 相似度**:对中文按字符 bigram 求 Jaccard 相似度,作为兜底排序分。
6. **阈值过滤**:低于阈值(如 bigram Jaccard < 0.15 且无精确/包含命中)→ 该菜不入结果。
7. **变体去重**:同一菜名目录(如 `红烧肉/`)下多个变体,取最高分一条代表,避免结果重复;`getRecipeDetail` 仍按具体 id 取特定变体。
8. 返回按分降序、截取 `limit`。**若结果为空,返回 `[]`**(交由调用方走 LLM 兜底,见 §6.5)。

> 命中阈值与同义词表在 `howtocook.ts` 顶部集中常量化,便于调整与测试。

### 6.4 `getRecipeDetail(recipeId)`

- `recipeId` 为 §6.2 的 `id`(相对路径形式)。从单例索引直接取对应 `HowToCookRecipeDetail`(已含完整解析);不存在返回 `null`。
- 与 xiachufang 版不同:**不再发起网络请求**,纯内存查找,但仍为 `async`(签名兼容)。

### 6.5 兜底链(不变,但需确认衔接)

- `recipes.ts:181-191`:`if (!steps || !steps.length)` → `generateFallbackRecipeSteps()`。HowToCook 未匹配时 `searchRecipes` 返回 `[]`,导致 `steps` 保持 `undefined`,自然进入此分支 —— **无需改动兜底逻辑**。
- `api/favorites/route.ts:48-59`:保存时若缺步骤/原料,先 `getRecipeDetail`,再 LLM 兜底 —— 逻辑结构不变,仅换函数名。

## 7. 字段语义重映射(重要决策)

`saved_recipes` 表已有 `score`、`cooked` 两列且类型为 `TEXT`。**不改 schema、不做迁移**,仅改变这两个字段的语义来源与 UI 标签:

| 列/字段 | 旧(xiachufang) | 新(HowToCook) | UI 标签变化 |
|---|---|---|---|
| `score` | 菜谱评分 `7.8`(数字分) | 烹饪难度 `★★★`(星号) | `⭐ 7.8 分` → `难度 ★★★` |
| `cooked` | `"1234 人做过"` | `"252 大卡"` | `1234 人做过` → `约 252 大卡` |

- 历史 DB 记录仍含旧的数字分/人做过文案;UI 按新标签渲染旧值会出现"难度 7.8"这类不协调。**接受**:收藏菜谱为低频、可重建数据,不为此做迁移。若用户介意,可后续加一次性清洗脚本(本设计不含)。
- 空值处理:未匹配到的菜(走 LLM 兜底),`score`/`cooked` 为 `""`,UI 必须隐藏对应 chip(见 §8)。

## 8. UI 调整 — `meal-recommendations.tsx` / `favorites-view.tsx`

- 文案:"下厨房精选菜谱" → "开源家常菜谱";步骤模态标题等含"下厨房"处一并改为"开源菜谱"或"家常菜谱"。
- 评分/卡路里标签按 §7 重映射(`⭐ X 分` → `难度 X`;`人做过` → `约 X`)。
- **空字段优雅降级**(关键):`cover` 为空时**不渲染图片块**(不使用占位图,保持布局整洁);`score`/`cooked` 为空时隐藏对应 chip。避免兜底菜出现破图或空标签。
- 移除仅为下厨房防盗链的 `referrerPolicy="no-referrer"`(现图片为自有静态资源 `/howtocook/...`)。逐一核查并删除该属性。
- 图片 `alt` 用菜名。
- `CookingModal` 中步骤图片:HowToCook 多无步骤配图,`img` 为 `""` 时跳过步骤图渲染(原逻辑应已支持,需复核)。

## 9. 集成点改动清单

| 文件 | 改动 |
|---|---|
| `apps/web/src/lib/howtocook.ts` | **新建**:类型、索引、解析、匹配、两个导出函数 |
| `apps/web/src/lib/xiachufang.ts` | **删除** |
| `references/xiachufang-api/` | **删除**(整个目录) |
| `apps/web/src/lib/recipes.ts` | import 改 `@/lib/howtocook`;`searchXiachufang`→`searchRecipes`、`getXiachufangRecipeDetail`→`getRecipeDetail`(共 2 处调用,`recipes.ts:9,157,167`);其余不动 |
| `apps/web/src/app/api/favorites/route.ts` | import 改 `@/lib/howtocook`;`getXiachufangRecipeDetail`→`getRecipeDetail`(2 处:`route.ts:6,49`);注释更新 |
| `apps/web/scripts/sync-howtocook.mjs` | **新建**:同步脚本 |
| `apps/web/package.json` | 加 `sync:recipes` 脚本与 `predev`/`prebuild` 钩子 |
| `apps/web/.gitignore` 或根 `.gitignore` | 忽略 `apps/web/public/howtocook/` |
| `.gitmodules` | 新增 HowToCook submodule |
| `apps/web/src/components/meal-recommendations.tsx` | 文案、标签重映射、空字段占位、移除 `referrerPolicy` |
| `apps/web/src/components/favorites-view.tsx` | 同上 |
| `README.md` | 更新"下厨房"相关描述为 HowToCook;补 submodule 初始化说明 |

## 10. 测试 — `apps/web/src/lib/howtocook.test.ts`(vitest)

沿用 `recipes.test.ts` 的 vitest 模式。用 `HOWTOCOOK_DIR` 指向测试 fixture 目录,避免依赖 submodule。

**Fixture**:在 `apps/web/src/lib/__fixtures__/howtocook/` 下放 2 个真实样本的精简副本(如 `vegetable_dish/西红柿炒鸡蛋.md`、`meat_dish/麻婆豆腐/麻婆豆腐.md`),各配 1 个 jpeg 占位图。

用例:
1. **解析 — 西红柿炒鸡蛋**:断言 `name`="西红柿炒鸡蛋"、`score` 含星号、`cooked`="252 大卡"(按 fixture)、`ingredients` 含"西红柿""鸡蛋"、`steps` 数 ≥ 5 且首步含"洗净"、`tips` 不含模板致谢语、`cover` 指向 `/howtocook/.../jpeg`。
2. **解析 — 麻婆豆腐**:断言 `name`、`ingredients` 含"内脂豆腐"、`steps` 数 ≥ 10、难度星数正确。
3. **匹配 — 同义词召回**:`searchRecipes("番茄炒蛋")` 命中"西红柿炒鸡蛋"。
4. **匹配 — 精确**:`searchRecipes("麻婆豆腐")` 首条为麻婆豆腐。
5. **匹配 — 无命中**:`searchRecipes("完全不存在的乱码菜xyz")` 返回 `[]`。
6. **getRecipeDetail**:用已知 id 返回完整 detail;不存在 id 返回 `null`。
7. **变体去重**:`searchRecipes("红烧肉")` 不返回多条红烧肉变体(若 fixture 含变体则验证)。

现有 `recipes.test.ts` 应仍通过(其只测 `assertSafeRecommendations`,不依赖 xiachufang)。

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 匹配率 < 100%(HowToCook 仅 369 道,LLM 菜名可能不在其中) | 部分菜无 HowToCook 详情 | 已有 LLM 步骤兜底自动接管,体验降级而非报错;`score`/`cooked` 为空时 UI 隐藏 |
| submodule 在 CI 未初始化 | 构建缺数据 | `prebuild` 跑同步脚本 + 脚本内守卫(源缺失/.md=0 则非零退出并提示);README 说明 |
| `cooked` 语义从"人做过"变"卡路里" | 历史收藏显示不协调 | 接受(低频可重建);UI 按新标签渲染;文档注明,必要时后续清洗 |
| 同义词表需维护 | 召回不准 | 集中常量化、可扩展;测试覆盖关键对 |
| 步骤多无配图 | 步骤模态少图 | UI 已按 `img` 空值跳过;复核 |
| Next 静态资源路径/编码(中文目录名) | 图片 404 | `public/howtocook/dishes/...` 保留原始中文路径,Next/浏览器自动编码;构建后抽样验证 |

## 12. 验收标准

1. `apps/web/src/lib/xiachufang.ts` 与 `references/xiachufang-api/` 已删除,全仓库无 `xiachufang` 字样残留(grep 为空)。
2. `git submodule status` 含 HowToCook;`apps/web/public/howtocook/dishes/` 在 `sync:recipes` 后含 ~369 个 md 及对应图片。
3. `npm run test`(vitest)全绿,含新增 `howtocook.test.ts` 全部用例。
4. `npm run build` 成功(`prebuild` 自动同步数据)。
5. 手动验证(本地 `npm run dev`):
   - 冰箱有西红柿+鸡蛋 → 推荐含"西红柿炒鸡蛋",详情有难度星、卡路里、原料、步骤、小贴士、封面图正常显示。
   - 构造一个 HowToCook 没有的菜名 → 该菜卡仍显示(LLM 步骤),无破图、无空 chip。
   - 收藏一道菜后,"吃什么"页与收藏页都能正常显示与打开烹饪步骤。
6. UI 无"下厨房"文案;图片不再带 `referrerPolicy="no-referrer"`。
