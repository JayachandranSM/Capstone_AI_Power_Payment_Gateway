import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Shield, Loader2 } from 'lucide-react'

export default function SignupPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    full_name: '', email: '', password: '',
    country_code: 'IN', preferred_currency: 'INR',
  })
  const [loading, setLoading] = useState(false)

  const u = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await axios.post('/api/v1/auth/signup', form)
      toast.success('Account created! Please sign in.')
      navigate('/login')
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Signup failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Create Account</h1>
          <p className="text-blue-300 mt-1 text-sm">Join PayGateway today</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Full Name</label>
              <input
                required value={form.full_name}
                onChange={e => u('full_name', e.target.value)}
                className="w-full bg-white/10 border border-white/20 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 placeholder-slate-500"
                placeholder="Priya Sharma"
              />
            </div>
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Email</label>
              <input
                required type="email" value={form.email}
                onChange={e => u('email', e.target.value)}
                className="w-full bg-white/10 border border-white/20 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 placeholder-slate-500"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="text-sm text-slate-300 mb-1 block">Password</label>
              <input
                required type="password" value={form.password}
                onChange={e => u('password', e.target.value)}
                className="w-full bg-white/10 border border-white/20 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-400 placeholder-slate-500"
                placeholder="Min 8 chars, 1 uppercase, 1 digit"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-300 mb-1 block">Country</label>
                <select
                  value={form.country_code}
                  onChange={e => u('country_code', e.target.value)}
                  className="w-full bg-white/10 border border-white/20 text-white rounded-xl px-3 py-3 text-sm focus:outline-none"
                >
                  <option value="IN" className="bg-slate-800">India</option>
                  <option value="US" className="bg-slate-800">USA</option>
                  <option value="SG" className="bg-slate-800">Singapore</option>
                  <option value="GB" className="bg-slate-800">UK</option>
                  <option value="AE" className="bg-slate-800">UAE</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-slate-300 mb-1 block">Currency</label>
                <select
                  value={form.preferred_currency}
                  onChange={e => u('preferred_currency', e.target.value)}
                  className="w-full bg-white/10 border border-white/20 text-white rounded-xl px-3 py-3 text-sm focus:outline-none"
                >
                  <option className="bg-slate-800">INR</option>
                  <option className="bg-slate-800">USD</option>
                  <option className="bg-slate-800">EUR</option>
                  <option className="bg-slate-800">GBP</option>
                  <option className="bg-slate-800">SGD</option>
                </select>
              </div>
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold rounded-xl py-3 flex items-center justify-center gap-2"
            >
              {loading
                ? <><Loader2 className="animate-spin" size={16} />Creating...</>
                : 'Create Account'
              }
            </button>
          </form>
          <p className="text-center text-sm text-slate-400 mt-4">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-400 hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
