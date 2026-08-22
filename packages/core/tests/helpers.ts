import { createServer } from 'node:http';
import { once } from 'node:events';
import type { Server } from 'node:http';

export interface MockSseServer {
  server: Server;
  url: string;
  requests: string[];
}

/**
 * Starts a local HTTP server that answers every request with the
 * string returned by `respond(requestBody)` (caller composes raw SSE frames).
 */
export async function startSseServer(
  respond: (requestBody: string) => string,
): Promise<MockSseServer> {
  const requests: string[] = [];

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      requests.push(body);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(respond(body));
    });
    req.on('error', () => {
      /* client aborted — ignore */
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return { server, url: `http://127.0.0.1:${port}`, requests };
}
