# 面向用户的部署与分发

## 上线前准备

1. 准备一个 HTTPS 域名。安卓 Chrome 的相机、麦克风、Push 与真实 PWA 安装都要求 HTTPS；局域网 HTTP 仅用于功能调试。
2. 复制 `.env.example` 为部署机上的 `.env.production`，填写 `APP_ENCRYPTION_KEY`。用 `openssl rand -base64 32` 生成，永久保存在部署平台密钥库；更换前需计划用户 Key 的迁移。
3. 如需临期通知，执行 `npx web-push generate-vapid-keys`，填写 VAPID 环境变量和高强度 `CRON_SECRET`。
4. 使用 Nginx、Caddy 或托管平台把域名反向代理到容器 `3000` 端口，并强制 HTTPS。

## 启动

```bash
docker compose up -d --build
```

`fridge-data` 是唯一的 SQLite 数据卷。升级前应先备份该卷；不要把包含用户 BYOK 密文的数据库文件公开上传或作为示例数据分发。

## 触发临期提醒

由部署平台每天定时调用：

```text
POST https://你的域名/api/cron/expiry-reminders
Authorization: Bearer <CRON_SECRET>
```

用户需要先在应用中点击“开启临期提醒”并在系统弹窗中授权。未授权时，首页的过期/临期状态仍可使用。

## 面向真实用户的安装流程

1. 用短链接或二维码将用户带到 HTTPS 首页。
2. 首次使用只解释“可安装到桌面”，不要要求用户理解 PWA。
3. 在安卓 Chrome 菜单选择“安装应用”或“添加到主屏幕”；安装成功后从桌面图标打开。
4. 如果用户通过微信内置浏览器访问，提示其选择“在浏览器打开”，再使用 Chrome 安装。

## 安卓 Chrome 最终验收

在真实手机上逐项记录：HTTPS 打开、Manifest 可见、安装、桌面启动、相机、录音、通知授权、文字入库预览与确认、页面刷新数据保持、Service Worker 更新提示。改变 Manifest 或图标后，需要卸载旧应用并清理浏览器缓存后重新安装。
