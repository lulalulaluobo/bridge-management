import "server-only";

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, basename, relative, sep } from "node:path";

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
  if (existsSync(root)) {
    walkMd(root, root, index);
  }
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
  const name = h1 ? h1[1].trim().replace(/的做法$/, "").trim() : basename(absPath, ".md");

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
  // 取 ## header 到下一个 ## 或文末。注意:不能用 /m 标志,
  // 否则 $ 匹配每行行尾,非贪婪 *? 会在第一行行尾就停下。
  const re = new RegExp(`##\\s*${header}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  const m = text.match(re);
  return m ? m[1] : "";
}

function extractIngredients(text: string): HowToCookIngredient[] {
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
  const cleaned = block.replace(/如果您遵循本指南[\s\S]*?(Issue|Pull request)[\s\S]*?[。.]?\s*$/m, "").trim();
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

  // 菜名 → 已选最高分(变体去重)
  const bestPerName = new Map<string, { detail: HowToCookRecipeDetail; score: number }>();

  for (const detail of index.values()) {
    const dishNorm = normalize(detail.name);
    let s = 0;
    if (dishNorm === kw) s = 1.0;
    else if (dishNorm.includes(kw) || kw.includes(dishNorm)) s = 0.8;
    else s = jaccard(bigrams(kw), bigrams(dishNorm)) * 0.5;

    if (s >= MIN_BIGRAM_JACCARD || s >= 0.8) {
      const cur = bestPerName.get(detail.name);
      if (!cur || s > cur.score) bestPerName.set(detail.name, { detail, score: s });
    }
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
