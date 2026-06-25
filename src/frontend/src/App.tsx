import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/authStore'

import LoginPage         from './pages/LoginPage'
import SignupPage        from './pages/SignupPage'

import CustomerLayout    from './components/customer/CustomerLayout'
import CustomerDashboard from './components/customer/Dashboard'
import PaymentSend       from './components/customer/PaymentSend'
import TransactionList   from './components/customer/TransactionList'
import RefundFlow        from './components/customer/RefundFlow'
import CustomerWallet    from './components/customer/Wallet'
import CustomerProfile   from './components/customer/Profile'

import MerchantLayout    from './components/merchant/MerchantLayout'
import MerchantDashboard from './components/merchant/Dashboard'
import MerchantTxns      from './components/merchant/Transactions'
import Settlements       from './components/merchant/Settlements'
import AISupportChat     from './components/merchant/AISupportChat'

import AdminLayout       from './components/admin/AdminLayout'
import AdminDashboard    from './components/admin/Dashboard'
import FraudQueue        from './components/admin/FraudQueue'
import DisputeManager    from './components/admin/DisputeManager'
import NLPLookup         from './components/admin/NLPLookup'
import UserManager       from './components/admin/UserManager'

function RoleRoute({ allowed, children }: { allowed: string[]; children: React.ReactNode }) {
  const role = useAuthStore(s => s.role)
  if (!role) return <Navigate to="/login" replace />
  if (!allowed.includes(role)) return <Navigate to={`/${role}`} replace />
  return <>{children}</>
}

export default function App() {
  const { token, role, fetchMe } = useAuthStore()
  useEffect(() => { if (token) fetchMe() }, [token])

  return (
    <BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
      <Routes>
        <Route path="/login"  element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        <Route path="/" element={
          !token ? <Navigate to="/login" replace /> :
          role === 'customer' ? <Navigate to="/customer" replace /> :
          role === 'merchant' ? <Navigate to="/merchant" replace /> :
          <Navigate to="/admin" replace />
        } />

        <Route path="/customer" element={<RoleRoute allowed={['customer']}><CustomerLayout /></RoleRoute>}>
          <Route index          element={<CustomerDashboard />} />
          <Route path="send"    element={<PaymentSend />} />
          <Route path="history" element={<TransactionList />} />
          <Route path="refund"  element={<RefundFlow />} />
          <Route path="wallet"  element={<CustomerWallet />} />
          <Route path="profile" element={<CustomerProfile />} />
        </Route>

        <Route path="/merchant" element={<RoleRoute allowed={['merchant']}><MerchantLayout /></RoleRoute>}>
          <Route index               element={<MerchantDashboard />} />
          <Route path="transactions" element={<MerchantTxns />} />
          <Route path="settlements"  element={<Settlements />} />
          <Route path="ai-support"   element={<AISupportChat />} />
        </Route>

        <Route path="/admin" element={<RoleRoute allowed={['admin']}><AdminLayout /></RoleRoute>}>
          <Route index             element={<AdminDashboard />} />
          <Route path="fraud"      element={<FraudQueue />} />
          <Route path="disputes"   element={<DisputeManager />} />
          <Route path="nlp"        element={<NLPLookup />} />
          <Route path="users"      element={<UserManager />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
