// 로컬 개발 서버: public/ 정적 파일 + api/ 함수(Vercel과 같은 코드)를 그대로 실행한다
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCE_NAME } from './lib/env.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;

const routes = {
  '/api/config': await import('./api/config.js'),
  '/api/search': await import('./api/search.js'),
  '/api/status': await import('./api/status.js'),
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body });
}

async function send(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

http
  .createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      const mod = routes[pathname];
      if (mod) {
        const handler = mod[req.method];
        if (!handler) return send(res, new Response('Method Not Allowed', { status: 405 }));
        return send(res, await handler(await toRequest(req)));
      }
      const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
      if (!file.startsWith(PUBLIC_DIR)) return send(res, new Response('Forbidden', { status: 403 }));
      const body = await readFile(file).catch(() => null);
      if (!body) return send(res, new Response('Not Found', { status: 404 }));
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch (err) {
      console.error(err);
      send(res, Response.json({ error: err.message }, { status: 500 }));
    }
  })
  .listen(PORT, () => {
    console.log(`비플페이 지도: http://localhost:${PORT}`);
    console.log(`식당 데이터 출처: ${SOURCE_NAME}`);
  });
