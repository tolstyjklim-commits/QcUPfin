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
function noise(d: number, v = 0.2, delay = 0) {
  if (!sfx.enabled) return
  const c = ctx(); if (!c) return
  const n = Math.floor(c.sampleRate * d), buf = c.createBuffer(1, n, c.sampleRate), data = buf.getChannelData(0)
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n)
  const src = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter()
  f.type = 'lowpass'; f.frequency.value = 900
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
}
