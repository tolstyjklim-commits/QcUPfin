// Рисованные символы для слотов (вместо эмодзи): единые градиенты, объём, блики.
export function SlotDefs() {
  const g = (id: string, stops: [number, string][], x2 = 0, y2 = 1) =>
    <linearGradient id={id} x1="0" y1="0" x2={x2} y2={y2}>{stops.map(([o, c], i) => <stop key={i} offset={o} stopColor={c} />)}</linearGradient>
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true"><defs>
      {g('sgGold', [[0, '#fff6c2'], [.45, '#f4b92f'], [1, '#a8700a']], 1, 1)}
      {g('sgRed', [[0, '#ff8a8a'], [.5, '#e03644'], [1, '#8e1424']])}
      {g('sgGreen', [[0, '#a6f5b4'], [.55, '#2fb862'], [1, '#12713a']], 1, 1)}
      {g('sgPurple', [[0, '#d6b8ff'], [.5, '#8a52e0'], [1, '#4a2194']], 1, 1)}
      {g('sgYellow', [[0, '#fffbb0'], [.5, '#f7d21e'], [1, '#c99200']], 1, 1)}
      {g('sgCyan', [[0, '#ecfdff'], [.45, '#5fd8ff'], [1, '#1670c4']], 1, 1)}
      {g('sgCyanD', [[0, '#7fe0ff'], [1, '#0e4f9e']])}
      {g('sgBag', [[0, '#e6c28a'], [.5, '#b9863f'], [1, '#6e4719']], 1, 1)}
      <radialGradient id="sgShine" cx=".3" cy=".25" r=".6"><stop offset="0" stopColor="#fff" stopOpacity=".85" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
    </defs></svg>
  )
}
const star = (cx: number, cy: number, R: number, r: number) =>
  Array.from({ length: 10 }, (_, i) => { const a = (Math.PI / 5) * i - Math.PI / 2, d = i % 2 ? r : R; return `${(cx + d * Math.cos(a)).toFixed(2)},${(cy + d * Math.sin(a)).toFixed(2)}` }).join(' ')

export function SlotSym({ s }: { s: string }) {
  const sh = { filter: 'drop-shadow(0 3px 3px rgba(0,0,0,.55))' }
  const wrap = (body: React.ReactNode) => <svg viewBox="0 0 64 64" className="sym" style={sh} aria-hidden="true">{body}</svg>
  switch (s) {
    case '💎': return wrap(<>
      <path d="M13 24L23 11H41L51 24L32 55Z" fill="url(#sgCyan)" stroke="#0e4f9e" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M13 24H51" stroke="#0e4f9e" strokeWidth="1.2" /><path d="M23 11L27 24L32 55L37 24L41 11" fill="none" stroke="#0e4f9e" strokeWidth="1" strokeLinejoin="round" />
      <path d="M23 11L32 24L41 11Z" fill="#fff" opacity=".55" /><path d="M13 24L27 24L32 55Z" fill="url(#sgCyanD)" opacity=".45" />
      <path d="M17 22L24 13" stroke="#fff" strokeWidth="2.200" strokeLinecap="round" opacity=".9" />
    </>)
    case '7⭐': return wrap(<>
      <polygon points={star(32, 33, 28, 13)} fill="url(#sgGold)" stroke="#a8700a" strokeWidth="1.400" strokeLinejoin="round" opacity=".95" />
      <text x="32" y="46" textAnchor="middle" fontSize="40" fontWeight="900" fontFamily="Georgia,'Times New Roman',serif" fill="url(#sgRed)" stroke="#fff3b0" strokeWidth="2.600" paintOrder="stroke" strokeLinejoin="round">7</text>
      <text x="31" y="44" textAnchor="middle" fontSize="40" fontWeight="900" fontFamily="Georgia,'Times New Roman',serif" fill="none" stroke="#7a0f1c" strokeWidth=".8">7</text>
    </>)
    case '🍀': return wrap(<>
      <path d="M32 33C34 43 36 49 41 56" fill="none" stroke="#14602f" strokeWidth="3.200" strokeLinecap="round" />
      {[0, 90, 180, 270].map(a => <g key={a} transform={`rotate(${a} 32 32)`}>
        <path d="M32 32C26 28 17 24 17 16C17 10 25 8 32 15C39 8 47 10 47 16C47 24 38 28 32 32Z" fill="url(#sgGreen)" stroke="#14602f" strokeWidth="1.300" strokeLinejoin="round" />
        <path d="M32 31V17" stroke="#c9ffd6" strokeWidth="1" opacity=".6" />
      </g>)}
      <circle cx="26" cy="19" r="3" fill="url(#sgShine)" />
    </>)
    case '🔔': return wrap(<>
      <path d="M32 7C34.500 7 36 8.500 36 11C47 13.500 50.500 24 50.500 33L54 45H10L13.500 33C13.500 24 17 13.500 28 11C28 8.500 29.500 7 32 7Z" fill="url(#sgGold)" stroke="#8a5a05" strokeWidth="1.600" strokeLinejoin="round" />
      <path d="M10 45H54" stroke="#8a5a05" strokeWidth="2.400" strokeLinecap="round" />
      <circle cx="32" cy="51" r="5.200" fill="url(#sgGold)" stroke="#8a5a05" strokeWidth="1.300" />
      <path d="M21 20C18 26 18 31 18 36" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".75" />
    </>)
    case '🍇': return wrap(<>
      <path d="M32 14C32 9 34 7 37 6" fill="none" stroke="#6b4423" strokeWidth="2.600" strokeLinecap="round" />
      <path d="M36 9C42 4 50 6 52 12C46 14 40 13 36 9Z" fill="url(#sgGreen)" stroke="#14602f" strokeWidth="1.200" />
      {[[20, 24], [32, 22], [44, 24], [26, 34], [38, 34], [20, 34 + 0], [44, 34], [32, 44], [26, 44 + 0], [38, 44], [32, 54]].map(([x, y], i) =>
        <g key={i}><circle cx={x} cy={y} r="6.600" fill="url(#sgPurple)" stroke="#3a1a7a" strokeWidth="1" /><circle cx={x - 2} cy={y - 2.400} r="2.100" fill="#fff" opacity=".7" /></g>)}
    </>)
    case '🍋': return wrap(<>
      <g transform="rotate(-24 32 34)">
        <path d="M6 34C6 22 18 14 32 14C46 14 58 22 58 34C58 46 46 54 32 54C18 54 6 46 6 34Z" fill="url(#sgYellow)" stroke="#a06f00" strokeWidth="1.600" />
        <path d="M3 34L9 31V37Z M61 34L55 31V37Z" fill="#e0aa00" stroke="#a06f00" strokeWidth="1.300" strokeLinejoin="round" />
        <ellipse cx="24" cy="25" rx="11" ry="5" fill="#fff" opacity=".6" />
      </g>
      <path d="M44 14C50 6 58 8 58 8C58 8 58 16 50 18C48 18 45 17 44 14Z" fill="url(#sgGreen)" stroke="#14602f" strokeWidth="1.200" />
    </>)
    case '⭐': return wrap(<>
      <polygon points={star(32, 34, 28, 12.500)} fill="url(#sgGold)" stroke="#8a5a05" strokeWidth="1.700" strokeLinejoin="round" />
      <polygon points={star(32, 34, 17, 7.500)} fill="#fff6c2" opacity=".55" />
      <path d="M22 21L27 15" stroke="#fff" strokeWidth="2.400" strokeLinecap="round" opacity=".9" />
    </>)
    case '💰': return wrap(<>
      <path d="M22 18L18 8C25 13 39 13 46 8L42 18C38 22 26 22 22 18Z" fill="url(#sgBag)" stroke="#5a3a12" strokeWidth="1.500" strokeLinejoin="round" />
      <path d="M22 19C11 30 8 50 20 57H44C56 50 53 30 42 19C37 23 27 23 22 19Z" fill="url(#sgBag)" stroke="#5a3a12" strokeWidth="1.600" strokeLinejoin="round" />
      <path d="M22 19Q32 25 42 19" fill="none" stroke="#e03644" strokeWidth="3.200" strokeLinecap="round" />
      <text x="32" y="48" textAnchor="middle" fontSize="23" fontWeight="900" fontFamily="Georgia,serif" fill="#fff3b0" stroke="#5a3a12" strokeWidth=".9">$</text>
      <path d="M17 36C15 42 16 47 19 51" fill="none" stroke="#fff" strokeWidth="2.600" strokeLinecap="round" opacity=".45" />
    </>)
    default: return <span className="sym-txt">{s}</span>
  }
}
export const Bulbs = ({ n = 16 }: { n?: number }) => <div className="bulbs" aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 2) * 0.5}s` }} />)}</div>
