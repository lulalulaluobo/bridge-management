import "server-only";

import webpush, { type PushSubscription as WebPushSubscription } from "web-push";

import { getInventoryStore, openAppDatabase } from "@/lib/inventory/store";

const defaultHouseholdId = "default-household";

export class NotificationStore {
  private readonly db = openAppDatabase();
  constructor(private readonly householdId = defaultHouseholdId) {
    this.db.exec("CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, household_id TEXT NOT NULL, subscription_json TEXT NOT NULL, created_at TEXT NOT NULL)");
  }
  save(subscription: PushSubscriptionJSON) {
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys.auth) throw new Error("无效的通知订阅");
    const stored: WebPushSubscription = { endpoint: subscription.endpoint, expirationTime: subscription.expirationTime, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } };
    this.db.prepare("INSERT INTO push_subscriptions (endpoint, household_id, subscription_json, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET subscription_json = excluded.subscription_json, created_at = excluded.created_at")
      .run(stored.endpoint, this.householdId, JSON.stringify(stored), new Date().toISOString());
  }
  remove(endpoint: string) { this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND household_id = ?").run(endpoint, this.householdId); }
  list(): WebPushSubscription[] { return (this.db.prepare("SELECT subscription_json FROM push_subscriptions WHERE household_id = ?").all(this.householdId) as Array<{ subscription_json: string }>).map((row) => JSON.parse(row.subscription_json) as WebPushSubscription); }
  householdIds(): string[] { return (this.db.prepare("SELECT DISTINCT household_id FROM push_subscriptions").all() as Array<{ household_id: string }>).map((row) => row.household_id); }
}

export async function sendExpiryReminders() {
  configureWebPush();
  let sent = 0;
  const index = getNotificationStore();
  for (const householdId of index.householdIds()) {
    const items = getInventoryStore(householdId).listBatches().filter((batch) => batch.status !== "normal");
    if (!items.length) continue;
    const payload = JSON.stringify({ title: "冰箱 Agent 提醒", body: `有 ${items.length} 个食材已过期或即将过期，点此查看。`, url: "/" });
    for (const subscription of getNotificationStore(householdId).list()) {
    try { await webpush.sendNotification(subscription, payload); sent += 1; } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error ? (error as { statusCode?: number }).statusCode : undefined;
      if (statusCode === 404 || statusCode === 410) getNotificationStore(householdId).remove(subscription.endpoint);
      else throw error;
    }
    }
  }
  return { sent, skipped: sent === 0 };
}

function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) throw new Error("服务端未配置 Web Push 密钥");
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

const globalForNotifications = globalThis as unknown as { notificationStore?: NotificationStore };
export function getNotificationStore(householdId = defaultHouseholdId) { if (householdId !== defaultHouseholdId) return new NotificationStore(householdId); if (!globalForNotifications.notificationStore) globalForNotifications.notificationStore = new NotificationStore(); return globalForNotifications.notificationStore; }
