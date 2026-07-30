import "server-only";

export type XiachufangSearchResult = {
  id: string;
  name: string;
  url: string;
  cover: string;
  score: string;
  cooked: string;
};

export type XiachufangIngredient = {
  name: string;
  unit: string;
};

export type XiachufangStep = {
  step: number;
  desc: string;
  img: string;
};

export type XiachufangRecipeDetail = {
  id: string;
  name: string;
  url: string;
  cover: string;
  score: string;
  cooked: string;
  ingredients: XiachufangIngredient[];
  steps: XiachufangStep[];
  tips: string;
};

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function searchXiachufang(keyword: string, limit = 6): Promise<XiachufangSearchResult[]> {
  try {
    const url = `https://www.xiachufang.com/search/?keyword=${encodeURIComponent(keyword)}`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 3600 } });
    if (!response.ok) return [];
    const html = await response.text();

    const results: XiachufangSearchResult[] = [];
    const liRegex = /<li[^>]*>\s*<div class="recipe[^"]*"[\s\S]*?<\/div>\s*<\/li>/gi;
    const matches = html.match(liRegex) || [];

    for (const block of matches.slice(0, limit)) {
      const urlMatch = block.match(/href="(\/recipe\/\d+\/)"/);
      const nameMatch = block.match(/<p class="name">\s*<a[^>]*>([\s\S]*?)<\/a>/);
      const imgMatch = block.match(/<img[^>]+(?:data-src|src)="([^"]+)"/);
      const scoreMatch = block.match(/<span class="score[^"]*">\s*([\d.]+)/) || block.match(/([\d.]+)\s*分/);
      const cookedMatch = block.match(/([\d.]+(?:万)?\s*人做过)/);

      if (urlMatch && nameMatch) {
        const path = urlMatch[1];
        const id = path.replace(/\/recipe\/|\//g, "");
        const rawName = nameMatch[1].replace(/<[^>]+>/g, "").trim();
        const cover = imgMatch ? imgMatch[1].replace(/@.*/, "") : "";
        const score = scoreMatch ? scoreMatch[1].trim() : "";
        const cooked = cookedMatch ? cookedMatch[1].trim() : "";

        results.push({ id, name: rawName, url: `https://www.xiachufang.com${path}`, cover, score, cooked });
      }
    }
    return results;
  } catch (error) {
    console.error("Xiachufang search error:", error);
    return [];
  }
}

export async function getXiachufangRecipeDetail(recipeId: string): Promise<XiachufangRecipeDetail | null> {
  try {
    const id = recipeId.replace(/[^0-9]/g, "");
    if (!id) return null;
    const url = `https://www.xiachufang.com/recipe/${id}/`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, next: { revalidate: 86400 } });
    if (!response.ok) return null;
    const html = await response.text();

    const titleMatch = html.match(/<h1 class="page-title"[^>]*>\s*([\s\S]*?)\s*<\/h1>/);
    const name = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    const coverMatch = html.match(/<div class="cover[^"]*"[\s\S]*?<img [^>]*src="([^"]+)"/);
    const cover = coverMatch ? coverMatch[1] : "";

    const scoreMatch = html.match(/<span class="number">\s*([\d.]+)\s*<\/span>/);
    const score = scoreMatch ? scoreMatch[1].trim() : "";

    const cookedMatch = html.match(/<div class="cooked[^"]*"[\s\S]*?<span class="number">\s*([\s\S]*?)\s*<\/span>/);
    const cooked = cookedMatch ? cookedMatch[1].replace(/<[^>]+>/g, "").trim() + "人做过" : "";

    const ingredients: XiachufangIngredient[] = [];
    const ingBlockMatch = html.match(/<div class="ings"[^>]*>([\s\S]*?)<\/div>/);
    if (ingBlockMatch) {
      const trRegex = /<tr>\s*<td class="name">([\s\S]*?)<\/td>\s*<td class="unit">([\s\S]*?)<\/td>\s*<\/tr>/gi;
      let match: RegExpExecArray | null;
      while ((match = trRegex.exec(ingBlockMatch[1])) !== null) {
        const ingName = match[1].replace(/<[^>]+>/g, "").trim();
        const ingUnit = match[2].replace(/<[^>]+>/g, "").trim();
        if (ingName) ingredients.push({ name: ingName, unit: ingUnit });
      }
    }

    const steps: XiachufangStep[] = [];
    const stepsBlockMatch = html.match(/<div class="steps">([\s\S]*?)<\/div>\s*<\/div>/);
    if (stepsBlockMatch) {
      const liRegex = /<li class="container">\s*<p class="text"[^>]*>([\s\S]*?)<\/p>(?:[\s\S]*?<img src="([^"]+)")?/gi;
      let match: RegExpExecArray | null;
      let stepIndex = 1;
      while ((match = liRegex.exec(stepsBlockMatch[1])) !== null) {
        const desc = match[1].replace(/<[^>]+>/g, "").replace(/<br\s*\/?>/gi, "\n").trim();
        const img = match[2] || "";
        if (desc) {
          steps.push({ step: stepIndex++, desc, img });
        }
      }
    }

    const tipMatch = html.match(/<div class="tip"[^>]*>([\s\S]*?)<\/div>/);
    const tips = tipMatch ? tipMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    return { id, name, url, cover, score, cooked, ingredients, steps, tips };
  } catch (error) {
    console.error("Xiachufang recipe detail error:", error);
    return null;
  }
}
