import { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { Send, Bot, User, Loader2, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import { useAuthStore } from '../../store/authStore'

interface Msg {
  role: 'user' | 'assistant'
  text: string
  confidence?: number
  sources?: any[]
}

const QUICK = [
  'Why did recent card payments fail?',
  'Explain my settlement amount',
  'Show failed UPI transactions',
  'What is my chargeback rate?',
]

export default function AISupportChat() {
  const { userId } = useAuthStore()
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: "Hello! I'm your AI payment assistant with session memory. I can help you understand transaction failures, settlements, fraud patterns, and more. What would you like to know?" }
  ])
  const [input,     setInput]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (userId) {
      axios.post('/api/ai/session/create', { user_id: userId, session_type: 'merchant_support' })
        .then(r => setSessionId(r.data.session_id))
        .catch(() => {})
    }
  }, [userId])

  const send = async (text: string) => {
    if (!text.trim() || loading) return
    setInput('')
    setMessages(m => [...m, { role: 'user', text }])
    setLoading(true)
    try {
      if (sessionId) {
        const r = await axios.post('/api/ai/session/chat', { session_id: sessionId, message: text })
        setMessages(m => [...m, {
          role: 'assistant',
          text: r.data.answer,
          confidence: r.data.confidence,
          sources: r.data.sources,
        }])
      } else {
        const r = await axios.post('/api/ai/rag/query', { query: text, top_k: 5 })
        setMessages(m => [...m, {
          role: 'assistant',
          text: r.data.answer,
          confidence: r.data.confidence,
          sources: r.data.sources,
        }])
      }
    } catch {
      setMessages(m => [...m, { role: 'assistant', text: 'Sorry, AI service is temporarily unavailable.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-160px)]">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900">AI Support Assistant</h1>
        <p className="text-slate-500 text-sm mt-1">
          RAG-powered with session memory {sessionId ? '✓ Session active' : ''}
        </p>
      </div>

      <div className="flex gap-2 flex-wrap mb-4">
        {QUICK.map(q => (
          <button key={q} onClick={() => send(q)}
            className="text-xs border border-violet-200 text-violet-700 bg-violet-50 hover:bg-violet-100 px-3 py-1.5 rounded-full transition-colors">
            {q}
          </button>
        ))}
      </div>

      <div className="flex-1 bg-white rounded-2xl border border-slate-100 overflow-y-auto p-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={clsx('flex gap-3', m.role === 'user' && 'flex-row-reverse')}>
            <div className={clsx(
              'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
              m.role === 'assistant' ? 'bg-violet-100 text-violet-600' : 'bg-blue-600 text-white'
            )}>
              {m.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}
            </div>
            <div className={clsx('max-w-[75%] space-y-1', m.role === 'user' && 'items-end flex flex-col')}>
              <div className={clsx(
                'rounded-2xl px-4 py-3 text-sm leading-relaxed',
                m.role === 'assistant'
                  ? 'bg-slate-50 text-slate-800 rounded-tl-none'
                  : 'bg-blue-600 text-white rounded-tr-none'
              )}>
                {m.text}
              </div>
              {m.confidence != null && (
                <div className="flex items-center gap-1 text-xs text-slate-400">
                  <Sparkles size={10} />
                  Confidence: {(m.confidence * 100).toFixed(0)}%
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center">
              <Bot size={16} className="text-violet-600" />
            </div>
            <div className="bg-slate-50 rounded-2xl rounded-tl-none px-4 py-3">
              <Loader2 size={16} className="animate-spin text-slate-400" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send(input)}
          placeholder="Ask about transactions, failures, settlements…"
          className="flex-1 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
        />
        <button onClick={() => send(input)} disabled={!input.trim() || loading}
          className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl px-4 py-3 flex items-center gap-1.5 text-sm font-medium transition-colors">
          <Send size={15} />
        </button>
      </div>
    </div>
  )
}
