import { InventoryDashboard } from "@/components/inventory-dashboard";
import { getInventoryStore } from "@/lib/inventory/store";
import { getCredentialStore } from "@/lib/llm/credentials";
import { getPreferenceStore } from "@/lib/preferences";

export default function Home() {
  return <InventoryDashboard initialBatches={getInventoryStore().listBatches()} initialCredentials={getCredentialStore().list()} initialPreferences={getPreferenceStore().get()} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />;
}
