import { NavLink } from 'react-router-dom'
import type { ReactNode } from 'react'

interface NavItem {
  to: string
  label: string
  icon: (active: boolean) => ReactNode
}

const iconProps = (active: boolean) => ({
  width: 21,
  height: 21,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: active ? '#FF5A1F' : '#B4B1AB',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

const items: NavItem[] = [
  {
    to: '/home',
    label: '매물',
    icon: (active) => (
      <svg {...iconProps(active)}>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
      </svg>
    ),
  },
  {
    to: '/map',
    label: '지역',
    icon: (active) => (
      <svg {...iconProps(active)}>
        <path d="M9 20 3 17V5l6 3m0 12 6-3m-6 3V8m6 9 6 3V8l-6-3m0 12V5m0 3-6-3" />
      </svg>
    ),
  },
  {
    to: '/profile',
    label: '프로필',
    icon: (active) => (
      <svg {...iconProps(active)}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
      </svg>
    ),
  },
]

export default function BottomNav() {
  return (
    <nav className="sticky bottom-0 z-10 flex h-[64px] w-full items-stretch border-t border-border bg-white/95 backdrop-blur-md lg:hidden">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/home'}
          className="flex flex-1 flex-col items-center justify-center gap-1"
        >
          {({ isActive }) => (
            <>
              {item.icon(isActive)}
              <span className={`text-[10px] font-semibold ${isActive ? 'text-primary' : 'text-text-lightgray'}`}>
                {item.label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
