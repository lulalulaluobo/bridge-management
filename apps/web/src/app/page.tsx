import { InventoryDashboard } from "@/components/inventory-dashboard";
import { AccountGate } from "@/components/account-gate";
import { getInventoryStore } from "@/lib/inventory/store";
import { currentAccount, currentHouseholdId } from "@/lib/household";
import { getPreferenceStore } from "@/lib/preferences";

export default async function Home() {
  const account = await currentAccount();
  if (!account) return <AccountGate />;
  const householdId = await currentHouseholdId();
  return <InventoryDashboard username={account.username} initialBatches={getInventoryStore(householdId).listBatches()} initialPreferences={getPreferenceStore(householdId).get()} vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />;
}
