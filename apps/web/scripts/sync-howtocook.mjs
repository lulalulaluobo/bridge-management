// 把 HowToCook submodule 的 dishes/ 同步到 public/ 下作为静态资源。
// 幂等:每次清空目标再拷贝。带守卫:源缺失或拷贝后 md 数为 0 则非零退出。
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// process.cwd() 在 apps/web 下(npm 脚本均从该目录运行),路径相对它计算。
const ROOT = process.cwd();
const SRC = join(ROOT, "vendor/howtocook/dishes");
const DEST = join(ROOT, "public/howtocook/dishes");

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
