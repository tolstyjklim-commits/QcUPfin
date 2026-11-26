import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

export type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string }
declare global { namespace Express { interface Request { telegramUser?: TelegramUser; startParam?: string } } }

export function validateInitData(initData: string, botToken: string, maxAgeSeconds = 3600): TelegramUser | null {
  if (!initData || !botToken) return null
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n')
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  const a = Buffer.from(calculated, 'hex'), b = Buffer.from(hash, 'hex')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const authDate = Number(params.get('auth_date'))
  if (!Number.isFinite(authDate) || Math.abs(Date.now()/1000 - authDate) > maxAgeSeconds) return null
  try {
    const raw = params.get('user')
    if (!raw) return null
    const user = JSON.parse(raw) as TelegramUser
    return Number.isSafeInteger(user.id) ? user : null
  } catch { return null }
}

export function requireTelegramAuth(req: Request, res: Response, next: NextFunction) {
  const initData = req.header('x-telegram-init-data') || ''
  const token = process.env.TELEGRAM_BOT_TOKEN || ''
  const user = validateInitData(initData, token)
  if (!user) return res.status(401).json({ error: 'Valid Telegram WebApp initData required' })
  req.telegramUser = user
  // start_param подписан Telegram вместе с остальным initData (hash уже проверен выше)
  req.startParam = new URLSearchParams(initData).get('start_param') || undefined
  next()
}
