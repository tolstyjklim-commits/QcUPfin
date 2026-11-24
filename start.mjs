// Лаунчер QcUp: проверяет окружение, при первом запуске спрашивает токен бота
// (и сохраняет его в backend/.env), затем запускает бэкенд и фронтенд.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const be = path.join(root, 'backend'), fe = path.join(root, 'frontend')
const envFile = path.join(be, '.env')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const rl = createInterface({ input: process.stdin, output: process.stdout })
const ask = async q => (await rl.question(q)).trim()
// буфер обмена: в старом окне cmd Ctrl+V не работает, поэтому умеем брать значение прямо из буфера
const clip = () => {
  try {
    const r = process.platform === 'win32'
      ? spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8' })
      : process.platform === 'darwin' ? spawnSync('pbpaste', { encoding: 'utf8' }) : spawnSync('xclip', ['-o', '-selection', 'clipboard'], { encoding: 'utf8' })
    return (r.stdout || '').trim()
  } catch { return '' }
}

const readEnv = () => Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
function setEnv(key, value) {
  const lines = readFileSync(envFile, 'utf8').split(/\r?\n/)
  const i = lines.findIndex(l => l.startsWith(key + '='))
  if (i >= 0) lines[i] = `${key}=${value}`; else lines.push(`${key}=${value}`)
  writeFileSync(envFile, lines.join('\n'))
}
const run = (cwd, args, label) => {
  console.log(`\n> ${label}`)
  const r = spawnSync(npm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) { console.error(`\nОшибка на шаге: ${label}`); process.exit(1) }
}

console.log('=== QcUp: запуск ===')
if (Number(process.versions.node.split('.')[0]) < 18) { console.error('Нужен Node.js 18 или новее: https://nodejs.org'); process.exit(1) }

if (!existsSync(envFile)) copyFileSync(path.join(be, '.env.example'), envFile)
let env = readEnv()

// токен бота: спрашиваем только если ещё не сохранён
if (!env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN === 'replace_me') {
  console.log('\nТокен бота ещё не сохранён. Возьми его в @BotFather (/mybots -> бот -> API Token).')
  console.log('Скопируй токен (Ctrl+C в Telegram) и просто нажми Enter: я возьму его из буфера обмена.')
  console.log('Можно ввести вручную или вставить правой кнопкой мыши. Введи 0, чтобы запустить без бота (демо-подарки).')
  for (;;) {
    let t = await ask('Токен бота (Enter = из буфера, 0 = без бота): ')
    if (t === '0') break
    if (!t) { t = clip(); if (t) console.log(`Взял из буфера: ${t.slice(0, 10)}...`) }
    if (!/^\d+:[\w-]{30,}$/.test(t)) { console.log('Не похоже на токен (ожидается 123456789:AAH...). Скопируй его и нажми Enter ещё раз.'); continue }
    try {
      const j = await (await fetch(`https://api.telegram.org/bot${t}/getMe`)).json()
      if (!j.ok) { console.log('Telegram не принял этот токен. Проверь его и попробуй ещё раз.'); continue }
      console.log(`Бот найден: @${j.result.username}`)
    } catch { console.log('Не удалось проверить токен (нет связи с Telegram), сохраняю как есть.') }
    setEnv('TELEGRAM_BOT_TOKEN', t); break
  }
  env = readEnv()
}
rl.close()

// фронтенд ходит на бэкенд через dev-прокси того же адреса
const feEnv = path.join(fe, '.env')
if (!existsSync(feEnv)) writeFileSync(feEnv, 'VITE_API_URL=same\n')

if (!existsSync(path.join(be, 'node_modules'))) run(be, ['install'], 'Установка зависимостей бэкенда')
if (!existsSync(path.join(fe, 'node_modules'))) run(fe, ['install'], 'Установка зависимостей фронтенда')
const gen = spawnSync(npm, ['exec', '--', 'prisma', 'generate'], { cwd: be, encoding: 'utf8', shell: process.platform === 'win32' })
if (gen.status !== 0) console.log('\nПредупреждение: prisma generate не удался. Игра, подарки и бот запустятся, но вход через базу данных (/api/me) не заработает.')

// Иконки NFT: сохраняем на этот компьютер (только недостающие), чтобы они были всегда под рукой
console.log('\nПроверяю иконки NFT...')
spawnSync('node', ['scripts/cache-nft-icons.mjs'], { cwd: fe, stdio: 'inherit', timeout: 120000 })

// Туннель с https-адресом (нужен Telegram для кнопки запуска). Пробуем cloudflared, затем ssh -> pinggy (порт 443).
const tunnels = []
const openTunnel = (cmdline, urlRe, readyRe, ms = 45000) => new Promise(resolve => {
  let p, buf = '', url = null, done = false
  const fin = v => { if (!done) { done = true; if (!v) try { p?.kill() } catch {} ; resolve(v ? p : null) } }
  try { p = spawn(cmdline, { stdio: ['ignore', 'pipe', 'pipe'], shell: true }) } catch { return resolve(null) }
  const onData = d => {
    buf += d.toString()
    url ||= buf.match(urlRe)?.[0] ?? null
    if (url && (!readyRe || readyRe.test(buf))) { p.url = url; fin(true) }
  }
  p.stdout.on('data', onData); p.stderr.on('data', onData)
  p.on('error', () => fin(false)); p.on('exit', () => fin(false))
  setTimeout(() => fin(false), ms)
})
const hasBot = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_TOKEN !== 'replace_me'
if (hasBot && env.AUTO_TUNNEL !== '0' && env.BOT_ENABLED !== '0') {
  console.log('\nОткрываю https-туннель для кнопки запуска в боте (это может занять до минуты)...')
  const SSH = '-o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o BatchMode=yes -o ServerAliveInterval=30'
  let t = await openTunnel('npx -y cloudflared tunnel --url http://localhost:5173', /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i, /Registered tunnel connection/, 90000)
  if (!t) {
    console.log('Cloudflare не подключился, пробую запасной туннель localhost.run (ssh)...')
    t = await openTunnel(`ssh ${SSH} -R 80:localhost:5173 nokey@localhost.run`, /https:\/\/[a-z0-9-]+\.lhr\.life/i, null, 30000)
  }
  if (!t) {
    console.log('Пробую третий вариант: pinggy (ssh, порт 443)...')
    t = await openTunnel(`ssh -p 443 ${SSH} -R0:localhost:5173 a.pinggy.io`, /https:\/\/[a-z0-9.-]+\.pinggy[a-z.-]*/i, null, 30000)
  }
  if (t) { tunnels.push(t); setEnv('WEBAPP_URL', t.url); console.log(`Адрес игры: ${t.url}`) }
  else console.log('Туннель открыть не удалось. Бот запустится без кнопки, игра доступна на http://localhost:5173.')
}

console.log('\nЗапускаю бэкенд (:4000) и игру (:5173). Остановить: Ctrl+C или закрой окно.\n')
const kids = [
  spawn(npm, ['run', 'dev'], { cwd: be, stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn(npm, ['run', 'dev', '--', '--host'], { cwd: fe, stdio: 'inherit', shell: process.platform === 'win32' }),
]
setTimeout(() => {
  const url = 'http://localhost:5173'
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore' })
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' }).on('error', () => {})
}, 5000)
// Самопроверка: через 10 секунд показываем в окне, загрузились ли подарки и работает ли связь игры с бэкендом
setTimeout(async () => {
  const probe = async (label, url) => {
    for (let i = 0; i < 12; i++) {
      try {
        const r = await fetch(url)
        const j = await r.json().catch(() => ({}))
        if (r.ok && j.gifts) return console.log(`[проверка] ${label}: подарков Telegram ${j.gifts.length}, с иконками ${j.gifts.filter(g => g.thumb).length}, с анимацией ${j.gifts.filter(g => g.anim).length}`)
        if (r.status !== 502 && r.status !== 503 || i === 11) return console.log(`[проверка] ${label}: ошибка ${r.status} ${j.error || ''}`)
      } catch (e) { if (i === 11) return console.log(`[проверка] ${label}: нет ответа (${e.message})`) }
      await new Promise(r => setTimeout(r, 4000))
    }
  }
  await probe('бэкенд :4000', 'http://localhost:4000/api/gifts/catalog')
  await probe('игра :5173 -> бэкенд', 'http://localhost:5173/api/gifts/catalog')
}, 10000)

const stop = () => { for (const t of tunnels) { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(t.pid), '/T', '/F'], { stdio: 'ignore' }); else t.kill() } for (const k of kids) { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(k.pid), '/T', '/F'], { stdio: 'ignore' }); else k.kill() } process.exit(0) }
process.on('SIGINT', stop); process.on('SIGTERM', stop)
kids.forEach(k => k.on('exit', stop))
