import { useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Send, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react'
import clsx from 'clsx'

const CURRENCIES = ['INR','USD','EUR','GBP','SGD','AED']
const METHODS = ['upi','card','bank_transfer','wallet','neft','rtgs','imps']
const METHOD_LABEL: Record<string,string> = {
  upi:'📱 UPI',card:'💳 Card',bank_transfer:'🏦 Bank',wallet:'👜 Wallet',neft:'NEFT',rtgs:'RTGS',imps:'⚡ IMPS'
}

type Step = 'form'|'confirm'|'processing'|'success'|'failed'

export default function PaymentSend() {
  const [step,    setStep]   = useState<Step>('form')
  const [result,  setResult] = useState<any>(null)
  const [upi,     setUpi]    = useState('rajshop@paygw')
  const [amount,  setAmount] = useState('')
  const [currency,setCur]    = useState('INR')
  const [method,  setMethod] = useState('upi')
  const [note,    setNote]   = useState('')

  const pay = async () => {
    setStep('processing')
    const key = `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`
    try {
      const res = await axios.post('/api/v1/payments/process',
        { idempotency_key:key, amount:parseFloat(amount), currency, payment_method:method, receiver_upi:upi||undefined },
        { headers:{'X-Idempotency-Key':key} }
      )
      setResult(res.data)
      setStep(res.data.status==='success'?'success':'failed')
    } catch (err:any) {
      setResult({ message: err?.response?.data?.detail||'Payment failed' })
      setStep('failed')
    }
  }

  if (step==='success') return (
    <div className="max-w-md mx-auto mt-8 text-center">
      <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-lg">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={44} className="text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">Payment Sent!</h2>
        <p className="text-slate-500 text-sm mb-6">Processed successfully</p>
        <div className="bg-slate-50 rounded-2xl p-4 mb-6 text-left space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Amount</span><span className="font-bold">{result?.amount} {result?.currency}</span></div>
          {result?.currency!=='USD' && <div className="flex justify-between"><span className="text-slate-500">≈ USD</span><span>${result?.amount_usd?.toFixed(2)}</span></div>}
          <div className="flex justify-between"><span className="text-slate-500">To</span><span>{upi}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Ref</span><span className="font-mono text-xs">{result?.sandbox_ref}</span></div>
          <div className="flex justify-between"><span className="text-slate-500">Risk</span><span>{(result?.fraud_score*100).toFixed(0)}%</span></div>
        </div>
        <div className="flex gap-3">
          <button onClick={()=>{setStep('form');setAmount('');setNote('')}} className="flex-1 border border-slate-200 text-slate-700 rounded-xl py-3 text-sm font-medium">New Payment</button>
          <button onClick={()=>window.location.href='/customer/history'} className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-medium">View History</button>
        </div>
      </div>
    </div>
  )

  if (step==='failed') return (
    <div className="max-w-md mx-auto mt-8 text-center">
      <div className="bg-white rounded-3xl p-8 border border-red-100 shadow-lg">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={44} className="text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-1">{result?.status==='flagged'?'Payment Flagged':'Payment Failed'}</h2>
        <p className="text-slate-500 text-sm mb-4">{result?.message}</p>
        {result?.status==='flagged' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 text-sm text-yellow-800">
            🔍 Under fraud review. You'll be notified within 24h.
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={()=>setStep('form')} className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-medium">Try Again</button>
          <button onClick={()=>window.location.href='/customer'} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-3 text-sm font-medium">Go Home</button>
        </div>
      </div>
    </div>
  )

  if (step==='processing') return (
    <div className="max-w-md mx-auto mt-16 text-center">
      <Loader2 size={48} className="text-blue-600 animate-spin mx-auto mb-4" />
      <h2 className="text-xl font-semibold text-slate-800">Processing Payment…</h2>
      <p className="text-slate-500 text-sm mt-2">Running fraud checks · Sandbox mode</p>
    </div>
  )

  if (step==='confirm') return (
    <div className="max-w-md mx-auto mt-8">
      <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-lg">
        <h2 className="text-xl font-bold text-slate-900 mb-6 text-center">Confirm Payment</h2>
        <div className="bg-blue-50 rounded-2xl p-5 mb-6 space-y-2 text-sm">
          <div className="text-center text-3xl font-bold text-slate-900">{parseFloat(amount).toLocaleString()} {currency}</div>
          <div className="text-center text-slate-500">to {upi}</div>
          <div className="border-t border-blue-100 pt-2 flex justify-between">
            <span className="text-slate-500">Method</span><span>{METHOD_LABEL[method]||method}</span>
          </div>
          {note && <div className="flex justify-between"><span className="text-slate-500">Note</span><span>{note}</span></div>}
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4 text-xs text-yellow-700">
          ⚠️ Sandbox mode — no real money transferred
        </div>
        <div className="flex gap-3">
          <button onClick={()=>setStep('form')} className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-3 text-sm">Back</button>
          <button onClick={pay} className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold flex items-center justify-center gap-2">
            <Send size={16}/>Pay Now
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Send Money</h1>
      <p className="text-slate-500 text-sm mb-6">UPI · Card · Bank Transfer · Wallet</p>
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-5">
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">To (UPI handle)</label>
          <input value={upi} onChange={e=>setUpi(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="name@paygw" />
          <p className="text-xs text-slate-400 mt-1">Try: rajshop@paygw · priya@paygw · carlos@paygw</p>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">Amount</label>
          <div className="flex gap-2">
            <input type="number" value={amount} onChange={e=>setAmount(e.target.value)}
              className="flex-1 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="0.00" min="0.01" step="0.01" />
            <select value={currency} onChange={e=>setCur(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-3 text-sm bg-white focus:outline-none">
              {CURRENCIES.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-2">Payment Method</label>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map(m=>(
              <button key={m} onClick={()=>setMethod(m)}
                className={clsx('border rounded-xl px-2 py-2.5 text-xs font-medium transition-colors',
                  method===m?'border-blue-500 bg-blue-50 text-blue-700':'border-slate-200 text-slate-600 hover:border-slate-300')}>
                {METHOD_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1">Note (optional)</label>
          <input value={note} onChange={e=>setNote(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Dinner, rent, etc." />
        </div>
        <button onClick={()=>{if(!amount||parseFloat(amount)<=0){toast.error('Enter valid amount');return}setStep('confirm')}}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl py-3 flex items-center justify-center gap-2">
          <Send size={16}/>Continue
        </button>
      </div>
    </div>
  )
}
