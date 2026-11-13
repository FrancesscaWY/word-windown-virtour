import { getPoi } from '../src/data/pois.js';
import type { AgentInput, Message } from './ai/types.ts';

const record = (input: unknown): Record<string, unknown> => input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};

/** Only known page data and bounded user/assistant history cross the model boundary. */
export function guidePayload(input: { text?: string; context?: unknown }): AgentInput {
  const context = record(input.context);
  const history: Message[] = [];
  for (const item of (Array.isArray(context.messages) ? context.messages.slice(-10) : [])) {
    const row = record(item);
    const content = row.content ?? row.text;
    if ((row.role === 'user' || row.role === 'assistant') && typeof content === 'string' && content.trim()) history.push({ role: row.role, content: content.slice(0, 2000) });
  }
  const id = context.mentionedPoiId ?? context.selectedPoiId;
  const poi = typeof id === 'string' ? getPoi(id) : null;
  return {
    city: '深圳',
    messages: [...history, ...(input.text ? [{ role: 'user' as const, content: input.text.trim() }] : [])],
    pageContext: {
      park: '深圳世界之窗', view: context.view === 'map' ? '园区地图' : '景点画面',
      topic: poi ? { name: poi.name, summary: poi.summary, source: poi.source } : null,
    },
  };
}

export function validPcm(audio: string): boolean {
  if (audio.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return false;
  const bytes = Buffer.from(audio, 'base64');
  return bytes.length >= 3200 && bytes.length <= 1920000 && bytes.length % 2 === 0 && bytes.toString('base64') === audio;
}
