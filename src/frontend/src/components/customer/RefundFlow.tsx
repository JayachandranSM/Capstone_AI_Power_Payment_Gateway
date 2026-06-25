import { useEffect, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { RefreshCw, CheckCircle, Loader2, Search } from 'lucide-react'
import clsx from 'clsx'

type Step = 'select'|'reason'|'confirm'|'processing'|'submitted'
const REASONS = ['Item not received','Wrong amount charged','Duplicate payment','Service not delivered','Product damaged','Merchant cancelled','Other']

export default function RefundFlow() {
  const [step, setStep]     = useState<Step>('select')
  const [txns, setTxns]     = useState<any[]>([])
  const [sel,  setSel]      = useState<any>(null)
  const [reason, setReason] = useState('')
  const [custom, setCustom] = useState('')
  const [amt,  setAmt]      = useState('')
  const [result, setResult] = useState<any>(null)
  const [loading, setLoad]  = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    axios.get('/api/v1/transactions?size=50')
      .then(r => setTxns((r.data.items||[]).filter((t:any)=>t.status==='success')))
      .finally(()=>setLoad(false))
  }, [])

  const filtered = txns.filter(t =>
    (t.upi_handle_receiver||'').includes(search)||
    (t.currency||'').includes(search.toUpperCase())||
    String(t.amount).includes(search)
  )

  const submit = async () => {
    setStep('processing')
    try {
      const res = await axios.post('/api/v1/refunds', {
        transaction_id: sel.id,
        amount: amt ? parseFloat(amt) : undefined,
        reason: (reason==='Other'?custom:reason) + ' — customer initiated',
      })
      setResult(res.data); setStep('submitted')
    } catch(err:any) { toast.error(err?.response?.data?.detail||'Refund failed'); setStep('confirm') }
  }

  if (step==='submitted') return (
    <div className="max-w-md mx-auto mt-8 text-center">
      <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-lg">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><CheckCircle size={44} className="text-green-500"/></div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">Refund Requested</h2>
        <p className="text-slate-500 text-sm mb-6">We'll process it within 3-5 business days</p>
        <div className="bg-slate-50 rounded-2xl p-4 mb-6 text-left space-y-2">
          {[
            {label:'Request submitted',status:'done',time:'Just now'},
            {label:'Under admin review',status:'pending',time:'1-2 hours'},
            {label:'Approved & processing',status:'waiting',time:'24 hours'},
            {label:'Credited to wallet',status:'waiting',time:'3-5 days'},
          ].map((r,i)=>(
            <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
              <div className={clsx('w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0',
                r.status==='done'?'bg-green-500 text-white':r.status==='pending'?'bg-blue-500 text-white':'bg-slate-200 text-slate-400')}>
                {r.status==='done'?'✓':i+1}
              </div>
              <div className="flex-1 text-sm text-slate-700">{r.label}</div>
              <div className="text-xs text-slate-400">{r.time}</div>
            </div>
          ))}
        </div>
        <button onClick={()=>{setStep('select');setSel(null);setReason('');setAmt('')}}
          className="w-full bg-blue-600 text-white rounded-xl py-3 font-medium">Done</button>
      </div>
    </div>
  )

  if (step==='processing') return (
    <div className="max-w-md mx-auto mt-16 text-center"><Loader2 size={48} className="text-blue-600 animate-spin mx-auto mb-4"/><h2 className="text-xl font-semibold text-slate-800">Submitting refund…</h2></div>
  )

  if (step==='confirm') return (
    <div className="max-w-md mx-auto mt-8">
      <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-lg">
        <h2 className="text-xl font-bold text-slate-900 mb-6">Confirm Refund</h2>
        <div className="bg-slate-50 rounded-2xl p-4 mb-6 space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Original</span><span className="font-semibold">{sel?.amount} {sel?.currency}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Refund</span><span className="font-bold text-blue-600">{amt||sel?.amount} {sel?.currency}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Reason</span><span className="text-right max-w-[60%]">{reason==='Other'?custom:reason}</span></div>
        </div>
        <div className="flex gap-3">
          <button onClick={()=>setStep('reason')} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-3 text-sm">Back</button>
          <button onClick={submit} className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold">Submit</button>
        </div>
      </div>
    </div>
  )

  if (step==='reason') return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Reason for Refund</h1>
      <div className="bg-blue-50 rounded-2xl p-4 mb-4 text-sm">
        <div className="font-semibold text-slate-800">{sel?.amount} {sel?.currency}</div>
        <div className="text-slate-500 text-xs">{sel?.upi_handle_receiver||sel?.payment_method} · {new Date(sel?.created_at).toLocaleDateString()}</div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-2 mb-4">
        {REASONS.map(r=>(
          <button key={r} onClick={()=>setReason(r)}
            className={clsx('w-full text-left px-4 py-3 rounded-xl text-sm border transition-colors',
              reason===r?'border-blue-500 bg-blue-50 text-blue-700':'border-slate-100 hover:bg-slate-50 text-slate-700')}>
            {reason===r?'✓ ':''}{r}
          </button>
        ))}
        {reason==='Other' && (
          <textarea rows={3} value={custom} onChange={e=>setCustom(e.target.value)} placeholder="Describe your issue..."
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none resize-none mt-2"/>
        )}
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 p-4 mb-4">
        <label className="text-sm font-medium text-slate-700 block mb-2">Refund amount <span className="text-slate-400 font-normal">(blank = full)</span></label>
        <input type="number" value={amt} onChange={e=>setAmt(e.target.value)} placeholder={`Full: ${sel?.amount} ${sel?.currency}`}
          max={sel?.amount} min="0.01" step="0.01"
          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none"/>
      </div>
      <div className="flex gap-3">
        <button onClick={()=>{setStep('select');setSel(null)}} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-3 text-sm">Back</button>
        <button onClick={()=>reason&&setStep('confirm')} disabled={!reason||(reason==='Other'&&!custom)}
          className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50">Continue</button>
      </div>
    </div>
  )

  return (
    <div className="max-w-lg mx-auto">
      <div><h1 className="text-2xl font-bold text-slate-900">Request a Refund</h1><p className="text-slate-500 text-sm mt-1">Select the transaction to refund</p></div>
      <div className="mt-4 relative mb-4">
        <Search size={16} className="absolute left-3 top-3.5 text-slate-400"/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by amount, UPI, currency..."
          className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 divide-y divide-slate-50">
        {loading ? [1,2,3].map(i=><div key={i} className="p-4 h-16 animate-pulse bg-slate-50"/>) :
         filtered.length===0 ? <div className="p-8 text-center text-slate-400 text-sm">No eligible transactions</div> :
         filtered.map(tx=>(
          <button key={tx.id} onClick={()=>{setSel(tx);setStep('reason')}}
            className="w-full p-4 flex items-center gap-3 hover:bg-slate-50 text-left">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center text-green-600 flex-shrink-0"><RefreshCw size={16}/></div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-800 truncate">{tx.upi_handle_receiver||tx.type?.replace('_',' ')}</div>
              <div className="text-xs text-slate-400">{tx.payment_method?.toUpperCase()} · {new Date(tx.created_at).toLocaleDateString()}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-800">{tx.amount} {tx.currency}</div>
              <div className="text-xs text-green-600">Eligible</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
