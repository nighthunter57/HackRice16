import { z } from 'zod';
import { requestJson, safeReason, type FetchLike } from './http';

/** Closed vocabulary deliberately excludes balances, transactions, bills and forecasts. */
export const preferenceSchema = z.discriminatedUnion('key', [
  z.object({ key: z.literal('riskTolerance'), value: z.enum(['cautious', 'balanced', 'flexible']) }).strict(),
  z.object({ key: z.literal('explanationStyle'), value: z.enum(['concise', 'detailed']) }).strict(),
  z.object({ key: z.literal('spendingPriority'), value: z.enum(['essentials', 'experiences', 'saving']) }).strict(),
]);
export type Preference = z.infer<typeof preferenceSchema>;
export const rememberedDecisionSchema = z.object({
  productName: z.string().trim().min(1).max(200).refine(value => !/[$€£¥]|\b(?:balance|bill amount|forecast|price|cost)\b/i.test(value), 'Product name must not contain financial facts'),
  action: z.enum(['buy', 'wait', 'skip', 'consider']),
}).strict();
export type RememberedDecision = z.infer<typeof rememberedDecisionSchema>;
export interface MemoryOptions { apiKey?: string; assistantId?: string; fetcher?: FetchLike }
const memorySchema = z.object({ memory_id: z.string(), content: z.string(), updated_at: z.string().optional(), created_at: z.string().optional() });
const listSchema = z.object({ memories: z.array(memorySchema) });
function config(options: MemoryOptions) {
  const apiKey = options.apiKey ?? process.env.BACKBOARD_API_KEY;
  const assistantId = options.assistantId ?? process.env.BACKBOARD_ASSISTANT_ID;
  if (!apiKey || !assistantId) return null;
  return { url: `https://app.backboard.io/api/assistants/${encodeURIComponent(assistantId)}/memories`, headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' } };
}

export async function getPreferences(options: MemoryOptions = {}): Promise<{ preferences: Preference[]; mode: 'live' | 'unavailable'; warnings: string[] }> {
  const settings = config(options);
  if (!settings) return { preferences: [], mode: 'unavailable', warnings: ['Backboard is not configured.'] };
  try {
    // Official API: omitting page fetches all assistant memories.
    const data = await requestJson('Backboard', settings.url, listSchema, { headers: settings.headers }, options.fetcher);
    const values = new Map<string, Preference>();
    const conflicts = new Set<string>();
    const warnings: string[] = [];
    for (const memory of data.memories) {
      if (!memory.content.startsWith('canibuyit.preference.v1:')) continue;
      let raw: unknown;
      try { raw = JSON.parse(memory.content.slice('canibuyit.preference.v1:'.length)); }
      catch { warnings.push('Ignored malformed preference memory.'); continue; }
      const parsed = preferenceSchema.safeParse(raw);
      if (!parsed.success) { warnings.push('Ignored unsupported preference memory.'); continue; }
      const existing = values.get(parsed.data.key);
      if (existing && existing.value !== parsed.data.value) conflicts.add(parsed.data.key);
      values.set(parsed.data.key, parsed.data);
    }
    // No reliable version ordering is guaranteed by the API. Do not pick an arbitrary winner.
    for (const key of conflicts) { values.delete(key); warnings.push(`Conflicting ${key} preferences require confirmation.`); }
    return { preferences: [...values.values()], mode: 'live', warnings };
  } catch (error) { return { preferences: [], mode: 'unavailable', warnings: [safeReason(error)] }; }
}

export async function savePreference(preference: Preference, options: MemoryOptions = {}): Promise<{ mode: 'live'; memoryId: string } | { mode: 'unavailable'; reason: string }> {
  const value = preferenceSchema.parse(preference);
  const settings = config(options);
  if (!settings) return { mode: 'unavailable', reason: 'Backboard is not configured; preference was not saved.' };
  try {
    const memories = await requestJson('Backboard', settings.url, listSchema, { headers: settings.headers }, options.fetcher);
    const matching = memories.memories.filter(memory => {
      if (!memory.content.startsWith('canibuyit.preference.v1:')) return false;
      try {
        const parsed = preferenceSchema.safeParse(JSON.parse(memory.content.slice('canibuyit.preference.v1:'.length)));
        return parsed.success && parsed.data.key === value.key;
      } catch { return false; }
    });
    // Explicit user updates resolve all older copies of this preference without deleting memories.
    if (matching.length) {
      for (const memory of matching) {
        await requestJson('Backboard', `${settings.url}/${encodeURIComponent(memory.memory_id)}`, z.object({}), {
          method: 'PUT', headers: settings.headers, body: JSON.stringify({ content: `canibuyit.preference.v1:${JSON.stringify(value)}` }),
        }, options.fetcher);
      }
      return { mode: 'live', memoryId: matching[0].memory_id };
    }
    const saved = await requestJson('Backboard', settings.url, z.object({ memory_id: z.string().min(1) }), {
      method: 'POST', headers: settings.headers,
      body: JSON.stringify({ content: `canibuyit.preference.v1:${JSON.stringify(value)}`, metadata: { source: 'canibuyit', kind: 'preference', version: 1 } }),
    }, options.fetcher);
    return { mode: 'live', memoryId: saved.memory_id };
  } catch (error) { return { mode: 'unavailable', reason: safeReason(error) }; }
}

/** Semantic context only. Amounts, balances, verdicts and forecast dates stay in Tiger. */
export async function rememberDecision(productName: string, action: RememberedDecision['action'], options: MemoryOptions = {}): Promise<{ mode: 'live'; memoryId: string } | { mode: 'unavailable'; reason: string }> {
  const value = rememberedDecisionSchema.parse({ productName, action });
  const settings = config(options);
  if (!settings) return { mode: 'unavailable', reason: 'Backboard is not configured; decision was not remembered.' };
  try {
    const saved = await requestJson('Backboard', settings.url, z.object({ memory_id: z.string().min(1) }), {
      method: 'POST', headers: settings.headers,
      body: JSON.stringify({ content: `canibuyit.decision.v1:${JSON.stringify(value)}`, metadata: { source: 'canibuyit', kind: 'decision', version: 1 } }),
    }, options.fetcher);
    return { mode: 'live', memoryId: saved.memory_id };
  } catch (error) { return { mode: 'unavailable', reason: safeReason(error) }; }
}

export async function getRememberedDecisions(options: MemoryOptions = {}): Promise<{ decisions: RememberedDecision[]; mode: 'live' | 'unavailable'; warnings: string[] }> {
  const settings = config(options);
  if (!settings) return { decisions: [], mode: 'unavailable', warnings: ['Backboard is not configured.'] };
  try {
    const data = await requestJson('Backboard', settings.url, listSchema, { headers: settings.headers }, options.fetcher);
    const decisions: RememberedDecision[] = [];
    const warnings: string[] = [];
    for (const memory of data.memories) {
      if (!memory.content.startsWith('canibuyit.decision.v1:')) continue;
      try {
        const value = rememberedDecisionSchema.parse(JSON.parse(memory.content.slice('canibuyit.decision.v1:'.length)));
        decisions.push(value);
      } catch { warnings.push('Ignored malformed decision memory.'); }
    }
    return { decisions, mode: 'live', warnings };
  } catch (error) { return { decisions: [], mode: 'unavailable', warnings: [safeReason(error)] }; }
}

/** Remove only CanIBuyIt memory from this user's dedicated assistant. */
export async function deleteApplicationMemories(options:MemoryOptions):Promise<boolean> {
  const settings=config(options);
  if(!settings)return false;
  try {
    const list=await requestJson('Backboard',settings.url,listSchema,{headers:settings.headers},options.fetcher);
    for(const memory of list.memories.filter(m=>m.content.startsWith('canibuyit.'))) {
      const response=await (options.fetcher??fetch)(`${settings.url}/${encodeURIComponent(memory.memory_id)}`,{method:'DELETE',headers:settings.headers,redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!response.ok && response.status!==404)return false;
    }
    return true;
  } catch{return false;}
}
