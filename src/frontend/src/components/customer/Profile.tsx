import { useState } from 'react'
import axios from 'axios'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store/authStore'
import { Shield, Key, CheckCircle } from 'lucide-react'

export default function CustomerProfile() {
  const { user, fetchMe } = useAuthStore()
  const [mfaData, setMfaData] = useState<any>(null)
  const [totp, setTotp] = useState('')

  const setupMfa = async () => {
    try { const r = await axios.post('/api/v1/auth/mfa/setup'); setMfaData(r.data) }
    catch(e:any) { toast.error(e?.response?.data?.detail||'MFA setup failed') }
  }
  const verifyMfa = async () => {
    try { await axios.post('/api/v1/auth/mfa/verify',{totp_code:totp}); toast.success('MFA enabled!'); setMfaData(null); setTotp(''); fetchMe() }
    catch(e:any) { toast.error(e?.response?.data?.detail||'Invalid code') }
  }

  if (!user) return null
  return (
    <div className="max-w-2xl space-y-6">
      <div><h1 className="text-2xl font-bold text-slate-900">Profile</h1></div>
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-purple-500 rounded-2xl flex items-center justify-center text-white text-2xl font-bold">{user.full_name?.[0]}</div>
          <div>
            <div className="text-xl font-bold text-slate-900">{user.full_name}</div>
            <div className="text-slate-500 text-sm">{user.email}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full capitalize">{user.role}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${user.kyc_status==='verified'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-700'}`}>KYC: {user.kyc_status}</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          {[
            {label:'Country',value:user.country_code},
            {label:'Currency',value:user.preferred_currency},
            {label:'Phone',value:user.phone||'—'},
            {label:'Member since',value:new Date(user.created_at).toLocaleDateString('en-IN',{month:'long',year:'numeric'})},
          ].map(r=>(
            <div key={r.label} className="bg-slate-50 rounded-xl p-3">
              <div className="text-xs text-slate-400 mb-0.5">{r.label}</div>
              <div className="font-medium text-slate-800">{r.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <div className="flex items-center gap-2 mb-4"><Shield size={18} className="text-blue-600"/><h2 className="font-semibold text-slate-800">Security</h2></div>
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl mb-4">
          <div className="flex items-center gap-3"><Key size={16} className="text-slate-500"/>
            <div><div className="text-sm font-medium text-slate-800">Two-Factor Authentication</div><div className="text-xs text-slate-400">TOTP via authenticator app</div></div>
          </div>
          {user.mfa_enabled
            ? <div className="flex items-center gap-1.5 text-green-600 text-sm font-medium"><CheckCircle size={16}/>Enabled</div>
            : <button onClick={setupMfa} className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-500 font-medium">Enable MFA</button>
          }
        </div>
        {mfaData && (
          <div className="border border-blue-200 bg-blue-50 rounded-xl p-4 space-y-3">
            <div className="text-sm font-semibold text-slate-800">Scan with your authenticator app</div>
            <div className="bg-white rounded-xl p-3 font-mono text-xs text-slate-600 break-all">{mfaData.qr_uri}</div>
            <div className="text-xs text-slate-500">Secret: <span className="font-mono font-bold">{mfaData.secret}</span></div>
            <div className="grid grid-cols-4 gap-1">
              {mfaData.backup_codes?.map((c:string)=>(
                <div key={c} className="bg-white rounded-lg px-2 py-1 font-mono text-[10px] text-center border border-slate-200">{c}</div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={totp} onChange={e=>setTotp(e.target.value)} maxLength={6} placeholder="000000"
                className="flex-1 border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none tracking-widest text-center"/>
              <button onClick={verifyMfa} disabled={totp.length!==6} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50">Verify</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
