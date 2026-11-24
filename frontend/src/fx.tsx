import { useEffect, useRef } from 'react'

// ---- Вспышка частиц поверх родителя (родитель должен быть position:relative) ----
export function Burst({ type = 'gold', n = 70 }: { type?: 'gold' | 'ember' | 'confetti'; n?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!, dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth, h = cv.clientHeight
    cv.width = w * dpr; cv.height = h * dpr
    const g = cv.getContext('2d')!; g.scale(dpr, dpr)
    const pal = type === 'gold' ? ['#FFE08A', '#FFC24B', '#FFF6D0', '#ffffff'] : type === 'ember' ? ['#FF6B2B', '#FFB347', '#7a2a12', '#444'] : ['#8eccaf', '#FF6B7A', '#59b58d', '#FFC24B', '#afdbc6']
    const ps = Array.from({ length: n }, () => {
      const a = Math.random() * Math.PI * 2, sp = type === 'ember' ? 1 + Math.random() * 3 : 3 + Math.random() * 8
      return { x: w / 2, y: h / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (type === 'ember' ? 2 : 3), life: 1, r: 1.5 + Math.random() * 3.2, c: pal[Math.floor(Math.random() * pal.length)], rot: Math.random() * 6 }
    })
    let raf = 0, last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(32, now - last) / 16; last = now
      g.clearRect(0, 0, w, h)
      let alive = 0
      for (const p of ps) {
        p.x += p.vx * dt; p.y += p.vy * dt
        p.vy += (type === 'ember' ? -0.03 : 0.28) * dt; p.vx *= 0.985
        p.life -= (type === 'ember' ? 0.011 : 0.014) * dt
        if (p.life <= 0) continue
        alive++
        g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.c
        if (type === 'confetti') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot += 0.2); g.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); g.restore() }
        else { g.beginPath(); g.arc(p.x, p.y, p.r * (type === 'ember' ? p.life + 0.3 : 1), 0, 6.3); g.fill() }
      }
      if (alive) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [type, n])
  return <canvas ref={ref} className="burst" aria-hidden="true" />
}

// ---- Сцена «Ракеты»: звёзды, облака, след, пламя, взрыв ----
const ROCKET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 120"><defs><linearGradient id="b" x1="0" x2="1"><stop offset="0" stop-color="#d1fde8"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#9de5c2"/></linearGradient><linearGradient id="r" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff6b7a"/><stop offset="1" stop-color="#d63b55"/></linearGradient></defs><path d="M30 4C44 20 48 52 44 92H16C12 52 16 20 30 4z" fill="url(#b)" stroke="#2e6048" stroke-width="2"/><path d="M30 4C38 12 42 22 44 34H16C18 22 22 12 30 4z" fill="url(#r)"/><circle cx="30" cy="52" r="9" fill="#1f4532" stroke="#FFC24B" stroke-width="3"/><circle cx="27" cy="49" r="3" fill="#74f9b7" opacity=".7"/><path d="M16 70L4 96l4 8 10-6zM44 70l12 26-4 8-10-6z" fill="url(#r)" stroke="#2e6048" stroke-width="2" stroke-linejoin="round"/><rect x="22" y="92" width="16" height="8" rx="2" fill="#578d73"/></svg>`

type Phase = 'idle' | 'fly' | 'crash' | 'cash'
export function CrashScene({ phase, mult }: { phase: Phase; mult: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useRef({ phase, mult })
  live.current.phase = phase; live.current.mult = mult

  useEffect(() => {
    const cv = ref.current!, g = cv.getContext('2d')!
    const img = new Image(); img.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(ROCKET_SVG)
    const stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.9 }))
    const clouds = Array.from({ length: 7 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() }))
    const flame: { x: number; y: number; vx: number; vy: number; l: number }[] = []
    const boom: { x: number; y: number; vx: number; vy: number; l: number; r: number; c: string }[] = []
    const debris: { x: number; y: number; vx: number; vy: number; a: number; va: number; l: number; w: number }[] = []
    let ring = 0
    const trail: { x: number; y: number }[] = []
    let prev: Phase = 'idle', shake = 0, flash = 0, away = 0, exploded = false, ex = 0, ey = 0
    let raf = 0, t0 = performance.now(), last = t0
    const loop = (now: number) => {
      const dpr = window.devicePixelRatio || 1
      const w = cv.clientWidth, h = cv.clientHeight
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr) }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const dt = Math.min(32, now - last) / 16; last = now
      const { phase: ph, mult: m } = live.current
      const flying = ph === 'fly', p = Math.min(1, Math.log(Math.max(1, m)) / Math.log(8))
      // фон
      const bg = g.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, '#060b10'); bg.addColorStop(0.55, '#0e1d1f'); bg.addColorStop(1, '#17372f')
      g.save()
      if (shake > 0.3) { g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.9 }
      g.fillStyle = bg; g.fillRect(-20, -20, w + 40, h + 40)
      // туманность и планета у горизонта
      const neb = g.createRadialGradient(w * 0.75, h * 0.25, 0, w * 0.75, h * 0.25, w * 0.6); neb.addColorStop(0, 'rgba(70,170,130,.22)'); neb.addColorStop(1, 'rgba(70,170,130,0)')
      g.fillStyle = neb; g.fillRect(0, 0, w, h)
      const neb2 = g.createRadialGradient(w * 0.15, h * 0.4, 0, w * 0.15, h * 0.4, w * 0.5); neb2.addColorStop(0, 'rgba(110,90,200,.16)'); neb2.addColorStop(1, 'rgba(110,90,200,0)')
      g.fillStyle = neb2; g.fillRect(0, 0, w, h)
      const py = h * (1.15 + p * 0.5) // планета уходит вниз по мере набора высоты
      const pg = g.createRadialGradient(w * 0.35, py - w * 0.5, w * 0.1, w * 0.5, py, w * 0.95)
      pg.addColorStop(0, '#2c6b57'); pg.addColorStop(0.6, '#173d33'); pg.addColorStop(1, '#0a1a16')
      g.fillStyle = pg; g.beginPath(); g.arc(w * 0.5, py, w * 0.82, 0, 6.3); g.fill()
      g.strokeStyle = 'rgba(150,240,200,.55)'; g.lineWidth = 2; g.beginPath(); g.arc(w * 0.5, py, w * 0.82, 4.0, 5.4); g.stroke()
      const speed = flying ? 0.004 + p * 0.02 : ph === 'idle' ? 0.0008 : 0.0005
      for (const s of stars) {
        s.y += speed * s.z * dt; if (s.y > 1) { s.y = 0; s.x = Math.random() }
        g.globalAlpha = (0.35 + s.z * 0.5) * (0.75 + 0.25 * Math.sin(now / 400 + s.x * 40)); g.fillStyle = '#fff'
        const len = flying ? 1 + p * 9 * s.z : 0
        g.fillRect(s.x * w, s.y * h, 1.4 * s.z, 1.4 * s.z + len)
      }
      g.globalAlpha = 1
      for (const c of clouds) {
        c.y += (flying ? 0.003 + p * 0.012 : 0.0004) * c.s * dt; if (c.y > 1.1) { c.y = -0.1; c.x = Math.random() }
        g.fillStyle = 'rgba(147,193,172,.10)'
        g.beginPath(); g.ellipse(c.x * w, c.y * h, 70 * c.s, 18 * c.s, 0, 0, 6.3); g.fill()
      }
      // сетка множителей ×2 ×4 ×8
      if (flying || ph === 'crash' || ph === 'cash') {
        g.save(); g.setLineDash([4, 6]); g.lineWidth = 1; g.font = '700 11px Manrope,sans-serif'; g.textAlign = 'right'
        for (const mk of [2, 4, 8]) { const yy = h * (0.8 - 0.5 * Math.min(1, Math.log(mk) / Math.log(8))); g.strokeStyle = 'rgba(190,240,215,.18)'; g.beginPath(); g.moveTo(0, yy); g.lineTo(w, yy); g.stroke(); g.fillStyle = 'rgba(190,240,215,.55)'; g.fillText(`×${mk}`, w - 8, yy - 4) }
        g.restore()
      }
      // положение ракеты
      let rx = w * (0.2 + 0.5 * p), ry = h * (0.8 - 0.5 * p)
      const ang = 0.62 + 0.18 * p
      if (ph === 'cash') { away += 14 * dt; rx += away * 0.75; ry -= away }
      if (flying) { rx += Math.sin(now / 45) * 1.3; ry += Math.cos(now / 55) * 1.3 }
      else if (ph === 'idle') ry += Math.sin(now / 400) * 2
      // события смены фазы
      if (prev !== ph) {
        if (ph === 'crash') {
          exploded = true; ex = rx; ey = ry; shake = 22; flash = 1; ring = 1
          for (let i = 0; i < 14; i++) { const a = Math.random() * 6.3, sp = 2 + Math.random() * 5; debris.push({ x: ex, y: ey, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, l: 1, w: 3 + Math.random() * 5 }) }
          for (let i = 0; i < 110; i++) { const a = Math.random() * 6.3, sp = 1 + Math.random() * 7; boom.push({ x: ex, y: ey, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, l: 1, r: 2 + Math.random() * 4, c: ['#FFE08A', '#FF8A3D', '#FF4D4D', '#fff'][i % 4] }) }
        }
        if (ph === 'fly' || ph === 'idle') { exploded = false; away = 0; trail.length = 0; boom.length = 0; debris.length = 0; ring = 0 }
        prev = ph
      }
      // след
      if (flying) { trail.push({ x: rx, y: ry }); if (trail.length > 70) trail.shift() } else if (trail.length) trail.shift()
      for (let i = 1; i < trail.length; i++) {
        g.strokeStyle = `rgba(255,190,90,${(i / trail.length) * 0.55})`; g.lineWidth = 2 + (i / trail.length) * 7; g.lineCap = 'round'
        g.beginPath(); g.moveTo(trail[i - 1].x, trail[i - 1].y); g.lineTo(trail[i].x, trail[i].y); g.stroke()
      }
      // пламя
      const dx = Math.sin(ang), dy = -Math.cos(ang) // направление носа
      const rs = Math.min(w * 0.13, 56)
      if ((flying || ph === 'idle' || ph === 'cash') && !exploded) {
        const n = flying || ph === 'cash' ? 4 : 1
        for (let i = 0; i < n; i++) flame.push({ x: rx - dx * rs * 0.9, y: ry - dy * rs * 0.9, vx: -dx * (2 + Math.random() * 3) + (Math.random() - 0.5) * 1.5, vy: -dy * (2 + Math.random() * 3) + (Math.random() - 0.5) * 1.5, l: 1 })
      }
      for (let i = flame.length - 1; i >= 0; i--) {
        const f = flame[i]; f.x += f.vx * dt; f.y += f.vy * dt; f.l -= 0.05 * dt
        if (f.l <= 0) { flame.splice(i, 1); continue }
        g.globalCompositeOperation = f.l > 0.25 ? 'lighter' : 'source-over'
        g.globalAlpha = f.l * (f.l > 0.25 ? 0.8 : 0.35); g.fillStyle = f.l > 0.7 ? '#FFF3C4' : f.l > 0.45 ? '#FFB347' : f.l > 0.25 ? '#FF6A2B' : '#6b7a75'
        g.beginPath(); g.arc(f.x, f.y, 2 + f.l * (f.l > 0.25 ? 6 : 9), 0, 6.3); g.fill()
        g.globalCompositeOperation = 'source-over'
      }
      g.globalAlpha = 1
      // свет двигателя на корпусе
      if (flying && !exploded) { const eg = g.createRadialGradient(rx - dx * rs * 0.9, ry - dy * rs * 0.9, 0, rx - dx * rs * 0.9, ry - dy * rs * 0.9, rs * 1.6); eg.addColorStop(0, 'rgba(255,170,70,.45)'); eg.addColorStop(1, 'rgba(255,170,70,0)'); g.fillStyle = eg; g.fillRect(rx - rs * 3, ry - rs * 3, rs * 6, rs * 6) }
      // ракета
      if (!exploded && img.complete) {
        g.save(); g.translate(rx, ry); g.rotate(ang)
        if (ph === 'cash') { g.shadowColor = '#59b58d'; g.shadowBlur = 24 }
        g.drawImage(img, -rs / 2, -rs, rs, rs * 2); g.restore()
      }
      // взрыв
      for (let i = boom.length - 1; i >= 0; i--) {
        const b = boom[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 0.12 * dt; b.vx *= 0.99; b.l -= 0.014 * dt
        if (b.l <= 0) { boom.splice(i, 1); continue }
        g.globalAlpha = b.l; g.fillStyle = b.c; g.beginPath(); g.arc(b.x, b.y, b.r * b.l + 0.5, 0, 6.3); g.fill()
      }
      g.globalAlpha = 1
      if (ring > 0.02) { g.strokeStyle = `rgba(255,220,160,${ring * 0.8})`; g.lineWidth = 2 + ring * 6; g.beginPath(); g.arc(ex, ey, 20 + (1 - ring) * 170, 0, 6.3); g.stroke(); ring *= 0.93 }
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i]; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 0.18 * dt; d.a += d.va * dt; d.l -= 0.012 * dt
        if (d.l <= 0) { debris.splice(i, 1); continue }
        g.save(); g.translate(d.x, d.y); g.rotate(d.a); g.globalAlpha = d.l; g.fillStyle = i % 2 ? '#e8374f' : '#dfe9e5'; g.fillRect(-d.w / 2, -d.w / 4, d.w, d.w / 2); g.restore()
      }
      g.globalAlpha = 1
      if (flash > 0.02) { g.fillStyle = `rgba(255,230,180,${flash * 0.55})`; g.beginPath(); g.arc(ex, ey, 40 + (1 - flash) * 220, 0, 6.3); g.fill(); flash *= 0.88 }
      g.restore()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    void t0
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="crash-canvas" aria-label="Полёт ракеты" role="img" />
}
