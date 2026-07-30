import { InventoryDashboard } from "@/components/inventory-dashboard";
import { getInventoryStore } from "@/lib/inventory/store";
import { currentHouseholdId } from "@/lib/household";
import { getCredentialStore } from "@/lib/llm/credentials";
import { getPreferenceStore } from "@/lib/preferences";

export default async function Home() {
  const householdId = await currentHouseholdId();
  return <InventoryDashboard initialBatches={getInventoryStore(householdId).listBatches()} initialCredentials={getCredentialStore(householdId).list()} initialPreferences={getPreferenceStore(householdId).get()} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />;
}
