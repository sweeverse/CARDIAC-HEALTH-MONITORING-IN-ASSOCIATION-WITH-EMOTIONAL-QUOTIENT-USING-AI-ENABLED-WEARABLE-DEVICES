// Pill colors aligned with palette: #CF0A0A (red) = moderate risk, #DC5F00 (orange) = mild risk, green = healthy
const STYLES = {
  healthy: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'mild risk': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  'moderate risk': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  unknown: 'bg-ink/10 text-ink/75 dark:bg-dark-border dark:text-dark-muted',
}

// Dot colors match the ring colors
const DOT_COLORS = {
  healthy: '#2F8F5B',
  'mild risk': '#DC5F00',
  'moderate risk': '#CF0A0A',
  unknown: '#888',
}

export default function RiskBadge({ riskClass }) {
  const key = riskClass || 'unknown'
  return (
    <span className={`pill ${STYLES[key] || STYLES.unknown}`}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: DOT_COLORS[key] || DOT_COLORS.unknown }} />
      {key}
    </span>
  )
}
