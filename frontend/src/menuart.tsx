// Собственные обложки режимов (SVG): вместо картинок, похожих на чужие. Используются в меню и в шапке каждой игры.
import type { ReactNode } from 'react'

type P = { id: string }
const Bg = ({ id, a, b }: { id: string; a: string; b: string }) => (
  <defs>
    <linearGradient id={`cv-${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} /></linearGradient>
    <radialGradient id={`cg-${id}`} cx=".5" cy=".45"><stop offset="0" stopColor="#fff" stopOpacity=".45" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
  </defs>
)
const Frame = ({ id, a, b, children }: { id: string; a: string; b: string; children: ReactNode }) => (
  <svg viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" className="cover" aria-hidden="true">
    <Bg id={id} a={a} b={b} />
    <rect width="160" height="120" fill={`url(#cv-${id})`} />
    <circle cx="80" cy="52" r="52" fill={`url(#cg-${id})`} />
    {children}
  </svg>
)
const Sparks = ({ n = 7, c = '#fff' }: { n?: number; c?: string }) => <>{Array.from({ length: n }, (_, i) => <circle key={i} className="tw" style={{ animationDelay: `${i * 0.37}s` }} cx={(i * 53 + 17) % 150 + 5} cy={(i * 31 + 9) % 70 + 6} r={0.9 + (i % 3) * 0.5} fill={c} opacity=".7" />)}</>

export function GameCover({ id }: P) {
  switch (id) {
    case 'upgrade': return (
      <Frame id={id} a="#3a1d6e" b="#12805f">
        <Sparks />
        <circle cx="80" cy="56" r="34" fill="none" stroke="#7df3c6" strokeWidth="2" strokeDasharray="3 6" opacity=".6" className="spin-slow" />
        <rect x="52" y="52" width="56" height="42" rx="6" fill="#ff5d9e" /><rect x="52" y="52" width="56" height="12" rx="4" fill="#ff8abc" />
        <rect x="75" y="52" width="10" height="42" fill="#ffe08a" /><path d="M80 52c-14-18-26-4-12 0zM80 52c14-18 26-4 12 0z" fill="#ffe08a" />
        <path d="M118 46l10-14 10 14h-6v16h-8V46z" fill="#7df3c6" stroke="#0b3f31" strokeWidth="1.500" strokeLinejoin="round" />
      </Frame>)
    case 'storm': return (
      <Frame id={id} a="#1b2b6b" b="#6a1d7a">
        <Sparks c="#9fd0ff" />
        <path d="M70 6L44 54h18l-8 36 34-48H68l12-36z" fill="#ffe14d" stroke="#7a5200" strokeWidth="1.500" strokeLinejoin="round" className="bolt" />
        {[14, 62, 110].map((x, i) => <g key={x}><rect x={x} y="78" width="36" height="32" rx="6" fill="#0f1730" stroke="#8fa8ff" strokeWidth="1.500" /><text x={x + 18} y="102" fontSize="19" fontWeight="900" textAnchor="middle" fill={['#ffd166', '#ff6b8b', '#7df3c6'][i]}>{['7', '7', '7'][i]}</text></g>)}
      </Frame>)
    case 'rocket': return (
      <Frame id={id} a="#0d1b3d" b="#7a2b5f">
        <Sparks n={10} />
        <path d="M8 104L40 86l22 8 26-26 22 6 28-40" fill="none" stroke="#7df3c6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <g transform="translate(112 22) rotate(38)">
          <path d="M0 -22c9 7 12 20 9 34h-18c-3-14 0-27 9-34z" fill="#f4f7ff" /><circle cx="0" cy="-6" r="5" fill="#4cc9f0" stroke="#27506b" strokeWidth="1.500" />
          <path d="M-9 8l-9 9 3-17zM9 8l9 9-3-17z" fill="#ff5d73" /><path d="M-5 12h10l-5 16z" fill="#ffb347" className="flame" />
        </g>
        <text x="30" y="40" fontSize="22" fontWeight="900" fill="#fff" opacity=".9">×12,4</text>
      </Frame>)
    case 'cases': return (
      <Frame id={id} a="#0f4d78" b="#6b2b9a">
        <Sparks c="#bfe9ff" />
        <path d="M30 62h100v44a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6z" fill="#b8742e" /><path d="M30 62h100v14H30z" fill="#d89040" />
        <path d="M30 62c0-14 22-24 50-24s50 10 50 24z" fill="#e0a050" stroke="#7a4a14" strokeWidth="1.500" />
        <rect x="72" y="60" width="16" height="22" rx="3" fill="#ffd166" stroke="#7a5200" strokeWidth="1.500" />
        <path d="M80 56c-3-26-2-34 0-44 2 10 3 18 0 44z" fill="#ffe9a8" opacity=".8" /><circle cx="80" cy="28" r="9" fill="#ff5d9e" /><path d="M80 19v18M71 28h18" stroke="#ffe08a" strokeWidth="2" />
      </Frame>)
    case 'slots': return (
      <Frame id={id} a="#5b1d3a" b="#a8561a">
        <Sparks c="#ffe08a" />
        <rect x="20" y="30" width="120" height="62" rx="12" fill="#2a0f1d" stroke="#ffc24b" strokeWidth="3" />
        {[0, 1, 2].map(i => <g key={i}><rect x={28 + i * 38} y="38" width="34" height="46" rx="7" fill="#fff6e0" /><text x={45 + i * 38} y="70" fontSize="26" textAnchor="middle">{['🍒', '💎', '🍀'][i]}</text></g>)}
        {Array.from({ length: 11 }, (_, i) => <circle key={i} className="tw" style={{ animationDelay: `${(i % 2) * 0.5}s` }} cx={24 + i * 11.2} cy="22" r="2.600" fill="#ffd166" />)}
      </Frame>)
    case 'mines': return (
      <Frame id={id} a="#12384a" b="#0d6a58">
        <Sparks c="#9ff5d6" />
        {Array.from({ length: 9 }, (_, i) => { const x = 28 + (i % 3) * 36, y = 14 + Math.floor(i / 3) * 31; const k = i === 4 ? 'gem' : i === 6 ? 'bomb' : 'tile'; return (
          <g key={i}><rect x={x} y={y} width="32" height="27" rx="7" fill={k === 'tile' ? '#2e6b6a' : '#102a31'} stroke={k === 'gem' ? '#7df3c6' : '#58a39b'} strokeWidth="1.500" />
            {k === 'gem' && <path d={`M${x + 16} ${y + 5}l9 7-9 12-9-12z`} fill="#7df3c6" stroke="#0b5844" strokeWidth="1.200" />}
            {k === 'bomb' && <><circle cx={x + 16} cy={y + 15} r="7" fill="#1a1d22" /><path d={`M${x + 20} ${y + 8}l5-4`} stroke="#ffb347" strokeWidth="2" strokeLinecap="round" /></>}</g>) })}
      </Frame>)
    case 'plinko': return (
      <Frame id={id} a="#1a2a5a" b="#0d7a7a">
        <Sparks />
        {[1, 2, 3, 4, 5].map(r => Array.from({ length: r + 1 }, (_, c) => <circle key={`${r}${c}`} cx={80 + (c - r / 2) * 22} cy={14 + r * 15} r="3" fill="#e0fff4" />))}
        <circle cx="94" cy="49" r="7" fill="#ffc24b" stroke="#7a5200" strokeWidth="1.500" className="ballfall" />
        {[0, 1, 2, 3, 4, 5].map(i => <rect key={i} x={14 + i * 22.6} y="98" width="19" height="14" rx="4" fill={i === 0 || i === 5 ? '#c27d0a' : '#2f6b5a'} />)}
      </Frame>)
    case 'blackjack': return (
      <Frame id={id} a="#0d4a30" b="#0a2d4a">
        <Sparks c="#cfe" />
        <g transform="translate(46 70) rotate(-14)"><rect x="-22" y="-34" width="44" height="64" rx="6" fill="#f6f8f4" /><text x="-14" y="-14" fontSize="15" fontWeight="900" fill="#1b1f23">A</text><text x="0" y="14" fontSize="30" textAnchor="middle" fill="#1b1f23">♠</text></g>
        <g transform="translate(100 66) rotate(12)"><rect x="-22" y="-34" width="44" height="64" rx="6" fill="#f6f8f4" /><text x="-14" y="-14" fontSize="15" fontWeight="900" fill="#d63b55">K</text><text x="0" y="14" fontSize="30" textAnchor="middle" fill="#d63b55">♥</text></g>
        <circle cx="132" cy="24" r="14" fill="#ffc24b" stroke="#7a5200" strokeWidth="2" /><text x="132" y="29" fontSize="13" fontWeight="900" textAnchor="middle" fill="#3a2600">21</text>
      </Frame>)
    case 'mansion': return (
      <Frame id={id} a="#161a3a" b="#4a2a6a">
        <Sparks n={12} />
        <circle cx="128" cy="24" r="12" fill="#fff6c8" /><circle cx="123" cy="21" r="2.600" fill="#d8c98a" />
        <path d="M24 112V62l56-34 56 34v50z" fill="#2a1a3d" stroke="#6e4b7d" strokeWidth="2" strokeLinejoin="round" />
        <path d="M18 64L80 22l62 42" fill="none" stroke="#7d5890" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="104" y="34" width="12" height="20" fill="#241631" />
        {[[40, 72], [64, 72], [96, 72], [120, 72]].map(([x, y], i) => <rect key={i} className="win-lit" style={{ animationDelay: `${i * 0.6}s` }} x={x - 7} y={y - 9} width="14" height="18" rx="7" fill="#ffd166" />)}
        <path d="M70 112V92a10 10 0 0 1 20 0v20z" fill="#5b3a63" stroke="#9a78ad" strokeWidth="1.500" /><circle cx="86" cy="102" r="1.600" fill="#ffd166" />
        <path className="bat b1" d="M30 34c4-6 8-3 10 0c2-3 6-6 10 0c-4-2-6 0-10 4c-4-4-6-6-10-4z" fill="#0b0d18" />
      </Frame>)
    case 'coin': return (
      <Frame id={id} a="#5b3a0d" b="#8a2b4a">
        <Sparks c="#ffe9a8" />
        <ellipse cx="80" cy="100" rx="38" ry="6" fill="#000" opacity=".35" />
        <circle cx="80" cy="56" r="40" fill="#e2a52a" stroke="#fff0a0" strokeWidth="3" /><circle cx="80" cy="56" r="32" fill="none" stroke="#8a5a05" strokeWidth="1.500" strokeDasharray="2 4" />
        <circle cx="80" cy="56" r="26" fill="#f3c24a" /><path d="M80 36l6 14 15 1-12 10 4 15-13-8-13 8 4-15-12-10 15-1z" fill="#b9801a" />
        <path d="M54 34c6-8 16-12 26-12" fill="none" stroke="#fff6c8" strokeWidth="3" strokeLinecap="round" opacity=".8" />
      </Frame>)
    case 'racing': return (
      <Frame id={id} a="#1b2f5a" b="#a83a3a">
        <path d="M0 92h160v28H0z" fill="#2a2d35" /><path d="M0 104h160" stroke="#fff" strokeWidth="2" strokeDasharray="14 12" opacity=".6" className="road" />
        {[0, 1, 2].map(i => <path key={i} d={`M${6 + i * 6} ${40 + i * 14}h${40 - i * 8}`} stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity={0.5 - i * 0.12} />)}
        <g transform="translate(40 36) scale(1.700)"><path d="M4 21c0-4 2-6 6-7l8-1c3-4 6-7 11-7h10c5 0 8 3 11 7l9 2c4 1 6 3 6 6v2c0 1-1 2-2 2H6c-1 0-2-1-2-2z" fill="#ff5d73" /><path d="M22 13c2-3 4-5 8-5h6c4 0 6 2 8 5z" fill="#bfeaff" /><circle cx="19" cy="24" r="5" fill="#15191c" /><circle cx="19" cy="24" r="2" fill="#aab3b8" /><circle cx="52" cy="24" r="5" fill="#15191c" /><circle cx="52" cy="24" r="2" fill="#aab3b8" /></g>
        <g transform="translate(120 10)">{Array.from({ length: 12 }, (_, i) => <rect key={i} x={(i % 3) * 8} y={Math.floor(i / 3) * 8} width="8" height="8" fill={(i + Math.floor(i / 3)) % 2 ? '#fff' : '#15191c'} />)}</g>
      </Frame>)
    default: return (
      <Frame id="launch" a="#0d2a4a" b="#1d1a5a">
        <Sparks n={14} />
        <circle cx="80" cy="64" r="26" fill="#3a7bd5" /><path d="M58 58c8-6 18-4 26 2s14 4 20-2" fill="none" stroke="#8fd0ff" strokeWidth="3" opacity=".7" />
        <ellipse cx="80" cy="64" rx="52" ry="12" fill="none" stroke="#ffd166" strokeWidth="2.500" transform="rotate(-18 80 64)" opacity=".9" />
        <circle cx="128" cy="44" r="5" fill="#ff8abc" />
      </Frame>)
  }
}

// Короткая подпись и честные цифры для шапки игры. Отдача указана только там, где она заложена в формулы без подстроек.
export const GAME_INFO: Record<string, { sub: string; chips: string[] }> = {
  upgrade: { sub: 'Отдай один или несколько подарков и получи более редкий', chips: ['Шанс на циферблате', 'Отдача 94%'] },
  storm: { sub: 'Слот 5×3, девять линий выплат', chips: ['9 линий', '5 барабанов'] },
  rocket: { sub: 'Забери множитель до вылета', chips: ['Авто-вывод', 'Отсчёт 3-2-1'] },
  cases: { sub: 'Открывай по одному или сразу до десяти кейсов', chips: ['Шансы в списке', 'До ×10 за раз'] },
  slots: { sub: 'Три барабана, один спин', chips: ['Быстро', 'Три в ряд'] },
  mines: { sub: 'Открывай клетки и обходи мины', chips: ['1–12 мин', 'Забери в любой момент'] },
  plinko: { sub: 'Шар падает на множитель', chips: ['3 уровня риска', 'Отдача до 96%'] },
  blackjack: { sub: 'Набери 21 очко и обыграй дилера', chips: ['Блэкджек 3:2', 'Удвоение'] },
  mansion: { sub: 'Поднимайся по этажам, обходи призраков', chips: ['5–7 этажей', 'Отдача 90%'] },
  coin: { sub: 'Серия побед и растущий множитель', chips: ['1–5 монет', 'Серия'] },
  racing: { sub: 'Овал, 3 круга, нитро и слипстрим', chips: ['6 машин', 'Отдача 95%'] },
  launch: { sub: 'Режим появится позже', chips: ['Скоро'] },
}
