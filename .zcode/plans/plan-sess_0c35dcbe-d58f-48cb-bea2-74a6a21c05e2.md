# 移植 v2 两个功能到当前项目

## 背景

v2 项目(`bridge-management-v2`)最近实现了两个功能,本次把它们移植到当前项目(`bridge-management`)。已确认两处代码结构一致,可近乎逐行移植:
- **功能一(换一批菜谱)**:在 v2 提交 `ebd32e5` 中,已提交。
- **功能二(图库替代拍照)**:在 v2 工作区未提交改动中(`inventory-dashboard.tsx`)。

v2 用 PostgreSQL+Drizzle,当前用 SQLite——但**这两个功能都不涉及数据库**,纯前端 + LLM prompt + API body 字段,故无适配障碍。

---

## 功能一:推荐菜谱"换一批"(差异化二次推荐)

### 核心机制
用户点"换一批"时,把当前这批菜名加入**今日排除列表**(localStorage,按自然日过期重置),带着排除清单重新请求推荐;LLM 被明确要求严禁推荐这些菜或同义菜,并提高 temperature(0.4→0.7)增加差异。

### 改动 4 处(逐行对照 v2)

**1. `apps/web/src/lib/recipes.ts`**
- `RecommendationParams` 增加 `excludeDishes?: string[]`(line 52-56)
- 新增 `excludeContext`(line 97 后):`严禁推荐以下菜品或与其高度相似的同义菜品：${excludeDishes.join("、")}`
- `temperature`(line 106):`params.excludeDishes?.length ? 0.7 : 0.4`
- system 第二条消息末尾拼接 `${excludeContext}`(line 124)
- user 消息(line 126):改为带排除提示的版本——`...推荐最适合的菜。` + (有排除时)`\n请注意:本次推荐中,严禁包含以下任何菜品或与其高度相似的同义菜品:${excludeDishes.join("、")}。如果无法找到足够的新菜,可以推荐包含缺失食材的菜,但绝不能包含上述已排除的菜品。`

**2. `apps/web/src/app/api/recommendations/route.ts`**
- body 类型加 `excludeDishes?: string[]`(line 13)
- params 透传 `excludeDishes: body.excludeDishes`(line 27 后)

**3. `apps/web/src/components/meal-recommendations.tsx`**
- 新增 3 个工具函数 + `EXCLUDE_STORAGE_KEY` 常量(文件顶部):`getExcludeDishes()`(读今日排除,按日期判断过期)、`saveExcludeDishes()`、`clearExcludeDishes()`
- `recommend()`(line 50)开头加 `clearExcludeDishes()`(首次/重新推荐清空排除)
- 新增 `recommendMore()` 函数:取当前菜名 + 已有排除 → 合并去重存入 → 带 `excludeDishes` 请求 → 更新结果
- 渲染区(line 190-197):`results &&` 块改为 Fragment,在 `MealRecommendationCards` 后加"🔄 不合口味,换一批菜谱"按钮(绑定 `recommendMore`,`disabled={busy}`)

### 不做的事
- 不改 `recipes.test.ts`(它只测 `assertSafeRecommendations`,与排除无关)
- 不加新测试(excludeDishes 是纯 prompt 参数透传,无独立逻辑单元可测;前端为 UI 行为)

---

## 功能二:图像识别用图库(拍照+相册)替代纯拍照

### 核心机制
移动端 `<input type="file" accept="image/*" capture="environment">` 中,`capture` 属性会**强制直接调起相机**,跳过相册选择。去掉 `capture` 后,系统会弹出"拍照/从相册选择"的选项,两者都支持。

### 改动 1 处:`apps/web/src/components/inventory-dashboard.tsx`(line 289)
- `<input>` 去掉 `capture="environment"`(保留 `accept="image/*"`)
- 图标 `Icon name="camera"` → `name="image"`
- `aria-label="拍照识别"` → `aria-label="拍照与图片识别"`,加 `title="拍照与图片识别"`
- Icon 组件(line 401-404):
  - `IconName` 类型加 `"image"`
  - `paths` 加 `image` 定义:`<><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>`(标准相册图标,与 v2 完全一致)
  - 保留 `camera` 图标定义(其他地方可能还在用,不删)

---

## 验证
- `npx tsc --noEmit`(类型检查)
- `npm run test`(确保现有 31 测试不回归)
- `npm run lint`(确认无新 lint 错误)
- 手动:启动 dev,验证①点"换一批"得到不同菜、再点继续排除;②点图片按钮在手机上弹出拍照/相册选项(桌面端弹出文件选择器)

## 提交策略
两个功能各一个提交,清晰可回滚:
1. `feat(recipes): 推荐菜谱支持"换一批"差异化二次推荐(今日排除按自然日重置)`
2. `feat(ui): 图像识别支持拍照与相册选择(去除强制相机调起)`

在当前 `master` 上建新分支 `feat/recipe-refresh-and-gallery` 实现。