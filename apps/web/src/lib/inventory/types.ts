import { z } from "zod";

export const foodCategories = ["蔬菜", "水果", "乳制品", "肉类", "海鲜", "主食", "饮料", "其他"] as const;
export const storageLocations = ["冷藏室", "冷冻室", "常温柜", "其他"] as const;

export const batchInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(foodCategories),
  quantity: z.number().positive().max(100000),
  unit: z.string().trim().min(1).max(16),
  purchasedAt: z.string().date(),
  expiresAt: z.string().date().optional(),
  storageLocation: z.enum(storageLocations),
  opened: z.boolean(),
});

export const addBatchesActionSchema = z.object({
  type: z.literal("add_batches"),
  batches: z.array(batchInputSchema).min(1).max(30),
});

export const updateBatchActionSchema = z.object({
  type: z.literal("update_batch"),
  batchId: z.string().uuid(),
  changes: batchInputSchema.partial().refine((value) => Object.keys(value).length > 0),
});

export const consumeBatchActionSchema = z.object({
  type: z.literal("consume_batch"),
  batchId: z.string().uuid(),
  quantity: z.number().positive(),
});

export const deleteBatchActionSchema = z.object({
  type: z.literal("soft_delete_batch"),
  batchId: z.string().uuid(),
});

export const proposalActionSchema = z.discriminatedUnion("type", [
  addBatchesActionSchema,
  updateBatchActionSchema,
  consumeBatchActionSchema,
  deleteBatchActionSchema,
]);

export type BatchInput = z.infer<typeof batchInputSchema>;
export type ProposalAction = z.infer<typeof proposalActionSchema>;

export type FoodBatch = {
  id: string;
  householdId: string;
  name: string;
  category: (typeof foodCategories)[number];
  quantity: number;
  unit: string;
  purchasedAt: string;
  expiresAt: string;
  storageLocation: (typeof storageLocations)[number];
  opened: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InventoryStatus = "expired" | "expiring" | "normal";

export type FoodBatchWithStatus = FoodBatch & { status: InventoryStatus };

export type OperationProposal = {
  id: string;
  action: ProposalAction;
  expiresAt: string;
};
