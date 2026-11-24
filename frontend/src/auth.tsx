import { useEffect, useState, type ReactNode } from 'react'
import { DEMO } from './lib'
import { ownerDemoUnlocked } from './deposit'

// Вход только через Telegram. Мини-приложение открывается внутри Telegram и получает подписанные данные пользователя (initData).
// Без них (обычный браузер) игра не открывается. Имя и аватарка берутся из Telegram. Если задан VITE_API_URL, сервер дополнительно
// проверяет подпись (GET /api/me): подделать initData без токена бота нельзя.
export type TgUser = { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string }
const wa = () => (window as any).Telegram?.WebApp
export const tgUser = (): TgUser | null => { const u = wa()?.initDataUnsafe?.user; return u && Number.isSafeInteger(u.id) ? u : null }
export const tgName = (u: TgUser | null) => u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || 'Игрок' : 'Игрок'

const env = (import.meta as any).env || {}
const ENV_BOT_URL: string = (env.VITE_BOT_URL || '').trim()
const AUTH_OFF = env.VITE_AUTH_OFF === '1' // только для разработки: пускает без Telegram

type State = 'check' | 'ok' | 'nodata' | 'rejected'

export function AuthGate({ children }: { children: ReactNode }) {
  const [botUrl, setBotUrl] = useState(ENV_BOT_URL) // ссылка на бота: VITE_BOT_URL или поле botUrl в config.json
  useEffect(() => { if (!ENV_BOT_URL) fetch('./config.json', { cache: 'no-store' }).then(r => r.json()).then(j => { if (typeof j?.botUrl === 'string' && /^https:\/\/t\.me\//.test(j.botUrl.trim())) setBotUrl(j.botUrl.trim()) }).catch(() => {}) }, [])
  const [st, setSt] = useState<State>(() => (DEMO || AUTH_OFF ? 'ok' : 'check'))
  useEffect(() => {
    if (st !== 'check') return
    let dead = false
    ;(async () => {
      if (await ownerDemoUnlocked()) return !dead && setSt('ok') // режим владельца: localhost или адрес с #demo и паролем
      const initData: string = wa()?.initData || ''
      if (!initData || !tgUser()) return !dead && setSt('nodata')
      const raw = env.VITE_API_URL as string | undefined
      const API = raw === 'same' ? '' : raw?.replace(/\/$/, '')
      if (API === undefined) return !dead && setSt('ok') // сервера нет (статический сайт): остаётся проверка наличия данных Telegram
      try {
        const r = await fetch(`${API}/api/me`, { headers: { 'x-telegram-init-data': initData }, signal: AbortSignal.timeout(8000) })
        if (!dead) setSt(r.status === 401 || r.status === 403 ? 'rejected' : 'ok') // сеть или 5xx не блокируют, блокирует только отказ в подписи
      } catch { if (!dead) setSt('ok') }
    })()
    return () => { dead = true }
  }, [st])

  if (st === 'ok') return <>{children}</>
  if (st === 'check') return <div className="auth-screen"><div className="auth-spin" /></div>
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
        </div>
        <h1>{st === 'rejected' ? 'Вход не подтверждён' : 'Вход через Telegram'}</h1>
        <p>{st === 'rejected'
          ? 'Сервер не принял данные Telegram. Закройте приложение и откройте его заново из чата с ботом.'
          : 'Игра работает только внутри Telegram. Откройте её из чата с ботом: имя и аватарка подтянутся из вашего профиля.'}</p>
        {botUrl
          ? <a className="cta tg-btn" href={botUrl}><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M21.5 4.3 2.9 11.5c-1.3.5-1.2 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.1.8.7.8.5 0 .7-.2 1-.5l2.3-2.3 4.8 3.5c.9.5 1.5.2 1.7-.8L22.9 5.6c.3-1.3-.5-1.9-1.4-1.3ZM8.5 13.7l9.9-6.2c.5-.3.9-.1.5.2l-8.1 7.3-.3 3.4-2-4.7Z" /></svg>Войти через Telegram</a>
          : <p className="auth-hint">Откройте бота в Telegram и нажмите «Играть».</p>}
        <button className="auth-retry" onClick={() => location.reload()}>Проверить ещё раз</button>
      </div>
    </div>
  )
}
