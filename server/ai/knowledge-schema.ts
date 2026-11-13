import { z } from 'zod';

export const sourceSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), url: z.url().startsWith('https://').nullable(),
  accessed_at: z.string().nullable(), published_at: z.string().nullable(), verification: z.string(),
});
export const entrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(1),
  kind: z.enum(['reference', 'dynamic', 'editorial']), topic: z.string().min(1),
  source_ids: z.array(z.string()).min(1), keywords: z.array(z.string().min(1)),
  entities: z.array(z.string()), content: z.string().min(1).max(6000),
  section: z.string(), snapshot_date: z.string(),
});
export const knowledgeSchema = z.object({
  id: z.literal('shenzhen-window-of-world'), name: z.string(), version: z.literal(2),
  aliases: z.array(z.string()), sources: z.array(sourceSchema), entries: z.array(entrySchema).min(1),
  document: z.object({ filename: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/), snapshot_date: z.string() }),
}).superRefine((kb, ctx) => {
  for (const key of ['sources', 'entries'] as const) {
    const ids = kb[key].map(item => item.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: `Duplicate ${key} IDs` });
  }
  const sources = new Set(kb.sources.map(s => s.id));
  for (const entry of kb.entries) for (const id of entry.source_ids) {
    if (!sources.has(id)) ctx.addIssue({ code: 'custom', message: `Unknown source ${id} in ${entry.id}` });
  }
});
export type Knowledge = z.infer<typeof knowledgeSchema>;
export type Entry = z.infer<typeof entrySchema>;
