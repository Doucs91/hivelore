---
id: 2026-04-28-gotcha-serializememory-undefined-values-crash
scope: team
type: gotcha
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - core
  - parser
  - serialization
  - yaml
created_at: '2026-04-28T04:18:31.116Z'
expires_when: null
verified_at: null
stale_reason: null
---
# serializeMemory crashes on undefined values in frontmatter

gray-matter / js-yaml refuses to serialize `undefined` values — throws 'unacceptable type' error.

**Symptom**: memory write fails with cryptic yaml error when frontmatter has optional fields set to undefined.

**Fix**: `serializeMemory()` in `packages/core/src/parser.ts` strips undefined recursively before serializing. Always use `serializeMemory()` — never `yaml.dump()` directly.

**Also**: gray-matter parses YAML date strings as Date objects. The `IsoDateString` zod transform in schema.ts normalizes both string and Date to ISO string before validation.
