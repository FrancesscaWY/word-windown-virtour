import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHandler } from './handler.mjs';
import { readServerConfig, formatStartupMessages } from './network.mjs';

const config = readServerConfig();
const { host, port, tls } = config;
const handler = createHandler({ dist: config.dist });
const options = tls ? { cert: await readFile(tls.certPath), key: await readFile(tls.keyPath) } : {};
const server = (tls ? httpsServer : httpServer)(options, async (req, res) => {
  const abort = new AbortController();
  req.on('aborted', () => abort.abort());
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });
  try {
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const request = new Request(`${config.protocol}://localhost${req.url}`, {
      method: req.method, headers: req.headers, signal: abort.signal,
      ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) await pipeline(Readable.fromWeb(response.body), res);
    else res.end();
  } catch { if (!res.destroyed) { if (!res.headersSent) res.writeHead(500); res.end('服务暂时不可用'); } }
  finally { req.resume(); }
});
server.on('error', (error) => { console.error(`启动失败：${error.code ?? error.message}`); process.exitCode = 1; });
server.listen(port, host, () => { for (const line of formatStartupMessages(config)) console.log(line); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
