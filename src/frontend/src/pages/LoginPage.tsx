import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import toast from 'react-hot-toast'
import { Shield, Eye, EyeOff, Loader2 } from 'lucide-react'

const DEMOS = [
  { label: 'Priya Sharma',  sub: '🇮🇳 Customer · UPI · INR',  email: 'priya@example.com',  pw: 'Admin@123' },
  { label: 'Carlos Mendez', sub: '🇺🇸 Customer · Card · USD', email: 'carlos@example.com', pw: 'Admin@123' },
  { label: 'Raj Patel',     sub: '🏪 Merchant · Raj Electronics', email: 'raj@merchant.com', pw: 'Admin@123' },
  { label: 'Sara Chen',     sub: '🛡️ Admin · Singapore',     email: 'sara@paygw.com',     pw: 'Admin@123' },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, isLoading } = useAuthStore()
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [totpCode,  setTotpCode]  = useState('')
  const [showPw,    setShowPw]    = useState(false)
  const [mfaNeeded, setMfaNeeded] = useState(false)

  const doLogin = async (e: string, p: string, t?: string) => {
    try {
      await login(e, p, t)
      const role = useAuthStore.getState().role
      toast.success('Welcome back!')
      navigate(role === 'merchant' ? '/merchant' : role === 'admin' ? '/admin' : '/customer')
    } catch (err: any) {
      if (err?.response?.headers?.['x-mfa-required']) {
        setMfaNeeded(true)
        toast('Enter your MFA code', { icon: '🔐' })
      } else {
        toast.error(err?.response?.data?.detail || 'Login failed')
      }
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4 shadow-lg shadow-blue-600/30">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">PayGateway</h1>
          <p className="text-blue-300 mt-1 text-sm">AI-Powered Payment Platform</p>
        </div>

        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-8 shadow-2xl">
          <form onSubmit={e => { e.preventDefault(); doLogin(email, password, totpCode || undefined) }}
                className="space-y-4">
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full bg-white/10 border border-white/20 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 placeholder-slate-500"
                placeholder="you@example.com" />
            </div>
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} required value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 pr-10 placeholder-slate-500"
                  placeholder="••••••••" />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-3.5 text-slate-400 hover:text-white">
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {mfaNeeded && (
              <div>
                <label className="text-sm text-yellow-300 mb-1 block">🔐 MFA Code</label>
                <input type="text" value={totpCode} maxLength={6}
                  onChange={e => setTotpCode(e.target.value)}
                  className="w-full bg-white/10 border border-yellow-400/50 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-yellow-400 tracking-[0.5em] text-center text-xl"
                  placeholder="000000" />
              </div>
            )}
            <button type="submit" disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold rounded-xl py-3 transition-colors flex items-center justify-center gap-2">
              {isLoading ? <><Loader2 className="animate-spin" size={16} />Signing in...</> : 'Sign In'}
            </button>
          </form>
          <p className="text-center text-sm text-slate-400 mt-4">
            No account? <Link to="/signup" className="text-blue-400 hover:underline">Sign up</Link>
          </p>
        </div>

        <div className="mt-6">
          <p className="text-center text-xs text-slate-500 mb-3 uppercase tracking-wider">
            ⚡ Demo — one click login
          </p>
          <div className="grid grid-cols-2 gap-2">
            {DEMOS.map(d => (
              <button key={d.email} onClick={() => doLogin(d.email, d.pw)}
                className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-3 py-2.5 text-left transition-colors">
                <div className="text-white text-xs font-semibold">{d.label}</div>
                <div className="text-slate-400 text-[10px] mt-0.5">{d.sub}</div>
              </button>
            ))}
          </div>
          <p className="text-center text-[10px] text-slate-600 mt-2">All passwords: Admin@123</p>
        </div>
      </div>
    </div>
  )
}
