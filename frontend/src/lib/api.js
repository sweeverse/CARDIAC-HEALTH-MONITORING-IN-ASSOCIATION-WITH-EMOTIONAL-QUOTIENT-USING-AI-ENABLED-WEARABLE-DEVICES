import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export const api = axios.create({ baseURL: API_BASE })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('cardioeq_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('cardioeq_token')
      if (!window.location.pathname.startsWith('/sign-in')) {
        window.location.href = '/sign-in'
      }
    }
    return Promise.reject(err)
  }
)

export const Endpoints = {
  signup: (data) => api.post('/api/auth/signup', data),
  login: (data) => api.post('/api/auth/login', data),
  forgotPassword: (data) => api.post('/api/auth/forgot-password', data),
  resetPassword: (data) => api.post('/api/auth/reset-password', data),
  me: () => api.get('/api/auth/me'),
  updateMe: (data) => api.put('/api/auth/me', data),
  deleteAccount: () => api.delete('/api/auth/me'),

  // Admin User Management (Task 4 backend / Task 13 UI)
  adminListUsers: () => api.get('/api/auth/admin/users'),
  adminCreateUser: (data) => api.post('/api/auth/admin/users', data),
  adminDeleteUser: (userId) => api.delete(`/api/auth/admin/users/${userId}`),
  // Admin-triggered live model retrain (Task 7 / Task 11 / Task 14's
  // "Recalibrate risk model" button)
  adminRetrainPipeline: () => api.post('/api/subjects/admin/retrain-pipeline'),
  // Recently uploaded sessions across the whole cohort (Task 14)
  adminRecentSessions: (limit) => api.get('/api/subjects/admin/recent-sessions', { params: { limit } }),

  listSubjects: (params) => api.get('/api/subjects', { params }),
  getSubject: (id) => api.get(`/api/subjects/${id}`),
  // Full cohort-level delete (admin-only) — removes a subject and every
  // piece of their data, whether or not they have a login account.
  deleteSubject: (id) => api.delete(`/api/subjects/${id}`),
  getSessions: (id) => api.get(`/api/subjects/${id}/sessions`),
  deleteSession: (subjectId, sessionMongoId) => api.delete(`/api/subjects/${subjectId}/sessions/${sessionMongoId}`),
  getTimeseries: (id, activity, sessionId) => api.get(`/api/subjects/${id}/sessions/${activity}/timeseries`, { params: sessionId ? { session_id: sessionId } : {} }),
  getInsights: (id, activity, sessionId) => api.get(`/api/subjects/${id}/insights`, { params: { ...(activity ? { activity } : {}), ...(sessionId ? { session_id: sessionId } : {}) } }),
  getExplainability: (id) => api.get(`/api/subjects/${id}/explainability`),
  getPopulationComparison: (id) => api.get(`/api/subjects/${id}/population`),
  getLongitudinal: (id) => api.get(`/api/subjects/${id}/longitudinal`),

  getEqQuestionnaire: () => api.get('/api/subjects/eq-questionnaire'),
  getEqAssessment: (id) => api.get(`/api/subjects/${id}/eq-assessment`),
  submitEqAssessment: (id, answers) => api.post(`/api/subjects/${id}/eq-assessment`, { answers }),

  getEqCardiacCorrelation: () => api.get('/api/research/eq-cardiac-correlation'),
  getUnsupervisedValidation: () => api.get('/api/research/unsupervised-validation'),
  getLoocv: () => api.get('/api/research/loocv'),
  getVariability: () => api.get('/api/research/variability'),
  getReferenceRangesByActivity: () => api.get('/api/research/reference-ranges-by-activity'),
  // Accepts a FormData with subject_id, optional activity/bmi/age, and up
  // to 4 files appended under the 'files' key (see UploadRecording.jsx).
  // onUploadProgress is optional — pass a function to drive a progress bar.
  uploadRecording: (formData, onUploadProgress) => api.post('/api/subjects/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
  }),

  populationStats: () => api.get('/api/population/stats'),
  askAssistant: (data) => api.post('/api/assistant/ask', data),
  // PDF report must go through the authenticated axios client (responseType
  // 'blob') rather than a plain <a href> — the API requires a Bearer token
  // that a direct browser navigation can't attach, which is why the old
  // reportUrl()-as-href approach always 401'd.
  downloadReport: (id) => api.get(`/api/subjects/${id}/report`, { responseType: 'blob' }),
}

export default api
