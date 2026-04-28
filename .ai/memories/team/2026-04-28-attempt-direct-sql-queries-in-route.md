---
id: 2026-04-28-attempt-direct-sql-queries-in-route
scope: team
type: attempt
status: validated
anchor:
  paths: []
  symbols: []
tags: []
created_at: '2026-04-28T04:02:08.053Z'
expires_when: null
verified_at: null
stale_reason: null
---
# direct SQL queries in route handlers

**Why it failed / do NOT use:** bypasses ORM layer, breaks transaction handling, causes N+1 queries

**Instead, use:** use the repository pattern via services
