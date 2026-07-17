// Brand mark: a rounded gradient badge with a heartbeat pulse drawn through
// it (cardio) and a small orbiting dot (the "EQ" — an emotional signal
// riding along the physical one). Fully self-contained SVG so it renders
// identically everywhere (sidebar, navbar, auth screens, favicon-style uses)
// without depending on EcgLine.
const PULSE_PATH = 'M2,17 L9,17 L11.5,17 L13,7 L15.5,26 L17.5,17 L20,17 L22,12 L24,21 L26,17 L33,17'

export default function Logo({ size = 'md', dark = false, animate = true, showText = true }) {
  const dims = { sm: { badge: 28, text: 'text-base', gap: 'gap-2' }, md: { badge: 34, text: 'text-lg', gap: 'gap-2.5' }, lg: { badge: 44, text: 'text-2xl', gap: 'gap-3' } }[size] || { badge: 34, text: 'text-lg', gap: 'gap-2.5' }
  const gradId = `logo-grad-${size}-${dark ? 'd' : 'l'}`

  return (
    <div className={`flex items-center ${dims.gap} select-none group`}>
      <div className="relative shrink-0" style={{ width: dims.badge, height: dims.badge }}>
        <svg width={dims.badge} height={dims.badge} viewBox="0 0 36 36" className="transition-transform duration-300 group-hover:scale-105">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FF6B5C" />
              <stop offset="55%" stopColor="#CF0A0A" />
              <stop offset="100%" stopColor="#8C0808" />
            </linearGradient>
          </defs>
          <rect x="0.5" y="0.5" width="35" height="35" rx="10.5" fill={`url(#${gradId})`} />
          <rect x="0.5" y="0.5" width="35" height="35" rx="10.5" fill="none" stroke="rgba(255,255,255,0.15)" />
          <path
            d={PULSE_PATH}
            fill="none"
            stroke="#fff"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.95"
            className={animate ? 'animate-pulseLine' : ''}
            style={animate ? { strokeDasharray: 90, strokeDashoffset: 0 } : undefined}
          />
          {animate && (
            <circle r="1.8" fill="#fff">
              <animateMotion dur="2.6s" repeatCount="indefinite" path={PULSE_PATH} />
            </circle>
          )}
        </svg>
      </div>
      {showText && (
        <span className={`font-display font-semibold ${dims.text} tracking-tight ${dark ? 'text-white' : 'text-ink dark:text-dark-text'}`}>
          Cardio<span className="text-brand-red dark:text-red-400">EQ</span>
          <span className={`ml-1 font-mono text-[0.65em] align-top font-bold px-1 py-0.5 rounded ${dark ? 'bg-white/10 text-white/80' : 'bg-brand-red/10 text-brand-red dark:bg-red-900/30 dark:text-red-400'}`}>AI</span>
        </span>
      )}
    </div>
  )
}
