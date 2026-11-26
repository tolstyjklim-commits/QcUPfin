import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Coin, GiftArt, TonIcon, UsdtIcon, preloadGift } from './art'
import { Burst, CrashScene } from './fx'
import { Bulbs, SlotDefs, SlotSym } from './slotart'
import { play } from './sfx'
import {
  CASES, caseOddsOf, pctText, GIFTS, GIFT_ORDER, MINES_COUNT, MINES_TOTAL, PAYLINES, PLINKO_RISK, RACERS, SELL_RATE, type PlinkoRisk, SLOT3_PAY,
  STORM_PAY, SYMBOLS, caseChance, crashPoint, minesMult, money, pickSymbol, raceOdds, raceSimulate, RACE_LAPS, RACE_RTP, RACE_LEN, RACE_PROBS, LAP_LEN, rint, rnd, upgradeChance, weighted,
  type Gift, type GiftKind, type RaceEvent, type RaceSim, type Save, cfmt, dispCur, dispNum, toDisp, fromDisp, DISP } from './lib'

export type Ctx = {
  save: Save
  charge: (cost: number, title: string, countRound?: boolean) => boolean
  pay: (amount: number, title: string) => void
  notify: (msg: string) => void
  addGift: (kind: GiftKind, title: string) => Gift
  removeGift: (uid: string) => void
  bump: (key: string) => void
  tally: (staked: number, paid: number) => void // учёт для игр без обычной ставки/выплаты (кейсы, апгрейд)
  tilt: () => number // 0..0.3: насколько шансы ухудшены, если игрок слишком много выигрывает
}

// ---------- общие элементы ----------
export const MAX_BET = 10_000_000 // потолок ставки за раунд, как лимит стола в казино
export function CurIcon({ size = 16 }: { size?: number }) {
  const c = dispCur()
  return c === 'TON' ? <TonIcon size={size} /> : c === 'USDT' ? <UsdtIcon size={size} /> : <Coin size={size} />
}
export function StakeInput({ value, onChange, balance, disabled, presets = [10, 50, 100, 500] }:
  { value: number; onChange: (n: number) => void; balance: number; disabled?: boolean; presets?: number[] }) {
  const cap = Math.max(1, Math.min(balance, MAX_BET))
  const clamp = (n: number) => Math.max(1, Math.min(Math.floor(n) || 1, cap))
  const cur = dispCur()
  const [txt, setTxt] = useState<string | null>(null)
  const unit = cur === 'STAR' ? 'звёзды' : cur
  const shown = txt ?? (cur === 'STAR' ? String(value) : dispNum(value))
  const typed = (raw: string) => {
    if (cur === 'STAR') { onChange(clamp(Number(raw.replace(/\D/g, '')))); return }
    const clean = raw.replace(',', '.').replace(/[^\d.]/g, '')
    setTxt(clean.replace('.', ','))
    const v = parseFloat(clean)
    onChange(clamp(Number.isFinite(v) ? Math.round(fromDisp(v)) : 1))
  }
  return (
    <div className="stake-box">
      <label className="m small stake-label" htmlFor="stake">Ставка <span className="stake-cur"><CurIcon size={16} />{unit}</span></label>
      <div className="stake-line">
        <input id="stake" inputMode={cur === 'STAR' ? 'numeric' : 'decimal'} value={shown} disabled={disabled}
          onChange={e => typed(e.target.value)} onBlur={() => setTxt(null)} />
        <button disabled={disabled} onClick={() => { setTxt(null); onChange(clamp(value / 2)) }}>½</button>
        <button disabled={disabled} onClick={() => { setTxt(null); onChange(clamp(value * 2)) }}>×2</button>
      </div>
      <p className="m small stake-eq">{cur !== 'STAR' ? `В игре это ${money(value)} ⭐ · ` : ''}лимит ставки {cfmt(MAX_BET)}</p>
      <div className="stake-presets">
        {presets.map(p => <button key={p} disabled={disabled} className={p === value ? 'on' : ''} onClick={() => { setTxt(null); onChange(clamp(p)) }}>{cur === 'STAR' ? p : dispNum(p)}</button>)}
        <button disabled={disabled} onClick={() => { setTxt(null); onChange(clamp(cap)) }}>Макс</button>
      </div>
    </div>
  )
}
export const Result = ({ children, good }: { children: React.ReactNode; good?: boolean }) =>
  <div className={`result ${good ? 'good' : ''}`}>{children}</div>

function useCount(target: number, ms = 700) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!target) { setV(0); return }
    const t0 = performance.now(); let raf = 0
    const f = (now: number) => { const k = Math.min(1, (now - t0) / ms); setV(Math.round(target * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(f) }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}
// угол/сдвиг элемента из CSS-transform (для «тиков» во время анимации)
const matrixOf = (el: Element | null) => {
  if (!el) return null
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return null
  const m = t.match(/matrix\(([^)]+)\)/)
  return m ? m[1].split(',').map(Number) : null
}

// ---------- РАКЕТА ----------
export function Crash({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(50)
  const [phase, setPhase] = useState<'idle' | 'fly' | 'crash' | 'cash'>('idle')
  const [count, setCount] = useState(0) // обратный отсчёт перед стартом (3-2-1)
  const timer = useRef(0)
  const [auto, setAuto] = useState(0) // авто-вывод на этом множителе (0 = выключен)
  const [mult, setMult] = useState(1)
  const [win, setWin] = useState(0)
  const [hist, setHist] = useState<number[]>([])
  const raf = useRef(0)
  const live = useRef({ crashAt: 1, stake: 0, t0: 0, phase: 'idle' as string, mult: 1, auto: 0 })
  useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(timer.current) }, [])

  const finish = (kind: 'crash' | 'cash', m: number) => {
    cancelAnimationFrame(raf.current)
    live.current.phase = kind
    setPhase(kind); setMult(m)
    setHist(h => [live.current.crashAt, ...h].slice(0, 7))
  }
  const start = () => {
    if (phase === 'fly' || count > 0 || !ctx.charge(stake, 'Ракета — ставка')) return
    ctx.bump('crash')
    setPhase('idle'); setMult(1); setWin(0)
    const st = stake
    const launch = () => {
    play.whoosh()
    const L = live.current
    L.crashAt = Math.max(1.01, Math.floor((1 + (crashPoint() - 1) * (1 - ctx.tilt())) * 100) / 100); L.auto = auto; L.stake = st; L.t0 = performance.now(); L.phase = 'fly'; L.mult = 1
    setPhase('fly'); setMult(1); setWin(0)
    const tick = (now: number) => {
      if (L.phase !== 'fly') return
      const m = Math.floor(Math.exp(0.16 * ((now - L.t0) / 1000)) * 100) / 100
      if (m >= L.crashAt) { finish('crash', L.crashAt); play.boom(); play.lose(); ctx.notify(`Ракета улетела на ×${L.crashAt.toFixed(2)}`); return }
      L.mult = m; setMult(m)
      if (L.auto > 1 && m >= L.auto) { cash(); return }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    }
    const step = (n: number) => {
      if (n === 0) { setCount(0); launch(); return }
      setCount(n); play.tick()
      timer.current = window.setTimeout(() => step(n - 1), 900)
    }
    step(3)
  }
  function cash() {
    const L = live.current
    if (L.phase !== 'fly') return
    const w = Math.floor(L.stake * L.mult)
    finish('cash', L.mult); setWin(w)
    ctx.pay(w, 'Ракета — выигрыш')
  }
  const flying = phase === 'fly'
  return (
    <div className="crash">
      <div className="chips">{hist.length ? hist.map((h, i) => <span key={i} className={h >= 2 ? 'g' : 'r'}>{h.toFixed(2)}×</span>) : <span className="m small">Прошлые раунды появятся здесь</span>}</div>
      <div className={`stage ${phase}`}>
        <CrashScene phase={phase} mult={mult} />
        <div className={`big-mult ${phase}`} key={phase === 'fly' ? Math.floor(mult) : 'x'}>{mult.toFixed(2)}×</div>
        {phase === 'crash' && <div className="boom">Улетела</div>}
        {phase === 'cash' && <div className="boom ok">Забрано +{cfmt(win)}</div>}
        {count > 0 && <div className="countdown" key={count}>{count}</div>}
        {phase === 'idle' && count === 0 && <div className="boom m">Сделай ставку: перед стартом будет отсчёт 3-2-1</div>}
      </div>
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={flying || count > 0} />
      <div className="optrow"><span className="m small">Авто-вывод</span>
        {[0, 1.5, 2, 5, 10].map(v => <button key={v} className={auto === v ? 'on' : ''} disabled={flying || count > 0} onClick={() => setAuto(v)}>{v ? `×${v}` : 'Выкл'}</button>)}
      </div>
      {flying
        ? <button className="cta green pulse" onClick={cash}>Забрать {cfmt(Math.floor(live.current.stake * mult))}</button>
        : <button className="cta" disabled={count > 0} onClick={start}>{count > 0 ? `Старт через ${count}…` : `Сделать ставку · ${cfmt(stake)}`}</button>}
    </div>
  )
}

// ---------- АПГРЕЙД ПОДАРКОВ (можно отдать сразу несколько) ----------
const MAX_UPG = 12
const UPG_STARS_MAX = 0.75 // максимальный шанс, если в апгрейд поставлены звёзды
export function Upgrade({ ctx, seed }: { ctx: Ctx; seed: string | null }) {
  const gifts = ctx.save.gifts
  const prices = ctx.save.prices
  const [sel, setSel] = useState<string[]>(() => (seed && gifts.some(g => g.uid === seed) ? [seed] : []))
  const [picker, setPicker] = useState(false)
  const [tpicker, setTpicker] = useState(false)
  const [ptab, setPtab] = useState<'mine' | 'market'>('mine')
  const [target, setTarget] = useState<GiftKind | null>(null)
  const [rot, setRot] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [useStars, setUseStars] = useState(false) // добавить к ставке звёзды со счёта
  const [starStake, setStarStake] = useState(100)
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null)
  const [fx, setFx] = useState<'win' | 'burn' | null>(null)
  const needle = useRef<SVGGElement>(null)
  const chosen = useMemo(() => sel.map(id => gifts.find(g => g.uid === id)).filter((g): g is Gift => !!g), [sel, gifts])
  const lockedStars = useRef(0) // на время прокрутки сумма звёзд фиксируется, иначе она менялась бы вместе с балансом
  const stars = spinning ? lockedStars.current : useStars ? Math.max(0, Math.min(Math.floor(starStake) || 0, ctx.save.balance, MAX_BET)) : 0
  const curPrice = chosen.reduce((a, g) => a + (prices[g.kind] || 0), 0) + stars // подарки и звёзды вместе
  const has = chosen.length > 0 || stars > 0
  // если в ставку входят звёзды, шанс успеха не выше 75%
  const chanceFor = (t: GiftKind) => { const c = upgradeChance(curPrice, prices[t]); return stars > 0 ? Math.min(UPG_STARS_MAX, c) : c }

  // все подарки дороже суммы выбранных (в том числе с очень малым шансом, например обычный → редкий NFT)
  const allTargets = useMemo(() =>
    has ? GIFT_ORDER.filter(k => prices[k] > curPrice * 1.05) : [],
    [has, curPrice, prices])
  // быстрые кнопки: ближайшие цели с заметным шансом
  const targets = useMemo(() => allTargets.filter(k => chanceFor(k) >= 0.02).slice(0, 16), [allTargets, curPrice, prices])
  useEffect(() => {
    if (!allTargets.length) setTarget(null)
    else if (!target || !allTargets.includes(target)) {
      const pool = targets.length ? targets : allTargets
      setTarget(pool[Math.min(1, pool.length - 1)])
    }
  }, [allTargets, targets, target])
  const pct = (c: number) => { const p = c * 100; return p >= 10 ? String(Math.round(p)) : p >= 1 ? p.toFixed(1).replace('.', ',') : p >= 0.01 ? p.toFixed(2).replace('.', ',') : '<0,01' }

  // тики при прохождении стрелки через деления
  useEffect(() => {
    if (!spinning) return
    let raf = 0, lastTick = -1
    const f = () => {
      const m = matrixOf(needle.current)
      if (m) { const deg = ((Math.atan2(m[1], m[0]) * 180) / Math.PI + 360) % 360, idx = Math.floor(deg / 6); if (idx !== lastTick) { lastTick = idx; play.tick() } }
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [spinning])

  const chance = has && target ? chanceFor(target) : 0
  const mult = has && target ? prices[target] / curPrice : 0
  const R = 78, C = 2 * Math.PI * R
  const toggle = (id: string) => { setSel(s => (s.includes(id) ? s.filter(i => i !== id) : s.length >= MAX_UPG ? s : [...s, id])); setRes(null); setFx(null); play.click() }

  const go = () => {
    if (!has || !target || spinning) return
    if (stars > 0 && !ctx.charge(stars, 'Апгрейд — ставка звёздами')) return // звёзды списываются до прокрутки
    lockedStars.current = stars
    const ok = rnd() < chance // шанс ровно тот, что показан на циферблате
    ctx.tally(curPrice, ok ? prices[target] : 0)
    const zone = chance * 360
    const angle = ok ? zone * (0.06 + rnd() * 0.88) : zone + (360 - zone) * (0.06 + rnd() * 0.88)
    const next = rot - (rot % 360) + 360 * 5 + angle
    const give = chosen, tgt = target
    setSpinning(true); setRes(null); setFx(null); setRot(next); play.whoosh()
    window.setTimeout(() => {
      give.forEach(g => ctx.removeGift(g.uid))
      setUseStars(false)
      ctx.bump('upgrades')
      if (ok) {
        const g = ctx.addGift(tgt, 'Апгрейд — успех')
        ctx.notify(`Апгрейд удался: ${GIFTS[tgt]?.name}`)
        setRes({ ok: true, text: `Получено: ${GIFTS[tgt]?.name}` })
        setSel([g.uid]); setFx('win'); play.big(); window.dispatchEvent(new CustomEvent('qcup-fx', { detail: 100 }))
      } else {
        ctx.notify(give.length > 1 || stars > 0 ? 'Не повезло, ставка сгорела' : 'Не повезло, подарок сгорел')
        setRes({ ok: false, text: !give.length ? `Ставка ${cfmt(curPrice)} сгорела` : give.length > 1 || stars > 0 ? `Сгорело: ${give.length ? `${give.length} подарк.` : ''}${give.length && stars ? ' и ' : ''}${stars ? cfmt(stars) : ''}` : `${GIFTS[give[0].kind]?.name} сгорел` })
        setSel([]); setFx('burn'); play.lose(); play.boom()
      }
      setSpinning(false)
    }, 4200)
  }

  const buyPick = (k: GiftKind) => {
    const p = prices[k]
    if (sel.length >= MAX_UPG || !ctx.charge(p, `Маркет — ${GIFTS[k]?.name}`, false)) return
    const ng = ctx.addGift(k, `Маркет — ${GIFTS[k]?.name}`)
    setSel(s => [...s, ng.uid]); setRes(null); setFx(null); play.click()
  }
  const market = GIFT_ORDER.filter(k => !GIFTS[k]?.nft).concat(GIFT_ORDER.filter(k => GIFTS[k]?.nft).slice(0, 12))
  const ticks = Array.from({ length: 60 }, (_, i) => i)
  const first = chosen[0]
  return (
    <div className={`upg ${useStars ? 'sw' : ''}`}>
      <div className="upg-pair">
        <div className={`upg-slot ${fx === 'burn' ? 'burn' : ''}`}>
          <span className="m small">Отдаёшь{chosen.length > 1 ? ` · ${chosen.length}` : ''}</span>
          {has && !chosen.length
            ? <div className="slot-btn" style={{ cursor: 'default' }}><Coin size={72} /><b>Ставка звёздами</b><span className="gold">{cfmt(stars)}</span></div>
            : has
            ? <button className="slot-btn" disabled={spinning} onClick={() => { setPtab('mine'); setPicker(true) }}>
              {chosen.length === 1
                ? <GiftArt kind={first.kind} size={88} />
                : <div className="upg-stack">{chosen.slice(0, 4).map((g, i) => <span key={g.uid} style={{ ['--i' as string]: i }}><GiftArt kind={g.kind} size={52} glow={false} /></span>)}{chosen.length > 4 && <em>+{chosen.length - 4}</em>}</div>}
              <b>{chosen.length === 1 ? `${GIFTS[first.kind]?.name}` : `${chosen.length} подарков`}</b>
              <span className="gold">{cfmt(curPrice)}</span>
              {stars > 0 && <i className="m small">в том числе {cfmt(stars)} звёздами</i>}
            </button>
            : <button className="slot-plus" disabled={spinning} onClick={() => { setPtab(gifts.length ? 'mine' : 'market'); setPicker(true) }} aria-label="Выбрать подарок"><span>+</span><b className="m small">{fx === 'burn' ? 'Сгорели. Выбери новые' : 'Выбрать подарки'}</b></button>}
          {fx === 'burn' && <Burst key="b" type="ember" n={60} />}
        </div>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a5bbb1" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6" /></svg>
        <div className={`upg-slot ${fx === 'win' ? 'glow' : ''} ${spinning ? 'pending' : ''}`}>
          <span className="m small">Получаешь</span>
          {target ? <><GiftArt kind={target} size={88} animate={fx === 'win'} /><b>{GIFTS[target]?.name}</b><span className="gold">≈ {cfmt(prices[target])}</span></> : <b className="m">{has ? 'Выше нет' : '—'}</b>}
          {fx === 'win' && <Burst key="w" type="gold" n={90} />}
        </div>
      </div>

      <div className={`upg-stars ${useStars ? 'on' : ''}`}>
        <button className="upg-stars-head" disabled={spinning} aria-pressed={useStars} onClick={() => { setUseStars(v => !v); setRes(null); play.click() }}>
          <Coin size={22} />
          <span><b>Добавить звёзды в ставку</b><i>{useStars ? `В ставке ${cfmt(stars)} · шанс не выше 75%` : 'Баланс вместе с подарками, шанс до 75%'}</i></span>
          <em className="sw" aria-hidden="true" />
        </button>
        {useStars && <div className="upg-stars-body">
          <div className="cur-seg" role="radiogroup" aria-label="Валюта ставки">
            {(['STAR', 'TON', 'USDT'] as const).map(c => {
              const off = (c === 'TON' && !DISP.ton) || (c === 'USDT' && !DISP.usdt)
              return <button key={c} role="radio" aria-checked={dispCur() === c} disabled={spinning || off} className={dispCur() === c ? 'on' : ''}
                onClick={() => { window.dispatchEvent(new CustomEvent('qcup-cur', { detail: c })); play.click() }}>
                {c === 'TON' ? <TonIcon size={16} /> : c === 'USDT' ? <UsdtIcon size={16} /> : <Coin size={16} />}{c === 'STAR' ? 'Звёзды' : c}
              </button>
            })}
          </div>
          <StakeInput value={starStake} onChange={setStarStake} balance={ctx.save.balance} disabled={spinning} presets={[100, 500, 1000, 5000]} />
        </div>}
      </div>

      {has && gifts.length > chosen.length && !spinning && chosen.length < MAX_UPG && <button className="upg-add" onClick={() => { setPtab('mine'); setPicker(true) }}>+ Добавить ещё подарки: шанс растёт вместе с суммой</button>}

      <div className="upg-targets">
        {targets.map(k => (
          <button key={k} disabled={spinning} className={k === target ? 'on' : ''} onClick={() => { setTarget(k); play.click() }} title={GIFTS[k]?.name}>
            <GiftArt kind={k} size={28} glow={false} />
            <b>×{(prices[k] / curPrice).toFixed(1).replace('.', ',')}</b>
          </button>
        ))}
        {has && allTargets.length > 0 && <button disabled={spinning} className="more" onClick={() => { setTpicker(true); play.click() }}>Все цели · {allTargets.length}</button>}
      </div>

      <div className={`dial ${spinning ? 'spinning' : ''} ${fx === 'win' ? 'flash-win' : fx === 'burn' ? 'flash-lose' : ''}`}>
        <svg width="220" height="220" viewBox="0 0 210 210" role="img" aria-label={`Шанс успеха ${pct(chance)}%`}>
          <defs>
            <linearGradient id="arcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#59b58d" /><stop offset="1" stopColor="#9ad2b8" /></linearGradient>
            <radialGradient id="disc"><stop offset="0" stopColor="#344a42" /><stop offset="1" stopColor="#202d28" /></radialGradient>
            <filter id="glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <circle cx="105" cy="105" r="98" fill="url(#disc)" stroke="#374c44" strokeWidth="2" />
          {ticks.map(i => <line key={i} x1="105" y1="9" x2="105" y2={i % 5 === 0 ? 17 : 13} stroke={i % 5 === 0 ? '#79a190' : '#486a5c'} strokeWidth={i % 5 === 0 ? 2 : 1} transform={`rotate(${i * 6} 105 105)`} />)}
          <circle cx="105" cy="105" r={R} fill="none" stroke="#4a1c2c" strokeWidth="16" />
          <circle cx="105" cy="105" r={R} fill="none" stroke="url(#arcg)" strokeWidth="16" filter="url(#glow)"
            strokeDasharray={`${C * chance} ${C}`} transform="rotate(-90 105 105)" />
          <g ref={needle} style={{ transform: `rotate(${rot}deg)`, transformOrigin: '105px 105px', transition: spinning ? 'transform 4.1s cubic-bezier(.1,.72,.08,1)' : 'none' }}>
            <path d="M105 6l-9 22h18z" fill="#fff" filter="url(#glow)" />
            <rect x="103.5" y="26" width="3" height="22" rx="1.5" fill="#fff" opacity=".7" />
          </g>
        </svg>
        <div className="dial-text"><b>{pct(chance)}%</b><span className="m small">шанс успеха{mult ? ` · ×${mult.toFixed(1).replace('.', ',')}` : ''}</span></div>
      </div>

      {res && <Result good={res.ok}>{res.text}</Result>}
      <div className="upg-cta">
        <button className="cta" disabled={!has || !target || spinning} onClick={go}>
          {spinning ? <><RotateCcw size={18} className="spin-icon" /> Крутится…</> : chosen.length > 1 ? `Апгрейд · ${chosen.length} подарков` : 'Апгрейд'}
        </button>
        <p className="m small center">Если не повезёт, вся ставка сгорит. Подарки существуют только внутри игры.</p>
      </div>

      {tpicker && has && (
        <div className="sheet-bg" onClick={() => setTpicker(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-tabs"><button className="on">Во что улучшить · {allTargets.length}</button></div>
            <p className="m small center">Чем дороже подарок, тем меньше шанс. Можно сразу прыгнуть на редкий, но шанс будет совсем мизерным.</p>
            <div className="sheet-list">
              {allTargets.map(k => { const c = chanceFor(k); return (
                <button key={k} className={k === target ? 'on' : ''} onClick={() => { setTarget(k); setTpicker(false); setRes(null); play.click() }}>
                  <GiftArt kind={k} size={44} glow={false} />
                  <span><b>{GIFTS[k]?.name}{GIFTS[k]?.nft ? ' · редкий' : ''}</b><i>{cfmt(prices[k])} · ×{(prices[k] / curPrice).toFixed(1).replace('.', ',')}</i></span>
                  <em className={`chance ${c < 0.01 ? 'tiny' : ''}`}>{pct(c)}%</em>
                </button>) })}
            </div>
            <button className="sheet-close" onClick={() => setTpicker(false)}>Закрыть</button>
          </div>
        </div>
      )}
      {picker && (
        <div className="sheet-bg" onClick={() => setPicker(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-tabs">
              <button className={ptab === 'mine' ? 'on' : ''} onClick={() => setPtab('mine')}>Мои подарки · {gifts.length}</button>
              <button className={ptab === 'market' ? 'on' : ''} onClick={() => setPtab('market')}>Маркет</button>
            </div>
            <p className="m small center">Выбрано: {chosen.length} из {MAX_UPG}{has ? ` · ${cfmt(curPrice)}` : ''}. Можно отдать несколько подарков сразу.</p>
            <div className="sheet-list">
              {ptab === 'mine' && (gifts.length
                ? gifts.map(x => (
                  <button key={x.uid} className={sel.includes(x.uid) ? 'on' : ''} onClick={() => toggle(x.uid)}>
                    <GiftArt kind={x.kind} size={44} glow={false} /><span><b>{GIFTS[x.kind]?.name}</b><i>{cfmt(prices[x.kind])}</i></span>
                    <em className="chk">{sel.includes(x.uid) ? '✓' : ''}</em>
                  </button>))
                : <p className="m small center">Подарков пока нет. Купи на маркете.</p>)}
              {ptab === 'market' && market.map(k => (
                <button key={k} disabled={ctx.save.balance < prices[k] || sel.length >= MAX_UPG} onClick={() => buyPick(k)}>
                  <GiftArt kind={k} size={44} glow={false} /><span><b>{GIFTS[k]?.name}</b><i>Купить за {cfmt(prices[k])}</i></span>
                </button>))}
            </div>
            <div className="two">
              <button className="sheet-close" onClick={() => setSel(gifts.slice(0, MAX_UPG).map(g => g.uid))}>Выбрать все</button>
              <button className="sheet-close" onClick={() => setSel([])}>Сбросить</button>
            </div>
            <button className="sheet-close done" onClick={() => setPicker(false)}>Готово{has ? ` · ${chosen.length}` : ''}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- ШТОРМ (слот 5×3) ----------
const PITCH = 68
function stormTotal(f: string[][], stake: number, cells?: Set<string>) {
  let total = 0
  const lineBet = stake / PAYLINES.length
  for (const line of PAYLINES) {
    const s = f[0][line[0]]
    let run = 1
    while (run < 5 && f[run][line[run]] === s) run++
    if (run >= 3) { total += lineBet * STORM_PAY(s, run); if (cells) for (let i = 0; i < run; i++) cells.add(`${i},${line[i]}`) }
  }
  return Math.floor(total)
}

export function Storm({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(90)
  const [cols, setCols] = useState<string[][]>(() => Array.from({ length: 5 }, () => [pickSymbol(), pickSymbol(), pickSymbol()]))
  const [strips, setStrips] = useState<string[][] | null>(null) // во время спина: длинные ленты
  const [spinId, setSpinId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [hit, setHit] = useState<Set<string>>(new Set())
  const [win, setWin] = useState(0)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const shown = useCount(win)

  const spin = () => {
    if (busy || !ctx.charge(stake, 'Шторм — ставка')) return
    ctx.bump('storm'); play.whoosh()
    setWin(0); setHit(new Set()); setBusy(true)
    const gen = () => Array.from({ length: 5 }, () => Array.from({ length: 3 }, pickSymbol))
    let final = gen()
    if (stormTotal(final, stake) > 0 && rnd() < ctx.tilt() * 1.5) final = gen()
    setStrips(cols.map((cur, c) => [...cur, ...Array.from({ length: 12 }, pickSymbol), ...final[c]]))
    setSpinId(i => i + 1)
    for (let c = 0; c < 5; c++) timers.current.push(window.setTimeout(() => play.lock(), 900 + c * 280))
    timers.current.push(window.setTimeout(() => { setCols(final); setStrips(null); setBusy(false); settle(final) }, 900 + 4 * 280 + 120))
  }
  const settle = (f: string[][]) => {
    const cells = new Set<string>()
    const total = stormTotal(f, stake, cells)
    setHit(cells); setWin(total)
    if (total > 0) { ctx.pay(total, 'Шторм — выигрыш'); if (total >= stake * 5) play.big() } else ctx.notify('Комбинация не собрана')
  }
  return (
    <div className="storm">
      <SlotDefs />
      <div className={`cab ${win > 0 ? 'winning' : ''} ${busy ? 'spinning' : ''}`}>
        <div className="marquee"><Bulbs n={14} /><b>STORM</b><span>9 линий · 5 барабанов</span><Bulbs n={14} /></div>
        <div className="reels5">
          {cols.map((col, c) => (
            <div key={c} className="reel-win">
              {strips ? (
                <div key={spinId} className="strip run" style={{ ['--end' as string]: `${-(strips[c].length - 3) * PITCH}px`, ['--dur' as string]: `${0.9 + c * 0.28}s` }}>
                  {strips[c].map((s, i) => <div key={i} className="cell"><SlotSym s={s} /></div>)}
                </div>
              ) : (
                <div className="strip">{col.map((s, r) => <div key={r} className={`cell ${hit.has(`${c},${r}`) ? 'hit' : ''}`}><SlotSym s={s} /></div>)}</div>
              )}
              <i className="glass" />
            </div>
          ))}
          {win > 0 && <Burst key={win} type="gold" n={80} />}
        </div>
        </div>
      <details className="paytable"><summary>Таблица выплат</summary>
        <div className="pt-grid">{SYMBOLS.map(sy => <div key={sy}><span className="pt-sym"><SlotSym s={sy} /></span><small>3 · ×{STORM_PAY(sy, 3)}</small><small>4 · ×{STORM_PAY(sy, 4)}</small><small>5 · ×{STORM_PAY(sy, 5)}</small></div>)}</div>
        <p className="m small">Множители на ставку линии (ставка делится на 9 линий).</p>
      </details>
      {win > 0 ? <Result good>Выигрыш +{cfmt(shown)}</Result> : <p className="m small center">9 линий, выигрыш от 3 одинаковых символов слева направо. Ставка делится на линии.</p>}
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={busy} />
      <button className="cta" disabled={busy} onClick={spin}>{busy ? 'Барабаны крутятся…' : `Спин · ${cfmt(stake)}`}</button>
    </div>
  )
}

// ---------- БЫСТРЫЕ СЛОТЫ (3 барабана) ----------
export function Slots({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(20)
  const [reels, setReels] = useState(['💎', '7⭐', '🍀'])
  const [stopped, setStopped] = useState([true, true, true])
  const [busy, setBusy] = useState(false)
  const [win, setWin] = useState<number | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(t => { clearTimeout(t); clearInterval(t) }), [])
  const shown = useCount(win || 0)
  const spin = () => {
    if (busy || !ctx.charge(stake, 'Слоты — ставка')) return
    ctx.bump('slots'); play.whoosh()
    setBusy(true); setWin(null); setStopped([false, false, false])
    let final = [pickSymbol(), pickSymbol(), pickSymbol()]
    if (final[0] === final[1] && final[1] === final[2] && rnd() < ctx.tilt() * 1.5) final = [pickSymbol(), pickSymbol(), pickSymbol()]
    const st = [false, false, false]
    const iv = window.setInterval(() => setReels(r => r.map((s, i) => st[i] ? s : pickSymbol())), 60)
    timers.current.push(iv)
    final.forEach((s, i) => timers.current.push(window.setTimeout(() => {
      st[i] = true; play.lock()
      setReels(r => r.map((x, j) => j === i ? s : x)); setStopped([...st])
      if (i === 2) {
        clearInterval(iv)
        const w = final[0] === final[1] && final[1] === final[2] ? Math.floor(stake * SLOT3_PAY(final[0])) : 0
        setWin(w); setBusy(false)
        if (w > 0) { ctx.pay(w, 'Слоты — выигрыш'); play.big() } else ctx.notify('Комбинация не собрана')
      }
    }, 700 + i * 380)))
  }
  return (
    <div className="storm">
      <SlotDefs />
      <div className={`cab quick ${win ? 'winning' : ''} ${busy ? 'spinning' : ''}`}>
        <div className="marquee"><Bulbs n={10} /><b>QUICK SPIN</b><span>три в ряд</span><Bulbs n={10} /></div>
        <div className="reels three">
          {reels.map((s, i) => <div key={i} className={`cell big ${stopped[i] ? 'pop' : 'blur'} ${win ? 'hit' : ''}`}><SlotSym s={s} /><i className="glass" /></div>)}
          {!!win && <Burst key={win} type="gold" n={90} />}
        </div>
      </div>
      <details className="paytable"><summary>Таблица выплат</summary>
        <div className="pt-grid">{SYMBOLS.map(sy => <div key={sy}><span className="pt-sym"><SlotSym s={sy} /></span><small>3 · ×{SLOT3_PAY(sy)}</small></div>)}</div>
      </details>
      {win ? <Result good>Выигрыш +{cfmt(shown)}</Result> : <p className="m small center">Три одинаковых символа дают выигрыш. Самый редкий символ — бриллиант.</p>}
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={busy} presets={[5, 20, 100, 500]} />
      <button className="cta" disabled={busy} onClick={spin}>{busy ? 'Крутится…' : `Спин · ${cfmt(stake)}`}</button>
    </div>
  )
}

// ---------- КЕЙС (лента-рулетка, можно открыть сразу несколько) ----------
const CELL = 100
const QTYS = [1, 3, 5, 10]
// Лента рулетки заполняется подарками почти в пропорции их шансов (корень сглаживает, чтобы лента не была пустой): главный приз мелькает редко
const fillOf = (C: { pool: string[]; weights: number[] }) => weighted(C.pool, C.weights.map(w => Math.sqrt(w)))
const REEL_H = 92
function MultiReels({ kinds, C, onStop, onDone }: { kinds: GiftKind[]; C: { pool: string[]; weights: number[]; color: string }; onStop: (i: number) => void; onDone: () => void }) {
  const strips = useMemo(() => kinds.map(k => { const s = Array.from({ length: 26 }, () => fillOf(C)); s[22] = k; return s }), [kinds]) // eslint-disable-line react-hooks/exhaustive-deps
  const [go, setGo] = useState(false)
  const cb = useRef({ onStop, onDone }); cb.current = { onStop, onDone }
  useEffect(() => {
    const a = requestAnimationFrame(() => requestAnimationFrame(() => setGo(true)))
    const ts: number[] = []
    const D = 2300, GAP = Math.min(380, 2600 / kinds.length)
    kinds.forEach((_, i) => ts.push(window.setTimeout(() => cb.current.onStop(i), D + i * GAP)))
    ts.push(window.setTimeout(() => cb.current.onDone(), D + (kinds.length - 1) * GAP + 650))
    const tk = window.setInterval(() => play.roll(), 90); ts.push(tk)
    ts.push(window.setTimeout(() => clearInterval(tk), D + (kinds.length - 1) * GAP))
    return () => { cancelAnimationFrame(a); ts.forEach(t => { clearTimeout(t); clearInterval(t) }) }
  }, [kinds]) // eslint-disable-line react-hooks/exhaustive-deps
  const GAP = Math.min(380, 2600 / kinds.length)
  return (
    <div className="mreels" style={{ ['--cc' as string]: C.color }}>
      {strips.map((s, i) => (
        <div key={i} className="mreel" style={{ height: REEL_H }}>
          <div className="mreel-strip" style={{ transform: `translateY(${go ? -22 * REEL_H : 0}px)`, transition: go ? `transform ${2.3 + i * GAP / 1000}s cubic-bezier(.12,.7,.12,1)` : 'none' }}>
            {s.map((k, j) => <div key={j} style={{ height: REEL_H }}><GiftArt kind={k} size={62} glow={false} /></div>)}
          </div>
        </div>
      ))}
    </div>
  )
}

function StaticReels({ n, C }: { n: number; C: { pool: string[]; weights: number[]; color: string } }) {
  const kinds = useMemo(() => Array.from({ length: n }, () => fillOf(C)), [n]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mreels idle" style={{ ['--cc' as string]: C.color }}>
      {kinds.map((k, i) => <div key={i} className="mreel" style={{ height: REEL_H }}><div className="mreel-static"><GiftArt kind={k} size={62} glow={false} /></div></div>)}
    </div>
  )
}

export function Cases({ ctx, caseId }: { ctx: Ctx; caseId?: string | null }) {
  const C = CASES.find(c => c.id === caseId) || CASES[0] || { id: '', name: '', cat: '', color: '#fff', pool: [] as string[], weights: [] as number[], price: 0, ev: 0, jp: '', jpChance: 0 }
  const [phase, setPhase] = useState<'idle' | 'shake' | 'roll' | 'done'>('idle')
  const [strip, setStrip] = useState<GiftKind[]>(() => Array.from({ length: 12 }, () => fillOf(C)))
  const [x, setX] = useState(0)
  const [anim, setAnim] = useState(false)
  const [win, setWin] = useState(36)
  const [got, setGot] = useState<Gift | null>(null)
  const [qty, setQty] = useState(1)               // сколько кейсов открыть за раз
  const [multi, setMulti] = useState<Gift[] | null>(null)
  const [reels, setReels] = useState<{ kinds: GiftKind[]; gifts: Gift[] } | null>(null)
  const owed = useRef<string | null>(null)
  const ctxRef = useRef(ctx); ctxRef.current = ctx
  useEffect(() => () => { if (owed.current) { const k = owed.current; owed.current = null; ctxRef.current.addGift(k, 'Кейс — подарок') } }, [])
  const [spent, setSpent] = useState(0)
  const [fast, setFast] = useState(false) // быстрое открытие без рулетки
  const view = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  useEffect(() => {
    if (phase !== 'roll') return
    let raf = 0, last = -1
    const f = () => {
      const m = matrixOf(track.current)
      if (m) { const idx = Math.floor((-m[4] + (view.current?.clientWidth || 0) / 2) / CELL); if (idx !== last) { last = idx; play.tick() } }
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const open = () => {
    if ((phase === 'shake' || phase === 'roll') || !C.pool.length || !ctx.charge(C.price * qty, qty > 1 ? `Кейс — открытие ×${qty}` : 'Кейс — открытие')) return
    for (let i = 0; i < qty; i++) ctx.bump('cases')
    setMulti(null); setSpent(C.price * qty)
    const prices = ctx.save.prices

    if (qty > 1) { // несколько кейсов сразу: все подарки выпадают разом, без рулетки
      const kinds = Array.from({ length: qty }, () => weighted(C.pool, C.weights))
      ctx.tally(0, kinds.reduce((a, k) => a + (prices[k] || 0), 0))
      setGot(null); setPhase('shake'); play.creak()
      const ready = Promise.race([Promise.all([...new Set(kinds)].map(k => preloadGift(k, false))), new Promise(r => timers.current.push(window.setTimeout(r, 1500)))])
      const minWait = new Promise(r => timers.current.push(window.setTimeout(r, 900)))
      Promise.all([ready, minWait]).then(() => {
        const gifts = kinds.map(k => ctx.addGift(k, 'Кейс — подарок')) // подарки выдаются сразу, анимация только показывает результат
        if (!alive.current) return
        setReels({ kinds, gifts }); setPhase('roll'); play.rev()
      })
      return
    }

    const kind = weighted(C.pool, C.weights) // шансы ровно те, что показаны в списке «Что внутри»
    ctx.tally(0, prices[kind] || 0)
    if (fast) { setGot(ctx.addGift(kind, 'Кейс — подарок')); setPhase('done'); caseSound(kind); return }

    // Новая лента продолжает старую: видимые сейчас подарки остаются на тех же местах, поэтому ничего не пропадает и не мигает
    const KEEP = 10, WIN = KEEP + 30
    const a = Math.max(0, Math.floor(-x / CELL))
    const keep = strip.slice(a, a + KEEP)
    while (keep.length < KEEP) keep.push(fillOf(C))
    const s = [...keep, ...Array.from({ length: 40 }, () => fillOf(C))]
    s[WIN] = kind
    const off = Math.min(0, x + a * CELL)
    setGot(null); setPhase('shake'); play.creak()

    // пока кейс трясётся, подгружаем картинки и анимации новых подарков (не дольше 1,5 с)
    const ready = Promise.race([Promise.all([...new Set(s)].map(k => preloadGift(k, k === kind))), new Promise(r => timers.current.push(window.setTimeout(r, 1500)))])
    const minWait = new Promise(r => timers.current.push(window.setTimeout(r, 700)))
    Promise.all([ready, minWait]).then(() => {
      if (!alive.current) { ctx.addGift(kind, 'Кейс — подарок'); return }
      owed.current = kind
      setAnim(false); setStrip(s); setX(off); setWin(WIN)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!alive.current) { ctx.addGift(kind, 'Кейс — подарок'); return }
        const vw = view.current?.clientWidth || 340
        const final = -(WIN * CELL + CELL / 2 - vw / 2 + (rnd() - 0.5) * (CELL * 0.6))
        setPhase('roll'); setAnim(true); setX(final); owed.current = kind
        timers.current.push(window.setTimeout(() => {
          owed.current = null; setGot(ctx.addGift(kind, 'Кейс — подарок')); setPhase('done'); caseSound(kind)
        }, 5400))
      }))
    })
  }
  const caseSound = (kind: string) => { const v = ctx.save.prices[kind] || 0; if (kind === C.jp && C.jpChance < 3) play.jackpot(); else if (v >= C.price * 5) play.big(); else if (v >= C.price) play.chime(2); else play.chime(1) }
  const busy = phase === 'shake' || phase === 'roll'
  const multiWorth = multi ? multi.reduce((a, g) => a + (ctx.save.prices[g.kind] || 0), 0) : 0
  const multiSell = multi ? multi.reduce((a, g) => a + Math.floor((ctx.save.prices[g.kind] || 0) * SELL_RATE), 0) : 0
  return (
    <div className="cases">
      {C.jp && GIFTS[C.jp] && <div className="jp-box" style={{ ['--cc' as string]: C.color }}>
        <GiftArt kind={C.jp} size={54} glow={false} />
        <div><small>Главный приз</small><b>{GIFTS[C.jp].name}</b><span>≈{cfmt(GIFTS[C.jp].base)} · ×{(GIFTS[C.jp].base / Math.max(1, C.price)).toFixed(GIFTS[C.jp].base / Math.max(1, C.price) >= 10 ? 0 : 1).replace('.', ',')} от цены кейса</span></div>
        <i>{pctText(C.jpChance)}</i>
      </div>}
      {'pAbove' in C && C.pAbove > 0 && <p className="up-chance">Шанс выбить подарок дороже кейса: <b>{pctText(C.pAbove)}</b>{C.pAbove - C.pBig > 0.5 && <> · дороже вдвое: <b>{pctText(C.pBig)}</b></>}</p>}
      {reels && phase === 'roll'
        ? <MultiReels kinds={reels.kinds} C={C} onStop={i => { const v = ctx.save.prices[reels.kinds[i]] || 0; v >= C.price * 2 ? play.sparkle() : play.lock() }} onDone={() => { const gs = reels.gifts; setReels(null); setMulti(gs); setPhase('done'); const tot = gs.reduce((s, x) => s + (ctx.save.prices[x.kind] || 0), 0); if (gs.some(x => x.kind === C.jp && C.jpChance < 3)) play.jackpot(); else if (tot >= C.price * gs.length) play.big(); else play.chime(1) }} />
        : multi
        ? <div className="multi-grid" style={{ ['--cc' as string]: C.color }}>
          {multi.map((g, i) => {
            const pr = ctx.save.prices[g.kind] || 0
            return <div key={g.uid} className={`multi-item ${pr > C.price ? 'up' : ''}`} style={{ animationDelay: `${i * 0.08}s` }}>
              <GiftArt kind={g.kind} size={56} />
              <b>{GIFTS[g.kind]?.name}</b>
              <span className="gold">{cfmt(pr)}</span>
            </div>
          })}
          <Burst key={multi[0]?.uid} type="confetti" n={90} />
        </div>
        : qty > 1
          ? <StaticReels n={qty} C={C} />
          : fast
            ? <div className="fast-slot" style={{ ['--cc' as string]: C.color }}>{got ? <><GiftArt kind={got.kind} size={84} /><b>{GIFTS[got.kind]?.name}</b></> : <i>?</i>}</div>
          : <div className={`roll-view ${phase}`} ref={view}>
          <div className="roll-marker" />
          <div ref={track} className="roll-track" style={{ transform: `translateX(${x}px)`, transition: anim ? 'transform 5.2s cubic-bezier(.08,.6,.06,1)' : 'none' }}>
            {strip.map((k, i) => (
              <div key={i} className={`roll-cell ${phase === 'done' && i === win ? 'won' : ''}`} style={{ width: CELL }}>
                <GiftArt kind={k} size={76} animate={phase === 'done' && i === win} />
              </div>
            ))}
          </div>
          {phase === 'done' && <Burst key="d" type="confetti" n={got && got.kind === C.jp && C.jpChance < 3 ? 260 : 90} />}
        </div>}
      {multi
        ? <Result good={multiWorth >= spent}>Выпало {multi.length} · ≈{cfmt(multiWorth)} (потрачено {cfmt(spent)})</Result>
        : got
          ? <Result good>{got.kind === C.jp && C.jpChance < 3 ? 'ДЖЕКПОТ! ' : (ctx.save.prices[got.kind] || 0) >= C.price * 5 ? 'Крупный выигрыш! ' : ''}Выпало: {GIFTS[got.kind]?.name} · ≈{cfmt(ctx.save.prices[got.kind])}</Result>
          : <p className="m small center">Внутри один из {C.pool.length} подарков. Чаще всего {GIFTS[C.pool[0]]?.name} ({caseOddsOf(C, 0).toFixed(0)}%), реже всего {GIFTS[C.pool[C.pool.length - 1]]?.name} ({caseOddsOf(C, C.pool.length - 1).toFixed(2).replace('.', ',')}%).</p>}
      <div className="optrow"><span className="m small">Открыть сразу</span>
        {QTYS.map(v => <button key={v} className={qty === v ? 'on' : ''} disabled={busy} onClick={() => { setQty(v); play.click() }}>×{v}</button>)}
      </div>
      {qty === 1 && <label className="fastopt"><input type="checkbox" checked={fast} disabled={busy} onChange={e => setFast(e.target.checked)} /> Быстрое открытие</label>}
      {multi && !busy && <button className="cta ghost" onClick={() => { ctx.pay(multiSell, `Продажа — кейсы ×${multi.length}`); multi.forEach(g => ctx.removeGift(g.uid)); setMulti(null); setPhase('idle'); play.coin() }}>Продать все за {cfmt(multiSell)}</button>}
      {got && !busy && <button className="cta ghost" onClick={() => { const v = Math.floor(ctx.save.prices[got.kind] * SELL_RATE); ctx.removeGift(got.uid); ctx.pay(v, `Продажа — ${GIFTS[got.kind]?.name}`); setGot(null); setPhase('idle'); play.coin() }}>Продать за {cfmt(Math.floor(ctx.save.prices[got.kind] * SELL_RATE))}</button>}
      <button className="cta" disabled={busy || ctx.save.balance < C.price * qty} onClick={open}>{busy ? 'Открываем…' : `Открыть${qty > 1 ? ` ×${qty}` : ''} · ${cfmt(C.price * qty)}`}</button>
      <h3 className="sub-title">Что внутри · {C.name}</h3>
      <div className="case-items">
        {C.pool.map((k, i) => ({ k, i })).sort((a, b) => GIFTS[b.k].base - GIFTS[a.k].base).map(({ k, i }) => (
          <div key={k} className={`case-item ${GIFTS[k].base > C.price ? 'up' : ''}`}>
            <GiftArt kind={k} size={52} glow={false} />
            <b>{GIFTS[k].name}</b>
            <span className="gold">{cfmt(GIFTS[k].base)}</span>
            <i>{caseOddsOf(C, i) < 1 ? caseOddsOf(C, i).toFixed(2).replace('.', ',') : caseOddsOf(C, i).toFixed(1).replace('.', ',')}%</i>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- МИНЫ ----------
export function Mines({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(50)
  const [bn, setBn] = useState(3) // число мин на поле
  const [bombs, setBombs] = useState<Set<number> | null>(null)
  const [open, setOpen] = useState<number[]>([])
  const [over, setOver] = useState<'none' | 'boom' | 'cash'>('none')
  const active = !!bombs && over === 'none'
  const mult = minesMult(open.length, bn)
  const start = () => {
    if (!ctx.charge(stake, 'Мины — ставка')) return
    ctx.bump('mines'); play.click()
    const b = new Set<number>()
    while (b.size < bn) b.add(rint(MINES_TOTAL))
    setBombs(b); setOpen([]); setOver('none')
  }
  const tap = (i: number) => {
    if (!active || open.includes(i)) return
    setOpen(o => [...o, i])
    if (!bombs!.has(i) && open.length >= 1 && rnd() < ctx.tilt() * 0.35) { const nb = new Set(bombs!); nb.add(i); setBombs(nb); bombs!.add(i) }
    if (bombs!.has(i)) { setOver('boom'); play.boom(); play.lose(); ctx.notify('Мина! Ставка сгорела'); return }
    play.ding(open.length)
    if (open.length + 1 === MINES_TOTAL - bn) cashOut(open.length + 1)
  }
  const cashOut = (k = open.length) => {
    if (!active || k === 0) return
    setOver('cash'); ctx.pay(Math.floor(stake * minesMult(k, bn)), 'Мины — выигрыш')
  }
  return (
    <div className="mines">
      <div className={`mgrid ${over === 'boom' ? 'shake-grid' : ''}`}>
        {Array.from({ length: MINES_TOTAL }, (_, i) => {
          const isOpen = open.includes(i), isBomb = !!bombs?.has(i), reveal = over !== 'none' && !isOpen
          const flipped = isOpen || reveal
          return (
            <button key={i} disabled={!active} onClick={() => tap(i)} className={`mcell ${flipped ? 'flip' : ''} ${reveal ? 'ghost' : ''}`} aria-label={`Клетка ${i + 1}`}>
              {flipped
                ? <span className={`face ${isBomb ? 'bomb' : 'safe'}`}>{isBomb ? '💣' : '💎'}</span>
                : <span className="face front" />}
            </button>
          )
        })}
        {over === 'boom' && <Burst key="boom" type="ember" n={80} />}
        {over === 'cash' && <Burst key="cash" type="gold" n={80} />}
      </div>
      <p className="m small center">Мин: {bn}. Сейчас ×{mult.toFixed(2)}{active && open.length ? ` · забрать ${cfmt(Math.floor(stake * mult))}` : ''}</p>
      {over === 'cash' && <Result good>Забрано +{cfmt(Math.floor(stake * mult))}</Result>}
      <div className="optrow"><span className="m small">Мин</span>
        {[1, 3, 5, 8, 12].map(v => <button key={v} className={bn === v ? 'on' : ''} disabled={active} onClick={() => setBn(v)}>{v}</button>)}
      </div>
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={active} />
      {active
        ? <button className="cta green" disabled={!open.length} onClick={() => cashOut()}>Забрать {cfmt(Math.floor(stake * mult))}</button>
        : <button className="cta" onClick={start}>{bombs ? 'Новый раунд' : 'Начать'} · {cfmt(stake)}</button>}
    </div>
  )
}

// ---------- PLINKO (отскоки по колышкам) ----------
// Исход выбирается до броска: на каждом колышке шар уходит влево или вправо с шансом 50/50, поэтому ячейки выпадают
// ровно с теми вероятностями, на которых посчитаны множители. Анимация не «симулирует» физику заново, а проигрывает
// готовую траекторию из параболических прыжков от колышка к колышку: шар не может застрять или зависнуть.
export function Plinko({ ctx }: { ctx: Ctx }) {
  const ROWS = 8, W = 300, SX = 30, SY = 25, TOP = 28
  const [stake, setStake] = useState(50)
  const [ball, setBall] = useState<{ x: number; y: number; s: number; trail: { x: number; y: number }[] } | null>(null)
  const [hot, setHot] = useState<string | null>(null)
  const [landed, setLanded] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [risk, setRisk] = useState<PlinkoRisk>('mid')
  const MULTS = PLINKO_RISK[risk]
  const raf = useRef(0)
  const pending = useRef<{ w: number } | null>(null) // выигрыш бросающегося шара: выдаём, даже если игрок ушёл с экрана
  const ctxRef = useRef(ctx); ctxRef.current = ctx
  useEffect(() => () => {
    cancelAnimationFrame(raf.current)
    const p = pending.current
    if (p) { pending.current = null; if (p.w > 0) ctxRef.current.pay(p.w, 'Plinko — выигрыш') }
  }, [])
  const pegX = (r: number, c: number) => W / 2 + (c - (r + 1) / 2) * SX   // ряд r содержит r+2 колышка
  const pegY = (r: number) => TOP + r * SY
  const drop = () => {
    if (busy || !ctx.charge(stake, 'Plinko — ставка')) return
    ctx.bump('plinko'); play.whoosh()
    setBusy(true); setLanded(null); setHot(null)

    // ---- исход ----
    const steps: number[] = Array.from({ length: ROWS }, () => (rnd() < 0.5 ? 0 : 1))
    const kk: number[] = []
    for (let r = 0, k = 0; r < ROWS; r++) { k += steps[r]; kk.push(k) } // номер колышка в ряду r, по которому ударит шар
    const slot = kk[ROWS - 1]
    const mult = MULTS[slot]
    const win = Math.floor(stake * mult)
    pending.current = { w: win }

    // ---- траектория ----
    const G = 640, R = 5.6, RP = 3.2, M = R + RP, OFF = 3.2
    const BW = W / (ROWS + 1), WALL_TOP = 216
    const FLOOR = pegY(ROWS - 1) + 59 // дно ячейки с множителем
    const binX = W / 2 + (slot - ROWS / 2) * BW
    // в какую сторону шар уходит с колышка ряда r (последний колышек отправляет его к центру своей ячейки)
    const dir = (r: number) => {
      if (r + 1 < ROWS) return steps[r + 1] ? 1 : -1
      const d = binX - pegX(r, kk[r])
      return Math.abs(d) > 1.5 ? Math.sign(d) : rnd() < 0.5 ? 1 : -1
    }
    // шар всегда падает чуть сбоку от вершины колышка (так он и должен отскакивать, а не балансировать на нём)
    const contact = (r: number) => {
      const off = OFF + (rnd() - 0.5) * 1.2
      return { x: pegX(r, kk[r]) + dir(r) * off, y: pegY(r) - Math.sqrt(M * M - off * off) }
    }
    type Seg = { t0: number; dur: number; x0: number; y0: number; vx: number; vy: number; peg?: string; ease?: boolean; bump?: number }
    const segs: Seg[] = []
    const hop = (t0: number, from: { x: number; y: number }, to: { x: number; y: number }, vy0: number, peg?: string): Seg => {
      const dur = (-vy0 + Math.sqrt(vy0 * vy0 + 2 * G * (to.y - from.y))) / G
      return { t0, dur, x0: from.x, y0: from.y, vx: (to.x - from.x) / dur, vy: vy0, peg }
    }
    const first = contact(0)
    const start = { x: first.x, y: -6 }
    segs.push({ t0: 0, dur: Math.sqrt((2 * (first.y - start.y)) / G), x0: start.x, y0: start.y, vx: 0, vy: 0, peg: `0-${kk[0]}` })
    let t = segs[0].dur, prev = first
    for (let r = 1; r < ROWS; r++) {
      const c = contact(r)
      const sg = hop(t, prev, c, -(62 + rnd() * 14), `${r}-${kk[r]}`)
      segs.push(sg); t += sg.dur; prev = c
    }
    const land = { x: binX + (rnd() - 0.5) * 8, y: FLOOR - R }
    const fin = hop(t, prev, land, -(62 + rnd() * 14))
    fin.ease = true // последний прыжок: шар быстро выходит на середину своей ячейки, до перегородок
    // шар обязан огибать колышки последнего ряда: подбираем боковой изгиб траектории, чтобы нигде не было пересечения
    const bump = dir(ROWS - 1)
    const lastPegs = Array.from({ length: ROWS + 1 }, (_, c) => ({ x: pegX(ROWS - 1, c), y: pegY(ROWS - 1) }))
    const finX = (u: number, A: number) => {
      const k = 1 - Math.pow(1 - u / fin.dur, 3)
      return fin.x0 + (land.x - fin.x0) * k + bump * A * Math.sin(Math.PI * u / fin.dur)
    }
    let A = 0
    for (; A < 16; A += 0.5) {
      let ok = true
      for (let i = 0; i <= 60 && ok; i++) {
        const u = (fin.dur * i) / 60, x = finX(u, A), y = fin.y0 + fin.vy * u + 0.5 * G * u * u
        for (const p of lastPegs) if (Math.hypot(x - p.x, y - p.y) < M - 0.3) { ok = false; break }
      }
      if (ok) break
    }
    fin.bump = A * bump
    segs.push(fin); t += fin.dur
    const landAt = t
    const B1 = 0.3, B2 = 0.2, END = landAt + B1 + B2 + 0.45 // два затухающих подскока на дне и пауза
    const lo = slot * BW + R + 1.5, hi = (slot + 1) * BW - R - 1.5
    const place = (el: number) => {
      let x: number, y: number
      if (el >= landAt) {
        const e = el - landAt
        x = land.x
        y = land.y
        if (e < B1) y -= 13 * 4 * (e / B1) * (1 - e / B1)
        else if (e < B1 + B2) { const u = (e - B1) / B2; y -= 5 * 4 * u * (1 - u) }
      } else {
        const sg = segs.find(s => el < s.t0 + s.dur) || segs[segs.length - 1]
        const u = Math.min(el - sg.t0, sg.dur)
        const k = sg.ease ? 1 - Math.pow(1 - u / sg.dur, 3) : 0
        x = sg.ease ? sg.x0 + (land.x - sg.x0) * k + (sg.bump || 0) * Math.sin(Math.PI * u / sg.dur) : sg.x0 + sg.vx * u
        y = sg.y0 + sg.vy * u + 0.5 * G * u * u
      }
      if (y + R > WALL_TOP) x = Math.max(lo, Math.min(hi, x)) // перегородки между ячейками
      return { x, y }
    }

    const trail: { x: number; y: number }[] = []
    let hit = 0, hotAt = -1
    const t0 = performance.now()
    const f = (now: number) => {
      const el = (now - t0) / 1000
      // удары по колышкам: подсветка и тик
      while (hit < segs.length && segs[hit].peg && el >= segs[hit].t0 + segs[hit].dur) { setHot(segs[hit].peg!); hotAt = el; play.bounce(hit); hit++ }
      if (hit < segs.length && !segs[hit].peg) hit = segs.length
      if (hotAt >= 0 && el - hotAt > 0.12) { hotAt = -1; setHot(null) }
      const p = place(Math.min(el, END))
      trail.push(p); if (trail.length > 7) trail.shift()
      setBall({ x: p.x, y: p.y, s: hit, trail: [...trail] })
      if (el >= END) {
        pending.current = null
        setBall(null); setHot(null); setLanded(slot); setBusy(false)
        if (win > 0) { ctx.pay(win, 'Plinko — выигрыш'); if (mult >= 3) play.big() }
        return
      }
      raf.current = requestAnimationFrame(f)
    }
    raf.current = requestAnimationFrame(f)
  }
  const bw = W / (ROWS + 1)
  return (
    <div className="plinko">
      <svg viewBox="0 0 300 275" className="pboard" role="img" aria-label="Поле Plinko с множителями">
        <defs>
          <radialGradient id="pb" cx=".35" cy=".3"><stop offset="0" stopColor="#fff6d0" /><stop offset="1" stopColor="#f0a21b" /></radialGradient>
          <linearGradient id="pbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1d2b36" /><stop offset="1" stopColor="#2b4a43" /></linearGradient>
          <radialGradient id="ppeg" cx=".35" cy=".3"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#8fb3a2" /></radialGradient>
          <filter id="pglow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <rect x="0" y="0" width="300" height="275" rx="18" fill="url(#pbg)" />
        
        {Array.from({ length: 14 }, (_, i) => <circle key={`s${i}`} cx={(i * 47 + 13) % 296 + 2} cy={(i * 29 + 7) % 190 + 4} r={0.8} fill="#dff7ec" opacity={0.25 + (i % 3) * 0.12} />)}
        {Array.from({ length: ROWS }, (_, r) => Array.from({ length: r + 2 }, (_, c) => {
          const on = hot === `${r}-${c}`
          return <g key={`${r}-${c}`}>
            {on && <circle cx={pegX(r, c)} cy={pegY(r)} r={9} fill="#FFE08A" opacity={0.35} />}
            <circle cx={pegX(r, c)} cy={pegY(r)} r={on ? 4.6 : 3.2} fill={on ? '#FFE08A' : 'url(#ppeg)'} filter={on ? 'url(#pglow)' : undefined} />
          </g>
        }))}
        {Array.from({ length: ROWS + 2 }, (_, i) => <rect key={`w${i}`} x={i * bw - 1.2} y={216} width={2.4} height={52} rx={1.2} fill="#7fb59d" opacity={0.85} />)}
        {MULTS.map((m, i) => {
          const cx = W / 2 + (i - ROWS / 2) * bw, w = bw - 5, on = landed === i || (!!ball && ball.y > 222 && Math.floor(ball.x / bw) === i)
          const hi = m >= 3, lo = m < 1
          return <g key={`b${i}`} transform={on ? 'translate(0 -3)' : undefined}>
            <rect x={cx - w / 2} y={238} width={w} height={28} rx={6} fill={on ? '#ffd166' : hi ? '#5b3d12' : lo ? '#4a2436' : '#2f5646'} stroke={on ? '#fff3c4' : hi ? '#b8892e' : lo ? '#7a3b57' : '#4f8a73'} strokeWidth={on ? 1.6 : 1} />
            <text x={cx} y={256} textAnchor="middle" fontSize={m >= 10 ? 10 : 11.5} fontWeight={800} fill={on ? '#1a1304' : hi ? '#ffc24b' : lo ? '#ff9db8' : '#d6efe2'}>{m}×</text>
          </g>
        })}
        {ball && <>
          {ball.trail.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2 + i * 0.5} fill="#FFC24B" opacity={0.04 + i * 0.03} />)}
          <circle cx={ball.x} cy={ball.y} r="9" fill="#FFC24B" opacity=".22" /><circle cx={ball.x} cy={ball.y} r="5.6" fill="url(#pb)" />
        </>}
      </svg>
      {landed !== null && <Result good={MULTS[landed] >= 1}>×{MULTS[landed]} · {MULTS[landed] >= 1 ? '+' : ''}{cfmt(Math.floor(stake * MULTS[landed]))}</Result>}
      <div className="optrow"><span className="m small">Риск</span>
        {([['low', 'Низкий'], ['mid', 'Средний'], ['high', 'Высокий']] as [PlinkoRisk, string][]).map(([v, t]) => <button key={v} className={risk === v ? 'on' : ''} disabled={busy} onClick={() => setRisk(v)}>{t}</button>)}
      </div>
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={busy} />
      <button className="cta" disabled={busy} onClick={drop}>{busy ? 'Шар падает…' : `Бросить · ${cfmt(stake)}`}</button>
      <p className="m small center">На каждом колышке шар уходит влево или вправо с шансом 50/50.</p>
    </div>
  )
}

// ---------- БЛЭКДЖЕК ----------
type Card = { r: string; v: number; s: string }
const mkDeck = (): Card[] => {
  const d: Card[] = []
  for (const s of ['♠', '♥', '♦', '♣']) for (const [r, v] of [['A', 11], ['2', 2], ['3', 3], ['4', 4], ['5', 5], ['6', 6], ['7', 7], ['8', 8], ['9', 9], ['10', 10], ['J', 10], ['Q', 10], ['K', 10]] as [string, number][]) d.push({ r, v, s })
  for (let i = d.length - 1; i > 0; i--) { const j = rint(i + 1); [d[i], d[j]] = [d[j], d[i]] }
  return d
}
const score = (h: Card[]) => {
  let t = h.reduce((a, c) => a + c.v, 0), aces = h.filter(c => c.r === 'A').length
  while (t > 21 && aces) { t -= 10; aces-- }
  return t
}
const CardView = ({ c, hidden, i }: { c: Card; hidden?: boolean; i: number }) =>
  <div className={`pcard deal ${hidden ? 'back' : c.s === '♥' || c.s === '♦' ? 'red' : ''}`} style={{ animationDelay: `${i * 0.12}s` }}>{hidden ? '' : <>{c.r}<small>{c.s}</small></>}</div>

export function Blackjack({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(50)
  const [deck, setDeck] = useState<Card[]>([])
  const [pl, setPl] = useState<Card[]>([])
  const [de, setDe] = useState<Card[]>([])
  const [phase, setPhase] = useState<'bet' | 'play' | 'done'>('bet')
  const [msg, setMsg] = useState('')
  const [locked, setLocked] = useState(0)
  const finish = (p: Card[], d: Card[], bet: number, natural = false) => {
    const ps = score(p), ds = score(d)
    let pay = 0, text = ''
    if (ps > 21) text = 'Перебор'
    else if (natural && ds !== 21) { pay = Math.floor(bet * 2.2); text = 'Блэкджек!' }
    else if (ds > 21 || ps > ds) { pay = bet * 2; text = 'Победа' }
    else if (ps === ds) { pay = ps === 21 ? bet : 0; text = ps === 21 ? 'Ничья, ставка возвращена' : 'Ничья: выигрывает дилер' }
    else text = 'Проигрыш'
    setMsg(text); setPhase('done')
    if (pay > bet) play.big(); else if (pay === 0) play.lose()
    if (pay > 0) ctx.pay(pay, `Блэкджек — ${text.toLowerCase()}`)
  }
  const deal = () => {
    if (!ctx.charge(stake, 'Блэкджек — ставка')) return
    ctx.bump('blackjack'); play.card()
    const d = mkDeck()
    const p = [d.pop()!, d.pop()!], dl = [d.pop()!, d.pop()!]
    if (rnd() < ctx.tilt() * 0.5) { const bi = d.reduce((m, c, i) => (c.v > d[m].v ? i : m), 0); if (d[bi].v > dl[1].v) [dl[1], d[bi]] = [d[bi], dl[1]] } // скрытая карта дилера
    setDeck(d); setPl(p); setDe(dl); setLocked(stake); setMsg(''); setPhase('play')
    if (score(p) === 21) finish(p, dl, stake, true)
  }
  const hit = () => {
    const d = [...deck], p = [...pl, d.pop()!]
    play.card(); setDeck(d); setPl(p)
    if (score(p) >= 21) stand(p, d)
  }
  const dbl = () => {
    if (pl.length !== 2 || !ctx.charge(locked, 'Блэкджек — удвоение', false)) return
    const d = [...deck], p = [...pl, d.pop()!]
    play.card(); setDeck(d); setPl(p); setLocked(locked * 2)
    stand(p, d, locked * 2)
  }
  const stand = (p = pl, d0 = deck, bet = locked) => {
    const d = [...d0], dl = [...de]
    while (score(dl) < 17) dl.push(d.pop()!)
    setDe(dl); setDeck(d); finish(p, dl, bet)
  }
  return (
    <div className="bj">
      <div className="felt">
        <div className="hand"><span className="m small">Дилер {phase === 'play' ? '' : de.length ? score(de) : ''}</span>
          <div className="cards">{de.map((c, i) => <CardView key={`${phase === 'play' ? 'p' : 'r'}${i}${c.r}${c.s}`} c={c} hidden={phase === 'play' && i === 1} i={i} />)}</div></div>
        <div className="hand"><span className="m small">Ты {pl.length ? score(pl) : ''}</span>
          <div className="cards">{pl.map((c, i) => <CardView key={`${i}${c.r}${c.s}`} c={c} i={i} />)}</div></div>
      </div>
      {msg && <Result good={/Победа|Блэкджек!/.test(msg)}>{msg}</Result>}
      {phase !== 'play' && <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} />}
      {phase === 'play'
        ? <div className="two three"><button className="cta ghost" onClick={hit}>Ещё</button><button className="cta" onClick={() => stand()}>Хватит</button><button className="cta gold" disabled={pl.length !== 2 || ctx.save.balance < locked} onClick={dbl}>×2</button></div>
        : <button className="cta" onClick={deal}>Раздать · {cfmt(stake)}</button>}
      <p className="m small center">Блэкджек платит 6:5, дилер берёт до 17, при равных очках (кроме 21) выигрывает дилер.</p>
    </div>
  )
}

// ---------- ОСОБНЯК (этажи с призраками) ----------
// На каждом этаже n дверей, за одной из них призрак. Прошёл этаж: множитель растёт. Можно забрать выигрыш на любом этаже.
// Шанс пройти этаж (n-1)/n, множитель после k этажей = 90% · (n/(n-1))^k, поэтому отдача при любой стратегии ровно 90%.
const HOUSE_RTP = 0.84
const floorsFor = (n: number) => (n === 2 ? 5 : n === 3 ? 6 : 7) // с двумя дверями множители растут быстрее, поэтому этажей меньше: максимум около ×29

function MansionRoof({ glow, scared }: { glow: boolean; scared: boolean }) {
  return (
    <svg className={`mn-roof ${glow ? 'glow' : ''} ${scared ? 'scared' : ''}`} viewBox="0 0 340 120" aria-hidden="true">
      <defs>
        <linearGradient id="mnSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#141a33" /><stop offset="1" stopColor="#3b3560" /></linearGradient>
        <radialGradient id="mnMoon" cx=".4" cy=".4"><stop offset="0" stopColor="#fffbe6" /><stop offset="1" stopColor="#e9d9a0" /></radialGradient>
        <linearGradient id="mnTile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5b3a63" /><stop offset="1" stopColor="#2d1d3a" /></linearGradient>
        <radialGradient id="mnLamp" cx=".5" cy=".5"><stop offset="0" stopColor="#ffe08a" /><stop offset="1" stopColor="#ffe08a" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="340" height="120" fill="url(#mnSky)" />
      {Array.from({ length: 22 }, (_, i) => <circle key={i} cx={(i * 61 + 11) % 336 + 2} cy={(i * 37 + 5) % 70 + 3} r={0.7 + (i % 3) * 0.3} fill="#fff" opacity={0.35 + (i % 4) * 0.15} />)}
      <circle cx="280" cy="30" r="40" fill="#fff6c8" opacity=".08" />
      <circle cx="280" cy="30" r="17" fill="url(#mnMoon)" />
      <circle cx="274" cy="26" r="3.2" fill="#d8c98a" opacity=".6" /><circle cx="286" cy="35" r="2.4" fill="#d8c98a" opacity=".6" />
      <g className="mn-bats">
        <path className="bat b1" d="M60 36c4-6 8-3 10 0c2-3 6-6 10 0c-4-2-6 0-10 4c-4-4-6-6-10-4z" fill="#0b0d18" />
        <path className="bat b2" d="M120 22c3-5 6-2 8 0c2-2 5-5 8 0c-3-1-5 0-8 3c-3-3-5-4-8-3z" fill="#0b0d18" />
        <path className="bat b3" d="M214 48c3-5 6-2 8 0c2-2 5-5 8 0c-3-1-5 0-8 3c-3-3-5-4-8-3z" fill="#0b0d18" />
      </g>
      <rect x="236" y="48" width="16" height="40" fill="#241631" /><rect x="233" y="44" width="22" height="7" fill="#37224a" />
      <g className="mn-smoke"><circle cx="244" cy="36" r="4" /><circle cx="247" cy="28" r="5" /><circle cx="243" cy="19" r="6" /></g>
      <path d="M20 112L170 26L320 112Z" fill="url(#mnTile)" stroke="#6e4b7d" strokeWidth="2" strokeLinejoin="round" />
      <path d="M44 106L170 36L296 106" fill="none" stroke="#7d5890" strokeWidth="1" opacity=".5" />
      <rect x="158" y="14" width="24" height="3" rx="1.5" fill="#6e4b7d" /><path d="M170 14v-9M163 9h14" stroke="#9a78ad" strokeWidth="2" strokeLinecap="round" />
      <circle cx="170" cy="76" r="17" fill="url(#mnLamp)" opacity={glow ? 1 : 0.55} className="mn-lamp" />
      <circle cx="170" cy="76" r="11" fill="#1b1128" stroke="#9a78ad" strokeWidth="2" />
      <path d="M170 65v22M159 76h22" stroke="#9a78ad" strokeWidth="1.5" />
      <circle cx="170" cy="76" r="8" fill={glow ? '#ffd166' : '#ffe08a'} opacity={glow ? 0.95 : 0.3} />
      {glow && <text x="170" y="80" fontSize="11" textAnchor="middle">💰</text>}
      <rect x="0" y="108" width="340" height="12" fill="#2d1d3a" />
    </svg>
  )
}

export function Mansion({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(50)
  const [n, setN] = useState(3) // дверей на этаже: за одной из них призрак
  const FL = floorsFor(n)
  const [phase, setPhase] = useState<'idle' | 'play' | 'win' | 'lose'>('idle')
  const [floor, setFloor] = useState(0) // сколько этажей пройдено
  const [marks, setMarks] = useState<{ pick: number; ghost: number }[]>([])
  const [locked, setLocked] = useState(0) // ставка текущего раунда
  const [won, setWon] = useState(0)
  const mult = (k: number) => (k > 0 ? HOUSE_RTP * Math.pow(n / (n - 1), k) : 0)
  const fmt = (m: number) => m.toFixed(m >= 100 ? 0 : 2).replace('.', ',')
  const playing = phase === 'play'

  const start = () => {
    if (playing || !ctx.charge(stake, 'Особняк — ставка')) return
    ctx.bump('mansion'); play.click()
    setLocked(stake); setFloor(0); setMarks([]); setWon(0); setPhase('play')
  }
  const finishWin = (k: number) => {
    const w = Math.floor(locked * mult(k))
    setWon(w); setPhase('win')
    if (w > 0) { ctx.pay(w, 'Особняк — находка'); play.big() }
  }
  const choose = (d: number) => {
    if (!playing) return
    const ghost = rint(n) // призрак выбирает дверь случайно и поровну, шанс каждой двери 1/n
    setMarks(m => [...m, { pick: d, ghost }])
    if (d === ghost) { setPhase('lose'); play.ghost(); play.boom(); play.lose(); ctx.notify('За дверью призрак! Ставка сгорела'); return }
    const nf = floor + 1
    setFloor(nf); play.door(); play.ding(nf)
    if (nf === FL) finishWin(nf)
  }
  const cashOut = () => { if (playing && floor > 0) finishWin(floor) }

  const rows = Array.from({ length: FL }, (_, i) => FL - 1 - i)
  return (
    <div className="mansion">
      <div className={`mn-house ${phase}`}>
        <MansionRoof glow={phase === 'win'} scared={phase === 'lose'} />
        <div className="mn-body">
          {rows.map(fl => {
            const passed = fl < floor, now = playing && fl === floor, lostHere = phase === 'lose' && fl === floor
            const mk = marks[fl]
            const top = fl === FL - 1
            return (
              <div key={fl} className={`mn-floor ${passed ? 'passed' : ''} ${now ? 'now' : ''} ${lostHere ? 'lost' : ''} ${top ? 'top' : ''}`}>
                <div className="mn-tag"><b>{top ? 'Чердак' : `${fl + 1} эт.`}</b><i>×{fmt(mult(fl + 1))}</i></div>
                <div className="mn-doors" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
                  {Array.from({ length: n }, (_, d) => {
                    const picked = !!mk && mk.pick === d
                    const open = (passed || lostHere) && picked
                    const ghostShown = (passed || lostHere) && !!mk && mk.ghost === d
                    return (
                      <button key={d} className={`mdoor ${open ? 'open' : ''} ${ghostShown ? 'ghost' : ''} ${lostHere && picked ? 'boo' : ''} ${now ? 'live' : ''}`}
                        disabled={!now} onClick={() => choose(d)} aria-label={`Этаж ${fl + 1}, дверь ${d + 1}`}>
                        <span className="mdoor-room">{ghostShown ? '👻' : open ? '✨' : ''}</span>
                        <span className="mdoor-leaf"><i className="knob" /><i className="slit" /></span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
        <div className="mn-ground" />
        {phase === 'win' && <Burst key="mw" type="gold" n={100} />}
        {phase === 'lose' && <Burst key="ml" type="ember" n={70} />}
      </div>

      {phase === 'idle' && <p className="m small center">Призрак прячется за одной из {n} дверей на каждом этаже. Поднимайся вверх: чем выше, тем больше множитель.</p>}
      {playing && <p className="m small center">Этаж {floor + 1} из {FL} · сейчас <b className="gold">×{fmt(mult(floor))}</b>{floor > 0 ? ` · можно забрать ${cfmt(Math.floor(locked * mult(floor)))}` : ''}</p>}
      {phase === 'win' && <Result good>{floor === FL ? 'Чердак покорён! ' : 'Забрал вовремя: '}+{cfmt(won)} · ×{fmt(mult(floor))}</Result>}
      {phase === 'lose' && <Result>Призрак на {floor + 1}-м этаже. Ставка {cfmt(locked)} сгорела</Result>}

      {!playing && <>
        <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} />
        <div className="optrow"><span className="m small">Дверей на этаже</span>
          {[2, 3, 4].map(v => <button key={v} className={n === v ? 'on' : ''} onClick={() => { setN(v); play.click() }}>{v}</button>)}
        </div>
        <p className="m small center">Максимум ×{fmt(mult(FL))} · шанс пройти этаж {Math.round(((n - 1) / n) * 100)}%</p>
        <button className="cta" onClick={start}>{phase === 'idle' ? 'Войти в особняк' : 'Ещё раз'} · {cfmt(stake)}</button>
      </>}
      {playing && <button className="cta green" disabled={floor === 0} onClick={cashOut}>{floor === 0 ? 'Пройди первый этаж' : `Забрать ${cfmt(Math.floor(locked * mult(floor)))}`}</button>}
    </div>
  )
}

// ---------- ГОНКИ ----------
// Настоящий заезд: 6 машин, 3 круга по овалу. Заезд целиком просчитывается движком raceSimulate (lib.ts) до старта,
// экран лишь проигрывает готовую запись. У машин разные характеристики, в заезде работают слипстрим, нитро и ошибки в поворотах.
// Коэффициент = отдача (RACE_RTP) ÷ шанс (шансы получены прогоном того же движка), ставка на победителя или на топ-3.
const TR = { cx1: 90, cx2: 230, cy: 110, r: 70 }
const CORNER_LEN = Math.PI * TR.r
function trackPos(d: number, lane: number): [number, number] {
  const lp = ((d % LAP_LEN) + LAP_LEN) % LAP_LEN
  const R = TR.r + (lane - 2.5) * 7
  const { cx1, cx2, cy } = TR
  if (lp < 70) return [160 + lp, cy + R]
  if (lp < 70 + CORNER_LEN) { const th = Math.PI / 2 - (lp - 70) / TR.r; return [cx2 + R * Math.cos(th), cy + R * Math.sin(th)] }
  if (lp < 210 + CORNER_LEN) return [cx2 - (lp - 70 - CORNER_LEN), cy - R]
  if (lp < 210 + 2 * CORNER_LEN) { const th = -Math.PI / 2 - (lp - 210 - CORNER_LEN) / TR.r; return [cx1 + R * Math.cos(th), cy + R * Math.sin(th)] }
  return [cx1 + (lp - 210 - 2 * CORNER_LEN), cy + R]
}
type RaceKind = 'win' | 'top3'
const PLAY_SPEED = 2.1 // во сколько раз запись идёт быстрее реального времени симуляции
const evText = (e: RaceEvent) => {
  const n = RACERS[e.car].name
  return e.kind === 'luck' ? `${n} поймал удачу: рывок!` : e.kind === 'bad' ? `${n} не повезло: кочка на трассе` : e.kind === 'nitro' ? `${n} включает нитро` : e.kind === 'mistake' ? `${n} ошибся в повороте` : e.kind === 'lead' ? `${n} выходит вперёд`
    : e.kind === 'lap' ? `Круг ${e.lap} из ${RACE_LAPS}` : `${n} финиширует ${e.place}-м`
}
export function Race({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(50)
  const [kind, setKind] = useState<RaceKind>('win')
  const [pick, setPick] = useState(0)
  const [phase, setPhase] = useState<'bet' | 'count' | 'run' | 'done'>('bet')
  const [count, setCount] = useState(0)
  const [sim, setSim] = useState<RaceSim | null>(null)
  const [st, setSt] = useState(0) // текущее время записи, с
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null)
  const [hist, setHist] = useState<number[]>([])
  const odds = RACERS.map((_, i) => raceOdds(kind === 'win' ? RACE_PROBS.win[i] : RACE_PROBS.top3[i]))
  const raf = useRef(0)
  const timers = useRef<number[]>([])
  const pending = useRef<{ w: number } | null>(null) // выигрыш гонки, которая ещё идёт: выдаём, даже если игрок ушёл с экрана
  const ctxRef = useRef(ctx); ctxRef.current = ctx
  useEffect(() => () => {
    cancelAnimationFrame(raf.current); timers.current.forEach(clearTimeout)
    const p = pending.current
    if (p) { pending.current = null; if (p.w > 0) ctxRef.current.pay(p.w, 'Гонки — выигрыш') }
  }, [])

  const busy = phase === 'count' || phase === 'run'
  const go = () => {
    if (busy || !ctx.charge(stake, `Гонки — ${kind === 'win' ? 'победитель' : 'топ-3'}`)) return
    ctx.bump('race'); play.click()
    // ---- заезд просчитан здесь целиком, дальше только показ ----
    const s = raceSimulate()
    const myPlace = s.order.indexOf(pick) + 1
    const ok = kind === 'win' ? myPlace === 1 : myPlace <= 3
    const o = odds[pick]
    const w = ok ? Math.floor(stake * o) : 0
    pending.current = { w }
    setSim(s); setSt(0); setRes(null); setPhase('count')
    const END = s.duration + 3
    const run = () => {
      setPhase('run'); play.rev()
      const t0 = performance.now()
      let nextEv = 0
      const f = (now: number) => {
        const t = Math.min(END, ((now - t0) / 1000) * PLAY_SPEED)
        setSt(t)
        while (nextEv < s.events.length && s.events[nextEv].t <= t) { const ev = s.events[nextEv]; if (ev.kind === 'finish') play.finish(); else if (ev.kind === 'nitro') play.nitro(); else if (ev.kind === 'mistake') play.squeal(); else if (ev.kind === 'luck') play.sparkle(); else if (ev.kind === 'bad') play.thud(); else if (ev.kind === 'lap') play.bell(); nextEv++ }
        if (t >= END) {
          pending.current = null
          setPhase('done')
          setHist(h => [s.order[0], ...h].slice(0, 8))
          const win = RACERS[s.order[0]].name
          if (w > 0) { ctx.pay(w, 'Гонки — выигрыш'); play.big(); setRes({ ok: true, text: `${RACERS[pick].name} — ${myPlace}-е место. Выигрыш +${cfmt(w)} (×${o.toFixed(2).replace('.', ',')})` }) }
          else { play.lose(); setRes({ ok: false, text: `Победил ${win}. ${RACERS[pick].name} финишировал ${myPlace}-м. Ставка сгорела` }) }
          return
        }
        raf.current = requestAnimationFrame(f)
      }
      raf.current = requestAnimationFrame(f)
    }
    const step = (k: number) => {
      if (k === 0) { setCount(0); play.beep(true); run(); return }
      setCount(k); play.beep(false)
      timers.current.push(window.setTimeout(() => step(k - 1), 800))
    }
    step(3)
  }

  // положение машин в текущий момент записи
  const fi = sim ? Math.min(sim.frames.length - 1, st / sim.dt) : 0
  const f0 = Math.floor(fi), fr = fi - f0
  const dist = RACERS.map((_, i) => sim ? sim.frames[f0][i] + ((sim.frames[Math.min(f0 + 1, sim.frames.length - 1)][i]) - sim.frames[f0][i]) * fr : -i * 4)
  const finished = RACERS.map((_, i) => (sim && sim.fin[i] >= 0 && st >= sim.fin[i]) ? sim.order.indexOf(i) + 1 : 0)
  const board = RACERS.map((_, i) => i).sort((a, b) => (finished[a] && finished[b]) ? finished[a] - finished[b] : finished[a] ? -1 : finished[b] ? 1 : dist[b] - dist[a])
  const lead = Math.max(...dist)
  const lap = Math.min(RACE_LAPS, Math.max(1, Math.floor(Math.max(0, lead) / LAP_LEN) + 1))
  const feed = sim ? sim.events.filter(e => e.t <= st).slice(-3).reverse() : []
  const pct = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0).replace('.', ',')}%`
  const bar = (v: number) => <i style={{ ['--w' as string]: `${v * 10}%` }} />
  return (
    <div className="race">
      <div className="chips">{hist.length ? hist.map((h, i) => <span key={i} className="g" style={{ color: RACERS[h].color }}>{RACERS[h].name}</span>) : <span className="m small">Прошлые победители появятся здесь</span>}</div>
      <div className={`race-board ${phase}`}>
        <div className="race-hud"><span>Круг {phase === 'bet' ? 1 : lap} / {RACE_LAPS}</span><span className="m">{phase === 'run' || phase === 'done' ? `${st.toFixed(1).replace('.', ',')} с` : '3 круга · 6 машин'}</span></div>
        <svg viewBox="0 0 320 220" className="race-svg" aria-hidden="true">
          <defs><linearGradient id="rgInf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1f4a35" /><stop offset="1" stopColor="#173626" /></linearGradient></defs>
          <rect x="0" y="0" width="320" height="220" fill="#0f1a1e" />
          <path d="M90 40H230A70 70 0 0 1 230 180H90A70 70 0 0 1 90 40Z" fill="url(#rgInf)" stroke="#2d333b" strokeWidth="52" strokeLinejoin="round" />
          <path d="M90 40H230A70 70 0 0 1 230 180H90A70 70 0 0 1 90 40Z" fill="none" stroke="#ffffff22" strokeWidth="1.5" strokeDasharray="6 8" />
          <path d="M90 14H230A96 96 0 0 1 230 206H90A96 96 0 0 1 90 14Z" fill="none" stroke="#e8e8e8" strokeOpacity=".5" strokeWidth="2" strokeDasharray="5 5" />
          <path d="M90 66H230A44 44 0 0 1 230 154H90A44 44 0 0 1 90 66Z" fill="none" stroke="#e8e8e8" strokeOpacity=".5" strokeWidth="2" strokeDasharray="5 5" />
          <g transform="translate(160 180)"><rect x="-2.500" y="-26" width="5" height="52" fill="#fff" /><rect x="-2.500" y="-26" width="5" height="52" fill="url(#rgChk)" /></g>
          <defs><pattern id="rgChk" width="5" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#111" /><rect y="5" x="0" width="5" height="5" fill="#fff" /></pattern></defs>
          
          <text x="160" y="104" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff" opacity=".55">{phase === 'run' ? feed[0] ? evText(feed[0]) : '' : 'СТАРТ / ФИНИШ ↓'}</text>
          {[...RACERS.keys()].sort((x, y) => (x === pick ? 1 : 0) - (y === pick ? 1 : 0)).map(i => {
            const c = RACERS[i]
            // после финиша машина катится по инерции ещё немного, а не стоит на линии
            const roll = sim && sim.fin[i] >= 0 && st > sim.fin[i] ? Math.min(60, 60 * (1 - Math.exp(-(st - sim.fin[i]) * 1.1))) : 0
            const d = Math.min(dist[i], RACE_LEN) + roll
            const [x, y] = trackPos(d, i), [x2, y2] = trackPos(d + 3, i)
            const ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI
            const mine = i === pick
            const nitro = !!sim && sim.events.some(e => e.kind === 'nitro' && e.car === i && st >= e.t && st < e.t + 2)
            const luck = !!sim && sim.events.some(e => e.kind === 'luck' && e.car === i && st >= e.t && st < e.t + 1.6)
            const bad = !!sim && sim.events.some(e => e.kind === 'bad' && e.car === i && st >= e.t && st < e.t + 0.9)
            const slip = !!sim && sim.events.some(e => e.kind === 'mistake' && e.car === i && st >= e.t && st < e.t + 0.9)
            return (
              <g key={c.id} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
                {mine && <circle r="10.500" fill="none" stroke="#fff" strokeWidth="1.400" strokeDasharray="3 2.500" opacity=".9" />}
                <g transform={`rotate(${(ang + (slip ? Math.sin(st * 40) * 14 : 0)).toFixed(1)}) scale(.74)`}>
                  <ellipse cx="0.500" cy="1" rx="12" ry="5.500" fill="#000" opacity=".35" />
                  {luck && <circle r="13" fill="#7bd88f" opacity=".28"><animate attributeName="r" values="10;16;10" dur=".5s" repeatCount="indefinite" /></circle>}
                  {bad && <circle cx="-9" r="5" fill="#8a8f94" opacity=".55"><animate attributeName="r" values="3;8;3" dur=".4s" repeatCount="indefinite" /></circle>}
                  {nitro && <path d="M-11 0 L-22 -2.500 L-18 0 L-22 2.500Z" fill="#7bd8ff" opacity=".9"><animate attributeName="opacity" values=".4;1;.4" dur=".15s" repeatCount="indefinite" /></path>}
                  {nitro && <path d="M-11 0 L-17 -1.200 L-15 0 L-17 1.200Z" fill="#fff" />}
                  {[[-6.500, -5], [-6.500, 5], [6, -5], [6, 5]].map(([wx, wy], k) => <rect key={k} x={wx - 2.400} y={wy - 1.300} width="4.800" height="2.600" rx=".8" fill="#15171a" />)}
                  <rect x="-12" y="-4.800" width="2.600" height="9.600" rx=".8" fill={c.color2} />
                  <path d="M-10.500 -3.600 Q-10.500 -4.200 -8.500 -4.200 H3 Q8 -4 11 -1.600 V1.600 Q8 4 3 4.200 H-8.500 Q-10.500 4.200 -10.500 3.600Z" fill={c.color} stroke={c.color2} strokeWidth=".7" />
                  <rect x="10" y="-4.700" width="2.200" height="9.400" rx=".8" fill={c.color2} />
                  <rect x="-8" y="-.8" width="15" height="1.600" fill="#fff" opacity=".55" />
                  <rect x="-2.500" y="-2.400" width="6" height="4.800" rx="2" fill="#0d1114" opacity=".85" />
                  <circle cx=".500" cy="0" r="1.500" fill={c.color2} />
                </g>
                <text y="-8" textAnchor="middle" fontSize="6" fontWeight="900" fill="#fff" stroke="#000" strokeWidth="1.400" paintOrder="stroke">{i + 1}</text>
              </g>
            )
          })}
        </svg>
        {count > 0 && <div className="countdown" key={count}>{count}</div>}
        {phase === 'bet' && <div className="boom m">Выбери машину и сделай ставку</div>}
        {phase === 'done' && <Burst key={`rb${hist.length}`} type={res?.ok ? 'gold' : 'ember'} n={70} />}
      </div>
      <div className="race-lb">
        {board.map((i, k) => (
          <div key={i} className={`lb-row ${i === pick ? 'mine' : ''} ${finished[i] ? 'fin' : ''}`} style={{ ['--cc' as string]: RACERS[i].color }}>
            <b>{k + 1}</b><i className="cdot" /><span>{RACERS[i].name}</span>
            <em>{finished[i] ? `${sim ? sim.fin[i].toFixed(1).replace('.', ',') : ''} с` : phase === 'run' ? `${Math.max(0, Math.round((dist[i] / RACE_LEN) * 100))}%` : ''}</em>
          </div>
        ))}
      </div>
      {phase === 'run' && <div className="race-feed">{feed.map((e, i) => <span key={`${e.t}${i}`} className={e.kind}>{evText(e)}</span>)}</div>}

      {res && <Result good={res.ok}>{res.text}</Result>}

      <div className="optrow"><span className="m small">Ставка</span>
        {([['win', 'Победитель'], ['top3', 'Топ-3']] as [RaceKind, string][]).map(([v, t]) => <button key={v} className={kind === v ? 'on' : ''} disabled={busy} onClick={() => { setKind(v); play.click() }}>{t}</button>)}
      </div>
      <div className="race-cars">
        {RACERS.map((c, i) => (
          <button key={c.id} className={pick === i ? 'on' : ''} disabled={busy} style={{ ['--cc' as string]: c.color }} onClick={() => { setPick(i); play.click() }}>
            <i className="cdot" /><b>{i + 1}. {c.name}</b><span>×{odds[i].toFixed(2).replace('.', ',')}</span>
            <div className="stats"><u>Прямая{bar(c.speed)}</u><u>Поворот{bar(c.corner)}</u><u>Разгон{bar(c.accel)}</u><u>Надёжн.{bar(c.rely)}</u></div>
            <small>{c.note} · шанс {pct(kind === 'win' ? RACE_PROBS.win[i] : RACE_PROBS.top3[i])}</small>
          </button>
        ))}
      </div>
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={busy} />
      <button className="cta" disabled={busy} onClick={go}>{busy ? (count > 0 ? `Старт через ${count}…` : 'Гонка идёт…') : `Старт · ${cfmt(stake)} · ×${odds[pick].toFixed(2).replace('.', ',')}`}</button>
      <p className="m small center">Заезд разыгрывается честной симуляцией: стартовая решётка случайная, сильные машины чаще побеждают, но ошибки, нитро, слипстрим и просто удача (рывок или кочка) дают шанс каждому. Коэффициент зависит от шанса машины: чем меньше шанс, тем он выше.</p>
    </div>
  )
}

// ---------- БОЛЬШЕ / МЕНЬШЕ ----------
// Выпадает целое число от 0 до 99, все числа равновероятны. Три режима: «Меньше» (число < порога), «Больше» (число ≥ порога)
// и «Диапазон» (число внутри окна). Игрок выбирает шанс выигрыша от 2% до 80%, коэффициент = 84% ÷ шанс, округляется вниз до сотых.
// Число выбирается один раз до анимации, никаких подстроек под игрока. Выигрыш выдаётся, даже если игрок вышел с экрана.
const HL_RTP = 0.84
const HL_MIN = 2, HL_MAX = 80
type HlMode = 'under' | 'over' | 'range'
const hlMult = (chance: number) => Math.floor(((HL_RTP * 100) / chance) * 100) / 100
const hlZone = (mode: HlMode, c: number, lo: number): [number, number] => (mode === 'under' ? [0, c] : mode === 'over' ? [100 - c, 100] : [lo, lo + c]) // [от, до) в числах 0..99

function Reel({ digit, run, dur }: { digit: number; run: number; dur: number }) {
  const [pos, setPos] = useState(0)
  const [anim, setAnim] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    setAnim(false); setPos(p => p % 10)
    const a = requestAnimationFrame(() => requestAnimationFrame(() => { setAnim(true); setPos(20 + digit) }))
    const t = window.setTimeout(() => { setAnim(false); setPos(digit) }, dur * 1000 + 120)
    return () => { cancelAnimationFrame(a); clearTimeout(t) }
  }, [run]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="hl-reel" aria-hidden="true">
      <div className="hl-reel-strip" style={{ transform: `translateY(${-pos}em)`, transition: anim ? `transform ${dur}s cubic-bezier(.12,.72,.14,1)` : 'none' }}>
        {Array.from({ length: 40 }, (_, i) => <span key={i}>{i % 10}</span>)}
      </div>
    </div>
  )
}

export function HiLo({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(50)
  const [mode, setMode] = useState<HlMode>('over')
  const [chance, setChance] = useState(50)
  const [lo, setLo] = useState(30)
  const [digits, setDigits] = useState<[number, number]>([0, 0])
  const [run, setRun] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'spin' | 'done'>('idle')
  const [final, setFinal] = useState<number | null>(null)
  const [res, setRes] = useState<{ ok: boolean; text: string; tier: number } | null>(null)
  const [hist, setHist] = useState<{ n: number; ok: boolean }[]>([])
  const [stat, setStat] = useState({ w: 0, l: 0, net: 0, streak: 0 })
  const timers = useRef<number[]>([])
  const pending = useRef<{ w: number } | null>(null)
  const ctxRef = useRef(ctx); ctxRef.current = ctx
  useEffect(() => () => {
    timers.current.forEach(t => { clearTimeout(t); clearInterval(t) })
    const p = pending.current
    if (p) { pending.current = null; if (p.w > 0) ctxRef.current.pay(p.w, 'Больше / Меньше — выигрыш') }
  }, [])
  const busy = phase === 'spin'
  const loMax = 100 - chance
  const loEff = Math.min(lo, loMax)
  const m = hlMult(chance)
  const [za, zb] = hlZone(mode, chance, loEff)
  const fm = (v: number) => v.toFixed(2).replace('.', ',')
  const roll = () => {
    if (busy || !ctx.charge(stake, 'Больше / Меньше — ставка')) return
    ctx.bump('hilo'); play.click()
    const n = rint(100)
    const ok = n >= za && n < zb
    const w = ok ? Math.floor(stake * m) : 0
    pending.current = { w }
    setPhase('spin'); setRes(null); setFinal(null)
    setDigits([Math.floor(n / 10), n % 10]); setRun(r => r + 1)
    play.whoosh()
    const tick = window.setInterval(() => play.roll(), 85)
    timers.current.push(tick)
    timers.current.push(window.setTimeout(() => play.lock(), 1350))
    timers.current.push(window.setTimeout(() => {
      clearInterval(tick); play.lock()
      pending.current = null
      setFinal(n); setPhase('done'); setHist(h => [{ n, ok }, ...h].slice(0, 12))
      setStat(s => ({ w: s.w + (ok ? 1 : 0), l: s.l + (ok ? 0 : 1), net: s.net + w - stake, streak: ok ? s.streak + 1 : 0 }))
      if (ok) {
        ctx.pay(w, 'Больше / Меньше — выигрыш')
        const tier = m >= 10 ? 3 : m >= 4 ? 2 : 1
        if (tier === 3) play.jackpot(); else if (tier === 2) play.big(); else play.chime(1)
        setRes({ ok: true, tier, text: `Выпало ${n}. Выигрыш +${cfmt(w)} (×${fm(m)})` })
      } else { play.thud(); play.lose(); setRes({ ok: false, tier: 0, text: `Выпало ${n}. Ставка сгорела` }) }
    }, 1950))
  }
  const modeLabel: Record<HlMode, string> = { under: 'Меньше', over: 'Больше', range: 'Диапазон' }
  const zoneText = mode === 'under' ? `Выигрыш при числе от 0 до ${zb - 1}` : mode === 'over' ? `Выигрыш при числе от ${za} до 99` : `Выигрыш при числе от ${za} до ${zb - 1}`
  const grad = `linear-gradient(90deg,#b84a52 0 ${za}%,#3fc58a ${za}% ${zb}%,#b84a52 ${zb}% 100%)`
  const winPay = Math.floor(stake * m)
  return (
    <div className="hilo">
      <div className="hl-top">
        <div className="chips">{hist.length ? hist.map((h, i) => <span key={i} className="g" style={{ color: h.ok ? '#7bd88f' : '#ff8a8a' }}>{h.n}</span>) : <span className="m small">Прошлые числа появятся здесь</span>}</div>
        {stat.streak >= 2 && <span className="hl-streak">Серия {stat.streak}</span>}
      </div>
      <div className={`hl-screen ${phase} ${phase === 'done' ? (res?.ok ? 'win' : 'lose') : ''}`}>
        <div className="hl-ring" />
        <div className="hl-reels"><Reel digit={digits[0]} run={run} dur={1.35} /><Reel digit={digits[1]} run={run} dur={1.9} /></div>
        <div className="hl-bar" style={{ background: grad }}>
          <b className="hl-edge" style={{ left: `${za}%`, opacity: za > 0 ? 1 : 0 }} /><b className="hl-edge" style={{ left: `${zb}%`, opacity: zb < 100 ? 1 : 0 }} />
          <i className="hl-mark" style={{ left: `${final === null ? 50 : final + 0.5}%`, opacity: final === null ? 0 : 1 }} />
        </div>
        <div className="hl-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>99</span></div>
        <p className="hl-zone">{zoneText}</p>
        {phase === 'done' && res?.ok && <Burst key={`hb${hist.length}`} type={res.tier === 3 ? 'confetti' : 'gold'} n={res.tier === 3 ? 200 : res.tier === 2 ? 110 : 60} />}
      </div>
      {res && <Result good={res.ok}>{res.text}</Result>}
      <div className="hl-modes">{(['under', 'over', 'range'] as HlMode[]).map(k => <button key={k} className={mode === k ? 'on' : ''} disabled={busy} onClick={() => { setMode(k); play.click() }}>{modeLabel[k]}</button>)}</div>
      <div className="hl-ctl">
        <div className="hl-row"><span>Шанс выигрыша</span><b>{chance}%</b></div>
        <input className="hl-range" type="range" min={HL_MIN} max={HL_MAX} step={1} value={chance} disabled={busy} onChange={e => { setChance(Number(e.target.value)); play.tick() }} aria-label="Шанс выигрыша" />
        <div className="hl-presets">{[5, 10, 25, 50, 75].map(v => <button key={v} className={chance === v ? 'on' : ''} disabled={busy} onClick={() => { setChance(v); play.click() }}>{v}%</button>)}</div>
        {mode === 'range' && <>
          <div className="hl-row"><span>Начало окна</span><b>{loEff}–{loEff + chance - 1}</b></div>
          <input className="hl-range" type="range" min={0} max={loMax} step={1} value={loEff} disabled={busy} onChange={e => { setLo(Number(e.target.value)); play.tick() }} aria-label="Начало окна" />
        </>}
      </div>
      <div className="hl-info"><div><small>Коэффициент</small><b>×{fm(m)}</b></div><div><small>Выигрыш</small><b>{cfmt(winPay)}</b></div><div><small>Итог сессии</small><b className={stat.net > 0 ? 'pos' : stat.net < 0 ? 'neg' : ''}>{stat.net > 0 ? '+' : ''}{cfmt(stat.net)}</b></div></div>
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={busy} />
      <button className="cta" disabled={busy} onClick={roll}>{busy ? 'Выпадает число…' : `Бросить · ${cfmt(stake)}`}</button>
      <p className="m small center">Число от 0 до 99, все числа равновероятны. Чем меньше шанс, тем выше коэффициент. Побед {stat.w}, поражений {stat.l}.</p>
    </div>
  )
}

// ---------- ОРЁЛ И РЕШКА ----------
type Side = 'heads' | 'tails'
const COIN_RTP = 0.86
const SIDE_NAME: Record<Side, string> = { heads: 'Орёл', tails: 'Решка' }
function CoinFace({ side }: { side: Side }) {
  // общий чекан: рант, жемчужный поясок, внутренний валик
  const rim = <>
    <circle cx="50" cy="50" r="48" fill="none" stroke="url(#cgRim)" strokeWidth="3" />
    <circle cx="50" cy="50" r="44.500" fill="none" stroke="#7a4d00" strokeOpacity=".55" strokeWidth="1" />
    <circle cx="50" cy="50" r="42" fill="none" stroke="#fff3b0" strokeOpacity=".9" strokeWidth="1.600" strokeDasharray="0.1 3.390" strokeLinecap="round" />
    <circle cx="50" cy="50" r="39" fill="none" stroke="#8a5a05" strokeOpacity=".6" strokeWidth="1.200" />
    <circle cx="50" cy="50" r="38" fill="none" stroke="#fff0a0" strokeOpacity=".7" strokeWidth=".8" />
  </>
  const emboss = (node: React.ReactNode) => <>
    <g transform="translate(-.9 -.9)" fill="#fff6c0" stroke="#fff6c0" opacity=".9">{node}</g>
    <g transform="translate(.9 1)" fill="#5a3500" stroke="#5a3500" opacity=".8">{node}</g>
    <g fill="url(#cgRelief)" stroke="#b9801a" strokeWidth=".4">{node}</g>
  </>
  const wing = <>
    <path d="M56 46C62 36 72 24 91 14C89 22 91 27 89 32C85 32 87 38 84.500 42C81 42 83 48 79 52C75 50.500 69 51 58 58Z" />
    <path d="M58 50C66 41 76 32 86 24M59 55C68 48 76 42 82 38" fill="none" stroke="#8a5a05" strokeWidth=".9" />
  </>
  const eagle = <>
    <path d="M50 31C56 31 59 40 58 50L56 68L50 77L44 68L42 50C41 40 44 31 50 31Z" />
    <path d="M44 68L41 82L46 79L50 85L54 79L59 82L56 68L53 72L50 78L47 72Z" />
    <path d="M44 27C44 22 46.500 19 50 19C53.500 19 56 22 56 27C56 30.500 53 32.500 50 32.500C47 32.500 44 30.500 44 27Z" />
    <path d="M46 26L50 40L54 26C52 24.500 48 24.500 46 26Z" fill="#c78512" />
    <path d="M45 25.500L50 28L55 25.500" fill="none" stroke="#5a3500" strokeWidth="1" />
    {wing}
    <g transform="translate(100 0) scale(-1 1)">{wing}</g>
  </>
  const star = (cx: number, cy: number, R: number, r: number) =>
    Array.from({ length: 10 }, (_, i) => { const a = (Math.PI / 5) * i - Math.PI / 2, d = i % 2 ? r : R; return `${(cx + d * Math.cos(a)).toFixed(2)},${(cy + d * Math.sin(a)).toFixed(2)}` }).join(' ')
  const leaves = (dir: 1 | -1) => Array.from({ length: 9 }, (_, i) => {
    const t = i / 8, ang = (150 + t * 100) * Math.PI / 180, rr = 33
    const x = 50 + dir * rr * Math.cos(ang) * -1, y = 50 + rr * Math.sin(ang) * -1 + 2
    return <ellipse key={i} cx={x} cy={y} rx="2.400" ry="5.200" transform={`rotate(${dir * (-40 + t * 150)} ${x} ${y})`} />
  })
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="cgRim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff3b0" /><stop offset=".5" stopColor="#d99a1c" /><stop offset="1" stopColor="#fbe07a" /></linearGradient>
        <linearGradient id="cgRelief" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffe48a" /><stop offset=".55" stopColor="#e2a52a" /><stop offset="1" stopColor="#b9801a" /></linearGradient>
        <path id="cgArcT" d="M16 50A34 34 0 0 1 84 50" fill="none" />
        <path id="cgArcB" d="M13 50A37 37 0 0 0 87 50" fill="none" />
      </defs>
      {rim}
      {side === 'heads' ? <>
        {emboss(eagle)}
        <text fontSize="7" fontWeight="800" letterSpacing="3" fill="#6b4300" textAnchor="middle" fontFamily="Georgia,serif"><textPath href="#cgArcT" startOffset="50%">ОРЁЛ</textPath></text>
        <text fontSize="5.500" fontWeight="800" letterSpacing="2" fill="#6b4300" textAnchor="middle" fontFamily="Georgia,serif"><textPath href="#cgArcB" startOffset="50%">QCUP</textPath></text>
      </> : <>
        {emboss(<>{leaves(1)}{leaves(-1)}</>)}
        {emboss(<polygon points={star(50, 48, 17, 7.500)} />)}
        <text fontSize="7" fontWeight="800" letterSpacing="3" fill="#6b4300" textAnchor="middle" fontFamily="Georgia,serif"><textPath href="#cgArcT" startOffset="50%">РЕШКА</textPath></text>
        <text x="50" y="82" fontSize="9" fontWeight="900" letterSpacing="2" fill="#6b4300" textAnchor="middle" fontFamily="Georgia,serif">QCUP</text>
      </>}
    </svg>
  )
}
export function Coinflip({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(50)
  const [pick, setPick] = useState<Side>('heads')
  const [count, setCount] = useState(1) // сколько монет подбрасываем: все должны лечь на выбранную сторону
  const [pot, setPot] = useState(0)     // текущий выигрыш серии (ещё не выплачен)
  const [streak, setStreak] = useState(0)
  const [faces, setFaces] = useState<Side[]>(['heads'])
  const [rot, setRot] = useState<number[]>([0])
  const [flipping, setFlipping] = useState(false)
  const [land, setLand] = useState<'won' | 'lost' | null>(null)
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null)
  const mult = COIN_RTP * 2 ** count
  const inSeries = pot > 0 && !flipping
  // в серии шанс следующей победы падает (множитель прежний): 2-я подряд ×0,7, 3-я ×0,45, дальше ×0,3
  const STREAK_F = [1, 0.7, 0.45, 0.3]
  const chanceNow = () => (0.5 ** count) * STREAK_F[Math.min(streak, STREAK_F.length - 1)]
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const flip = () => {
    if (flipping) return
    let bet = pot
    if (pot === 0) { if (!ctx.charge(stake, 'Орёл и решка — ставка')) return; bet = stake; ctx.bump('coin') }
    play.click()
    const pWin = chanceNow()
    const win = rnd() < pWin
    const other: Side = pick === 'heads' ? 'tails' : 'heads'
    let out: Side[] = Array.from({ length: count }, () => (win ? pick : (rnd() < 0.5 ? pick : other)))
    if (!win && out.every(f => f === pick)) out[rint(count)] = other // проигрыш: хотя бы одна монета лежит не той стороной
    setFaces(out); setFlipping(true); setRes(null); setLand(null)
    setRot(r => out.map((f, i) => { const cur = r[i] ?? 0; return cur - (cur % 360) + 360 * (6 + i) + (f === 'tails' ? 180 : 0) }))
    play.whoosh()
    timer.current = window.setTimeout(() => {
      setFlipping(false); setLand(win ? 'won' : 'lost')
      if (win) {
        const np = Math.floor(bet * mult)
        setPot(np); setStreak(s => s + 1); play.ding(streak + 1)
        setRes({ ok: true, text: `Угадал! Выигрыш серии ${cfmt(np)}` })
      } else {
        setPot(0); setStreak(0); play.lose()
        setRes({ ok: false, text: `Не повезло: ${out.map(f => SIDE_NAME[f]).join(', ')}. Ставка сгорела` })
      }
    }, 1950)
  }
  const cash = () => {
    if (!inSeries) return
    ctx.pay(pot, 'Орёл и решка — выигрыш'); play.big()
    setRes({ ok: true, text: `Забрал ${cfmt(pot)} · серия из ${streak}` }); setPot(0); setStreak(0)
  }
  const setCnt = (v: number) => { setCount(v); setFaces(Array.from({ length: v }, (_, i) => faces[i] ?? 'heads')); setRot(Array.from({ length: v }, (_, i) => rot[i] ?? 0)); play.click() }
  const locked = flipping || inSeries
  return (
    <div className="coinflip">
      <div className={`coins c${count}`}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={`coin3d ${land ?? ''}`} style={{ animationDelay: `${i * 0.08}s` }}>
            <div className={`hop ${flipping ? 'fly' : ''}`} style={{ animationDelay: `${i * 0.08}s` }}>
              <div className={`tilt ${flipping ? 'fly' : ''}`} style={{ animationDelay: `${i * 0.08}s` }}>
                <div className="coin" style={{ transform: `rotateX(${rot[i] ?? 0}deg)`, transitionDelay: `${i * 0.08}s` }}>
                  {[-3, -2, -1, 0, 1, 2, 3].map(z => <i key={z} className="cedge" style={{ transform: `translateZ(${z}px)` }} />)}
                  <div className="cface front"><CoinFace side="heads" /><b className="glint" /></div>
                  <div className="cface back"><CoinFace side="tails" /><b className="glint" /></div>
                </div>
              </div>
            </div>
            <i className={`shadow ${flipping ? 'fly' : ''}`} style={{ animationDelay: `${i * 0.08}s` }} />
          </div>
        ))}
        {!flipping && streak > 0 && <Burst key={`w${streak}`} type="gold" n={40} />}
      </div>
      {streak > 0 && <div className="streak">Серия: <b>{streak}</b> · в банке <b className="gold">{cfmt(pot)}</b></div>}
      {pot === 0 && <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={locked} />}
      <div className="optrow"><span className="m small">Сторона</span>
        {(['heads', 'tails'] as Side[]).map(sd => <button key={sd} className={pick === sd ? 'on' : ''} disabled={flipping} onClick={() => { setPick(sd); play.click() }}>{sd === 'heads' ? '🦅 Орёл' : '★ Решка'}</button>)}
      </div>
      <div className="optrow"><span className="m small">Монет</span>
        {[1, 2, 3, 4, 5].map(v => <button key={v} className={count === v ? 'on' : ''} disabled={flipping} onClick={() => setCnt(v)}>{v}</button>)}
      </div>
      <p className="m small center">
        {count > 1 && <>Все {count} монет должны лечь на «{SIDE_NAME[pick]}» · </>}Множитель <b className="gold">×{mult.toFixed(2).replace('.', ',')}</b>
      </p>
      {res && <Result good={res.ok}>{res.text}</Result>}
      {inSeries
        ? <div className="two"><button className="cta ghost" onClick={cash}>Забрать {cfmt(pot)}</button><button className="cta" onClick={flip}>Дальше · ×{mult.toFixed(2).replace('.', ',')}</button></div>
        : <button className="cta" disabled={flipping || ctx.save.balance < 1} onClick={flip}>{flipping ? 'Летит…' : `Подбросить · ${cfmt(stake)}`}</button>}
      <p className="m small center">После выигрыша можно забрать банк или рискнуть им снова с новым множителем: серия идёт без новой ставки.</p>
    </div>
  )
}
export { SYMBOLS }
