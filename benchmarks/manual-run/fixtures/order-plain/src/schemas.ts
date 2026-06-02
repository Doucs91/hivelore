import { z } from "zod";

/** Intentionally too permissive; tests require stricter business constraints on qty and sku. */
export const CreateOrderInputSchema = z.object({
  qty: z.number(),
  sku: z.string(),
});

export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;
