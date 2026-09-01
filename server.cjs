// 专升本学习助手 - 静态文件服务器
// 生产模式:直接服务 dist/ 目录,无需 npm dev
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.ZSB_PORT || 5173);
const DIST = path.join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const PROXY_TIMEOUT_MS = 50_000;
const BLOCKED_HEADERS = new Set(['connection', 'content-length', 'cookie', 'host', 'origin', 'referer', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '0.0.0.0') return true;
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

function safeHeaders(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { 'Content-Type': 'application/json' };
  for (const [name, raw] of Object.entries(value)) {
    if (!name || BLOCKED_HEADERS.has(name.toLowerCase()) || typeof raw !== 'string' || /[\r\n]/.test(raw)) continue;
    result[name] = raw.slice(0, 4096);
  }
  if (!Object.keys(result).some((name) => name.toLowerCase() === 'content-type')) result['Content-Type'] = 'application/json';
  return result;
}

function validTarget(target, endpoint) {
  try {
    const url = new URL(target);
    if (url.protocol !== 'https:' || url.username || url.password || isPrivateHost(url.hostname)) return false;
    return url.pathname.endsWith(endpoint);
  } catch { return false; }
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (Buffer.byteLength(data) > 4_000_000) reject(new Error('too_large')); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('invalid_json')); } });
    req.on('error', reject);
  });
}

async function handleAiProxy(req, res, models = false) {
  if (req.method === 'OPTIONS') return res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' }).end();
  if (req.method !== 'POST') return json(res, 405, { code: 'method_not_allowed', error: '仅支持 POST 请求' });
  let body;
  try { body = await readBody(req); } catch (error) {
    return json(res, error.message === 'too_large' ? 413 : 400, { code: error.message === 'too_large' ? 'request_too_large' : 'invalid_json', error: '请求 JSON 无效或过大' });
  }
  const target = body.target;
  const endpoint = models ? '/models' : (String(target || '').endsWith('/responses') ? '/responses' : '/chat/completions');
  if (!validTarget(target, endpoint)) return json(res, 400, { code: 'invalid_target', error: `上游地址必须是 HTTPS 且指向 ${endpoint}` });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), models ? 20_000 : PROXY_TIMEOUT_MS);
  try {
    const upstream = await fetch(target, { method: models ? 'GET' : 'POST', headers: safeHeaders(body.headers), body: models ? undefined : JSON.stringify(body.payload || {}), signal: controller.signal });
    const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': upstream.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-cache', 'X-ZSB-AI-Transport': 'local-proxy' };
    res.writeHead(upstream.status, headers);
    if (!upstream.body) return res.end();
    for await (const chunk of upstream.body) res.write(chunk);
    res.end();
  } catch (error) {
    json(res, error.name === 'AbortError' ? 504 : 502, { code: error.name === 'AbortError' ? 'upstream_timeout' : 'upstream_unreachable', error: error.name === 'AbortError' ? '上游服务响应超时，请检查接口地址或稍后重试' : '应用中转暂时无法连接上游服务，请检查接口地址或稍后重试' });
  } finally { clearTimeout(timeout); }
}

const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/api/ai/proxy') return void handleAiProxy(req, res, false);
  if (req.url.split('?')[0] === '/api/ai/models') return void handleAiProxy(req, res, true);
  let filePath = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));

  // SPA 路由:不存在文件时返回 index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`LAN access: http://<your-ip>:${PORT}`);
});
