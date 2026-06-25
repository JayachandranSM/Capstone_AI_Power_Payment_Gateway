import { useEffect, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Plus, ArrowRightLeft, Loader2 } from 'lucide-react'

const FLAG: Record<string,string> = { INR:'🇮🇳',USD:'🇺🇸',EUR:'🇪🇺',GBP:'🇬🇧',SGD:'🇸🇬',AED:'🇦🇪',JPY:'🇯🇵',CAD:'🇨🇦',AUD:'🇦🇺',CNY:'🇨🇳' }
const GRAD: Record<string,string> = { INR:'from-orange-500 to-orange-600',USD:'from-green-600 to-green-700',EUR:'from-blue-600 to-blue-700',GBP:'from-purple-600 to-purple-700',SGD:'from-red-500 to-red-600' }

export default function CustomerWallet() {
  const [wallets,  setWallets]  = useState<any[]>([])
  const [currencies,setCurrencies] = useState<any[]>([])
  const [loading,  setLoading]  = useState(true)
  const [topupCur, setTopupCur] = useState('INR')
  const [topupAmt, setTopupAmt] = useState('')
  const [topping,  setTopping]  = useState(false)
  const [fromCur,  setFromCur]  = useState('INR')
  const [toCur,    setToCur]    = useState('USD')
  const [convAmt,  setConvAmt]  = useState('')
  const [convResult,setConvRes] = useState<any>(null)
  const [converting,setConving] = useState(false)

  const load = async () => {
    setLoading(true)
    const [w,c] = await Promise.all([axios.get('/api/v1/wallets'), axios.get('/api/v1/wallets/currencies')])
    setWallets(w.data); setCurrencies(c.data); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const topup = async (e: React.FormEvent) => {
    e.preventDefault(); setTopping(true)
    try {
      await axios.post('/api/v1/wallets/topup', { currency:topupCur, amount:parseFloat(topupAmt) })
      toast.success(`${topupAmt} ${topupCur} added!`); setTopupAmt(''); load()
    } catch(err:any) { toast.error(err?.response?.data?.detail||'Top-up failed') }
    finally { setTopping(false) }
  }

  const convert = async (e: React.FormEvent) => {
    e.preventDefault(); setConving(true)
    try {
      const res = await axios.post('/api/v1/wallets/convert', { from_currency:fromCur, to_currency:toCur, amount:parseFloat(convAmt) })
      setConvRes(res.data)
    } catch(err:any) { toast.error(err?.response?.data?.detail||'Conversion failed') }
    finally { setConving(false) }
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">My Wallets</h1><p className="text-slate-500 text-sm mt-1">Multi-currency balances</p></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {loading ? [1,2,3].map(i=><div key={i} className="h-32 bg-slate-100 rounded-2xl animate-pulse"/>) :
         wallets.map(w=>(
          <div key={w.id} className={`bg-gradient-to-br ${GRAD[w.currency]||'from-slate-500 to-slate-600'} rounded-2xl p-5 text-white shadow-md`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-2xl">{FLAG[w.currency]||'💵'}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/20">{w.status}</span>
            </div>
            <div className="text-2xl font-bold">{Number(w.balance).toLocaleString('en-IN',{maximumFractionDigits:2})}</div>
            <div className="text-white/70 text-sm mt-0.5">{w.currency} Balance</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center gap-2 mb-4"><div className="w-8 h-8 bg-green-100 rounded-xl flex items-center justify-center"><Plus size={16} className="text-green-600"/></div><h2 className="font-semibold text-slate-800">Add Money</h2></div>
          <form onSubmit={topup} className="space-y-3">
            <select value={topupCur} onChange={e=>setTopupCur(e.target.value)} className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none">
              {currencies.map((c:any)=><option key={c.code} value={c.code}>{FLAG[c.code]||'💵'} {c.code} — {c.name}</option>)}
            </select>
            <input type="number" required value={topupAmt} onChange={e=>setTopupAmt(e.target.value)} placeholder="Amount" min="0.01" step="0.01" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none"/>
            <button type="submit" disabled={topping} className="w-full bg-green-600 hover:bg-green-500 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
              {topping?<Loader2 size={14} className="animate-spin"/>:<Plus size={14}/>}Add Money
            </button>
          </form>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center gap-2 mb-4"><div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center"><ArrowRightLeft size={16} className="text-blue-600"/></div><h2 className="font-semibold text-slate-800">Currency Converter</h2></div>
          <form onSubmit={convert} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <select value={fromCur} onChange={e=>setFromCur(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">{['INR','USD','EUR','GBP','SGD','AED'].map(c=><option key={c}>{c}</option>)}</select>
              <select value={toCur} onChange={e=>setToCur(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm">{['USD','INR','EUR','GBP','SGD','AED'].map(c=><option key={c}>{c}</option>)}</select>
            </div>
            <input type="number" required value={convAmt} onChange={e=>setConvAmt(e.target.value)} placeholder={`Amount in ${fromCur}`} min="0.01" step="0.01" className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none"/>
            <button type="submit" disabled={converting} className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
              {converting?<Loader2 size={14} className="animate-spin"/>:<ArrowRightLeft size={14}/>}Convert
            </button>
            {convResult && (
              <div className="bg-blue-50 rounded-xl p-3 text-sm">
                <div className="font-bold text-blue-700 text-lg">{convResult.converted_amount?.toLocaleString()} {convResult.to_currency}</div>
                <div className="text-blue-500 text-xs">Rate: 1 {convResult.from_currency} = {convResult.fx_rate} {convResult.to_currency}</div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}
