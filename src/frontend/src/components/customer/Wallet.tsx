import { useEffect, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Plus, ArrowLeftRight, Loader2, Info } from 'lucide-react'

const FLAG: Record<string,string> = {
  INR:'🇮🇳', USD:'🇺🇸', EUR:'🇪🇺', GBP:'🇬🇧',
  SGD:'🇸🇬', AED:'🇦🇪', JPY:'🇯🇵', CAD:'🇨🇦', AUD:'🇦🇺', CNY:'🇨🇳'
}
const GRAD: Record<string,string> = {
  INR:'from-orange-500 to-orange-600',
  USD:'from-green-600 to-green-700',
  EUR:'from-blue-600 to-blue-700',
  GBP:'from-purple-600 to-purple-700',
  SGD:'from-red-500 to-red-600',
  AED:'from-yellow-500 to-yellow-600',
  JPY:'from-pink-500 to-pink-600',
  CAD:'from-red-600 to-red-700',
  AUD:'from-teal-500 to-teal-600',
  CNY:'from-red-700 to-red-800',
}
const CURRENCY_NAMES: Record<string,string> = {
  INR:'Indian Rupee', USD:'US Dollar', EUR:'Euro',
  GBP:'British Pound', SGD:'Singapore Dollar', AED:'UAE Dirham',
  JPY:'Japanese Yen', CAD:'Canadian Dollar', AUD:'Australian Dollar', CNY:'Chinese Yuan'
}
const CURRENCIES = ['INR','USD','EUR','GBP','SGD','AED','JPY','CAD','AUD','CNY']

export default function Wallet() {
  const [wallets,   setWallets]  = useState<any[]>([])
  const [loading,   setLoading]  = useState(true)
  const [topupCur,  setTopupCur] = useState('INR')
  const [topupAmt,  setTopupAmt] = useState('')
  const [topping,   setTopping]  = useState(false)
  const [fromCur,   setFromCur]  = useState('INR')
  const [toCur,     setToCur]    = useState('USD')
  const [convAmt,   setConvAmt]  = useState('')
  const [convResult,setConvResult] = useState<any>(null)
  const [conving,   setConving]  = useState(false)

  const load = () => {
    setLoading(true)
    axios.get('/api/v1/wallets')
      .then(r => setWallets(r.data || []))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const topup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!topupAmt || parseFloat(topupAmt) <= 0) return
    setTopping(true)
    try {
      await axios.post('/api/v1/wallets/topup', {
        currency: topupCur,
        amount: parseFloat(topupAmt)
      })
      toast.success(`✅ ${parseFloat(topupAmt).toLocaleString()} ${topupCur} added to your wallet!`)
      setTopupAmt('')
      load()
    } catch(err: any) {
      toast.error(err?.response?.data?.detail || 'Top up failed')
    } finally { setTopping(false) }
  }

  const convert = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!convAmt || parseFloat(convAmt) <= 0) return
    if (fromCur === toCur) { toast.error('Please select different currencies'); return }
    setConving(true)
    setConvResult(null)
    try {
      const res = await axios.post('/api/v1/wallets/convert', {
        from_currency: fromCur,
        to_currency:   toCur,
        amount:        parseFloat(convAmt)
      })
      setConvResult(res.data)
    } catch(err: any) {
      toast.error(err?.response?.data?.detail || 'Conversion failed')
    } finally { setConving(false) }
  }

  const totalInr = wallets.reduce((sum, w) => {
    if (w.currency === 'INR') return sum + parseFloat(w.balance || 0)
    return sum
  }, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Wallets</h1>
        <p className="text-slate-500 text-sm mt-1">
          Your digital money — stored securely, spend anytime across 10 currencies
        </p>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-start gap-3">
        <Info size={16} className="text-blue-500 mt-0.5 flex-shrink-0"/>
        <p className="text-blue-700 text-sm">
          <strong>How it works:</strong> Your wallet holds digital balance — like Paytm or Google Pay.
          Top up from your bank, then use it to send money, pay merchants, or convert to other currencies.
          All payments are deducted from your wallet balance.
        </p>
      </div>

      {/* Wallet cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {loading
          ? [1,2,3].map(i => <div key={i} className="h-32 bg-slate-100 rounded-2xl animate-pulse"/>)
          : wallets.length === 0
            ? <div className="col-span-3 bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
                No wallets yet. Top up to create your first wallet.
              </div>
            : wallets.map(w => (
              <div key={w.id} className={`bg-gradient-to-br ${GRAD[w.currency]||'from-slate-500 to-slate-600'} rounded-2xl p-5 text-white shadow-md`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{FLAG[w.currency]||'💵'}</span>
                    <span className="font-semibold text-sm opacity-90">{w.currency}</span>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/20 capitalize">{w.status}</span>
                </div>
                <div className="text-3xl font-bold">
                  {Number(w.balance).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                </div>
                <div className="text-white/70 text-sm mt-0.5">
                  {CURRENCY_NAMES[w.currency] || w.currency} Balance
                </div>
              </div>
            ))
        }
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Top Up Wallet */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 bg-green-100 rounded-xl flex items-center justify-center">
              <Plus size={16} className="text-green-600"/>
            </div>
            <h2 className="font-semibold text-slate-800">Top Up Wallet</h2>
          </div>
          <p className="text-slate-400 text-xs mb-4 ml-10">
            Add funds from your bank account to your digital wallet
          </p>
          <form onSubmit={topup} className="space-y-3">
            <select
              value={topupCur}
              onChange={e => setTopupCur(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400">
              {CURRENCIES.map(c => (
                <option key={c} value={c}>
                  {FLAG[c]} {c} — {CURRENCY_NAMES[c]}
                </option>
              ))}
            </select>
            <input
              type="number"
              required
              value={topupAmt}
              onChange={e => setTopupAmt(e.target.value)}
              placeholder={`Amount in ${topupCur} (e.g. 1000)`}
              min="0.01"
              step="0.01"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            />
            <button
              type="submit"
              disabled={topping || !topupAmt}
              className="w-full bg-green-600 hover:bg-green-500 text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
              {topping ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14}/>}
              Top Up Wallet
            </button>
          </form>
          <p className="text-xs text-slate-400 mt-3 text-center">
            💡 Sandbox mode — no real bank debit occurs
          </p>
        </div>

        {/* Currency Converter */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center">
              <ArrowLeftRight size={16} className="text-blue-600"/>
            </div>
            <h2 className="font-semibold text-slate-800">Currency Converter</h2>
          </div>
          <p className="text-slate-400 text-xs mb-4 ml-10">
            Live exchange rates — powered by open.er-api.com (updated hourly)
          </p>
          <form onSubmit={convert} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={fromCur}
                onChange={e => setFromCur(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {CURRENCIES.map(c => <option key={c} value={c}>{FLAG[c]} {c}</option>)}
              </select>
              <select
                value={toCur}
                onChange={e => { setToCur(e.target.value); setConvResult(null) }}
                className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {CURRENCIES.map(c => <option key={c} value={c}>{FLAG[c]} {c}</option>)}
              </select>
            </div>
            <input
              type="number"
              required
              value={convAmt}
              onChange={e => { setConvAmt(e.target.value); setConvResult(null) }}
              placeholder={`Amount in ${fromCur} (e.g. 10000)`}
              min="0.01"
              step="0.01"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            <button
              type="submit"
              disabled={conving || !convAmt}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60 transition-colors">
              {conving ? <Loader2 size={14} className="animate-spin"/> : <ArrowLeftRight size={14}/>}
              {conving ? 'Fetching live rate...' : 'Convert'}
            </button>
          </form>

          {/* Conversion result */}
          {convResult && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="text-center">
                <div className="text-sm text-slate-500 mb-1">
                  {parseFloat(convAmt).toLocaleString()} {fromCur} =
                </div>
                <div className="text-2xl font-bold text-blue-700">
                  {convResult.converted_amount?.toLocaleString('en-IN', { maximumFractionDigits: 4 })} {convResult.to_currency}
                </div>
                <div className="text-blue-500 text-xs mt-1">
                  1 {convResult.from_currency} = {convResult.fx_rate?.toFixed(6)} {convResult.to_currency}
                </div>
                <div className="text-slate-400 text-xs mt-0.5">
                  {FLAG[fromCur]} {convResult.from_currency} → {FLAG[toCur]} {convResult.to_currency}
                  {convResult.rate_source === 'live' ? ' · 🟢 Live rate' : ' · Fallback rate'}
                </div>
              </div>
            </div>
          )}

          {!convResult && !conving && (
            <p className="text-xs text-slate-400 mt-3 text-center">
              💡 Try: 10,000 INR → USD to see today's live rate
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
