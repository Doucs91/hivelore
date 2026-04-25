import type { z } from "zod";
import type {
  AnchorSchema,
  MemoryFrontmatterSchema,
  MemoryScopeSchema,
  MemoryStatusSchema,
  MemoryTypeSchema,
} from "./schema.js";

export type MemoryScope = z.infer<typeof MemoryScopeSchema>;
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;
export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type MemoryFrontmatter = z.infer<typeof MemoryFrontmatterSchema>;

export interface Memory {
  frontmatter: MemoryFrontmatter;
  body: string;
}
