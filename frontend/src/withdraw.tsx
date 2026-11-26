import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { DEMO, money } from './lib'
import { serverJson, serverMode } from './deposit'
import { TonIcon, UsdtIcon } from './art'
import { Star } from 'lucide-react'

// ТЕСТОВАЯ система выводов. Игрок оставляет заявку, администратор вручную принимает или отклоняет её в админ-панели (panel.html) и платит сам.
// Монеты списываются в момент заявки; если заявку отклонили, сервер возвращает их тем же каналом, что и пополнения.
// Заявка хранится в браузере до подтверждения сервером: при обрыве связи она отправляется повторно с тем же ключом (сервер не создаст дубль).

export type WCfg = { coinsPerStar?: number; minStars?: number; enabled: boolean; minUsd: number; maxUsd: number; coinsPerUsd: number; feePct: number; methods: string[] }
type Mine = { stars?: number | null; id: string; coins: number; usd_cents: number; method: string; address: string; status: 'pending' | 'approved' | 'rejected'; created_at: number; admin_note?: string; txid?: string; demo?: boolean }
type Pend = { key: string; coins: number; method: string; address: string; t: number }

const TG = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id
const PK = `qcup-wd-pending-${TG || 'x'}`, DK = 'qcup-demo-wd'
const readJ = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d } catch { return d } }
const writeJ = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* */ } }
const METHODS: Record<string, { name: string; sub: string; ph: string }> = {
  TON: { name: 'TON', sub: 'сеть TON', ph: 'UQ… / EQ…' },
  USDT_TON: { name: 'USDT', sub: 'сеть TON', ph: 'UQ… / EQ…' },
  USDT_TRC20: { name: 'USDT', sub: 'сеть TRON · TRC20', ph: 'T…' },
  STARS: { name: 'Stars', sub: 'Telegram Stars', ph: '' },
}
const TON_RE = /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/, TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/
const rndKey = () => 'w' + [...crypto.getRandomValues(new Uint8Array(14))].map(b => (b % 36).toString(36)).join('')
export const DEMO_WCFG: WCfg = { enabled: true, minUsd: 5, maxUsd: 500, coinsPerUsd: 100, feePct: 0, coinsPerStar: 1, minStars: 100, methods: ['TON', 'USDT_TON', 'USDT_TRC20', 'STARS'] }

// есть ли вывод у этого игрока: на сервере (Worker/VPS) или тестовый в демо
export async function loadWithdrawCfg(): Promise<WCfg | null> {
  if (DEMO) return DEMO_WCFG
  if (!(await serverMode())) return null
  const r = await serverJson<{ withdraw?: WCfg }>('GET', '/api/deposit/config')
  return r && r.ok && r.data && r.data.withdraw && r.data.withdraw.enabled ? r.data.withdraw : null
}

// отправка заявки; общая для окна и для повторов в фоне
async function send(p: Pend): Promise<'ok' | 'rejected' | 'retry'> {
  const r = await serverJson<{ error?: string }>('POST', '/api/withdraw', { key: p.key, coins: p.coins, method: p.method, address: p.address })
  if (r && r.ok) return 'ok'
  if (r && r.status >= 400 && r.status < 500 && r.status !== 401) return 'rejected' // сервер отказал: повтор бессмыслен
  return 'retry'
}

// фоновая досылка заявок, которые не дошли из-за обрыва связи
export function useWithdrawRetry(refund: (coins: number, title: string) => void) {
  const busy = useRef(new Set<string>())
  useEffect(() => {
    if (DEMO || !TG) return
    let dead = false
    const tick = async () => {
      if (dead || !(await serverMode())) return
      for (const p of readJ<Pend[]>(PK, [])) {
        if (busy.current.has(p.key)) continue
        busy.current.add(p.key)
        try {
          const res = await send(p)
          if (res === 'retry') continue
          writeJ(PK, readJ<Pend[]>(PK, []).filter(x => x.key !== p.key))
          if (res === 'rejected') refund(p.coins, 'Вывод не принят: монеты возвращены')
        } finally { busy.current.delete(p.key) }
      }
    }
    const t = window.setInterval(tick, 20_000); tick()
    return () => { dead = true; clearInterval(t) }
  }, [refund])
}

export function WithdrawModal({ cfg, balance, onClose, onReserve, onRefund, onNotice }: {
  cfg: WCfg; balance: number; onClose: () => void
  onReserve: (coins: number) => boolean; onRefund: (coins: number, title: string) => void; onNotice: (s: string) => void
}) {
  const [method, setMethod] = useState(cfg.methods[0] || 'TON')
  const [address, setAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [err, setErr] = useState(''), [info, setInfo] = useState(''), [sending, setSending] = useState(false)
  const [list, setList] = useState<Mine[]>(() => (DEMO ? readJ<Mine[]>(DK, []) : []))
  const coins = Math.floor(Number(amount.replace(',', '.')) || 0)
  const gross = Math.floor((coins * 100) / cfg.coinsPerUsd) / 100
  const net = Math.floor(gross * (1 - cfg.feePct / 100) * 100) / 100
  const isStars = method === 'STARS'
  const cps = cfg.coinsPerStar || 1, stars = Math.floor(coins / cps)
  const minCoins = isStars ? Math.ceil((cfg.minStars || 100) * cps) : Math.ceil(cfg.minUsd * cfg.coinsPerUsd), maxCoins = Math.min(Math.floor(cfg.maxUsd * cfg.coinsPerUsd), Math.floor(balance))
  const addrOk = isStars || (method === 'USDT_TRC20' ? TRON_RE.test(address.trim()) : TON_RE.test(address.trim()))
  const amountOk = coins >= minCoins && coins <= maxCoins

  const reload = useCallback(async () => {
    if (DEMO) return
    const r = await serverJson<Mine[]>('GET', '/api/withdraw/mine')
    if (r && r.ok && Array.isArray(r.data)) setList(r.data)
  }, [])
  useEffect(() => { reload(); const t = window.setInterval(reload, 15_000); return () => clearInterval(t) }, [reload])

  const submit = async () => {
    setErr(''); setInfo('')
    if (!amountOk) return setErr(`Сумма от ${money(minCoins)} до ${money(Math.max(minCoins, maxCoins))} ⭐`)
    if (!addrOk) return setErr(method === 'USDT_TRC20' ? 'Неверный адрес TRON: он начинается с T и содержит 34 символа' : 'Неверный адрес TON: он начинается с EQ или UQ и содержит 48 символов')
    if (sending) return
    if (!onReserve(coins)) return setErr('Не хватает звёзд')
    setSending(true)
    const p: Pend = { key: rndKey(), coins, method, address: isStars ? '' : address.trim(), t: Date.now() }
    if (DEMO) { // в демо заявка никуда не уходит
      const item: Mine = { id: 'demo-' + p.key.slice(1, 7), coins, usd_cents: Math.round(net * 100), method, address: isStars ? 'Telegram Stars' : p.address.slice(0, 6) + '…' + p.address.slice(-4), stars: isStars ? stars : null, status: 'pending', created_at: Date.now(), demo: true }
      const next = [item, ...readJ<Mine[]>(DK, [])]; writeJ(DK, next); setList(next)
      setInfo('Демо: заявка создана только в этом браузере. На сервере её нет, админ-панель её не увидит.')
      setAmount(''); setSending(false); return
    }
    writeJ(PK, [...readJ<Pend[]>(PK, []), p])
    const res = await send(p)
    if (res === 'ok') { writeJ(PK, readJ<Pend[]>(PK, []).filter(x => x.key !== p.key)); setInfo('Заявка отправлена. Администратор рассмотрит её вручную.'); setAmount(''); onNotice('Заявка на вывод отправлена'); reload() }
    else if (res === 'rejected') { writeJ(PK, readJ<Pend[]>(PK, []).filter(x => x.key !== p.key)); onRefund(coins, 'Вывод не принят: монеты возвращены'); setErr('Сервер не принял заявку (проверьте сумму, адрес и число открытых заявок). Монеты возвращены.') }
    else setInfo('Нет связи с сервером. Заявка сохранена и отправится автоматически, когда связь появится.')
    setSending(false)
  }

  const label = (w: Mine) => (w.status === 'pending' ? 'В обработке' : w.status === 'approved' ? 'Принята' : 'Отклонена')
  return <div className="dep-back" onClick={onClose}>
    <div className="dep-card wd-card" onClick={e => e.stopPropagation()}>
      <button className="dep-x" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
      <h2>Вывод средств</h2>
      <p className="wd-test">Тестовый режим: заявки рассматривает администратор вручную, выплата не мгновенная.</p>
      {err && <p className="dep-err">{err}</p>}
      {info && <p className="dep-ok">{info}</p>}
      <label className="dep-lab">Куда вывести</label>
      <div className="dep-methods" role="radiogroup" aria-label="Способ вывода">
        {cfg.methods.filter(m => METHODS[m]).map(m => (
          <button key={m} type="button" role="radio" aria-checked={method === m} className={`dep-method ${method === m ? 'on' : ''}`} onClick={() => { setMethod(m); setErr('') }}>
            {m === 'TON' ? <TonIcon size={24} /> : m === 'STARS' ? <Star size={24} fill="currentColor" /> : <UsdtIcon size={24} />}<span><b>{METHODS[m].name}</b><small>{METHODS[m].sub}</small></span>
          </button>))}
      </div>
      {isStars ? <p className="dep-hint">Звёзды придут на ваш аккаунт Telegram. Адрес не нужен.</p> : <>
        <label className="dep-lab">Адрес кошелька</label>
        <input className="dep-input dep-mono" placeholder={METHODS[method]?.ph} value={address} onChange={e => setAddress(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      </>}
      <label className="dep-lab">Сумма, ⭐ (баланс {money(balance)})</label>
      <input className="dep-input" inputMode="numeric" placeholder={`от ${money(minCoins)}`} value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d]/g, ''))} />
      <div className="dep-quick">
        <button onClick={() => setAmount(String(minCoins))}>Мин.</button>
        <button onClick={() => setAmount(String(Math.max(minCoins, Math.floor(maxCoins / 2))))}>50%</button>
        <button onClick={() => setAmount(String(Math.max(0, maxCoins)))}>Макс.</button>
      </div>
      <p className="dep-hint">{coins > 0 ? <>К выплате {isStars ? <b>{money(stars)} Stars</b> : <>≈ <b>{net.toFixed(2)} USD</b></>}{cfg.feePct > 0 ? ` (комиссия ${cfg.feePct}%)` : ''} · </> : null}{isStars ? `${cps} ⭐ = 1 Star · от ${cfg.minStars || 100} Stars` : `${cfg.coinsPerUsd} ⭐ = 1 USD · от ${cfg.minUsd} USD`} · до {cfg.maxUsd} USD</p>
      <button className="primary-btn wide" onClick={submit} disabled={sending || !amountOk || !addrOk}>Отправить заявку</button>
      {list.length > 0 && <>
        <label className="dep-lab">Мои заявки</label>
        <div className="wd-list">
          {list.slice(0, 8).map(w => <div key={w.id} className={`wd-item ${w.status}`}>
            <div><b>{money(w.coins)} ⭐</b><span>{w.stars != null ? `${money(w.stars)} Stars` : `≈ ${(w.usd_cents / 100).toFixed(2)} USD`} · {METHODS[w.method]?.name || w.method}{w.demo ? ' · демо' : ''}</span></div>
            <em>{label(w)}</em>
            {w.status === 'rejected' && <small>{w.admin_note ? `${w.admin_note}. ` : ''}Монеты возвращены на баланс.</small>}
            {w.status === 'approved' && <small>{w.admin_note || 'Выплата будет сделана администратором.'}</small>}
          </div>)}
        </div>
      </>}
    </div>
  </div>
}
