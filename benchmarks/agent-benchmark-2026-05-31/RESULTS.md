# hAIve Agent Benchmark — 2026-05-31

Replaces the 2026-05-07 pilot. Measures agent correctness **with vs without hAIve** across five
projects, where each project hides a policy that is *not* visible in the code.

## Method

- 5 fixtures × 2 variants (`-plain` = no `.ai`; `-haive` = `haive init` + the policy seeded as a memory).
- 10 cold general-purpose sub-agents, identical task per pair. The hAIve variant was instructed to
  run `haive briefing` first; the plain variant had no `.ai` and no mention of hAIve.
- **Correctness graded by a hidden rubric the agents never saw** (executed/inspected post-hoc).
- Token / tool-call / duration figures are the real numbers reported by the agent runtime.
- `n=1` per cell — a characterization of *where* hAIve helps, not a significance test.

## Fixtures & hidden policies

| Fixture | Stack | Hidden policy (only in the hAIve variant) | Type |
|---|---|---|---|
| A multitenant | TS | every repo query filters `tenantId` **and** excludes soft-deleted rows | inferable |
| B money | Python | `Decimal` + `ROUND_HALF_UP`, never `float` | inferable |
| C migrations | SQL | never edit an applied migration — create `V{n+1}` | inferable |
| D public-id | TS | `toPublicId(7) == "AC-100007"` (offset +100000, `AC-` prefix) | **arbitrary** |
| E status | Python | API status field is `"OK"`/`"KO"`, never `"success"`/`"error"` | **arbitrary** |

## Correctness (hidden rubric)

| Fixture | Without hAIve | With hAIve |
|---|:---:|:---:|
| A multitenant | ✅ | ✅ |
| B money | ✅ | ✅ |
| C migrations | ✅ | ✅ |
| D public-id | ❌ invented Crockford base32 `rec_7` (with passing tests) | ✅ `AC-100007` |
| E status | ❌ `ok` / `error` | ✅ `OK` / `KO` |
| **Total** | **3 / 5** | **5 / 5** |

## Cost (real tokens / tool-calls)

| Fixture | tokens plain | tokens haive | tools plain | tools haive |
|---|---:|---:|:---:|:---:|
| A | 11,334 | 27,133 | 8 | 13 |
| B | 10,548 | 24,786 | 6 | 11 |
| C | 9,843 | 11,333 | 4 | 6 |
| D | 15,599 | 11,482 | 10 | 6 |
| E | 15,726 | 11,661 | 9 | 5 |

Split by policy type:

| | tokens without | tokens with | result |
|---|---:|---:|---|
| Inferable (A,B,C) | 31,725 | 63,252 | same answer — hAIve is overhead |
| Arbitrary (D,E) | 31,325 | 23,143 | hAIve 2/2 vs 0/2, −26% tokens |

## Conclusion

- On **inferable** policies a capable model needs nothing extra; hAIve roughly **doubles** token cost
  for no correctness gain. (This is what motivated **adaptive briefing**, which trims itself to
  near-zero when `briefing_value == "low"`.)
- On **arbitrary, team-specific** policies the plain agent fails confidently — clean, tested,
  wrong-by-policy code — while hAIve gets it right **and** spends fewer tokens (no flailing to invent
  a convention). **5/5 vs 3/5.**
- hAIve's value is correctness on the unguessable, not speed. Its value scales entirely with how much
  genuinely unguessable, well-curated knowledge lives in the corpus.
