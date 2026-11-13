import { readFile } from 'node:fs/promises';
import { createProxy } from './proxy.ts';
import { readServerConfig, formatStartupMessages } from './network.ts';

let entry: Awaited<ReturnType<typeof createProxy>> | undefined;
try {
  const config = readServerConfig();
  const https = config.tls ? { cert: await readFile(config.tls.certPath), key: await readFile(config.tls.keyPath) } : undefined;
  entry = await createProxy({ dist: config.dist, https, logger: true });
  const { proxy } = entry;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void proxy.close().catch(() => { process.exitCode = 1; });
  });
  await proxy.listen({ port: config.port, host: config.host });
  for (const line of formatStartupMessages(config)) console.log(line);
} catch (error) {
  await entry?.proxy.close();
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'STARTUP_ERROR';
  console.error(`启动失败：${code}；请检查端口、证书和服务端配置。`);
  process.exitCode = 1;
}
