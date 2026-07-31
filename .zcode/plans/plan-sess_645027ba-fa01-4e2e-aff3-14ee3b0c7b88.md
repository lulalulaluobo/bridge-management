## 在独立 worktree 中执行 PocketBase 全迁移

上一轮你已批准"直接全迁 PocketBase",现在新增一条:在独立 git worktree 里做,保证主分支 master 稳定、重构期间主分支仍可用。

### 本步动作(仅环境准备)
1. 检测当前 git 状态(主分支 master,正常 checkout,非 submodule)
2. 创建 `.worktrees/` 目录(项目本地约定),确认已被 gitignore 忽略
3. 基于 master 新建分支 `pocketbase-migration`,创建 worktree
4. 在 worktree 内 `pnpm install`,跑基线 `vitest`(确认 16 个测试通过 = 干净起点)

### 之后的迁移实施(worktree 内,分阶段)
- 建 PocketBase 集合迁移脚本(13 个集合,参考 `references/equipment_management-pb/`)
- 写数据迁移脚本:`fridge.db` → PocketBase(LLM key 密文原样搬,`APP_ENCRYPTION_KEY` 不变)
- 8 个 store 类从同步 better-sqlite3 改为异步 PocketBase JS SDK
- 处理 `confirmProposal` 事务原子性(PB hook + 幂等键兜底)
- 临期提醒 cron 从 Next.js route 挪进 `pb_hooks/main.pb.js` 的 `cronAdd`
- 20 个 API 路由同步→异步适配
- 重写部署(`docker-compose` 双容器 + PB 二进制,去掉 better-sqlite3 编译)
- PB Admin UI 作为"后台查看库存"(白送,你的诉求之一)
- 每阶段验证,全部完成后再合并回 master

是否同意我先做环境准备(建 worktree + 基线测试)?