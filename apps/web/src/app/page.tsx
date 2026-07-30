import { InventoryDashboard } from "@/components/inventory-dashboard";
import { getInventoryStore } from "@/lib/inventory/store";
import { getCredentialStore } from "@/lib/llm/credentials";

export default function Home() {
  return <InventoryDashboard initialBatches={getInventoryStore().listBatches()} initialCredentials={getCredentialStore().list()} />;
}
