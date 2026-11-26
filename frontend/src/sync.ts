// История игр для сервера: ставки и выигрыши складываются в очередь и пачками уходят на сервер (админ-панель показывает их игроку).
// Очередь хранится в браузере, у каждого события свой номер (seq): если ответ потерялся и пачка уйдёт повторно, сервер не посчитает её дважды.
// Эти данные присылает клиент, поэтому сервер считает их непроверенными; проверенными считаются только пополнения.
import { DEMO } from './lib'
import { serverJson, serverMode } from './deposit'

type Ev = { s: number; k: 'bet' | 'win' | 'bonus' | 'sale'; g: string; a: number; t: number }
const TG = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id
const QK = `qcup-sync-q-${TG || 'x'}`, SK = `qcup-sync-seq-${TG || 'x'}`
const load = (): Ev[] => { try { const q = JSON.parse(localStorage.getItem(QK) || '[]'); return Array.isArray(q) ? q : [] } catch { return [] } }
const save = (q: Ev[]) => { try { localStorage.setItem(QK, JSON.stringify(q.slice(-1500))) } catch { /* хранилище переполнено: теряем самое старое */ } }
const nextSeq = () => { let n = 0; try { n = Number(localStorage.getItem(SK)) || 0 } catch { /* */ } n += 1; try { localStorage.setItem(SK, String(n)) } catch { /* */ } return n }

export function track(kind: 'bet' | 'win' | 'bonus' | 'sale', game: string, amount: number) {
  if (DEMO || !TG || !(amount > 0) || !Number.isFinite(amount)) return
  const q = load(); q.push({ s: nextSeq(), k: kind, g: game.slice(0, 40), a: Math.round(amount), t: Date.now() }); save(q)
}

let busy = false
export async function flushSync(snapshot: { balance: number; level: number }) {
  if (busy || DEMO || !TG) return
  busy = true
  try {
    if (!(await serverMode())) return
    const q = load()
    const batch = q.slice(0, 200)
    const r = await serverJson<{ seq: number }>('POST', '/api/sync', { events: batch, balance: Math.round(snapshot.balance), level: snapshot.level })
    if (r && r.ok) { const last = batch.length ? batch[batch.length - 1].s : 0; save(load().filter(e => e.s > last)) } // убираем только отправленное
    else if (r && r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 429) save(load().slice(batch.length)) // сервер отверг пачку: не зацикливаемся
  } catch { /* повторим в следующий раз */ } finally { busy = false }
}
