import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity, Brain, Users, ShieldCheck, FileBarChart,
  ArrowRight, Heart, ChevronDown, Menu, X,
} from 'lucide-react'
import EcgLine from '../components/EcgLine.jsx'
import Logo from '../components/Logo.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { Sun, Moon } from 'lucide-react'

const STATS = [
  { value: '20', label: 'Research Subjects', sub: 'across 4 activity conditions' },
  { value: '6+', label: 'Biomarkers tracked', sub: 'HR, HRV, SpO₂, GSR & more' },
  { value: 'GMM + IF', label: 'Unsupervised risk model', sub: 'zero clinician labels, cohort-relative thresholds' },
]

const FEATURES = [
  {
  icon: FileBarChart,
  title: 'Interactive Dashboard',
  desc: 'Explore real-time charts, session history, longitudinal trends, population comparisons, and downloadable reports through a unified analytics dashboard.',
  },
  {
    icon: Brain,
    title: 'Emotional Quotient Analysis',
    desc: 'Correlates physiological stress markers with EQ scores using composure proxy indices — bridging cardiac health and emotional regulation in real-time.',
  },
  {
    icon: Activity,
    title: 'HRV & ECG-Derived Analytics',
    desc: 'Heart rate, RR interval, RMSSD, SDNN, stress index, and recovery rate — windowed and visualized across sit, walk, run, and cognitive load sessions.',
  },
  {
    icon: ShieldCheck,
    title: 'Explainable AI, Not Black-Box',
    desc: 'Every prediction ships with per-feature anomaly-driver explanations straight from the fitted Gaussian Mixture Model — showing exactly what was detected and why, with no clinician labels anywhere in the pipeline.',
  },
  {
    icon: Users,
    title: 'Population Benchmarking',
    desc: 'Percentile ranking against the full cohort and a similar-profile peer group matched on age and BMI — results that mean something in context.',
  },
  {
    icon: FileBarChart,
    title: 'Longitudinal Monitoring',
    desc: 'Session-over-session comparison highlights whether a subject is improving, stable, or deteriorating — not just a single-point-in-time snapshot.',
  },
]

const HOW_IT_WORKS = [
  { n: '01', t: 'Wear & record', d: 'Subject wears the Arduino-based biosensor device during 4 activity sessions — sit, walk, run, and cognitive task.' },
  { n: '02', t: 'Upload all 4 CSVs', d: 'Upload the raw sensor CSVs at once. The system auto-detects activities from filenames and assigns a Subject ID.' },
  { n: '03', t: 'AI scores & explains', d: 'A fully unsupervised model (Gaussian Mixture + Isolation Forest, blended) extracts 6+ biomarkers, scores cardiovascular risk, and explains every decision — no clinician labels anywhere in the pipeline.' },
  { n: '04', t: 'Review & benchmark', d: 'View time-series charts, population percentile rank, longitudinal trends, and downloadable PDF reports.' },
]

// Hero background: rotating set of cardiac/ECG-monitor photos, each
// crossfaded under the same color-scheme overlay for legibility. Served
// locally from /public/images/landing — same curated set used across the
// site (login/signup, research section).
const HERO_BG_IMAGES = [
  '/images/landing/heart-glow.png',
  '/images/landing/ecg-monitor-closeup.png',
  '/images/landing/Bad-habits-that-can-harm-your-heart-health-.png',
  '/images/landing/heart-monitor-gym.png',
  '/images/landing/runner-sunset.png',
  '/images/landing/brain-anatomy.png',

]
const HERO_OVERLAY = 'linear-gradient(135deg, rgba(0,0,0,0.88) 0%, rgba(26,0,0,0.82) 40%, rgba(45,5,5,0.75) 70%, rgba(207,10,10,0.35) 100%)'
// A bit faster than before (was 6000ms) with a longer, smoother crossfade
// relative to that shorter interval (was 1800ms) so consecutive slides
// overlap more of their fade instead of feeling like a hard cut.
const HERO_SLIDE_MS = 4500
const HERO_FADE_MS = 2200

// Research mission photo — clinician reviewing data on a mobile device,
// served locally from /public/images/landing.
const RESEARCH_BG_IMAGE = '/images/landing/doctor-phone.png'

export default function Landing() {
  const { dark, toggle } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [heroSlide, setHeroSlide] = useState(0)

  // Auto-advancing hero background slideshow with smooth crossfade (each
  // frame is a separately opacity-transitioned layer, see the hero
  // section below) — cycles continuously while the landing page is mounted.
  // Pauses when the tab isn't visible so slides don't pile up/jump when the
  // user comes back, and restarts cleanly on manual navigation so timing
  // always feels consistent.
  useEffect(() => {
    let id
    const start = () => {
      clearInterval(id)
      id = setInterval(() => {
        setHeroSlide((i) => (i + 1) % HERO_BG_IMAGES.length)
      }, HERO_SLIDE_MS)
    }
    const onVisibility = () => {
      if (document.hidden) clearInterval(id)
      else start()
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [heroSlide])

  const goToSlide = (i) => setHeroSlide(i)

  return (
    <div className="min-h-screen" style={{ background: dark ? '#08090A' : '#EEEEEE' }}>
      {/* Nav */}
      <header className="sticky top-0 z-30 backdrop-blur-md border-b" style={{ background: dark ? 'rgba(8,9,10,0.92)' : 'rgba(238,238,238,0.92)', borderColor: dark ? '#2C2F32' : '#D0CECE' }}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo />
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium" style={{ color: dark ? '#888' : '#0F2421AA' }}>
            <a href="#research" className="hover:text-brand-red transition-colors">Research</a>
            <a href="#platform" className="hover:text-brand-red transition-colors">Platform</a>
            <a href="#how" className="hover:text-brand-red transition-colors">How it works</a>
            <a href="#contact" className="hover:text-brand-red transition-colors">Contact</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={toggle}
              className="p-2 rounded-full hover:bg-red-900/20 transition-all duration-300 hover:rotate-12"
              style={{ color: dark ? '#888' : '#0F2421AA' }}
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link
              to="/sign-in"
              className="hidden sm:inline-block text-sm font-medium px-4 py-2 rounded-full transition-colors hover:bg-red-900/20"
              style={{ color: dark ? '#EEEEEE' : '#0F2421' }}
            >Sign in</Link>
            <Link to="/sign-up" className="btn-primary text-sm">
              Get started <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="md:hidden p-2 rounded-full hover:bg-red-900/20 transition-colors"
              style={{ color: dark ? '#EEEEEE' : '#0F2421' }}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div
            className="md:hidden border-t px-6 py-4 flex flex-col gap-3.5 text-sm font-medium animate-[fadeSlideIn_.2s_ease]"
            style={{ borderColor: dark ? '#2C2F32' : '#D0CECE', color: dark ? '#ccc' : '#0F2421' }}
          >
            <a href="#research" onClick={() => setMobileOpen(false)} className="hover:text-brand-red transition-colors">Research</a>
            <a href="#platform" onClick={() => setMobileOpen(false)} className="hover:text-brand-red transition-colors">Platform</a>
            <a href="#how" onClick={() => setMobileOpen(false)} className="hover:text-brand-red transition-colors">How it works</a>
            <a href="#contact" onClick={() => setMobileOpen(false)} className="hover:text-brand-red transition-colors">Contact</a>
            <Link to="/sign-in" onClick={() => setMobileOpen(false)} className="hover:text-brand-red transition-colors">Sign in</Link>
          </div>
        )}
      </header>

      {/* Hero — dark always, card health themed, rotating photo background */}
      <section className="relative overflow-hidden">
        {/* Slideshow layers — crossfade by toggling opacity, image below stays mounted so the fade is smooth rather than a hard cut */}
        <div className="absolute inset-0 overflow-hidden">
          {HERO_BG_IMAGES.map((src, i) => (
            <div
              key={src}
              className="absolute inset-0"
              style={{
                opacity: i === heroSlide ? 1 : 0,
                transition: `opacity ${HERO_FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
              }}
            >
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage: `url(${src})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  // Slow continuous Ken Burns drift — only the active layer
                  // animates so idle layers don't waste GPU cycles, and the
                  // animation duration matches the slide interval so the
                  // zoom completes right as the next slide fades in.
                  animation: i === heroSlide ? `heroKenBurns ${HERO_SLIDE_MS}ms ease-out forwards` : 'none',
                }}
              />
            </div>
          ))}
          <div className="absolute inset-0" style={{ background: HERO_OVERLAY }} />

          {/* Slide indicators — click to jump, active dot widens */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
            {HERO_BG_IMAGES.map((_, i) => (
              <button
                key={i}
                onClick={() => goToSlide(i)}
                aria-label={`Go to slide ${i + 1}`}
                className="h-1.5 rounded-full transition-all duration-500"
                style={{
                  width: i === heroSlide ? '24px' : '8px',
                  background: i === heroSlide ? '#EEEEEE' : 'rgba(238,238,238,0.35)',
                }}
              />
            ))}
          </div>
        </div>
        <style>{`
          @keyframes heroKenBurns {
            from { transform: scale(1); }
            to { transform: scale(1.08); }
          }
        `}</style>

        {/* Background ECG overlay */}
        <div className="absolute inset-0 opacity-5 pointer-events-none overflow-hidden">
          <svg viewBox="0 0 1400 200" className="absolute bottom-0 w-full" preserveAspectRatio="none">
            <path d="M0,100 L200,100 L220,100 L230,20 L240,180 L250,100 L270,100 L280,60 L290,140 L300,100 L500,100 L520,100 L530,20 L540,180 L550,100 L570,100 L580,60 L590,140 L600,100 L800,100 L820,100 L830,20 L840,180 L850,100 L870,100 L880,60 L890,140 L900,100 L1100,100 L1120,100 L1130,20 L1140,180 L1150,100 L1170,100 L1180,60 L1190,140 L1200,100 L1400,100"
              stroke="#CF0A0A" strokeWidth="3" fill="none" />
          </svg>
        </div>

        {/* Placeholder heart anatomy illustration area */}
        <div className="absolute right-0 top-0 w-1/2 h-full opacity-10 pointer-events-none" style={{
          background: 'radial-gradient(ellipse at 70% 50%, #CF0A0A 0%, transparent 70%)'
        }} />

        <div className="max-w-7xl mx-auto px-6 pt-24 pb-28 relative">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold mb-6" style={{ background: 'rgba(207,10,10,0.15)', color: '#CF0A0A', border: '1px solid rgba(207,10,10,0.3)' }}>
              <Heart className="w-3 h-3 animate-heartbeat" /> Unsupervised Cardiovascular Risk Research — 2026
            </div>
            <h1 className="text-5xl lg:text-6xl font-display font-semibold leading-[1.05] text-white mb-6">
              Cardiac health monitoring{' '}
              <span style={{ color: '#CF0A0A' }}>in association with</span>{' '}
              Emotional Quotient
            </h1>
            <p className="text-xl font-bold leading-relaxed mb-8 max-w-2xl" style={{ color: 'rgba(238,238,238,0.85)' }}>
              CardioEQ AI fuses calibrated cardiovascular risk scoring with ECG-derived HRV analytics,
              emotional regulation proxy indices, and environmental context — turning every wearable
              sensor recording into an explainable ML Risk Score, computed by a fully unsupervised
              model.
            </p>
            <div className="flex items-center gap-4 flex-wrap">
              <Link to="/sign-up" className="btn-primary px-6 py-3 text-base">
                Start analyzing <ArrowRight className="w-4 h-4" />
              </Link>
              <a href="#how" className="flex items-center gap-2 text-sm font-medium transition-colors" style={{ color: 'rgba(238,238,238,0.6)' }}>
                See how it works <ChevronDown className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="border-t" style={{ borderColor: 'rgba(207,10,10,0.2)', background: 'rgba(0,0,0,0.4)' }}>
          <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            {STATS.map(({ value, label, sub }) => (
              <div key={label} className="text-center">
                <p className="font-display text-2xl font-bold" style={{ color: '#CF0A0A' }}>{value}</p>
                <p className="text-sm font-semibold text-white mt-0.5">{label}</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(238,238,238,0.45)' }}>{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Research mission — inspired by heartresearch.org.uk layout */}
      <section id="research" className="py-20" style={{ background: dark ? '#121415' : '#FFFFFF' }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#CF0A0A' }}>Our Research</p>
              <h2 className="text-3xl lg:text-4xl font-display font-semibold mb-6" style={{ color: dark ? '#EEEEEE' : '#0F2421' }}>
                Understanding how emotional intelligence shapes your heart
              </h2>
              <p className="text-base leading-relaxed mb-6" style={{ color: dark ? '#888' : '#0F2421AA' }}>
                This research investigates the bidirectional relationship between Emotional Quotient (EQ)
                and cardiovascular health markers captured through AI-enabled wearable devices. 20 subjects
                were monitored across 4 distinct activity conditions using a custom Arduino biosensor system.
              </p>
              <p className="text-base leading-relaxed mb-8" style={{ color: dark ? '#888' : '#0F2421AA' }}>
                Key findings suggest that subjects with higher EQ scores exhibit faster heart rate recovery
                post-exertion, lower stress index during cognitive tasks, and more stable HRV — all markers
                of superior cardiovascular adaptability.
              </p>
              <Link to="/sign-up" className="btn-primary">
                Explore the data <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            {/* Placeholder image area with gradient */}
            <div className="relative">
              <div className="rounded-2xl overflow-hidden aspect-[4/3] relative" style={{ border: '1px solid rgba(207,10,10,0.2)' }}>
                <img src={RESEARCH_BG_IMAGE} alt="Wearable biosensor research" className="absolute inset-0 w-full h-full object-cover" />
                <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(26,0,0,0.75) 0%, rgba(207,10,10,0.35) 100%)' }} />
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8">
                  <Heart className="w-16 h-16 mb-4 animate-heartbeat" style={{ color: '#CF0A0A' }} />
                  <p className="font-display text-lg font-semibold text-center mb-2" style={{ color: '#EEEEEE' }}>Cardiac + EQ Monitoring</p>
                  <EcgLine className="w-full h-12" stroke="#CF0A0A" strokeWidth={2.5} animate />
                  <div className="mt-6 grid grid-cols-3 gap-3 w-full">
                    {[['PPG', '#CF0A0A'], ['GSR', '#DC5F00'], ['HRV', '#2F8F5B']].map(([l, c]) => (
                      <div key={l} className="rounded-lg p-2 text-center" style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${c}40` }}>
                        <p className="font-mono text-xs font-bold" style={{ color: c }}>{l}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {/* Floating stat card */}
              <div className="absolute -bottom-4 -left-4 rounded-xl p-4 shadow-pop hidden sm:block" style={{ background: dark ? '#1B1D1F' : '#fff', border: '1px solid rgba(207,10,10,0.2)' }}>
                <p className="text-xs font-semibold" style={{ color: '#888' }}>Composure Index</p>
                <p className="font-mono text-xl font-bold" style={{ color: '#CF0A0A' }}>30.8 <span className="text-xs font-sans" style={{ color: '#888' }}>/ 100</span></p>
                <p className="text-[10px] mt-0.5" style={{ color: '#888' }}>EQ proxy, derived from HRV</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Platform features */}
      <section id="platform" className="py-20" style={{ background: dark ? '#08090A' : '#EEEEEE' }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#CF0A0A' }}>The Platform</p>
            <h2 className="text-3xl font-display font-semibold mb-3" style={{ color: dark ? '#EEEEEE' : '#0F2421' }}>
              One platform. Every signal that matters.
            </h2>
            <p style={{ color: dark ? '#888' : '#0F2421AA' }}>
              From raw wearable sensor streams to clinician-ready, explainable insight — without losing the why.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl2 p-6 transition-shadow hover:shadow-pop" style={{ background: dark ? '#1B1D1F' : '#fff', border: `1px solid ${dark ? '#2C2F32' : '#D0CECE'}` }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: 'rgba(207,10,10,0.1)' }}>
                  <Icon className="w-5 h-5" style={{ color: '#CF0A0A' }} />
                </div>
                <h3 className="font-display font-semibold text-lg mb-2" style={{ color: dark ? '#EEEEEE' : '#0F2421' }}>{title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: dark ? '#888' : '#0F2421AA' }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-20" style={{ background: dark ? '#121415' : '#FFFFFF' }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-xl mx-auto mb-14">
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#CF0A0A' }}>Process</p>
            <h2 className="text-3xl font-display font-semibold" style={{ color: dark ? '#EEEEEE' : '#0F2421' }}>
              From upload to explainable insight
            </h2>
          </div>
          <div className="grid md:grid-cols-4 gap-8 relative">
            {/* Connector line */}
            <div className="hidden md:block absolute top-10 left-[12%] right-[12%] h-px" style={{ background: 'linear-gradient(90deg, #CF0A0A, #DC5F00, #CF0A0A)' }} />
            {HOW_IT_WORKS.map(({ n, t, d }) => (
              <div key={n} className="relative text-center">
                <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 font-mono text-2xl font-bold relative z-10" style={{ background: dark ? '#1a0000' : '#fff', border: '2px solid #CF0A0A', color: '#CF0A0A' }}>
                  {n}
                </div>
                <h3 className="font-display font-semibold text-lg mb-2" style={{ color: dark ? '#EEEEEE' : '#0F2421' }}>{t}</h3>
                <p className="text-sm leading-relaxed" style={{ color: dark ? '#888' : '#0F2421AA' }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="py-20" style={{ background: '#A20909' }}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl lg:text-4xl font-display font-semibold text-white mb-4">
            Built for explainability. Validated against real cohort data.
          </h2>
          <p className="text-white/75 max-w-xl mx-auto mb-8">
            Every score on this platform traces back to a biomarker you can see and a model decision you can audit.
          </p>
          <Link to="/sign-up" className="inline-flex items-center gap-2 rounded-full px-7 py-3.5 text-base font-semibold transition-colors" style={{ background: '#000', color: '#EEEEEE' }}>
            Create your free account <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      {/* Contact / Footer */}
      <section id="contact" className="py-16 border-t" style={{ background: dark ? '#08090A' : '#EEEEEE', borderColor: dark ? '#2C2F32' : '#D0CECE' }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-3 gap-10 mb-12">
            <div>
              <Logo />
              <p className="text-sm mt-4 leading-relaxed" style={{ color: dark ? '#666' : '#0F2421AA' }}>
                A research-grade AI cardiovascular analytics platform combining wearable biosensor data
                with a fully unsupervised machine learning pipeline — no clinician labels, anywhere.
              </p>
            </div>
            <div>
              <p className="font-semibold mb-4 text-sm" style={{ color: dark ? '#EEEEEE' : '#0F2421' }}>Quick Links</p>
              <nav className="space-y-2 text-sm" style={{ color: dark ? '#666' : '#0F2421AA' }}>
                <a href="#research" className="block hover:text-brand-red">Research</a>
                <a href="#platform" className="block hover:text-brand-red">Platform</a>
                <a href="#how" className="block hover:text-brand-red">How it works</a>
                <Link to="/sign-in" className="block hover:text-brand-red">Sign in</Link>
              </nav>
            </div>
            <div>
              <p className="font-semibold mb-4 text-sm" style={{ color: dark ? '#EEEEEE' : '#0F2421' }}>Model</p>
              <div className="space-y-3 text-sm" style={{ color: dark ? '#666' : '#0F2421AA' }}>
                <div className="flex items-start gap-2">
                  <Brain className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#CF0A0A' }} />
                  <span>Fully unsupervised — Gaussian Mixture + Isolation Forest, blended</span>
                </div>
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: '#CF0A0A' }} />
                  <span>No clinician labels — thresholds recalculated from the cohort itself</span>
                </div>
              </div>
            </div>
          </div>
          <div className="pt-8 border-t flex flex-col sm:flex-row items-center justify-end gap-4 text-xs" style={{ borderColor: dark ? '#2C2F32' : '#D0CECE', color: dark ? '#444' : '#0F2421AA' }}>
            <span></span>
          </div>
        </div>
      </section>
    </div>
  )
}