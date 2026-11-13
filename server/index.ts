import { readFile } from 'node:fs/promises';
import { createApp } from './app.ts';
import { readServerConfig, formatStartupMessages } from './network.ts';

try {
  const config = readServerConfig();
  const https = config.tls ? { cert: await readFile(config.tls.certPath), key: await readFile(config.tls.keyPath) } : undefined;
  const app = createApp({ dist: config.dist, https, logger: true });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void app.close().catch(() => { process.exitCode = 1; });
  });
  await app.listen({ port: config.port, host: config.host });
  for (const line of formatStartupMessages(config)) console.log(line);
} catch (error) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'STARTUP_ERROR';
  console.error(`启动失败：${code}；请检查端口、证书和服务端配置。`);
  process.exitCode = 1;
}
