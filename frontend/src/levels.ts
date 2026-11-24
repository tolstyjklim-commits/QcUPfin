// Система уровней: опыт (XP) даётся за ставки, задания и достижения. Наград за уровни пока нет, только прогресс и звания.
export const MAX_LEVEL = 100
export const xpToNext = (level: number) => 100 + 40 * (level - 1)          // сколько XP нужно, чтобы с уровня N перейти на N+1
export const xpAtLevel = (level: number) => { let t = 0; for (let l = 1; l < level; l++) t += xpToNext(l); return t } // сумма XP для достижения уровня
export function levelInfo(xp: number) {
  let level = 1, rest = Math.max(0, Math.floor(xp))
  while (level < MAX_LEVEL && rest >= xpToNext(level)) { rest -= xpToNext(level); level++ }
  const need = level >= MAX_LEVEL ? 0 : xpToNext(level)
  return { level, into: rest, need, pct: need ? rest / need : 1 }
}
export const RANKS: [number, string][] = [[1, 'Новичок'], [5, 'Игрок'], [10, 'Азартный'], [20, 'Профи'], [35, 'Мастер'], [50, 'Легенда'], [75, 'Миф']]
export const rankOf = (level: number) => [...RANKS].reverse().find(r => level >= r[0])![1]

// XP за раунд: 2 за сам раунд + 1 за каждые 25 звёзд ставки (максимум 40 сверху)
export const betXp = (cost: number) => 2 + Math.min(40, Math.floor(cost / 25))
export const TASK_XP = 50
export const DAILY_XP = 20

type Stats = Record<string, number>
export type Achievement = { id: string; title: string; desc: string; icon: string; xp: number; test: (s: Stats) => boolean }
const GAME_KEYS = ['crash', 'storm', 'slots', 'cases', 'mines', 'plinko', 'blackjack', 'mansion', 'coin', 'upgrades']
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'r1', title: 'Первый шаг', desc: 'Сыграть первый раунд', icon: '🎯', xp: 20, test: s => (s.rounds || 0) >= 1 },
  { id: 'r50', title: 'Втянулся', desc: '50 раундов', icon: '🎲', xp: 60, test: s => (s.rounds || 0) >= 50 },
  { id: 'r250', title: 'Завсегдатай', desc: '250 раундов', icon: '🃏', xp: 150, test: s => (s.rounds || 0) >= 250 },
  { id: 'r1000', title: 'Старожил', desc: '1000 раундов', icon: '👑', xp: 400, test: s => (s.rounds || 0) >= 1000 },
  { id: 's1k', title: 'Первая тысяча', desc: 'Поставить 1 000 ⭐ суммарно', icon: '💫', xp: 50, test: s => (s.gStaked || 0) >= 1000 },
  { id: 's10k', title: 'Крупная игра', desc: 'Поставить 10 000 ⭐ суммарно', icon: '🌟', xp: 150, test: s => (s.gStaked || 0) >= 10000 },
  { id: 's100k', title: 'Хайроллер', desc: 'Поставить 100 000 ⭐ суммарно', icon: '💎', xp: 500, test: s => (s.gStaked || 0) >= 100000 },
  { id: 'p10k', title: 'В плюсе', desc: 'Выигрыши суммарно на 10 000 ⭐', icon: '💰', xp: 120, test: s => (s.gPaid || 0) >= 10000 },
  { id: 'c1', title: 'Первый кейс', desc: 'Открыть кейс', icon: '📦', xp: 25, test: s => (s.cases || 0) >= 1 },
  { id: 'c25', title: 'Коллекционер', desc: 'Открыть 25 кейсов', icon: '🎁', xp: 120, test: s => (s.cases || 0) >= 25 },
  { id: 'u1', title: 'Рискнул', desc: 'Сделать апгрейд', icon: '⚡', xp: 25, test: s => (s.upgrades || 0) >= 1 },
  { id: 'u10', title: 'Мастер апгрейда', desc: '10 апгрейдов', icon: '🔥', xp: 120, test: s => (s.upgrades || 0) >= 10 },
  { id: 't5', title: 'Торговец', desc: '5 сделок на маркете', icon: '🛒', xp: 60, test: s => (s.trades || 0) >= 5 },
  { id: 'g5', title: 'Любопытный', desc: 'Попробовать 5 разных игр', icon: '🧭', xp: 80, test: s => GAME_KEYS.filter(k => (s[k] || 0) > 0).length >= 5 },
  { id: 'g10', title: 'Всё перепробовал', desc: 'Попробовать все игры', icon: '🏆', xp: 250, test: s => GAME_KEYS.filter(k => (s[k] || 0) > 0).length >= GAME_KEYS.length },
]
