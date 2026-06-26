import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Mail, ArrowLeft, KeyRound, Eye, EyeOff } from 'lucide-react'

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step,       setStep]       = useState<'email'|'reset'>('email')
  const [email,      setEmail]      = useState('')
  const [token,      setToken]      = useState('')
  const [password,   setPassword]   = useState('')
  const [confirm,    setConfirm]    = useState('')
  const [showPw,     setShowPw]     = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [resetToken, setResetToken] = useState('')

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const r = await axios.post('/api/v1/auth/forgot-password', { email })
      // In sandbox mode, token is returned directly
      const t = r.data.reset_token || r.data.token || ''
      setResetToken(t)
      toast.success('Reset token generated!')
      setStep('reset')
    } catch(err: any) {
      toast.error(err?.response?.data?.detail || 'Email not found')
    } finally { setLoading(false) }
  }

  const resetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { toast.error('Passwords do not match'); return }
    if (password.length < 8)  { toast.error('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await axios.post('/api/v1/auth/reset-password', {
        reset_token:  token || resetToken,
        new_password: password,
      })
      toast.success('Password reset successfully!')
      setTimeout(() => navigate('/login'), 1500)
    } catch(err: any) {
      toast.error(err?.response?.data?.detail || 'Reset failed — check token')
    } finally { setLoading(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <KeyRound size={28} className="text-white"/>
          </div>
          <h1 className="text-3xl font-bold text-white">Reset Password</h1>
          <p className="text-blue-300 mt-1">PayGateway — AI-Powered Payment Platform</p>
        </div>

        <div className="bg-slate-800/60 backdrop-blur rounded-2xl p-8 border border-slate-700/50 shadow-xl">
          {step === 'email' ? (
            <>
              <h2 className="text-white font-semibold text-lg mb-1">Forgot your password?</h2>
              <p className="text-slate-400 text-sm mb-6">Enter your email and we'll generate a reset token.</p>
              <form onSubmit={requestReset} className="space-y-4">
                <div>
                  <label className="text-slate-300 text-sm font-medium block mb-1.5">Email Address</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-3.5 text-slate-400"/>
                    <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className="w-full bg-slate-700/50 border border-slate-600 text-white rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"/>
                  </div>
                </div>
                <button type="submit" disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-semibold text-sm transition-colors disabled:opacity-60">
                  {loading ? 'Sending...' : 'Get Reset Token'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-white font-semibold text-lg mb-1">Set New Password</h2>
              <p className="text-slate-400 text-sm mb-4">Enter the reset token and your new password.</p>

              {/* Show token for sandbox */}
              {resetToken && (
                <div className="bg-green-900/30 border border-green-500/30 rounded-xl p-3 mb-4">
                  <p className="text-green-400 text-xs font-semibold mb-1">🔑 Reset Token (Sandbox Mode)</p>
                  <p className="text-green-300 text-xs font-mono break-all">{resetToken}</p>
                  <p className="text-green-500 text-xs mt-1">In production this would be emailed to you</p>
                </div>
              )}

              <form onSubmit={resetPassword} className="space-y-4">
                <div>
                  <label className="text-slate-300 text-sm font-medium block mb-1.5">Reset Token</label>
                  <input type="text" required value={token || resetToken}
                    onChange={e => setToken(e.target.value)}
                    placeholder="Paste reset token here"
                    className="w-full bg-slate-700/50 border border-slate-600 text-white rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"/>
                </div>
                <div>
                  <label className="text-slate-300 text-sm font-medium block mb-1.5">New Password</label>
                  <div className="relative">
                    <input type={showPw ? 'text' : 'password'} required value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Min 8 chars, 1 uppercase, 1 digit"
                      className="w-full bg-slate-700/50 border border-slate-600 text-white rounded-xl px-4 py-3 pr-10 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"/>
                    <button type="button" onClick={() => setShowPw(!showPw)}
                      className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-300">
                      {showPw ? <EyeOff size={16}/> : <Eye size={16}/>}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-slate-300 text-sm font-medium block mb-1.5">Confirm Password</label>
                  <input type="password" required value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Repeat new password"
                    className="w-full bg-slate-700/50 border border-slate-600 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"/>
                </div>
                <button type="submit" disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl font-semibold text-sm transition-colors disabled:opacity-60">
                  {loading ? 'Resetting...' : 'Reset Password'}
                </button>
              </form>
            </>
          )}

          <button onClick={() => navigate('/login')}
            className="flex items-center gap-2 text-slate-400 hover:text-slate-300 text-sm mt-6 mx-auto w-fit transition-colors">
            <ArrowLeft size={14}/> Back to Sign In
          </button>
        </div>

        <p className="text-center text-slate-600 text-xs mt-6">
          All passwords: Admin@123 · Sandbox Mode
        </p>
      </div>
    </div>
  )
}
