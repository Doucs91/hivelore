import { describe, expect, it } from "vitest";
import { createOrder } from "../src/order.js";
import { CreateOrderInputSchema } from "../src/schemas.js";

describe("createOrder", () => {
  it("refuses negative qty at the schema layer", () => {
    expect(() =>
      CreateOrderInputSchema.parse({ qty: -1, sku: "a" }),
    ).toThrow();
  });

  it("refuses zero qty at the schema layer", () => {
    expect(() =>
      CreateOrderInputSchema.parse({ qty: 0, sku: "a" }),
    ).toThrow();
  });

  it("refuses empty sku", () => {
    expect(() =>
      CreateOrderInputSchema.parse({ qty: 1, sku: "" }),
    ).toThrow();
  });

  it("creates order for valid input", () => {
    const row = createOrder({ qty: 2, sku: "abc" });
    expect(row).toEqual({
      id: expect.any(String),
      qty: 2,
      sku: "abc",
    });
  });
});
