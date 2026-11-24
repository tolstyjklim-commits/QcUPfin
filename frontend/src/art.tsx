import { useEffect, useId, useRef, useState } from 'react'
import { GIFTS, type GiftKind } from './lib'

const SHAPES: Record<string, string> = {
  heart: 'M60 104C16 72 12 42 30 28c13-10 25-4 30 8 5-12 17-18 30-8 18 14 14 44-30 76z',
  star: 'M60 12l14 30 33 4-24 23 6 33-29-16-29 16 6-33-24-23 33-4z',
  diamond: 'M60 12l38 30-38 66L22 42z',
  hex: 'M60 12l38 22v52L60 108 22 86V34z',
}

// Анимированные стикеры Telegram (.tgs = gzip + Lottie JSON). Грузятся лениво и кэшируются:
// при перемонтировании (например, в ленте кейса) картинка появляется сразу, без паузы на повторную загрузку.
const lottieData = new Map<string, Promise<any>>()
const lottieReady = new Map<string, any>()
let lottieLib: any = null
const loadLib = async () => (lottieLib ||= (await import('lottie-web')).default)
function loadLottieData(src: string): Promise<any> {
  let p = lottieData.get(src)
  if (!p) {
    p = (async () => {
      const buf = await (await fetch(src)).arrayBuffer()
      const u8 = new Uint8Array(buf)
      let text: string
      if (u8[0] === 0x1f && u8[1] === 0x8b) text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
      else text = new TextDecoder().decode(u8)
      const data = JSON.parse(text)
      lottieReady.set(src, data)
      return data
    })()
    p.catch(() => lottieData.delete(src))
    lottieData.set(src, p)
  }
  return p
}
// Прогреть кэш для подарков: анимация и картинка. Не бросает ошибок, нужна только чтобы ничего не «мигало»
export function preloadGift(kind: GiftKind, withAnim = true): Promise<void> {
  const g = GIFTS[kind]
  if (!g) return Promise.resolve()
  const jobs: Promise<unknown>[] = []
  if (withAnim && g.anim && !g.nft) jobs.push(loadLib(), loadLottieData(g.anim))
  if (g.thumb) {
    const u = srcFor(g.thumb, 0)
    if (u) jobs.push(new Promise(res => { const im = new Image(); im.onload = im.onerror = () => res(null); im.referrerPolicy = 'no-referrer'; im.src = u }))
  }
  return Promise.allSettled(jobs).then(() => undefined)
}

function LottieArt({ src, size, onFail }: { src: string; size: number; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let anim: { destroy: () => void } | null = null, dead = false
    const mount = (lib: any, data: any) => {
      if (dead || !box.current) return
      anim = lib.loadAnimation({ container: box.current, renderer: 'svg', loop: true, autoplay: true, animationData: structuredClone(data) })
    }
    if (lottieLib && lottieReady.has(src)) mount(lottieLib, lottieReady.get(src)) // из кэша: сразу, без ожидания
    else (async () => { try { const [lib, data] = await Promise.all([loadLib(), loadLottieData(src)]); mount(lib, data) } catch { if (!dead) onFail() } })()
    return () => { dead = true; anim?.destroy() }
  }, [src, onFail])
  return <div ref={box} style={{ width: size, height: size }} />
}

// У NFT-коллекций несколько возможных адресов картинки: превью коллекции, затем первый выпущенный экземпляр
function srcFor(thumb: string, n: number): string {
  const m = thumb.match(/fragment\.com\/file\/gifts\/([a-z0-9]+)\/thumb\.webp/i)
  if (!m) return n === 0 ? thumb : ''
  const slug = m[1].toLowerCase()
  // сначала сохранённая на этом ПК иконка, затем Fragment
  return [`./gifts/nft/${slug}.webp`, thumb, `https://nft.fragment.com/gift/${slug}-1.webp`, `https://nft.fragment.com/gift/${slug}-1.small.jpg`][n] || ''
}

// Анимация (Lottie) тяжёлая: по умолчанию подарки показываются статичной картинкой, анимируется только тот, что выпал (animate)
export function GiftArt({ kind, size = 64, glow = true, animate = false }: { kind: GiftKind; size?: number; glow?: boolean; animate?: boolean }) {
  const id = useId().replace(/:/g, '')
  const g = GIFTS[kind]
  const [imgBad, setImgBad] = useState(false)
  const [alt, setAlt] = useState(0) // номер запасного адреса картинки
  const [animBad, setAnimBad] = useState(false)
  if (!g) return <span style={{ width: size, height: size, display: 'inline-block' }} />
  if (g.anim && size >= 36 && !g.nft && !animBad && (animate || !g.thumb)) return <LottieArt src={g.anim} size={size} onFail={() => setAnimBad(true)} />
  if (g.thumb && !imgBad) return (
    <span style={{ width: size, height: size, display: 'inline-grid', placeItems: 'center', borderRadius: size * 0.25,
      background: glow ? `radial-gradient(circle,${g.c1}55,transparent 70%)` : 'none' }}>
      <img src={srcFor(g.thumb, alt)} alt="" referrerPolicy="no-referrer" onError={() => { const n = srcFor(g.thumb!, alt + 1); if (n) setAlt(alt + 1); else setImgBad(true) }} width={size * 0.86} height={size * 0.86} style={{ objectFit: 'contain' }} />
    </span>)
  // картинка не загрузилась: нейтральная заглушка вместо нарисованных фигур
  return <span aria-hidden="true" style={{ width: size, height: size, display: 'inline-grid', placeItems: 'center', fontSize: size * 0.55, opacity: .55 }}>🎁</span>
}

export function RocketArt({ size = 120, flame = true }: { size?: number; flame?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFE08A" /><stop offset="1" stopColor="#F0A21B" /></linearGradient>
        <linearGradient id={`h${id}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#d9eee4" /></linearGradient>
      </defs>
      <g transform="rotate(45 100 100)">
        <path d="M100 14c26 22 34 58 28 100H72c-6-42 2-78 28-100z" fill={`url(#h${id})`} stroke="#374c44" strokeWidth="3" />
        <circle cx="100" cy="64" r="13" fill="#263630" stroke={`url(#g${id})`} strokeWidth="5" />
        <path d="M72 114l-26 30 6 12 22-12zM128 114l26 30-6 12-22-12z" fill={`url(#g${id})`} stroke="#374c44" strokeWidth="3" strokeLinejoin="round" />
        <rect x="84" y="114" width="32" height="12" fill="#F0A21B" />
        {flame && <><path d="M86 128h28l-14 52z" fill="#FF8A3D" /><path d="M92 128h16l-8 30z" fill="#FFE08A" /></>}
      </g>
    </svg>
  )
}

export const Coin = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 1.8l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.9 5.6 21.4 7 14.3 1.7 9.3l7.2-.9z" fill="#F6B73C" stroke="#B87A12" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
)

// Иконки валют: TON (фирменный синий) и USDT (фирменный зелёный)
export const TonIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <defs><linearGradient id="tonG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2BB3F5" /><stop offset="1" stopColor="#0088CC" /></linearGradient></defs>
    <circle cx="12" cy="12" r="12" fill="url(#tonG)" />
    <path d="M7.4 7.2h9.2c.7 0 1.100.7.800 1.300l-4.600 8c-.3.5-1 .5-1.300 0l-4.600-8c-.3-.6.100-1.300.5-1.300z" fill="#fff" />
    <path d="M12 7.600v9" stroke="#0A92D6" strokeWidth="1" strokeLinecap="round" />
  </svg>
)
export const UsdtIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none' }}>
    <circle cx="12" cy="12" r="12" fill="#26A17B" />
    <path d="M7 7h10v2.500h-3.800V11.500c2.600.1 4.500.7 4.500 1.500s-1.900 1.400-4.500 1.500V18h-2.400v-3.500C8.200 14.400 6.300 13.800 6.300 13s1.900-1.400 4.500-1.500V9.500H7z" fill="#fff" />
    <ellipse cx="12" cy="12.900" rx="3.400" ry=".75" fill="#26A17B" />
  </svg>
)
