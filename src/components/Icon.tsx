// 轻量 SVG 图标库(线性图标,currentColor)
import React from 'react'

const P: Record<string, string[]> = {
  home: ['M3 11.5 12 4l9 7.5', 'M5.5 10.5V20h13v-9.5'],
  map: ['M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z', 'M9 4v14', 'M15 6v14'],
  book: ['M4 19V5a1 1 0 0 1 1-1h15v14H6a2 2 0 0 0-2 2z', 'M4 19a2 2 0 0 0 2 2h14', 'M8 8h8'],
  fire: ['M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3.6 2.2-5.2.2 1.8 1 2.7 1.8 3.2 0-3 .4-5 1-7z'],
  wrongbook: ['M5 4h13a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5z', 'M9 4v16', 'M13.5 10l4 4', 'M17.5 10l-4 4'],
  calendar: ['M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M8 3v4', 'M16 3v4', 'M4 10h16'],
  chart: ['M5 20v-6', 'M11 20V6', 'M17 20v-9', 'M3 20h18'],
  user: ['M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5'],
  settings: ['M4 7h9', 'M17 7h3', 'M15 4.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z', 'M4 17h3', 'M11 17h9', 'M9 14.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z'],
  plus: ['M12 5v14', 'M5 12h14'],
  edit: ['M4 20l4.5-1L20 7.5 16.5 4 5 15.5 4 20z'],
  trash: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13', 'M10 11v5', 'M14 11v5'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M4 12.5l5 5L20 7'],
  up: ['M6 14l6-6 6 6'],
  down: ['M6 10l6 6 6-6'],
  left: ['M14 6l-6 6 6 6'],
  right: ['M10 6l6 6-6 6'],
  search: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'M15.5 15.5 20 20'],
  play: ['M8 5.5v13l11-6.5z'],
  pause: ['M8 5h2.5v14H8z', 'M13.5 5H16v14h-2.5z'],
  clock: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 7.5V12l3 3'],
  star: ['M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z'],
  mic: ['M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z', 'M5.5 11.5a6.5 6.5 0 0 0 13 0', 'M12 18v3'],
  volume: ['M4 9.5v5h3.5L13 19V5L7.5 9.5H4z', 'M16 9.5a4 4 0 0 1 0 5'],
  refresh: ['M20 12a8 8 0 1 1-2.5-5.8', 'M20 4v5h-5'],
  download: ['M12 4v10', 'M8 10.5l4 4 4-4', 'M5 19.5h14'],
  upload: ['M12 14V4', 'M8 8l4-4 4 4', 'M5 19.5h14'],
  dots: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  flag: ['M6 21V4', 'M6 4.5h11.5L15 8.5l2.5 4H6'],
  sparkle: ['M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z'],
  arrowRight: ['M4 12h15', 'M13.5 6l6 6-6 6'],
  zap: ['M13 2 4.5 13.5H11L9.5 22 18 10.5h-6.5z'],
  list: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
  cap: ['M12 4 2 9l10 5 10-5-10-5z', 'M6 11.5V16c0 1.6 2.7 3 6 3s6-1.4 6-3v-4.5', 'M22 9v6'],
  target: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M12 12h.01'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  timer: ['M10 2h4', 'M12 8v5l3 2', 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z'],
  chat: ['M4.5 4.5h15v11h-10l-5 4v-15z'],
  math: ['M17 5H7l5.5 7L7 19h10'],
  send: ['M20 4 4 11l6 2.6L12.6 20 20 4z', 'M10 13.6 20 4'],
  copy: ['M9 9h10v10H9z', 'M15 9V5H5v10h4'],
  image: ['M4 5h16v14H4z', 'M9 11a1.8 1.8 0 1 0 0-3.6A1.8 1.8 0 0 0 9 11z', 'M6 17.5l4-4.5 3 3 2.5-2.5L20 17.5'],
  stop: ['M7.5 7.5h9v9h-9z'],
}

const FILLED = new Set(['play', 'pause', 'sparkle', 'stop'])

export type IconName = keyof typeof P

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  const filled = FILLED.has(name as string)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {(P[name] ?? []).map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
