import { useEffect, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Loader2, Sparkles } from 'lucide-react'

export default function Settlements() {
  const [settlements, setS]       = useState<any[]>([])
  const [aiSummary,   setAI]      = useState('')
  const [aiLoad,      setAL]      = useState(false)
  const [loading,     setLoad]    = useState(true)
  const [merchantId,  setMerchantId] = useState<string>('')

  useEffect(() => {
    // Load merchant profile to get real merchant_id
    axios.get('/api/v1/merchants/me')
      .then(r => setMerchantId(r.data.id))
      .catch(() => {})

    // Load settlements
    axios.get('/api/v1/merchants/settlements')
      .then(r => setS(r.data || []))
      .finally(() => setLoad(false))
  }, [])

  const fetchAI = async () => {
    if (!merchantId) {
      toast.error('Loading merchant profile, please wait a moment...')
      return
    }
    setAL(true)
    setAI('')
    try {
      const r = await axios.get(`/api/ai/settlement/summary/${merchantId}`)
      const summary = r.data?.summary
        || r.data?.details?.settlement_analysis?.summary
        || r.data?.details?.summary
        || JSON.stringify(r.data?.details || r.data, null, 2)
      setAI(summary)
    } catch {
      toast.error('AI summary unavailable — check AI service')
    } finally {
      setAL(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Settlements</h1>
          <p className="text-slate-500 text-sm mt-1">Payout history and reconciliation</p>
        </div>
        <button onClick={fetchAI} disabled={aiLoad}
          className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-60 transition-colors">
          {aiLoad
            ? <Loader2 size={14} className="animate-spin"/>
            : <Sparkles size={14}/>}
          AI Summary
        </button>
      </div>

      {/* AI Summary panel */}
      {aiLoad && (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5 flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-violet-600"/>
          <span className="text-violet-700 text-sm">Generating AI settlement analysis...</span>
        </div>
      )}

      {aiSummary && !aiLoad && (
        <div className="bg-violet-50 border border-violet-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={16} className="text-violet-600"/>
            <span className="font-semibold text-violet-800 text-sm">AI Settlement Analysis</span>
            <span className="text-xs text-violet-400 ml-auto">Powered by Azure OpenAI</span>
          </div>
          <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">{(aiSummary || '').split('**').join('').split('***').join('').split('###').join('').split('##').join('').split('# ').join('').split('`').join('').replace(/\n\n+/g, '\n').trim()}</p>
        </div>
      )}

      {/* Settlement cards */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-28 bg-slate-100 rounded-2xl animate-pulse"/>
          ))}
        </div>
      ) : settlements.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
          <div className="text-4xl mb-3">💳</div>
          <div className="text-slate-500 font-medium">No settlements yet</div>
          <div className="text-slate-400 text-sm mt-1">Settlements are generated weekly for completed transactions</div>
        </div>
      ) : (
        <div className="space-y-4">
          {settlements.map((s: any) => (
            <div key={s.id} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              {/* Settlement header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="font-semibold text-slate-800">
                    {new Date(s.period_start).toLocaleDateString('en-IN', { month:'short', day:'numeric' })}
                    {' — '}
                    {new Date(s.period_end).toLocaleDateString('en-IN', { month:'short', day:'numeric', year:'numeric' })}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">{s.tx_count} transactions · {s.currency}</div>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                  s.status === 'settled'    ? 'bg-green-100 text-green-700'  :
                  s.status === 'pending'    ? 'bg-blue-100 text-blue-700'    :
                  s.status === 'processing' ? 'bg-yellow-100 text-yellow-700':
                  'bg-slate-100 text-slate-600'
                }`}>
                  {s.status.toUpperCase()}
                </span>
              </div>

              {/* Breakdown */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label:'Gross Revenue', value:`₹${parseFloat(s.gross_amount||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`, highlight:false, negative:false },
                  { label:'Platform Fee (2%)', value:`-₹${parseFloat(s.fees||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`, highlight:false, negative:true },
                  { label:'GST (18%)', value:`-₹${parseFloat(s.tax||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`, highlight:false, negative:true },
                  { label:'Net Payout', value:`₹${parseFloat(s.net_amount||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`, highlight:true, negative:false },
                ].map(x => (
                  <div key={x.label} className={`rounded-xl p-3 ${x.highlight ? 'bg-emerald-50 border border-emerald-100' : 'bg-slate-50'}`}>
                    <div className={`text-xs mb-1 ${x.highlight ? 'text-emerald-600' : 'text-slate-400'}`}>{x.label}</div>
                    <div className={`font-bold text-sm ${x.negative ? 'text-red-600' : x.highlight ? 'text-emerald-700 text-base' : 'text-slate-800'}`}>
                      {x.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* AI note if available */}
              {s.summary_ai && (
                <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500 italic">
                  {(s.summary_ai || '').split('**').join('').split('***').join('').split('###').join('').split('##').join('').split('# ').join('').split('`').join('').replace(/\n\n+/g, '\n').trim()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
