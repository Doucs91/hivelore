---
id: 2026-05-05-convention-order-input-zod
scope: team
type: convention
status: validated
anchor:
  paths:
    - src/schemas.ts
  symbols:
    - CreateOrderInputSchema
tags:
  - zod
  - validation
  - orders
created_at: '2026-05-05T12:00:00.000Z'
expires_when: null
verified_at: '2026-05-05T12:00:00.000Z'
stale_reason: null
---

Les entrées publiques de commande passent par `CreateOrderInputSchema` dans `src/schemas.ts` :

- `qty` : entier strictement positif (`z.number().int().positive()` — 0 et les négatifs sont refusés).
- `sku` : chaîne non vide après trim (`z.string().trim().min(1)`).

Ne pas déplacer la validation hors du schéma Zod : `createOrder` parse toujours via `CreateOrderInputSchema.parse`.
