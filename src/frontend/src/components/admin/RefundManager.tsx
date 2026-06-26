import { useEffect, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { RefreshCw, CheckCircle, XCircle, ChevronDown, ChevronUp } from 'lucide-react'

const STATUS_COLOR: Record<string,string> = {
  requested: 'bg-yellow-100 text-yellow-700',
  approved:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-700',
  processing:'bg-blue-100 text-blue-700',
}

export default function RefundManager() {
  const [refunds,  setRefunds]  = useState<any[]>([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('requested')
  const [expanded, setExpanded] = useState<string|null>(null)
  const [rejectId, setRejectId] = useState<string|null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [acting,   setActing]   = useState<string|null>(null)

  const load = async (status = filter) => {
    setLoading(true)
    try {
      const r = await axios.get(`/api/v1/refunds?status=${status}&size=50`)
      const data = r.data; setRefunds(Array.isArray(data) ? data : data?.items || [])
    } catch { toast.error('Failed to load refunds') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [filter])

  const approve = async (id: string) => {
    setActing(id)
    try {
      await axios.patch(`/api/v1/refunds/${id}/approve`, { action: 'approve' })
      toast.success('✅ Refund approved — amount credited to customer wallet')
      setRefunds(r => r.filter(x => x.id !== id))
    } catch(e: any) {
      toast.error(e?.response?.data?.detail || 'Approval failed')
    } finally { setActing(null) }
  }

  const reject = async (id: string) => {
    if (!rejectReason.trim()) { toast.error('Please enter rejection reason'); return }
    setActing(id)
    try {
      await axios.patch(`/api/v1/refunds/${id}/reject`, { rejection_reason: rejectReason })
      toast.success('Refund rejected')
      setRefunds(r => r.filter(x => x.id !== id))
      setRejectId(null)
      setRejectReason('')
    } catch(e: any) {
      toast.error(e?.response?.data?.detail || 'Rejection failed')
    } finally { setActing(null) }
  }

  // Stats
  const stats = {
    requested:  refunds.filter(r => r.status === 'requested').length,
    approved:   refunds.filter(r => r.status === 'approved').length,
    rejected:   refunds.filter(r => r.status === 'rejected').length,
    total_amount: refunds.reduce((s, r) => s + parseFloat(r.amount || 0), 0),
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Refund Manager</h1>
          <p className="text-slate-500 text-sm mt-1">
            Review and approve/reject customer refund requests
          </p>
        </div>
        <button onClick={() => load()}
          className="flex items-center gap-2 border border-slate-200 text-slate-600 px-3 py-2 rounded-xl text-sm hover:bg-slate-50">
          <RefreshCw size={14}/> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Pending Review', value: stats.requested, color: 'text-yellow-600', bg: 'bg-yellow-50' },
          { label: 'Approved',       value: stats.approved,  color: 'text-green-600',  bg: 'bg-green-50'  },
          { label: 'Rejected',       value: stats.rejected,  color: 'text-red-600',    bg: 'bg-red-50'    },
          { label: 'Total Amount',   value: `₹${stats.total_amount.toLocaleString('en-IN')}`, color: 'text-blue-600', bg: 'bg-blue-50' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-2xl p-4`}>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {['requested','approved','rejected','all'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === s
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}>
            {s === 'requested' ? '⏳ Pending' :
             s === 'approved'  ? '✅ Approved' :
             s === 'rejected'  ? '❌ Rejected' : '📋 All'}
          </button>
        ))}
      </div>

      {/* Refund list */}
      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-slate-100 rounded-2xl animate-pulse"/>)}
        </div>
      ) : refunds.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
          <div className="text-3xl mb-2">📭</div>
          <div className="text-slate-500 font-medium">No {filter} refunds</div>
          <div className="text-slate-400 text-sm mt-1">
            {filter === 'requested' ? 'All caught up! No pending refunds.' : `No ${filter} refunds found.`}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {refunds.map(r => (
            <div key={r.id} className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              {/* Main row */}
              <div className="p-4 flex items-center gap-4">
                {/* Amount */}
                <div className="text-center min-w-[80px]">
                  <div className="text-xl font-bold text-slate-800">
                    ₹{parseFloat(r.amount).toLocaleString('en-IN')}
                  </div>
                  <div className="text-xs text-slate-400">{r.currency}</div>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 truncate">
                    {r.reason}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    TX: {r.original_tx_id?.slice(0,8).toUpperCase()} ·
                    Requested: {new Date(r.created_at).toLocaleDateString('en-IN', {
                      day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'
                    })}
                  </div>
                  {r.rejection_reason && (
                    <div className="text-xs text-red-500 mt-0.5">
                      Rejection reason: {r.rejection_reason}
                    </div>
                  )}
                </div>

                {/* Status */}
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${STATUS_COLOR[r.status] || 'bg-slate-100 text-slate-600'}`}>
                  {r.status.toUpperCase()}
                </span>

                {/* Actions */}
                {r.status === 'requested' && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => approve(r.id)}
                      disabled={acting === r.id}
                      className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-xl text-xs font-medium disabled:opacity-60 transition-colors">
                      <CheckCircle size={12}/>
                      Approve
                    </button>
                    <button
                      onClick={() => setRejectId(rejectId === r.id ? null : r.id)}
                      className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors">
                      <XCircle size={12}/>
                      Reject
                    </button>
                  </div>
                )}

                <button onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-50 flex-shrink-0">
                  {expanded === r.id ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
                </button>
              </div>

              {/* Reject reason input */}
              {rejectId === r.id && (
                <div className="px-4 pb-4 border-t border-slate-100 bg-red-50">
                  <div className="pt-3">
                    <label className="text-xs font-semibold text-red-700 mb-1.5 block">
                      Rejection Reason (required)
                    </label>
                    <select
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      className="w-full border border-red-200 rounded-xl px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-red-300 bg-white">
                      <option value="">Select reason...</option>
                      <option value="Changed mind is not eligible for refund">Changed mind — not eligible</option>
                      <option value="Transaction is under fraud investigation">Under fraud investigation</option>
                      <option value="Merchant confirms amount is correct">Merchant confirms amount is correct</option>
                      <option value="Refund window of 7 days has expired">Refund window expired (over 7 days)</option>
                      <option value="Duplicate refund request">Duplicate refund request</option>
                      <option value="Insufficient supporting evidence">Insufficient supporting evidence</option>
                      <option value="Custom">Custom reason...</option>
                    </select>
                    {rejectReason === 'Custom' && (
                      <input
                        type="text"
                        placeholder="Enter custom rejection reason..."
                        onChange={e => setRejectReason(e.target.value)}
                        className="w-full border border-red-200 rounded-xl px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-red-300"/>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => reject(r.id)}
                        disabled={acting === r.id || !rejectReason}
                        className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-60 transition-colors">
                        Confirm Rejection
                      </button>
                      <button
                        onClick={() => { setRejectId(null); setRejectReason('') }}
                        className="px-4 border border-slate-200 text-slate-600 py-2 rounded-xl text-sm hover:bg-slate-50">
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Expanded detail */}
              {expanded === r.id && (
                <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <div className="text-slate-400 mb-0.5">Refund ID</div>
                      <div className="font-mono text-slate-700">{r.id?.slice(0,16).toUpperCase()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 mb-0.5">Original Transaction</div>
                      <div className="font-mono text-slate-700">{r.original_tx_id?.slice(0,16).toUpperCase()}</div>
                    </div>
                    <div>
                      <div className="text-slate-400 mb-0.5">Approved By</div>
                      <div className="text-slate-700">{r.approved_by ? 'Sara Chen (Admin)' : '—'}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
