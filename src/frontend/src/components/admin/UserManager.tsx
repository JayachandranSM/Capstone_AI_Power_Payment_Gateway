import { useEffect, useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import {
  Users, Search, ChevronDown, ChevronUp,
  UserCheck, UserX, Shield, AlertTriangle, Eye
} from 'lucide-react'

const ROLE_COLOR: Record<string,string> = {
  admin:    'bg-red-100 text-red-700',
  merchant: 'bg-emerald-100 text-emerald-700',
  customer: 'bg-blue-100 text-blue-700',
}
const KYC_COLOR: Record<string,string> = {
  verified: 'bg-green-100 text-green-700',
  pending:  'bg-yellow-100 text-yellow-700',
  failed:   'bg-red-100 text-red-700',
  expired:  'bg-orange-100 text-orange-700',
}

export default function UserManager() {
  const [users,    setUsers]    = useState<any[]>([])
  const [loading,  setLoading]  = useState(true)
  const [role,     setRole]     = useState('')
  const [search,   setSearch]   = useState('')
  const [expanded, setExpanded] = useState<string|null>(null)
  const [summary,  setSummary]  = useState<Record<string,any>>({})
  const [summLoad, setSummLoad] = useState<string|null>(null)

  const fetchUsers = async () => {
    setLoading(true)
    const params = role ? `?role=${role}&size=50` : '?size=50'
    try {
      const r = await axios.get(`/api/v1/admin/users${params}`)
      setUsers(r.data || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchUsers() }, [role])

  const toggleStatus = async (user: any) => {
    try {
      const r = await axios.patch(`/api/v1/admin/users/${user.id}/toggle-status`)
      toast.success(r.data.message)
      setUsers(u => u.map(x => x.id === user.id
        ? { ...x, is_active: r.data.is_active } : x))
    } catch { toast.error('Failed to update status') }
  }

  const updateKyc = async (userId: string, kyc_status: string) => {
    try {
      await axios.patch(`/api/v1/admin/users/${userId}/kyc`, { kyc_status })
      toast.success(`KYC updated to ${kyc_status}`)
      setUsers(u => u.map(x => x.id === userId ? { ...x, kyc_status } : x))
    } catch { toast.error('Failed to update KYC') }
  }

  const loadSummary = async (userId: string) => {
    if (summary[userId]) {
      setExpanded(expanded === userId ? null : userId)
      return
    }
    setSummLoad(userId)
    try {
      const r = await axios.get(`/api/v1/admin/users/${userId}/summary`)
      setSummary(prev => ({ ...prev, [userId]: r.data }))
      setExpanded(userId)
    } catch { toast.error('Failed to load summary') }
    finally { setSummLoad(null) }
  }

  const filtered = users.filter(u =>
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.country_code?.toLowerCase().includes(search.toLowerCase())
  )

  // Stats
  const stats = {
    total:    users.length,
    active:   users.filter(u => u.is_active).length,
    verified: users.filter(u => u.kyc_status === 'verified').length,
    flagged:  users.filter(u => u.kyc_status !== 'verified').length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="text-slate-500 text-sm mt-1">
            Manage accounts, KYC status, and access control
          </p>
        </div>
        <div className="flex gap-2">
          {['','customer','merchant','admin'].map(r => (
            <button key={r} onClick={() => setRole(r)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                role === r
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}>
              {r || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Users',    value: stats.total,    color: 'bg-blue-100 text-blue-600' },
          { label: 'Active',         value: stats.active,   color: 'bg-green-100 text-green-600' },
          { label: 'KYC Verified',   value: stats.verified, color: 'bg-emerald-100 text-emerald-600' },
          { label: 'Needs Attention',value: stats.flagged,  color: 'bg-yellow-100 text-yellow-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-slate-100 p-4">
            <div className={`text-2xl font-bold ${s.color.split(' ')[1]}`}>{s.value}</div>
            <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-3.5 text-slate-400"/>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, email, country..."
          className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"/>
      </div>

      {/* User Table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                {['User','Role','KYC Status','Country','Joined','Account','Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-slate-500 font-semibold uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? Array.from({length:5}).map((_,i) => (
                <tr key={i}>{Array.from({length:7}).map((_,j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 bg-slate-100 rounded animate-pulse"/>
                  </td>
                ))}</tr>
              )) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    No users found
                  </td>
                </tr>
              ) : filtered.map(u => (
                <>
                  <tr key={u.id} className={`hover:bg-slate-50 ${!u.is_active ? 'opacity-60' : ''}`}>
                    {/* User */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                          {u.full_name?.[0]}
                        </div>
                        <div>
                          <div className="font-medium text-slate-800">{u.full_name}</div>
                          <div className="text-xs text-slate-400">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    {/* Role */}
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLOR[u.role]||'bg-slate-100 text-slate-600'}`}>
                        {u.role}
                      </span>
                    </td>
                    {/* KYC */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${KYC_COLOR[u.kyc_status]||'bg-slate-100 text-slate-600'}`}>
                          {u.kyc_status}
                        </span>
                        {u.kyc_status !== 'verified' && (
                          <button
                            onClick={() => updateKyc(u.id, 'verified')}
                            className="text-[10px] bg-green-50 border border-green-200 text-green-700 px-1.5 py-0.5 rounded hover:bg-green-100"
                            title="Mark as verified">
                            Verify ✓
                          </button>
                        )}
                        {u.kyc_status === 'verified' && (
                          <button
                            onClick={() => updateKyc(u.id, 'pending')}
                            className="text-[10px] bg-yellow-50 border border-yellow-200 text-yellow-700 px-1.5 py-0.5 rounded hover:bg-yellow-100"
                            title="Reset to pending">
                            Reset
                          </button>
                        )}
                      </div>
                    </td>
                    {/* Country */}
                    <td className="px-4 py-3 text-sm text-slate-500">{u.country_code}</td>
                    {/* Joined */}
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {new Date(u.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {u.is_active ? '● Active' : '○ Inactive'}
                      </span>
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => toggleStatus(u)}
                          title={u.is_active ? 'Deactivate' : 'Activate'}
                          className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 ${
                            u.is_active
                              ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                              : 'bg-green-50 border-green-200 text-green-600 hover:bg-green-100'
                          }`}>
                          {u.is_active ? <UserX size={12}/> : <UserCheck size={12}/>}
                          {u.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => loadSummary(u.id)}
                          className="p-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center gap-1 text-xs">
                          {summLoad === u.id
                            ? <span className="text-[10px]">...</span>
                            : <Eye size={12}/>}
                          View
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded summary row */}
                  {expanded === u.id && summary[u.id] && (
                    <tr key={`${u.id}-detail`}>
                      <td colSpan={7} className="px-4 py-4 bg-slate-50 border-t border-slate-100">
                        <div className="grid grid-cols-4 gap-4">
                          {/* Wallet balances */}
                          <div className="bg-white rounded-xl p-3 border border-slate-100">
                            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Wallets</div>
                            {summary[u.id].wallets?.length === 0
                              ? <div className="text-xs text-slate-400">No wallets</div>
                              : summary[u.id].wallets?.map((w:any) => (
                                <div key={w.id} className="flex justify-between text-xs py-0.5">
                                  <span className="text-slate-500">{w.currency}</span>
                                  <span className="font-semibold text-slate-800">{Number(w.balance).toLocaleString()}</span>
                                </div>
                              ))
                            }
                          </div>

                          {/* TX Stats */}
                          <div className="bg-white rounded-xl p-3 border border-slate-100">
                            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Transaction Stats</div>
                            {[
                              { label: 'Total',   value: summary[u.id].tx_stats?.total || 0 },
                              { label: 'Volume',  value: `$${parseFloat(summary[u.id].tx_stats?.volume_usd||0).toFixed(0)}` },
                              { label: 'Failed',  value: summary[u.id].tx_stats?.failed || 0 },
                              { label: 'Avg Risk',value: `${(parseFloat(summary[u.id].tx_stats?.avg_fraud||0)*100).toFixed(0)}%` },
                            ].map(s => (
                              <div key={s.label} className="flex justify-between text-xs py-0.5">
                                <span className="text-slate-500">{s.label}</span>
                                <span className="font-semibold text-slate-800">{s.value}</span>
                              </div>
                            ))}
                          </div>

                          {/* UPI + Disputes */}
                          <div className="bg-white rounded-xl p-3 border border-slate-100">
                            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Account Info</div>
                            <div className="flex justify-between text-xs py-0.5">
                              <span className="text-slate-500">UPI Handle</span>
                              <span className="font-mono text-slate-800">{summary[u.id].upi_handle || '—'}</span>
                            </div>
                            <div className="flex justify-between text-xs py-0.5">
                              <span className="text-slate-500">Disputes</span>
                              <span className="font-semibold text-slate-800">{summary[u.id].disputes?.total || 0}</span>
                            </div>
                            <div className="flex justify-between text-xs py-0.5">
                              <span className="text-slate-500">MFA</span>
                              <span className={summary[u.id].user?.mfa_enabled ? 'text-green-600 font-semibold' : 'text-slate-400'}>
                                {summary[u.id].user?.mfa_enabled ? '✓ Enabled' : 'Disabled'}
                              </span>
                            </div>
                          </div>

                          {/* Quick KYC actions */}
                          <div className="bg-white rounded-xl p-3 border border-slate-100">
                            <div className="text-xs font-semibold text-slate-500 uppercase mb-2">KYC Actions</div>
                            <div className="space-y-1.5">
                              {['verified','pending','failed','expired'].map(status => (
                                <button key={status}
                                  onClick={() => updateKyc(u.id, status)}
                                  className={`w-full text-left text-xs px-2 py-1.5 rounded-lg border transition-colors ${
                                    u.kyc_status === status
                                      ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
                                      : 'border-slate-200 hover:bg-slate-50 text-slate-600'
                                  }`}>
                                  {u.kyc_status === status ? '● ' : '○ '}{status}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && !loading && (
          <div className="p-12 text-center">
            <Users size={32} className="text-slate-300 mx-auto mb-3"/>
            <div className="text-slate-400">No users found</div>
          </div>
        )}
      </div>
    </div>
  )
}
