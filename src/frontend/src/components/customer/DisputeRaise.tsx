import { useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { AlertTriangle, X, Loader2 } from 'lucide-react'

const REASONS = [
  "Merchant charged wrong amount",
  "Item/service not delivered",
  "Duplicate charge",
  "Unauthorized transaction",
  "Refund not received",
  "Fraudulent merchant",
  "Other",
]

interface Props {
  transaction: any
  onClose: () => void
  onSuccess: () => void
}

export default function DisputeRaise({ transaction, onClose, onSuccess }: Props) {
  const [reason,   setReason]   = useState('')
  const [custom,   setCustom]   = useState('')
  const [loading,  setLoading]  = useState(false)

  const submit = async () => {
    const finalReason = reason === 'Other' ? custom : reason
    if (!finalReason) { toast.error('Please select a reason'); return }
    setLoading(true)
    try {
      await axios.post('/api/v1/disputes', {
        transaction_id: transaction.id,
        reason: finalReason,
      })
      toast.success('✅ Dispute raised — admin will review within 24 hours')
      onSuccess()
      onClose()
    } catch(e: any) {
      toast.error(e?.response?.data?.detail || 'Failed to raise dispute')
    } finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-orange-500"/>
            <h2 className="font-bold text-slate-800">Raise Dispute</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
            <X size={16}/>
          </button>
        </div>

        {/* Transaction summary */}
        <div className="bg-slate-50 rounded-xl p-3 mb-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Amount</span>
            <span className="font-semibold">{transaction.amount} {transaction.currency}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-slate-500">To</span>
            <span>{transaction.upi_handle_receiver || 'Merchant'}</span>
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-slate-500">Date</span>
            <span>{new Date(transaction.created_at).toLocaleDateString('en-IN')}</span>
          </div>
        </div>

        {/* Reason selection */}
        <div className="mb-4">
          <label className="text-sm font-medium text-slate-700 mb-2 block">Reason for dispute</label>
          <div className="space-y-2">
            {REASONS.map(r => (
              <button key={r} onClick={() => setReason(r)}
                className={`w-full text-left text-sm px-3 py-2.5 rounded-xl border transition-colors ${
                  reason === r
                    ? 'border-orange-400 bg-orange-50 text-orange-700'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}>
                {reason === r ? '● ' : '○ '}{r}
              </button>
            ))}
          </div>
          {reason === 'Other' && (
            <textarea
              value={custom}
              onChange={e => setCustom(e.target.value)}
              placeholder="Describe your issue..."
              rows={3}
              className="mt-2 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm">
            Cancel
          </button>
          <button onClick={submit} disabled={loading || !reason}
            className="flex-1 bg-orange-500 hover:bg-orange-400 text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? <Loader2 size={14} className="animate-spin"/> : <AlertTriangle size={14}/>}
            Raise Dispute
          </button>
        </div>

        <p className="text-xs text-slate-400 text-center mt-3">
          AI agent will automatically analyze your dispute and recommend resolution
        </p>
      </div>
    </div>
  )
}
