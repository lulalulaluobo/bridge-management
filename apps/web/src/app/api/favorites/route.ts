import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/http";
import { getFavoritesStore } from "@/lib/favorites";
import { currentHouseholdId } from "@/lib/household";
import { getXiachufangRecipeDetail } from "@/lib/xiachufang";

export const runtime = "nodejs";

export async function GET() {
  try {
    const householdId = await currentHouseholdId();
    const store = getFavoritesStore(householdId);
    return NextResponse.json({ favorites: store.list() });
  } catch (error) {
    return errorResponse(error, "无法获取收藏菜谱列表");
  }
}

export async function POST(request: Request) {
  try {
    const householdId = await currentHouseholdId();
    const body = (await request.json()) as {
      recipeId?: string;
      name?: string;
      cover?: string;
      score?: string;
      cooked?: string;
      reason?: string;
      ingredients?: Array<{ name: string; unit: string; inStock?: boolean }>;
      steps?: Array<{ step: number; desc: string; img?: string }>;
      tips?: string;
    };

    let recipeId = body.recipeId || "";
    let name = body.name || "";
    let cover = body.cover || "";
    let score = body.score || "";
    let cooked = body.cooked || "";
    let reason = body.reason || "";
    let ingredients = body.ingredients || [];
    let steps = body.steps || [];
    let tips = body.tips || "";

    // If recipeId exists and steps are missing, attempt to pull details from Xiachufang
    if (recipeId && (!steps.length || !ingredients.length)) {
      const detail = await getXiachufangRecipeDetail(recipeId);
      if (detail) {
        if (!name) name = detail.name;
        if (!cover) cover = detail.cover;
        if (!score) score = detail.score;
        if (!cooked) cooked = detail.cooked;
        if (!ingredients.length) ingredients = detail.ingredients;
        if (!steps.length) steps = detail.steps;
        if (!tips) tips = detail.tips;
      }
    }

    if (!name) throw new Error("缺少菜谱名称");

    const store = getFavoritesStore(householdId);
    const saved = store.save({
      recipeId,
      name,
      cover,
      score,
      cooked,
      reason,
      ingredients,
      steps,
      tips,
    });

    return NextResponse.json({ saved });
  } catch (error) {
    return errorResponse(error, "无法收藏菜谱");
  }
}

export async function DELETE(request: Request) {
  try {
    const householdId = await currentHouseholdId();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) throw new Error("缺少菜谱 ID");

    const store = getFavoritesStore(householdId);
    const deleted = store.delete(id);

    return NextResponse.json({ success: deleted });
  } catch (error) {
    return errorResponse(error, "无法取消收藏");
  }
}
