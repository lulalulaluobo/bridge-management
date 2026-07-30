import "server-only";

import { headers } from "next/headers";

const fallbackHouseholdId = "default-household";
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function currentHouseholdId() {
  const value = (await headers()).get("x-fridge-household-id");
  return value && idPattern.test(value) ? value : fallbackHouseholdId;
}

export { fallbackHouseholdId };
