import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Endpoints } from '../lib/api.js'

/**
 * Renders the 15-item EQ self-report and drives answer state upward.
 * Purely presentational + fetches the question set itself — submission is
 * left to the caller (different flows submit at different times: bundled
 * into the upload request for brand-new subjects, or immediately via
 * submitEqAssessment for retake/admin flows).
 */
export default function EqQuestionnaireForm({ answers, setAnswers, compact = false }) {
  const [questions, setQuestions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Endpoints.getEqQuestionnaire()
      .then((res) => setQuestions(res.data.questions || []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-brand-red" /></div>

  return (
    <div className={compact ? 'space-y-3 max-h-80 overflow-y-auto pr-1' : 'space-y-3 max-h-96 overflow-y-auto pr-1'}>
      {questions.map((q) => (
        <div key={q.id} className="border-b border-line/50 dark:border-dark-border pb-3 last:border-0">
          <p className="text-sm text-ink/80 dark:text-dark-text mb-2">{q.text}</p>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAnswers((a) => ({ ...a, [q.id]: v }))}
                className={`w-8 h-8 rounded-full text-xs font-semibold border transition-colors ${
                  answers[q.id] === v
                    ? 'bg-brand-red text-white border-brand-red'
                    : 'bg-white dark:bg-dark-card text-ink/75 dark:text-dark-muted border-line dark:border-dark-border hover:border-brand-red/40'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-ink/65 dark:text-dark-muted pt-1">1 = Strongly disagree · 5 = Strongly agree</p>
    </div>
  )
}

export function useEqQuestionCount() {
  const [count, setCount] = useState(15)
  useEffect(() => {
    Endpoints.getEqQuestionnaire().then((res) => setCount((res.data.questions || []).length || 15)).catch(() => {})
  }, [])
  return count
}
