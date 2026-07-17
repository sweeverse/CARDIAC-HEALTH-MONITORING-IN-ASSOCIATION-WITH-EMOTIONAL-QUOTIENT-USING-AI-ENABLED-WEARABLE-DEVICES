// Score thresholds (fallback only, when no riskClass is supplied): the
// ring is colored from riskClass whenever it's available (see below) — a
// raw score alone can't be safely bucketed here anymore, since ML Risk
// Score is lower-is-better with cohort-relative thresholds, the OPPOSITE
// direction of the old fixed-scale Heart Health Score this fallback used
// to assume. Neutral gray until a real classification is known.

import { useEffect, useId, useRef, useState } from 'react'
import { formatScore } from '../lib/format'

// Same mapping RiskBadge uses — keeping this identical is what makes the
// ring color and the badge next to it always agree, instead of the ring
// deriving its color independently from the raw score.
const RISK_CLASS_COLORS = {
  healthy: '#2F8F5B',
  'mild risk': '#DC5F00',
  'moderate risk': '#CF0A0A',
}
const RISK_CLASS_COLORS_LIGHT = {
  healthy: '#6FCB9B',
  'mild risk': '#FFA24D',
  'moderate risk': '#FF6B6B',
}
const NEUTRAL = '#8B8578'

export default function ScoreRing({ score, size = 64, strokeWidth = 6, riskClass = null }) {
  const value = score ?? 0
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const gradId = useId()

  // If a risk classification is available (and shown alongside this ring,
  // e.g. next to a RiskBadge), color the ring from THAT — the single
  // source of truth for risk-level color — instead of an independent
  // score-threshold guess that can disagree with the badge next to it.
  const color = riskClass && RISK_CLASS_COLORS[riskClass] ? RISK_CLASS_COLORS[riskClass] : NEUTRAL
  const colorLight = riskClass && RISK_CLASS_COLORS_LIGHT[riskClass]
    ? RISK_CLASS_COLORS_LIGHT[riskClass]
    : color

  // Animate the ring growing in from 0 on mount / whenever the score
  // changes, instead of snapping straight to its final position — makes
  // the dashboard feel alive rather than static.
  const [animatedValue, setAnimatedValue] = useState(0)
  const frameRef = useRef(null)

  useEffect(() => {
    const target = Math.min(Math.max(value, 0), 100)
    const start = performance.now()
    const from = animatedValue
    const duration = 900
    cancelAnimationFrame(frameRef.current)

    const tick = (now) => {
      const elapsed = now - start
      const t = Math.min(elapsed / duration, 1)
      // easeOutCubic — fast start, gentle settle
      const eased = 1 - Math.pow(1 - t, 3)
      setAnimatedValue(from + (target - from) * eased)
      if (t < 1) frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const offset = circumference - (animatedValue / 100) * circumference

  // Exactly two decimal places, always (Task 21) — small rings (<=60px)
  // use a smaller font so "82.46" still fits comfortably.
  const fontSizeClass = size <= 60 ? 'text-[11px]' : 'text-sm'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colorLight} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" className="text-line/60 dark:text-dark-border" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={`url(#${gradId})`} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{
            transition: 'stroke-dashoffset 0.15s linear',
            filter: `drop-shadow(0 0 4px ${color}55)`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={`font-mono font-semibold ${fontSizeClass} transition-transform duration-300`}
          style={{ color }}
        >
          {formatScore(score)}
        </span>
      </div>
    </div>
  )
}
