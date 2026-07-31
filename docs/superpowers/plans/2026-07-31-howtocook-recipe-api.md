# HowToCook 本地索引替换下厨房抓取层 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除有版权风险的下厨房 HTML 抓取层,改用 HowToCook(Unlicense)本地 Markdown 索引作为菜谱增强层。

**Architecture:** HowToCook 以 git submodule 引入,启动时解析 `dishes/**/*.md` 为内存索引。新建 `howtocook.ts` 导出与 `xiachufang.ts` 同形状的 `searchRecipes`/`getRecipeDetail`,作为 drop-in 替换。推荐主流程不变;匹配不到的菜名返回 `[]`,自动落入已有的 LLM 步骤兜底。

**Tech Stack:** Next.js 16 App Router,TypeScript,vitest,better-sqlite3,HowToCook Markdown(Unlicense)。

**Spec:** `docs/superpowers/specs/2026-07-31-howtocook-recipe-api-design.md`

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `apps/web/vendor/howtocook/` | HowToCook submodule 源 | 新建(git submodule) |
| `apps/web/scripts/sync-howtocook.mjs` | 把 vendor/dishes 拷到 public,幂等,带守卫 | 新建 |
| `apps/web/src/lib/howtocook.ts` | 类型 + Markdown 解析 + 内存索引 + 模糊匹配 + 两个导出函数 | 新建 |
| `apps/web/src/lib/__fixtures__/howtocook/...` | 测试用真实菜谱样本(含图) | 新建 |
| `apps/web/src/lib/howtocook.test.ts` | 解析与匹配单测 | 新建 |
| `apps/web/src/lib/xiachufang.ts` | 旧抓取层 | 删除 |
| `apps/web/src/lib/recipes.ts` | 推荐核心,改 import 与函数名 | 改 |
| `apps/web/src/app/api/favorites/route.ts` | 收藏补全,改 import 与函数名 | 改 |
| `apps/web/package.json` | 加 `sync:recipes` + `predev`/`prebuild` | 改 |
| `.gitignore` | 忽略 `apps/web/public/howtocook/` | 改 |
| `apps/web/src/components/meal-recommendations.tsx` | 文案 + 标签重映射 + 移除 referrerPolicy | 改 |
| `apps/web/src/components/favorites-view.tsx` | 文案 + 标签重映射 + 移除 referrerPolicy | 改 |
| `references/xiachufang-api/` | 未接入的 Python 参考库 | 删除 |

字段语义重映射(零 DB 迁移):`score` → 烹饪难度星(`★★★`)、`cooked` → 卡路里(`252 大卡`)。

---

## Task 1: 引入 HowToCook submodule

**Files:**
- Create: `apps/web/vendor/howtocook/`(git submodule)
- Modify: `.gitmodules`

- [ ] **Step 1: 添加 submodule**

Run from repo root:
```bash
cd /Users/luluen/ai-project/bridge-management
git submodule add https://github.com/Anduin2017/HowToCook apps/web/vendor/howtocook
git submodule absorbgitdirs 2>/dev/null || true
```
Expected: `apps/web/vendor/howtocook/` 出现,含 `dishes/` 目录;`.gitmodules` 新增条目。

- [ ] **Step 2: 验证 dishes 内容存在**

```bash
ls apps/web/vendor/howtocook/dishes | head
find apps/web/vendor/howtocook/dishes -name "*.md" | wc -l
```
Expected: 列出 `aquatic breakfast condiment dessert drink meat_dish ...`;md 计数约 369。

- [ ] **Step 3: Commit**

```bash
git add .gitmodules apps/web/vendor/howtocook
git commit -m "chore: 引入 HowToCook 菜谱 submodule 作为本地数据源"
```

---

## Task 2: 编写同步脚本 `sync-howtocook.mjs`

**Files:**
- Create: `apps/web/scripts/sync-howtocook.mjs`

- [ ] **Step 1: 创建脚本**

```bash
mkdir -p apps/web/scripts
```

写入 `apps/web/scripts/sync-howtocook.mjs`:

```javascript
// 把 HowToCook submodule 的 dishes/ 同步到 public/ 下作为静态资源。
// 幂等:每次清空目标再拷贝。带守卫:源缺失或拷贝后 md 数为 0 则非零退出。
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SRC = join(ROOT, "apps/web/vendor/howtocook/dishes");
const DEST = join(ROOT, "apps/web/public/howtocook/dishes");

if (!existsSync(SRC)) {
  console.error(`[sync-howtocook] 源目录不存在: ${SRC}`);
  console.error("请先运行: git submodule update --init --recursive");
  process.exit(1);
}

rmSync(join(ROOT, "apps/web/public/howtocook"), { recursive: true, force: true });
cpSync(SRC, DEST, { recursive: true });

function countMd(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countMd(join(dir, entry.name));
    else if (entry.name.endsWith(".md")) n += 1;
  }
  return n;
}

const mdCount = countMd(DEST);
const imgCount = (() => {
  let n = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (/\.(jpe?g|png|webp|gif)$/i.test(entry.name)) n += 1;
    }
  };
  walk(DEST);
  return n;
})();

if (mdCount === 0) {
  console.error("[sync-howtocook] 拷贝后未发现任何 .md,同步失败");
  process.exit(1);
}

console.log(`[sync-howtocook] 同步完成: ${mdCount} 道菜谱, ${imgCount} 张图片 -> ${DEST}`);
```

- [ ] **Step 2: 接入 package.json 脚本**

读取 `apps/web/package.json`,把 `scripts` 改为:

```json
"scripts": {
  "dev": "next dev",
  "predev": "node scripts/sync-howtocook.mjs",
  "build": "next build --webpack",
  "prebuild": "node scripts/sync-howtocook.mjs",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "sync:recipes": "node scripts/sync-howtocook.mjs"
},
```

- [ ] **Step 3: 运行同步脚本验证**

```bash
cd apps/web && node scripts/sync-howtocook.mjs
ls public/howtocook/dishes | head
find public/howtocook/dishes -name "*.md" | wc -l
```
Expected: 打印 `同步完成: ~369 道菜谱, ~350 张图片`;目录列出分类;md 计数约 369。

- [ ] **Step 4: 配置 .gitignore 忽略派生产物**

在仓库根 `.gitignore` 末尾追加(若已有类似条目则跳过):
```
# HowToCook 同步产物(由 sync-howtocook.mjs 生成)
apps/web/public/howtocook/
```

验证未被跟踪:
```bash
git status --short apps/web/public/howtocook/
```
Expected: 无输出(已被忽略)。

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/sync-howtocook.mjs apps/web/package.json .gitignore
git commit -m "feat(howtocook): 同步脚本把 dishes 拷为静态资源并接入 predev/prebuild"
```

---

## Task 3: 创建测试 fixture

为避免单测依赖 submodule,用真实菜谱样本建固定 fixture(选有图的,以验证图片解析路径)。

**Files:**
- Create: `apps/web/src/lib/__fixtures__/howtocook/dishes/vegetable_dish/西红柿炒鸡蛋.md`(无图样本,验证空字段)
- Create: `apps/web/src/lib/__fixtures__/howtocook/dishes/meat_dish/麻婆豆腐/麻婆豆腐.md`(有图样本)
- Create: `apps/web/src/lib/__fixtures__/howtocook/dishes/meat_dish/麻婆豆腐/1.jpeg`(占位图)

- [ ] **Step 1: 建无图 fixture — 西红柿炒鸡蛋(真实样本精简)**

```bash
mkdir -p apps/web/src/lib/__fixtures__/howtocook/dishes/vegetable_dish
```

写入 `apps/web/src/lib/__fixtures__/howtocook/dishes/vegetable_dish/西红柿炒鸡蛋.md`:

```markdown
# 西红柿炒鸡蛋的做法

一道酸甜开胃的家常菜肴。

预估烹饪难度：★★

预估卡路里：252 大卡

## 必备原料和工具

* 西红柿
* 鸡蛋
* 食用油
* 盐

## 计算

* 西红柿 = 1 个 * 份数
* 鸡蛋 = 1.5 个 * 份数

## 操作

1. 西红柿洗净
2. 西红柿去蒂，切成小块
3. 将鸡蛋打入碗中，加入 `1g` 的盐，搅匀
4. 热锅，加入食用油
5. 油热后，倒入鸡蛋液，翻炒至结为固体
6. 关火。将鸡蛋盛盘
7. 加入西红柿块，翻炒至软烂
8. 加入鸡蛋，翻炒均匀
9. 关火，盛盘

## 附加内容

- 可以加入 10ml 番茄酱增加汤汁

如果您遵循本指南的制作流程而发现有问题或可以改进的流程，请提出 Issue 或 Pull request 。
```

- [ ] **Step 2: 建有图 fixture — 麻婆豆腐(真实样本精简)**

```bash
mkdir -p apps/web/src/lib/__fixtures__/howtocook/dishes/meat_dish/麻婆豆腐
```

写入 `apps/web/src/lib/__fixtures__/howtocook/dishes/meat_dish/麻婆豆腐/麻婆豆腐.md`:

```markdown
# 麻婆豆腐的做法

![麻婆豆腐-预览图-1](./1.jpeg)

这道香辣滑嫩的豆腐菜。

预估烹饪难度：★★★

预估卡路里：476 大卡

## 必备原料和工具

- 内脂豆腐
- 咸鸭蛋
- 五花肉
- 大蒜
- 生姜

## 计算

- 1 盒内脂豆腐
- 1 枚咸鸭蛋
- 20-30g 五花肉

## 操作

1. 大蒜和生姜切碎，备用
2. 五花肉切成肉糜
3. 鸭蛋对半切开，去除蛋黄，蛋白捣碎
4. 豆腐划成小块
5. 热锅放入食用油
6. 放入大蒜、生姜翻炒
7. 放入肉糜翻炒
8. 放入豆腐
9. 倒入开水，中火煮 10 分钟
10. 关火，盛盘

## 附加内容

- 期间注意防止糊锅

如果您遵循本指南的制作流程而发现有问题或可以改进的流程，请提出 Issue 或 Pull request 。
```

- [ ] **Step 3: 建占位图片**

创建一个最小的合法 jpeg(1x1)作为占位:
```bash
printf '\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xdb\x00C\x00\x08\xff\xd9' > apps/web/src/lib/__fixtures__/howtocook/dishes/meat_dish/麻婆豆腐/1.jpeg
```

- [ ] **Step 4: 验证 fixture 就绪**

```bash
cd apps/web && find src/lib/__fixtures__/howtocook -type f
```
Expected: 列出 `西红柿炒鸡蛋.md`、`麻婆豆腐/麻婆豆腐.md`、`麻婆豆腐/1.jpeg`。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/__fixtures__
git commit -m "test(howtocook): 添加菜谱解析测试 fixture(含图/无图样本)"
```

---

## Task 4: 实现 `howtocook.ts` 的解析与匹配(TDD)

这是核心任务,采用 TDD:先写失败测试,再实现。

**Files:**
- Create: `apps/web/src/lib/howtocook.ts`
- Test: `apps/web/src/lib/howtocook.test.ts`

- [ ] **Step 1: 写失败测试 — `howtocook.test.ts`**

写入 `apps/web/src/lib/howtocook.test.ts`:

```typescript
import { describe, expect, it, beforeAll } from "vitest";

import {
  searchRecipes,
  getRecipeDetail,
  type HowToCookRecipeDetail,
} from "@/lib/howtocook";

// 用 fixture 目录而非 submodule,保证测试独立可重复
beforeAll(() => {
  process.env.HOWTOCOOK_DIR = "src/lib/__fixtures__/howtocook/dishes";
});

describe("howtocook parse — 西红柿炒鸡蛋(无图)", () => {
  let detail: HowToCookRecipeDetail | null;
  beforeAll(async () => {
    detail = await getRecipeDetail("vegetable_dish/西红柿炒鸡蛋");
  });

  it("解析菜名(去掉「的做法」)", () => {
    expect(detail?.name).toBe("西红柿炒鸡蛋");
  });

  it("解析难度星为 score", () => {
    expect(detail?.score).toBe("★★");
  });

  it("解析卡路里为 cooked", () => {
    expect(detail?.cooked).toBe("252 大卡");
  });

  it("无图时 cover 为空字符串", () => {
    expect(detail?.cover).toBe("");
  });

  it("解析原料包含西红柿、鸡蛋", () => {
    const names = detail?.ingredients.map((i) => i.name) ?? [];
    expect(names).toContain("西红柿");
    expect(names).toContain("鸡蛋");
  });

  it("解析操作步骤(≥5 步,首步含「洗净」)", () => {
    expect(detail?.steps.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(detail?.steps[0].desc).toContain("洗净");
  });

  it("解析小贴士且剥离模板致谢语", () => {
    expect(detail?.tips).toContain("番茄酱");
    expect(detail?.tips).not.toContain("Pull request");
  });
});

describe("howtocook parse — 麻婆豆腐(有图)", () => {
  let detail: HowToCookRecipeDetail | null;
  beforeAll(async () => {
    detail = await getRecipeDetail("meat_dish/麻婆豆腐/麻婆豆腐");
  });

  it("解析封面图为 /howtocook 路径", () => {
    expect(detail?.cover).toBe("/howtocook/dishes/meat_dish/麻婆豆腐/1.jpeg");
  });

  it("难度三星", () => {
    expect(detail?.score).toBe("★★★");
  });

  it("步骤 ≥10 步", () => {
    expect(detail?.steps.length ?? 0).toBeGreaterThanOrEqual(10);
  });

  it("url 指向 GitHub 源", () => {
    expect(detail?.url).toContain("github.com/Anduin2017/HowToCook");
  });
});

describe("howtocook searchRecipes 匹配", () => {
  it("同义词召回:番茄炒蛋 → 西红柿炒鸡蛋", async () => {
    const results = await searchRecipes("番茄炒蛋");
    expect(results.some((r) => r.name === "西红柿炒鸡蛋")).toBe(true);
  });

  it("精确命中:麻婆豆腐", async () => {
    const results = await searchRecipes("麻婆豆腐");
    expect(results[0].name).toBe("麻婆豆腐");
  });

  it("无命中返回空数组(交由 LLM 兜底)", async () => {
    const results = await searchRecipes("完全不存在的乱码菜xyz123");
    expect(results).toEqual([]);
  });

  it("未知 id 返回 null", async () => {
    expect(await getRecipeDetail("不存在/的菜")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/web && npx vitest run src/lib/howtocook.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/howtocook'`。

- [ ] **Step 3: 实现 `howtocook.ts`**

写入 `apps/web/src/lib/howtocook.ts`:

```typescript
import "server-only";

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, basename, extname, relative, sep } from "node:path";

// ---- 对外类型(与 xiachufang 同形状,drop-in 替换) ----
export type HowToCookSearchResult = {
  id: string;
  name: string;
  url: string;
  cover: string;
  score: string;
  cooked: string;
};

export type HowToCookIngredient = { name: string; unit: string };

export type HowToCookStep = { step: number; desc: string; img: string };

export type HowToCookRecipeDetail = {
  id: string;
  name: string;
  url: string;
  cover: string;
  score: string;
  cooked: string;
  ingredients: HowToCookIngredient[];
  steps: HowToCookStep[];
  tips: string;
};

// ---- 配置 ----
const PUBLIC_PREFIX = "/howtocook/dishes";
const GITHUB_BLOB = "https://github.com/Anduin2017/HowToCook/blob/master";
const MIN_BIGRAM_JACCARD = 0.15;

// 同义词归一(查询与建索引都先过此表)
const SYNONYMS: Array<[RegExp, string]> = [
  [/番茄/g, "西红柿"],
  [/马铃薯/g, "土豆"],
  [/里脊/g, "瘦肉"],
  [/元葱/g, "洋葱"],
  [/地瓜/g, "红薯"],
  [/苞菜|卷心菜/g, "圆白菜"],
  [/朝天椒/g, "小米椒"],
  [/蛋清/g, "鸡蛋白"],
];

// ---- 索引单例(沿用项目 globalThis 单例模式) ----
type Index = Map<string, HowToCookRecipeDetail>;

const globalForIndex = globalThis as unknown as { __howtocookIndex?: Index; __howtocookBuilt?: boolean };

function dishesRoot(): string {
  return process.env.HOWTOCOOK_DIR
    ? join(process.cwd(), process.env.HOWTOCOOK_DIR)
    : join(process.cwd(), "public", "howtocook", "dishes");
}

function buildIndex(): Index {
  if (globalForIndex.__howtocookIndex && globalForIndex.__howtocookBuilt) {
    return globalForIndex.__howtocookIndex;
  }
  const index: Index = new Map();
  const root = dishesRoot();
  if (!existsSync(root)) {
    globalForIndex.__howtocookIndex = index;
    globalForIndex.__howtocookBuilt = true;
    return index;
  }
  walkMd(root, root, index);
  globalForIndex.__howtocookIndex = index;
  globalForIndex.__howtocookBuilt = true;
  return index;
}

function walkMd(dir: string, root: string, index: Index) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMd(full, root, index);
    } else if (entry.name.endsWith(".md")) {
      const detail = parseRecipe(full, root);
      if (detail) index.set(detail.id, detail);
    }
  }
}

// ---- 解析 ----
function parseRecipe(absPath: string, root: string): HowToCookRecipeDetail | null {
  let text: string;
  try {
    text = readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
  const relPath = relative(root, absPath).split(sep).join("/");
  const id = relPath.replace(/\.md$/i, "");

  // H1 标题 → 菜名
  const h1 = text.match(/^#\s*(.+?)$/m);
  let name = h1 ? h1[1].trim().replace(/的做法$/, "").trim() : basename(absPath, ".md");

  // 封面:首个 markdown 图片引用(相对路径)
  const imgRef = text.match(/!\[[^\]]*\]\((\.\.?\/[^)]+|[^)]+\.(?:jpe?g|png|webp|gif))\)/i);
  let cover = "";
  if (imgRef) {
    const imgPath = imgRef[1].replace(/^\.\//, "");
    cover = `${PUBLIC_PREFIX}/${dirname(relPath)}/${imgPath}`.replace(/\/+/g, "/");
  }

  // 难度
  const diffMatch = text.match(/预估烹饪难度[:：]\s*([★☆]+)/);
  const score = diffMatch ? diffMatch[1] : "";

  // 卡路里
  const calMatch = text.match(/预估卡路里[:：]\s*(\d+)\s*大卡/);
  const cooked = calMatch ? `${calMatch[1]} 大卡` : "";

  // 原料:合并「必备原料和工具」与「计算」
  const ingredients = extractIngredients(text);

  // 步骤:「操作」
  const steps = extractSteps(text);

  // 小贴士:「附加内容」,剥离模板语
  const tips = extractTips(text);

  const url = `${GITHUB_BLOB}/dishes/${relPath}`;

  return { id, name, url, cover, score, cooked, ingredients, steps, tips };
}

function section(text: string, header: string): string {
  // 取 ## header 到下一个 ## 或文末
  const re = new RegExp(`##\\s*${header}\\s*([\\s\\S]*?)(?=\\n##\\s|$)`, "m");
  const m = text.match(re);
  return m ? m[1] : "";
}

function extractIngredients(text: string): HowToCookIngredient[] {
  const raw = section(text, "必备原料和工具") + "\n" + section(text, "计算");
  const names = new Map<string, string>(); // name -> unit(可被「计算」覆盖)
  // 必备原料:列表项
  for (const line of section(text, "必备原料和工具").split("\n")) {
    const m = line.match(/^\s*[*\-+]\s+(.+)/);
    if (m) {
      const n = stripInline(m[1]).replace(/[（(].*?[)）].*$/, "").trim();
      if (n && !names.has(n)) names.set(n, "");
    }
  }
  // 计算:尽量抽出用量(如 "1 盒内脂豆腐" → 内脂豆腐 / 1 盒)
  for (const line of section(text, "计算").split("\n")) {
    const m = line.match(/^\s*[*\-+]\s+(.+?)[\s=]+(.+)/);
    if (m) {
      const qtyPart = stripInline(m[1]).trim(); // 如 "1 盒" 或 "20-30g"
      const namePart = stripInline(m[2]).replace(/[（(].*?[)）].*$/, "").trim();
      const cleanedName = namePart.split(/\s+/)[0];
      if (cleanedName) names.set(cleanedName, qtyPart);
    }
  }
  return [...names.entries()].map(([name, unit]) => ({ name, unit }));
}

function extractSteps(text: string): HowToCookStep[] {
  const block = section(text, "操作");
  const steps: HowToCookStep[] = [];
  let current: HowToCookStep | null = null;
  for (const line of block.split("\n")) {
    const top = line.match(/^\s*(\d+)\.\s+(.+)/);
    if (top) {
      if (current) steps.push(current);
      current = { step: parseInt(top[1], 10), desc: stripInline(top[2]).trim(), img: "" };
    } else {
      const sub = line.match(/^\s*[-*+]\s+(.+)/);
      if (sub && current) {
        current.desc += `\n- ${stripInline(sub[1]).trim()}`;
      }
    }
  }
  if (current) steps.push(current);
  // 重排连续编号(防止源 md 编号跳号)
  return steps.map((s, i) => ({ ...s, step: i + 1 }));
}

function extractTips(text: string): string {
  const block = section(text, "附加内容");
  const cleaned = block
    .replace(/如果您遵循本指南[\s\S]*?(Issue|Pull request)[\s\S]*?[。.]?\s*$/m, "")
    .trim();
  return cleaned;
}

function stripInline(s: string): string {
  return s.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").trim();
}

// ---- 匹配 ----
function normalize(s: string): string {
  let r = (s || "").toLocaleLowerCase("zh-CN").replace(/\s+/g, "").replace(/的做法$/, "");
  for (const [re, rep] of SYNONYMS) r = r.replace(re, rep);
  return r;
}

function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// ---- 对外函数(与 xiachufang 同签名,async 兼容) ----
export async function getRecipeDetail(recipeId: string): Promise<HowToCookRecipeDetail | null> {
  const index = buildIndex();
  return index.get(recipeId) ?? null;
}

export async function searchRecipes(keyword: string, limit = 6): Promise<HowToCookSearchResult[]> {
  const index = buildIndex();
  const kw = normalize(keyword);
  if (!kw) return [];

  const scored: Array<{ detail: HowToCookRecipeDetail; score: number; key: string }> = [];
  const seenVariant = new Map<string, number>(); // 菜名 → 已选最高分(变体去重)

  for (const detail of index.values()) {
    const dishNorm = normalize(detail.name);
    let s = 0;
    if (dishNorm === kw) s = 1.0;
    else if (dishNorm.includes(kw) || kw.includes(dishNorm)) s = 0.8;
    else s = jaccard(bigrams(kw), bigrams(dishNorm)) * 0.5;

    if (s >= MIN_BIGRAM_JACCARD || s >= 0.8) {
      const prev = seenVariant.get(detail.name);
      if (prev === undefined || s > prev) {
        seenVariant.set(detail.name, s);
        scored.push({ detail, score: s, key: detail.name });
      }
    }
  }

  // 变体去重:同一菜名只保留最高分
  const bestPerName = new Map<string, { detail: HowToCookRecipeDetail; score: number }>();
  for (const item of scored) {
    const cur = bestPerName.get(item.key);
    if (!cur || item.score > cur.score) bestPerName.set(item.key, item);
  }

  return [...bestPerName.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ detail }) => ({
      id: detail.id,
      name: detail.name,
      url: detail.url,
      cover: detail.cover,
      score: detail.score,
      cooked: detail.cooked,
    }));
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd apps/web && npx vitest run src/lib/howtocook.test.ts
```
Expected: 全部 PASS(解析 7 + 有图 4 + 匹配 4 = 15 用例)。

如有用例失败,优先调整解析正则或同义词表,而非放宽断言。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/howtocook.ts apps/web/src/lib/howtocook.test.ts
git commit -m "feat(howtocook): 实现本地 Markdown 解析、内存索引与模糊匹配"
```

---

## Task 5: 切换 `recipes.ts` 到 howtocook

**Files:**
- Modify: `apps/web/src/lib/recipes.ts`(import 与函数名)
- Delete: `apps/web/src/lib/xiachufang.ts`

- [ ] **Step 1: 改 import(第 9 行)**

把:
```typescript
import { getXiachufangRecipeDetail, searchXiachufang } from "@/lib/xiachufang";
```
改为:
```typescript
import { getRecipeDetail, searchRecipes } from "@/lib/howtocook";
```

- [ ] **Step 2: 改调用点 — `recipes.ts:157`**

把:
```typescript
        const searchResults = await searchXiachufang(dish.name, 3);
```
改为:
```typescript
        const searchResults = await searchRecipes(dish.name, 3);
```

- [ ] **Step 3: 改调用点 — `recipes.ts:167`**

把:
```typescript
          const detail = await getXiachufangRecipeDetail(match.id);
```
改为:
```typescript
          const detail = await getRecipeDetail(match.id);
```

- [ ] **Step 4: 删除 xiachufang.ts**

```bash
git rm apps/web/src/lib/xiachufang.ts
```

- [ ] **Step 5: 验证无残留引用**

```bash
cd apps/web && grep -rn "xiachufang\|Xiachufang\|getXiachufangRecipeDetail\|searchXiachufang" src || echo "无残留"
```
Expected: 打印 `无残留`。

- [ ] **Step 6: 类型检查 + 测试**

```bash
cd apps/web && npx tsc --noEmit && npx vitest run
```
Expected: tsc 无错;所有测试通过(含 recipes.test.ts 与 howtocook.test.ts)。

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/recipes.ts
git commit -m "refactor(recipes): 推荐增强层切换到 howtocook,移除 xiachufang 抓取"
```

---

## Task 6: 切换收藏 API 并删除参考库

**Files:**
- Modify: `apps/web/src/app/api/favorites/route.ts`
- Delete: `references/xiachufang-api/`(若存在)

- [ ] **Step 1: 改 import(第 6 行)**

把:
```typescript
import { getXiachufangRecipeDetail } from "@/lib/xiachufang";
```
改为:
```typescript
import { getRecipeDetail } from "@/lib/howtocook";
```

- [ ] **Step 2: 改调用点 + 注释(第 47-49 行)**

把:
```typescript
    // If recipeId exists and steps are missing, attempt to pull details from Xiachufang
    if (recipeId && (!steps.length || !ingredients.length)) {
      const detail = await getXiachufangRecipeDetail(recipeId);
```
改为:
```typescript
    // If recipeId exists and steps are missing, attempt to pull details from HowToCook
    if (recipeId && (!steps.length || !ingredients.length)) {
      const detail = await getRecipeDetail(recipeId);
```

- [ ] **Step 3: 删除未接入的 Python 参考库**

```bash
git rm -r references/xiachufang-api 2>/dev/null && echo "已删除" || echo "目录不存在,跳过"
```

- [ ] **Step 4: 全仓 grep 确认无残留**

```bash
cd /Users/luluen/ai-project/bridge-management
grep -rni "xiachufang\|下厨房" apps/web/src references 2>/dev/null | grep -v node_modules || echo "无残留"
```
Expected: 打印 `无残留`(`apps/web/src` 与 `references` 中;README/文档的文案在 Task 8 单独处理)。

- [ ] **Step 5: 类型检查**

```bash
cd apps/web && npx tsc --noEmit
```
Expected: 无错。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/favorites/route.ts
git commit -m "refactor(favorites): 收藏补全切换到 howtocook,删除 xiachufang 参考库"
```

---

## Task 7: 调整 UI 标签与移除 referrerPolicy

**Files:**
- Modify: `apps/web/src/components/meal-recommendations.tsx`
- Modify: `apps/web/src/components/favorites-view.tsx`

字段语义重映射:`score`(难度星)、`cooked`(卡路里)。空字段降级逻辑已存在(`dish.cover &&` 等),本次只改标签与移除防盗链属性。

- [ ] **Step 1: meal-recommendations.tsx — 顶部文案(第 111 行)**

把:
```
优先临期和已开封食材；下厨房精选菜谱，指导你看着页面做饭。
```
改为:
```
优先临期和已开封食材；开源家常菜谱，指导你看着页面做饭。
```

- [ ] **Step 2: meal-recommendations.tsx — 加载文案(第 181 行)**

把:
```
正在分析库存与下厨房菜谱…
```
改为:
```
正在分析库存与开源菜谱…
```

- [ ] **Step 3: meal-recommendations.tsx — 卡片评分 chip(第 227-231 行)**

把:
```tsx
                {dish.score && (
                  <span className="absolute left-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-amber-300 backdrop-blur-md">
                    ⭐ {dish.score} 分
                  </span>
                )}
```
改为:
```tsx
                {dish.score && (
                  <span className="absolute left-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-amber-300 backdrop-blur-md">
                    难度 {dish.score}
                  </span>
                )}
```

- [ ] **Step 4: meal-recommendations.tsx — 卡片 cooked chip(第 232-236 行)**

cooked 现为卡路里,加个 emoji 前缀更直观。把:
```tsx
                {dish.cooked && (
                  <span className="absolute right-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">
                    {dish.cooked}
                  </span>
                )}
```
改为:
```tsx
                {dish.cooked && (
                  <span className="absolute right-2.5 top-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">
                    🔥 {dish.cooked}
                  </span>
                )}
```

- [ ] **Step 5: meal-recommendations.tsx — 移除 3 处 referrerPolicy**

第 226 行卡片封面:
```tsx
                <img src={dish.cover} alt={dish.name} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
```
→ 删除 ` referrerPolicy="no-referrer"`。

第 426 行模态封面:
```tsx
            <img src={recipe.cover} alt={recipe.name} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
```
→ 删除 ` referrerPolicy="no-referrer"`。

第 478 行步骤图:
```tsx
                        <img src={step.img} alt={`步骤 ${step.step}`} referrerPolicy="no-referrer" className="max-h-72 w-full object-cover" />
```
→ 删除 ` referrerPolicy="no-referrer"`。

- [ ] **Step 6: meal-recommendations.tsx — 模态评分文案(第 437-438 行)**

把:
```tsx
              {recipe.score && <span>⭐ 下厨房 {recipe.score} 分</span>}
              {recipe.cooked && <span>· {recipe.cooked}</span>}
```
改为:
```tsx
              {recipe.score && <span>难度 {recipe.score}</span>}
              {recipe.cooked && <span>· 🔥 {recipe.cooked}</span>}
```

- [ ] **Step 7: favorites-view.tsx — 移除 referrerPolicy(第 106 行) + 标签(第 127 行)**

第 106 行:
```tsx
                  <img src={recipe.cover} alt={recipe.name} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
```
→ 删除 ` referrerPolicy="no-referrer"`。

第 127 行:
```tsx
                  {recipe.score && <p className="mt-1 text-xs font-semibold text-amber-600">⭐ {recipe.score} 分</p>}
```
改为:
```tsx
                  {recipe.score && <p className="mt-1 text-xs font-semibold text-amber-600">难度 {recipe.score}</p>}
```

- [ ] **Step 8: 验证无残留 referrerPolicy 与下厨房文案**

```bash
cd apps/web && grep -rn 'referrerPolicy\|下厨房' src/components || echo "无残留"
```
Expected: 打印 `无残留`。

- [ ] **Step 9: 类型检查 + lint**

```bash
cd apps/web && npx tsc --noEmit && npm run lint
```
Expected: 无错。

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/meal-recommendations.tsx apps/web/src/components/favorites-view.tsx
git commit -m "feat(ui): 菜谱标签改为难度/卡路里,文案改开源菜谱,移除下厨房防盗链属性"
```

---

## Task 8: 更新 README 并做构建冒烟

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 更新 README 中下厨房相关描述**

定位 README 中"下厨房"字样(约第 3、27-29、48-50 行)。把"下厨房菜谱生态""连接下厨房开源 API"等描述改为:

```
## 菜谱数据

菜谱增强层基于开源项目 [HowToCook](https://github.com/Anduin2017/HowToCook)(Unlicense,无版权风险),
以 git submodule 形式内嵌,离线可用。首次克隆或拉取后请初始化 submodule:

    git submodule update --init --recursive

开发与构建时会自动运行 `sync-howtocook.mjs` 把菜谱与图片同步到 `public/howtocook/`。
```

- [ ] **Step 2: 全量构建冒烟(验证 prebuild 同步 + 类型 + 打包)**

```bash
cd apps/web && rm -rf public/howtocook && npm run build
```
Expected: 构建前自动打印 `[sync-howtocook] 同步完成`;构建成功无错。

- [ ] **Step 3: 全量测试**

```bash
cd apps/web && npm run test
```
Expected: 全绿(含 recipes.test.ts、howtocook.test.ts)。

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README 更新为 HowToCook 数据源说明与 submodule 初始化"
```

---

## Self-Review 记录(写计划后已核对)

- **Spec 覆盖**:§3 规范 → Task 4 解析;§5 架构 → Task 4/5/6;§6.1 submodule+同步 → Task 1/2;§6.3 匹配 → Task 4;§6.5 兜底 → Task 5(沿用不动);§7 字段重映射 → Task 7;§8 UI → Task 7;§9 删除项 → Task 5/6;§10 测试 → Task 3/4;§11 风险(prebuild 守卫)→ Task 2 Step 1 脚本;§12 验收 → Task 8。全覆盖。
- **类型一致性**:`HowToCookRecipeDetail`、`searchRecipes`、`getRecipeDetail` 在 Task 4 定义,Task 5/6 调用名一致;`score`/`cooked` 语义在 Task 7 一致应用。
- **已知权衡(已记入 spec §11)**:封面命中率约 49%、步骤图约 15%;空字段降级 UI 已支持,Task 7 不新增占位图逻辑,符合用户"正常开发即可"的指示。

---

## 执行交接

计划已保存到 `docs/superpowers/plans/2026-07-31-howtocook-recipe-api.md`。
