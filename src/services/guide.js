import { resolveLocalIntent } from '../guide/intent.js';
import { guideRequestContext } from './guide-context.js';

export async function requestGuide(text, context, { signal } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('请输入想说的话');
  if (globalThis.location?.protocol === 'file:') return { status: 'unconfigured', message: '离线预览暂未连接导游服务。' };
  const response = await fetch('/api/guide', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.trim(), context: guideRequestContext(context) }),
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(65000)]),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('当前站点没有可用的导游接口，仍可用本地指令浏览景点。'); }
  if (response.status === 503 && result.error === 'GUIDE_NOT_CONFIGURED') return { status: 'unconfigured', message: result.message };
  if (!response.ok) throw new Error(result.message || '导游服务暂时不可用，请稍后重试。');
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('导游没有返回完整回答，请重试。');
  return { ...result, status: 'success' };
}

/** Temporarily disable conversational shortcuts: every submitted question reaches the backend.
 * Keep the old rules available behind an explicit opt-in; direct UI controls do not use this resolver.
 */
export function createGuideResolver({ request = requestGuide, localRules = false } = {}) {
  return async (text, context, options) => {
    if (localRules) {
      const local = resolveLocalIntent(text, context);
      if (local.type !== 'unknown' && !(local.type === 'clarify' && local.kind === 'unknown-poi')) return local;
    }
    try {
      const result = await request(text, context, options);
      if (result.status === 'unconfigured') return { type: 'service-error', text: result.message };
      return { type: 'answer', text: result.text, model: result.model, traces: result.traces, mode: 'backend' };
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      return { type: 'service-error', text: error.name === 'TimeoutError' ? '导游回答超时，请稍后重试。' : error.message === 'Failed to fetch' ? '暂时连接不到导游服务，请检查网络后重试。' : error.message };
    }
  };
}
