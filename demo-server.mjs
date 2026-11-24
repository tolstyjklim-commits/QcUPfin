// Локальный сервер для демо-версии (папка demo-game). Не связан с настоящей игрой и её сервером.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demo-game')
const port = Number(process.env.PORT || 5180)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.tgs': 'application/json' }
http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0])
  if (p.endsWith('/')) p += 'index.html'
  const f = path.join(root, path.normalize(p))
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404') }
  res.writeHead(200, { 'Content-Type': types[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  fs.createReadStream(f).pipe(res)
}).listen(port, '127.0.0.1', () => {
  console.log(`\n  QcUp ДЕМО: http://localhost:${port}/\n  (закрыть: Ctrl+C)\n`)
})
