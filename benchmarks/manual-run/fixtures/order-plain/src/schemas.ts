import { z } from "zod";

/** Intentionnellement trop permissif — les tests exigent une contrainte métier plus stricte sur qty et sku. */
export const CreateOrderInputSchema = z.object({
  qty: z.number(),
  sku: z.string(),
});

export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;
