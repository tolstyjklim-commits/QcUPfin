// Простые синтезированные звуки (WebAudio): без файлов, включаются кнопкой звука.
let ac: AudioContext | null = null
export const sfx = { enabled: false }
const ctx = () => {
  if (!ac) { try { ac = new (window.AudioContext || (window as any).webkitAudioContext)() } catch { return null } }
  if (ac.state === 'suspended') ac.resume()
  return ac
}
function tone(f: number, d: number, type: OscillatorType = 'sine', v = 0.07, to?: number, delay = 0) {
  if (!sfx.enabled) return
  const c = ctx(); if (!c) return
  const t = c.currentTime + delay
  const o = c.createOscillator(), g = c.createGain()
  o.type = type; o.frequency.setValueAtTime(f, t)
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + d)
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d)
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + 0.02)
}
function noise(d: number, v = 0.2, delay = 0, cutoff = 900, kind: BiquadFilterType = 'lowpass') {
  if (!sfx.enabled) return
  const c = ctx(); if (!c) return
  const n = Math.floor(c.sampleRate * d), buf = c.createBuffer(1, n, c.sampleRate), data = buf.getChannelData(0)
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n)
  const src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter()
  f.type = kind; f.frequency.value = cutoff
  g.gain.value = v; src.buffer = buf; src.connect(f); f.connect(g); g.connect(c.destination); src.start(c.currentTime + delay)
}
export const play = {
  tick: () => tone(1500, 0.025, 'square', 0.025),
  click: () => tone(420, 0.07, 'triangle', 0.06),
  coin: () => { tone(1318, 0.07, 'square', 0.035); tone(1760, 0.14, 'square', 0.035, undefined, 0.06) },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 'triangle', 0.08, undefined, i * 0.07)),
  big: () => [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.28, 'triangle', 0.09, undefined, i * 0.08)),
  lose: () => tone(240, 0.45, 'sawtooth', 0.05, 90),
  boom: () => { noise(0.6, 0.35); tone(110, 0.5, 'sine', 0.2, 35) },
  whoosh: () => tone(180, 0.7, 'sawtooth', 0.025, 1100),
  stop: () => tone(260, 0.09, 'square', 0.05, 180),
  flip: () => tone(900, 0.05, 'triangle', 0.04, 500),
  // ---- разнообразные звуки для разных игр ----
  ding: (n = 0) => { const f = 660 * Math.pow(1.0595, Math.min(n, 18) * 2); tone(f, 0.16, 'sine', 0.07); tone(f * 2, 0.22, 'sine', 0.035, undefined, 0.04) }, // светлый «дзинь», растёт с серией
  chime: (tier = 1) => (tier >= 2 ? [523, 659, 784, 988, 1175] : [523, 659, 784]).forEach((f, i) => tone(f, 0.22 + tier * 0.05, 'sine', 0.07, undefined, i * 0.06)),
  jackpot: () => { [392, 523, 659, 784, 1046, 1318, 1568, 2093].forEach((f, i) => tone(f, 0.45, 'triangle', 0.09, undefined, i * 0.07)); [1568, 2093, 2637].forEach((f, i) => tone(f, 0.7, 'sine', 0.05, undefined, 0.6 + i * 0.1)); noise(0.5, 0.06, 0.55, 6000, 'highpass') },
  sparkle: () => [2093, 2637, 3136, 2637, 3520].forEach((f, i) => tone(f, 0.1, 'sine', 0.035, undefined, i * 0.045)),
  thud: () => { tone(140, 0.18, 'sine', 0.2, 50); noise(0.1, 0.12, 0, 500) },
  lock: () => { tone(220, 0.06, 'square', 0.05, 140); noise(0.04, 0.08, 0, 2400, 'highpass') }, // остановка барабана
  card: () => { noise(0.07, 0.14, 0, 3200, 'highpass'); tone(300, 0.05, 'triangle', 0.03, 200) },
  creak: () => { tone(90, 0.5, 'sawtooth', 0.035, 160); tone(95, 0.45, 'square', 0.015, 150, 0.08); noise(0.4, 0.05, 0.1, 400) }, // скрип кейса
  cash: () => { noise(0.08, 0.1, 0, 5000, 'highpass'); [1568, 2093].forEach((f, i) => tone(f, 0.25, 'sine', 0.06, undefined, 0.07 + i * 0.09)) },
  door: () => { tone(120, 0.22, 'triangle', 0.1, 70); tone(240, 0.12, 'square', 0.025, 330, 0.12) },
  ghost: () => { tone(300, 0.9, 'sine', 0.06, 90); tone(320, 0.9, 'sine', 0.04, 100, 0.05); noise(0.6, 0.05, 0, 700) },
  bounce: (k = 0) => tone(500 + (k % 9) * 70, 0.05, 'triangle', 0.05, 320),
  beep: (go = false) => tone(go ? 1175 : 660, go ? 0.5 : 0.14, 'square', 0.05), // отсчёт старта: гудки, последний выше и дольше
  rev: () => { tone(70, 1.4, 'sawtooth', 0.03, 260); tone(105, 1.2, 'square', 0.012, 330, 0.1); noise(0.9, 0.04, 0, 1200) },
  nitro: () => { noise(0.7, 0.14, 0, 1400, 'bandpass'); tone(300, 0.7, 'sawtooth', 0.04, 1400) },
  squeal: () => { tone(1500, 0.45, 'sawtooth', 0.022, 1000); noise(0.35, 0.07, 0, 3800, 'highpass') },
  bell: () => { tone(1568, 0.5, 'sine', 0.07); tone(2349, 0.7, 'sine', 0.04, undefined, 0.01) },
  finish: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.12, 'square', 0.04, undefined, i * 0.1)); tone(1568, 0.5, 'triangle', 0.06, undefined, 0.45) },
  roll: () => tone(180 + Math.random() * 70, 0.04, 'triangle', 0.05), // перестук кубика
  zap: () => { tone(1800, 0.12, 'sawtooth', 0.04, 300); noise(0.1, 0.07, 0, 4000, 'highpass') },
  scratch: () => noise(0.06, 0.07, 0, 2600, 'highpass'),
  spin: () => { tone(260, 0.5, 'sawtooth', 0.025, 700); noise(0.4, 0.04, 0, 1800, 'bandpass') },
  step: () => { tone(180, 0.07, 'square', 0.04, 120); noise(0.05, 0.05, 0, 700) },
}

// ---- вибрация (Telegram Haptic Feedback): привязана к тем же событиям, что и звуки ----
export const haptic = { on: (() => { try { return localStorage.getItem('qcup-haptic') !== '0' } catch { return true } })() }
export const setHaptic = (v: boolean) => { haptic.on = v; try { localStorage.setItem('qcup-haptic', v ? '1' : '0') } catch { /* хранилище недоступно */ } }
let lastBuzz = 0
const buzz = (k: string) => {
  const HF = (window as any).Telegram?.WebApp?.HapticFeedback
  if (!haptic.on || !HF) return
  const t = Date.now(); if (t - lastBuzz < 70) return; lastBuzz = t
  try { if (k === 'success' || k === 'error' || k === 'warning') HF.notificationOccurred(k); else HF.impactOccurred(k) } catch { /* не Telegram */ }
}
const HMAP: Record<string, string> = { click: 'light', stop: 'light', flip: 'light', card: 'light', lock: 'rigid', coin: 'soft', thud: 'medium', zap: 'medium', boom: 'heavy', lose: 'error', win: 'success', big: 'success', jackpot: 'success', cash: 'success', chime: 'success', sparkle: 'light', bounce: 'light' }
for (const k of Object.keys(HMAP)) {
  const f = (play as any)[k]; if (typeof f !== 'function') continue
  ;(play as any)[k] = (...a: unknown[]) => { buzz(HMAP[k]); return f(...a) }
}
