import { CreateOrderInputSchema } from "./schemas.js";

export function createOrder(input: unknown): {
  id: string;
  qty: number;
  sku: string;
} {
  const parsed = CreateOrderInputSchema.parse(input);
  return { id: crypto.randomUUID(), ...parsed };
}
