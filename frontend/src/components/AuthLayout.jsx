import { useEffect, useState } from 'react'
import EcgLine from './EcgLine.jsx'
import Logo from './Logo.jsx'

// A small curated set of cardio/wearable/research-themed photos for the
// left-panel slideshow — served locally from /public/images/landing so they
// load reliably (no external hotlink dependency) and match the same set
// used elsewhere on the site.
const SLIDES = [
  '/images/landing/heart-glow.png', // glowing 3D heart render
  '/images/landing/ecg-monitor-closeup.png',
  '/images/landing/heart-monitor-gym.png',
  '/images/landing/Bad-habits-that-can-harm-your-heart-health-.png', // ECG waveform + SpO2 monitor
  '/images/landing/runner-sunset.png', // runner silhouette, activity/exertion
  '/images/landing/brain-emotions.png', // brain + emotion icons, EQ theme
]

function Slideshow() {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDES.length), 6000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="absolute inset-0 z-0">
      {SLIDES.map((src, i) => (
        <div
          key={src}
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-[1400ms] ease-in-out"
          style={{
            backgroundImage: `url(${src})`,
            opacity: i === index ? 1 : 0,
            animation: i === index ? 'authKenBurns 12s ease-out both' : 'none',
          }}
        />
      ))}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(160deg, rgba(6,7,8,0.92) 0%, rgba(26,4,4,0.85) 45%, rgba(207,10,10,0.55) 100%)',
      }} />
      <style>{`@keyframes authKenBurns { from { transform: scale(1.08); } to { transform: scale(1); } }`}</style>
    </div>
  )
}

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex w-1/2 text-white relative overflow-hidden flex-col justify-between p-12">
        <Slideshow />
        <div className="relative z-10"><Logo dark size="lg" /></div>
        <div className="relative z-10">
          <EcgLine className="w-full h-24 mb-8" stroke="#AA0000" strokeWidth={2.5} animate />
          <h2 className="text-3xl font-display font-semibold leading-snug max-w-md drop-shadow-sm text-white">
            Every prediction, explained — from raw biosignal to recommendation.
          </h2>
          <p className="text-white/70 mt-4 max-w-sm text-sm leading-relaxed">
            Unsupervised cardiovascular risk modeling, HRV time-series analytics,
            and population benchmarking in one research-grade platform.
          </p>
          <div className="flex items-center gap-1.5 mt-6">
            {SLIDES.map((_, i) => <span key={i} className="w-6 h-1 rounded-full bg-white/25" />)}
          </div>
        </div>
        <p className="relative z-10 text-xs text-white/45">© {new Date().getFullYear()} CardioEQ AI</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-paper dark:bg-dark-bg">
        <div className="w-full max-w-md animate-[fadeSlideIn_.4s_ease]">
          <div className="lg:hidden mb-8"><Logo /></div>
          <h1 className="text-2xl font-display font-semibold text-ink dark:text-dark-text">{title}</h1>
          {subtitle && <p className="text-sm text-ink/60 dark:text-dark-muted mt-1.5">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-sm text-ink/60 dark:text-dark-muted">{footer}</div>}
        </div>
      </div>
    </div>
  )
}