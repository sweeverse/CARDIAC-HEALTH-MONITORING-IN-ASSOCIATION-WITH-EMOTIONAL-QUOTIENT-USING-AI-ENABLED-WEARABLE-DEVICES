import { useState, useRef, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { MessageCircle, X, Send, Loader2, Sparkles } from 'lucide-react'
import { Endpoints } from '../lib/api.js'

export default function AssistantWidget() {
  const { subjectId } = useParams()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open])

  const ask = async (q) => {
    if (!q.trim() || !subjectId) return
    setLoading(true)
    try {
      const res = await Endpoints.askAssistant({ subject_id: subjectId, question: q })
      setMessages((m) => [...m, { role: 'assistant', text: res.data.answer, mode: res.data.mode }])
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', text: 'Sorry — I could not reach the assistant service.', mode: 'error', retryQuestion: q }])
    } finally {
      setLoading(false)
    }
  }

  const send = async (e) => {
    e.preventDefault()
    if (!question.trim() || !subjectId) return
    const q = question.trim()
    setMessages((m) => [...m, { role: 'user', text: q }])
    setQuestion('')
    await ask(q)
  }

  if (!subjectId) return null // assistant is grounded in a subject's data; only show on subject pages

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-brand-red text-white shadow-pop flex items-center justify-center hover:bg-red-700 transition-colors"
        >
          <MessageCircle className="w-6 h-6" />
        </button>
      )}
      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-[380px] max-w-[calc(100vw-3rem)] h-[520px] card flex flex-col overflow-hidden shadow-pop">
          <div className="bg-brand-red text-white px-4 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-coral-400" />
              <div>
                <p className="font-display font-semibold text-sm leading-tight">Health Assistant</p>
                <p className="text-[11px] text-white/60 leading-tight">Grounded in {subjectId}'s data</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)}><X className="w-4 h-4" /></button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-paper dark:bg-dark-bg">
            {messages.length === 0 && (
              <div className="text-sm text-ink/80 dark:text-dark-muted leading-relaxed">
                Ask me things like <span className="italic">"why was this subject flagged?"</span> or
                <span className="italic"> "what's driving the heart health score?"</span> — every answer is
                grounded in this subject's actual stored data, never invented.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user' ? 'bg-brand-red text-white rounded-br-sm' : 'bg-white dark:bg-dark-card border border-line dark:border-dark-border text-ink/85 dark:text-dark-text rounded-bl-sm'
                }`}>
                  {m.text}
                  {m.mode === 'error' && m.retryQuestion && (
                    <button
                      onClick={() => ask(m.retryQuestion)}
                      disabled={loading}
                      className="block mt-1.5 text-xs font-semibold text-brand-red dark:text-red-400 hover:underline"
                    >
                      Retry
                    </button>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-white dark:bg-dark-card border border-line dark:border-dark-border rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-brand-red dark:text-red-400" />
                </div>
              </div>
            )}
          </div>

          <form onSubmit={send} className="p-3 border-t border-line/70 dark:border-dark-border flex items-center gap-2 bg-surface dark:bg-dark-surface">
            <input
              className="input-field flex-1 !py-2"
              placeholder="Ask about this subject's results..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button type="submit" className="btn-primary !px-3 !py-2" disabled={loading}>
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
