import { InventoryDashboard } from "@/components/inventory-dashboard";
import { getInventoryStore } from "@/lib/inventory/store";

export default function Home() {
  return <InventoryDashboard initialBatches={getInventoryStore().listBatches()} />;
}
