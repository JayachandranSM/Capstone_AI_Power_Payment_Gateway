import { useEffect, useState } from 'react'
import axios from 'axios'
import { Users } from 'lucide-react'

export default function UserManager() {
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoad] = useState(true)
  const [role, setRole] = useState('')

  useEffect(()=>{
    const params = role?`?role=${role}&size=50`:'?size=50'
    axios.get(`/api/v1/admin/users${params}`).then(r=>setUsers(r.data||[])).finally(()=>setLoad(false))
  },[role])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">User Manager</h1><p className="text-slate-500 text-sm mt-1">{users.length} users</p></div>
        <div className="flex gap-2">
          {['','customer','merchant','admin'].map(r=>(
            <button key={r} onClick={()=>setRole(r)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${role===r?'bg-slate-800 text-white border-slate-800':'bg-white text-slate-600 border-slate-200'}`}>
              {r||'All'}
            </button>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>{['User','Role','KYC','Country','Joined','Status'].map(h=><th key={h} className="text-left px-4 py-3 text-xs text-slate-500 font-semibold uppercase">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading?Array.from({length:6}).map((_,i)=><tr key={i}>{Array.from({length:6}).map((_,j)=><td key={j} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse"/></td>)}</tr>):
               users.map((u:any)=>(
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-xs font-bold">{u.full_name?.[0]}</div>
                      <div><div className="font-medium text-slate-800">{u.full_name}</div><div className="text-xs text-slate-400">{u.email}</div></div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.role==='admin'?'bg-red-100 text-red-700':u.role==='merchant'?'bg-emerald-100 text-emerald-700':'bg-blue-100 text-blue-700'}`}>{u.role}</span></td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${u.kyc_status==='verified'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-700'}`}>{u.kyc_status}</span></td>
                  <td className="px-4 py-3 text-sm text-slate-500">{u.country_code}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{new Date(u.created_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</td>
                  <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}`}>{u.is_active?'Active':'Inactive'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {users.length===0&&!loading&&<div className="p-12 text-center"><Users size={32} className="text-slate-300 mx-auto mb-3"/><div className="text-slate-400">No users found</div></div>}
      </div>
    </div>
  )
}
