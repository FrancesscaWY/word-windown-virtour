import type { FastifyRequest, FastifyReply } from 'fastify';

export function createTurn(request: FastifyRequest, reply: FastifyReply, timeoutMs: number) {
  const controller = new AbortController();
  const disconnect = () => { if (!reply.raw.writableFinished) controller.abort(new Error('客户端已断开。')); };
  const timer = setTimeout(() => controller.abort(new DOMException('请求超时。', 'TimeoutError')), timeoutMs);
  request.raw.once('aborted', disconnect);
  reply.raw.once('close', disconnect);
  return {
    controller,
    cleanup() {
      clearTimeout(timer);
      request.raw.removeListener('aborted', disconnect);
      reply.raw.removeListener('close', disconnect);
    },
  };
}

/** Enforce the deadline even if a faulty provider fails to settle after abort. */
export async function abortable<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let cancel: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
  });
  try { return await Promise.race([Promise.resolve().then(task), aborted]); }
  finally { signal.removeEventListener('abort', cancel); }
}
