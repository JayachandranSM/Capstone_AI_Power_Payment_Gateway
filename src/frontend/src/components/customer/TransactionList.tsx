import { useEffect, useState } from 'react'
import axios from 'axios'
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

const S: Record<string,string> = {
  success:'bg-green-100 text-green-700',failed:'bg-red-100 text-red-700',
  flagged:'bg-yellow-100 text-yellow-700',pending:'bg-blue-100 text-blue-700',
}
const MI: Record<string,string> = { upi:'📱',card:'💳',bank_transfer:'🏦',wallet:'👜',neft:'🔄',rtgs:'🔄',imps:'⚡' }

export default function TransactionList() {
  const [txns, setTxns] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page,  setPage]  = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [status, setStatus]   = useState('')
  const [currency, setCurrency] = useState('')

  const fetch = async (p=1) => {
    setLoading(true)
    const params = new URLSearchParams({ page:String(p), size:'15' })
    if (status)   params.set('status', status)
    if (currency) params.set('currency', currency)
    try {
      const res = await axios.get(`/api/v1/transactions?${params}`)
      setTxns(res.data.items||[]); setTotal(res.data.total||0)
      setPages(res.data.pages||1); setPage(p)
    } finally { setLoading(false) }
  }

  useEffect(() => { fetch(1) }, [status, currency])

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Transaction History</h1>
        <p className="text-slate-500 text-sm mt-1">{total.toLocaleString()} transactions</p>
      </div>
      <div className="flex gap-3 mb-4 flex-wrap">
        {[['','All'],['success','✓ Success'],['failed','✗ Failed'],['flagged','⚠ Flagged'],['pending','⏳ Pending']].map(([v,l])=>(
          <button key={v} onClick={()=>setStatus(v as string)}
            className={clsx('px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
              status===v?'bg-blue-600 text-white border-blue-600':'bg-white text-slate-600 border-slate-200')}>
            {l}
          </button>
        ))}
        <select value={currency} onChange={e=>setCurrency(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-sm bg-white focus:outline-none">
          <option value="">All currencies</option>
          {['INR','USD','EUR','GBP','SGD'].map(c=><option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['Transaction','Method','Date','Amount','Status','Risk'].map(h=>(
                  <th key={h} className={clsx('px-4 py-3 text-xs font-semibold text-slate-500 uppercase',
                    h==='Amount'||h==='Risk'?'text-right':'text-left')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? Array.from({length:8}).map((_,i)=>(
                <tr key={i}>{Array.from({length:6}).map((_,j)=>(
                  <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse"/></td>
                ))}</tr>
              )) : txns.length===0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No transactions</td></tr>
              ) : txns.map(tx=>(
                <tr key={tx.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span>{MI[tx.payment_method]||'💸'}</span>
                      <div>
                        <div className="font-medium text-slate-800 truncate max-w-[150px]">{tx.upi_handle_receiver||tx.type?.replace('_',' ')}</div>
                        <div className="text-xs text-slate-400 font-mono">{tx.id?.slice(0,8).toUpperCase()}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 uppercase">{tx.payment_method}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{new Date(tx.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">{Number(tx.amount).toLocaleString()} <span className="text-slate-400 font-normal text-xs">{tx.currency}</span></td>
                  <td className="px-4 py-3 text-center">
                    <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium',S[tx.status]||'bg-slate-100 text-slate-600')}>{tx.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {tx.fraud_score>0.5
                      ? <span className="text-yellow-500 text-xs font-semibold flex items-center justify-end gap-1"><AlertTriangle size={12}/>{(tx.fraud_score*100).toFixed(0)}%</span>
                      : <span className="text-green-500 text-xs">{(tx.fraud_score*100).toFixed(0)}%</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages>1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400">Page {page} of {pages}</span>
            <div className="flex gap-2">
              <button disabled={page<=1} onClick={()=>fetch(page-1)} className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40"><ChevronLeft size={14}/></button>
              <button disabled={page>=pages} onClick={()=>fetch(page+1)} className="p-1.5 rounded-lg border border-slate-200 disabled:opacity-40"><ChevronRight size={14}/></button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
