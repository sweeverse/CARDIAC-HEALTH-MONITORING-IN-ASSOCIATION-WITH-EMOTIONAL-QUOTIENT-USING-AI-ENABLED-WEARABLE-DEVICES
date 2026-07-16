// A hand-built ECG/PQRST-like waveform path, reused as the brand signature
// across the logo, hero, section dividers, and loading states.
const PATH =
  'M0,40 L60,40 L80,40 L95,18 L110,62 L125,8 L140,40 L160,40 L220,40 L240,40 L255,20 L270,58 L285,12 L300,40 L320,40 L400,40'

export default function EcgLine({ className = '', stroke = 'currentColor', animate = false, strokeWidth = 3 }) {
  return (
    <svg
      viewBox="0 0 400 80"
      className={className}
      fill="none"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={PATH}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={animate ? 'animate-pulseLine' : ''}
        style={animate ? { strokeDasharray: 1000 } : undefined}
      />
    </svg>
  )
}
