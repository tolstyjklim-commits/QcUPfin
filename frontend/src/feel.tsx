import { useEffect, useRef, useState } from 'react'
import { Check, Flame, Gift } from 'lucide-react'
import { GiftArt } from './art'
import { GIFTS, type GiftKind } from './lib'

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

type P = { x: number; y: number; vx: number; vy: number; r: number; rot: number; vr: number; c: string; w: number; h: number; round: boolean; life: number }
const COLORS = ['#ffd166', '#9ad2b8', '#59b58d', '#fff3c4', '#e9c46a', '#8eccaf']

// салют для крупных выигрышей: один canvas, который живёт только пока летят частицы
export function FxConfetti() {
  const cv = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = cv.current!, ctx = canvas.getContext('2d')!
    let parts: P[] = [], raf = 0, last = 0
    const fit = () => { const d = Math.min(devicePixelRatio || 1, 2); canvas.width = innerWidth * d; canvas.height = innerHeight * d; ctx.setTransform(d, 0, 0, d, 0, 0) }
    fit(); addEventListener('resize', fit)
    const step = (t: number) => {
      const dt = Math.min(0.033, (t - last) / 1000 || 0.016); last = t
      ctx.clearRect(0, 0, innerWidth, innerHeight)
      parts = parts.filter(p => p.life > 0 && p.y < innerHeight + 30)
      for (const p of parts) {
        p.vy += 900 * dt; p.vx *= 0.992; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= dt
        ctx.save(); ctx.globalAlpha = Math.min(1, p.life * 1.6); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.r, 0, 6.3); ctx.fill() } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }
      raf = parts.length ? requestAnimationFrame(step) : 0
      if (!parts.length) ctx.clearRect(0, 0, innerWidth, innerHeight)
    }
    const burst = (n: number) => {
      if (reduced()) return
      const x0 = innerWidth / 2, y0 = innerHeight * 0.38
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 380 + Math.random() * 520
        parts.push({ x: x0 + (Math.random() - 0.5) * 60, y: y0, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 2 + Math.random() * 2.5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
          c: COLORS[(Math.random() * COLORS.length) | 0], w: 5 + Math.random() * 5, h: 3 + Math.random() * 4, round: Math.random() < 0.3, life: 1.1 + Math.random() * 0.9 })
      }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(step) }
    }
    const onWin = (e: Event) => { const d = (e as CustomEvent<{ mult: number; amount: number; own?: boolean }>).detail; if (d && d.mult >= 5) burst(d.mult >= 20 ? 110 : 70) }
    const onGift = (e: Event) => { const d = (e as CustomEvent<{ kind: GiftKind }>).detail; const g = d && GIFTS[d.kind]; if (g && g.base >= 1000) burst(80) }
    const onFx = (e: Event) => burst(Number((e as CustomEvent<number>).detail) || 90)
    addEventListener('qcup-win', onWin); addEventListener('qcup-gift', onGift); addEventListener('qcup-fx', onFx)
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', fit); removeEventListener('qcup-win', onWin); removeEventListener('qcup-gift', onGift); removeEventListener('qcup-fx', onFx) }
  }, [])
  return <canvas ref={cv} className="fx-confetti" aria-hidden="true" />
}

// серия побед: плашка-уведомление, показывается пару секунд и сама исчезает
export function StreakChip({ n }: { n: number }) {
  const [shown, setShown] = useState<'in' | 'out' | null>(null)
  useEffect(() => {
    if (n < 2) { setShown(null); return }
    setShown('in')
    const t1 = window.setTimeout(() => setShown('out'), 1350), t2 = window.setTimeout(() => setShown(null), 1650)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [n])
  if (!shown || n < 2) return null
  return <div key={n} className={`streak-chip ${shown === 'out' ? 'out' : ''} ${n >= 10 ? 'hot3' : n >= 5 ? 'hot2' : ''}`} aria-live="polite"><Flame size={15} /><b>×{n}</b></div>
}

// экран нового уровня
export function LevelUp({ level, rank, onClose }: { level: number; rank: string; onClose: () => void }) {
  useEffect(() => { const t = window.setTimeout(onClose, 3600); return () => clearTimeout(t) }, [level, onClose])
  return <div className="lvlup-bg" onClick={onClose}>
    <div className="lvlup" role="status">
      <div className="lvlup-badge"><span>{level}</span></div>
      <small>Новый уровень</small>
      <b>{rank}</b>
    </div>
  </div>
}

// календарь ежедневного входа: 7 карточек, сегодняшняя подсвечена, на 7-й день редкий подарок
export function DailyStrip({ stars, done, ready, nextDay, onClaim, onOpen }: { stars: number[]; done: number; ready: boolean; nextDay: number; onClaim: () => void; onOpen: () => void }) {
  return <section className={`daily-strip ${ready ? 'ready' : ''}`} aria-label="Ежедневный вход">
    <div className="ds-top">
      <div><b>Ежедневный вход</b><span>{ready ? `Сегодня день ${nextDay} из 7` : 'Отмечено, приходи завтра'}</span></div>
      {ready ? <button className="ds-claim" onClick={onClaim}>Забрать</button> : <button className="ds-more" onClick={onOpen}>Задания</button>}
    </div>
    <div className="ds-days">
      {Array.from({ length: 7 }, (_, i) => {
        const isDone = i < done, today = ready && i === nextDay - 1
        return <button key={i} className={`ds-day ${isDone ? 'done' : ''} ${today ? 'today' : ''} ${i === 6 ? 'last' : ''}`} onClick={today ? onClaim : onOpen} aria-label={`День ${i + 1}`}>
          <small>{i + 1}</small>
          {isDone ? <Check size={15} /> : i === 6 ? <Gift size={16} /> : <i />}
          <em>+{stars[i] || 1}⭐</em>
        </button>
      })}
    </div>
    <p className="ds-hint">По звезде за каждый день, а на 7-й ещё и редкий подарок</p>
  </section>
}

// коллекция подарков: что уже было у игрока, остальное тёмными силуэтами
export function Collection({ kinds, seen, names }: { kinds: string[]; seen: Set<string>; names: (k: string) => string }) {
  const got = kinds.filter(k => seen.has(k)).length
  return <section className="coll">
    <div className="coll-top"><b>Коллекция подарков</b><span>{got} / {kinds.length}</span></div>
    <div className="coll-bar"><i style={{ width: `${kinds.length ? Math.round(got / kinds.length * 100) : 0}%` }} /></div>
    <div className="coll-grid">
      {kinds.map(k => <div key={k} className={`coll-item ${seen.has(k) ? 'on' : ''}`} title={seen.has(k) ? names(k) : 'Ещё не получен'}>
        <GiftArt kind={k} size={40} glow={false} />
      </div>)}
    </div>
  </section>
}

// оформление: тема и вибрация
export function LookCard({ theme, onTheme, haptic, onHaptic }: { theme: 'green' | 'graphite'; onTheme: (t: 'green' | 'graphite') => void; haptic: boolean; onHaptic: (v: boolean) => void }) {
  return <section className="look">
    <div className="look-row"><b>Тема</b>
      <div className="look-seg" role="radiogroup" aria-label="Тема оформления">
        <button role="radio" aria-checked={theme === 'green'} className={theme === 'green' ? 'on' : ''} onClick={() => onTheme('green')}><i className="sw-green" />Зелёная</button>
        <button role="radio" aria-checked={theme === 'graphite'} className={theme === 'graphite' ? 'on' : ''} onClick={() => onTheme('graphite')}><i className="sw-graphite" />Графит</button>
      </div>
    </div>
    <button className="look-row look-sw" role="switch" aria-checked={haptic} onClick={() => onHaptic(!haptic)}>
      <span><b>Вибрация</b><small>Отклик на выигрыши и нажатия</small></span><em className={`sw ${haptic ? 'on' : ''}`} />
    </button>
  </section>
}
