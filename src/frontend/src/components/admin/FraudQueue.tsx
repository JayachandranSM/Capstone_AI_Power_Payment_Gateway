import { useEffect, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { ShieldAlert, ChevronDown, ChevronUp, Loader2, CheckCircle, XCircle, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'

export default function FraudQueue() {
  const [alerts,   setAlerts]   = useState<any[]>([])
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState<string|null>(null)
  const [aiExpl,   setAiExpl]   = useState<Record<string,any>>({})
  const [aiLoad,   setAiLoad]   = useState<string|null>(null)
  const [agentRes, setAgentRes] = useState<Record<string,any>>({})
  const [agentLoad,setAgentLoad]= useState<string|null>(null)
  const [patterns, setPatterns] = useState<any[]>([])
  const [filter,   setFilter]   = useState('open')

  const fetch = async (s = filter) => {
    setLoading(true)
    try {
      const [alertRes, patternRes] = await Promise.all([
        axios.get(`/api/v1/admin/fraud-alerts?status=${s}`),
        axios.get('/api/v1/admin/fraud-patterns').catch(() => ({ data: [] })),
      ])
      setAlerts(alertRes.data || [])
      setPatterns(patternRes.data || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { fetch() }, [filter])

  const explain = async (alert: any) => {
    if (aiExpl[alert.id]) return
    setAiLoad(alert.id)
    try {
      const rules = typeof alert.rules_triggered === 'string'
        ? JSON.parse(alert.rules_triggered || '[]') : alert.rules_triggered || []
      const r = await axios.post('/api/ai/fraud/explain', {
        transaction_id: alert.transaction_id,
        fraud_score:    alert.fraud_score,
        rules_triggered: rules,
      })
      setAiExpl(prev => ({ ...prev, [alert.id]: r.data }))
      // Auto-expand to show result
      setExpanded(alert.id)
    } catch { toast.error('AI explanation unavailable') }
    finally { setAiLoad(null) }
  }

  const runAgent = async (alert: any) => {
    if (agentRes[alert.id]) return
    setAgentLoad(alert.id)
    try {
      const r = await axios.post('/api/ai/agents/analyze-transaction', {
        transaction_id: alert.transaction_id,
      })
      setAgentRes(prev => ({ ...prev, [alert.id]: r.data }))
      setExpanded(alert.id)
      toast.success('Agent analysis complete')
    } catch { toast.error('Agent unavailable') }
    finally { setAgentLoad(null) }
  }

  const resolve = async (id: string, status: string) => {
    try {
      await axios.patch(`/api/v1/admin/fraud-alerts/${id}/resolve`, { status, feedback: status })
      const action = status === 'false_positive' ? 'cleared (rule weights adjusted ↓)' : 'blocked'
      toast.success(`Alert ${action}`)
      setAlerts(a => a.filter(x => x.id !== id))
    } catch { toast.error('Failed to resolve') }
  }

  const SEV: Record<string,string> = {
    critical: 'bg-red-100 text-red-700 border-red-200',
    high:     'bg-orange-100 text-orange-700 border-orange-200',
    medium:   'bg-yellow-100 text-yellow-700 border-yellow-200',
    low:      'bg-blue-100 text-blue-700 border-blue-200',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Fraud Queue</h1>
          <p className="text-slate-500 text-sm mt-1">
            {alerts.length} alerts · AI-assisted review · Feedback loop active
          </p>
        </div>
        <div className="flex gap-2">
          {['open','investigating','resolved','false_positive'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filter === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'
              }`}>
              {s.replace('_',' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Fraud Pattern Feedback Loop Panel */}
      {patterns.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown size={16} className="text-blue-600"/>
            <h2 className="font-semibold text-slate-800">Fraud Rule Feedback Loop</h2>
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Auto-adjusting weights</span>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
            {patterns.slice(0,10).map((p:any) => (
              <div key={p.rule_name} className="bg-slate-50 rounded-xl p-2.5 text-center">
                <div className="text-xs font-semibold text-slate-700 truncate">{p.rule_name}</div>
                <div className="text-lg font-bold text-blue-600 mt-1">{parseFloat(p.weight).toFixed(3)}</div>
                <div className="text-[10px] text-slate-400">
                  hits: {p.hit_count} · fp: {p.false_positive}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-2">
            ℹ️ Marking alert as "Clear" (false positive) reduces rule weight by 0.01 automatically
          </p>
        </div>
      )}

      {/* Alerts */}
      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-slate-100 rounded-2xl animate-pulse"/>)}</div>
      ) : alerts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
          <ShieldAlert size={40} className="text-slate-300 mx-auto mb-3"/>
          <div className="text-slate-400">No {filter} fraud alerts 🎉</div>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map(alert => {
            const isOpen = expanded === alert.id
            const rules  = typeof alert.rules_triggered === 'string'
              ? JSON.parse(alert.rules_triggered || '[]') : alert.rules_triggered || []

            return (
              <div key={alert.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                <div className="p-4 flex items-center gap-3">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold border flex-shrink-0 ${SEV[alert.severity] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                    {alert.severity?.toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800">{alert.sender_name || 'Unknown'}</span>
                      <span className="text-xs text-slate-400">· {alert.sender_email}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      ₹{parseFloat(alert.amount||0).toLocaleString()} · {alert.payment_method?.toUpperCase()} ·
                      Score: <span className="font-bold text-red-600">{(alert.fraud_score*100).toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <button onClick={() => explain(alert)}
                      className="flex items-center gap-1 text-xs bg-violet-50 border border-violet-200 text-violet-700 px-2.5 py-1.5 rounded-lg hover:bg-violet-100">
                      {aiLoad === alert.id ? <Loader2 size={11} className="animate-spin"/> : <Sparkles size={11}/>}
                      AI Explain
                    </button>
                    <button onClick={() => runAgent(alert)}
                      className="flex items-center gap-1 text-xs bg-blue-50 border border-blue-200 text-blue-700 px-2.5 py-1.5 rounded-lg hover:bg-blue-100">
                      {agentLoad === alert.id ? <Loader2 size={11} className="animate-spin"/> : <Sparkles size={11}/>}
                      Run Agent
                    </button>
                    <button onClick={() => resolve(alert.id, 'false_positive')}
                      title="Mark as false positive — reduces the triggering rule weight by 0.01 so future similar transactions are less likely to be flagged"
                      className="flex items-center gap-1 text-xs bg-green-50 border border-green-200 text-green-700 px-2.5 py-1.5 rounded-lg hover:bg-green-100">
                      <CheckCircle size={11}/>Clear (false positive)
                    </button>
                    <button onClick={() => resolve(alert.id, 'resolved')}
                      className="flex items-center gap-1 text-xs bg-red-50 border border-red-200 text-red-700 px-2.5 py-1.5 rounded-lg hover:bg-red-100">
                      <XCircle size={11}/>Block
                    </button>
                    <button onClick={() => setExpanded(isOpen ? null : alert.id)}
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
                      {isOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-4">
                    {rules.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Rules Triggered</div>
                        <div className="flex flex-wrap gap-2">
                          {rules.map((r:any, i:number) => (
                            <div key={i} className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs">
                              <span className="font-semibold text-red-600">{r.rule}</span>
                              <span className="text-slate-500 ml-1.5">weight={r.weight?.toFixed(3)}</span>
                              {r.detail && <div className="text-slate-400 mt-0.5">{r.detail}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* AI Explanation */}
                    {aiExpl[alert.id] && (
                      <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles size={14} className="text-violet-600"/>
                          <span className="text-xs font-semibold text-violet-700">AI Fraud Analysis</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ml-auto font-semibold ${
                            aiExpl[alert.id].recommended_action === 'block'
                              ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            Recommended: {aiExpl[alert.id].recommended_action?.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
          {aiExpl[alert.id].explanation?.split('**').join('').split('###').join('').split('##').join('').split('#').join('').split('\n\n').join('\n')}
        </p>
                      </div>
                    )}

                    {/* Agent Results */}
                    {agentRes[alert.id] && (
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles size={14} className="text-blue-600"/>
                          <span className="text-xs font-semibold text-blue-700">Multi-Agent Analysis</span>
                        </div>
                        <p className="text-sm text-slate-700 mb-2">{(agentRes[alert.id].final_synthesis || '').split('**').join('').split('***').join('').split('###').join('').split('##').join('').split('# ').join('').split('`').join('').replace(/\n\n+/g, '\n').trim()}</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="bg-white rounded-lg p-2">
                            <div className="font-semibold text-slate-600 mb-1">Fraud Agent</div>
                            <div>Risk: <span className="font-bold">{agentRes[alert.id].fraud_analysis?.risk_level}</span></div>
                            <div>Action: <span className="font-bold text-red-600">{agentRes[alert.id].fraud_analysis?.action}</span></div>
                            <div>Confidence: {agentRes[alert.id].fraud_analysis?.confidence}%</div>
                          </div>
                          <div className="bg-white rounded-lg p-2">
                            <div className="font-semibold text-slate-600 mb-1">Compliance Agent</div>
                            <div>AML Flags: <span className="font-bold">{agentRes[alert.id].compliance_analysis?.aml_flags?.length || 0}</span></div>
                            <div>KYC: <span className="font-bold">{agentRes[alert.id].compliance_analysis?.kyc_status}</span></div>
                            <div>Verdict: <span className="font-bold">{agentRes[alert.id].compliance_analysis?.recommendation}</span></div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="text-xs text-slate-400 font-mono">
                      TX: {alert.transaction_id} · Alert: {alert.id?.slice(0,8).toUpperCase()}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
