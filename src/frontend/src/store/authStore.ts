import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import axios from 'axios'

const API = '/api/v1'

export type UserRole = 'customer' | 'merchant' | 'admin'

interface AuthState {
  token:        string | null
  refreshToken: string | null
  role:         UserRole | null
  userId:       string | null
  user:         any | null
  isLoading:    boolean
  login:        (email: string, password: string, totpCode?: string) => Promise<void>
  logout:       () => void
  fetchMe:      () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null, refreshToken: null, role: null,
      userId: null, user: null, isLoading: false,

      login: async (email, password, totpCode) => {
        set({ isLoading: true })
        try {
          const res = await axios.post(`${API}/auth/login`, {
            email, password, totp_code: totpCode || undefined,
          })
          const { access_token, refresh_token, role, user_id } = res.data
          axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`
          set({ token: access_token, refreshToken: refresh_token,
                role, userId: user_id, isLoading: false })
          await get().fetchMe()
        } catch (err) {
          set({ isLoading: false })
          throw err
        }
      },

      logout: () => {
        delete axios.defaults.headers.common['Authorization']
        set({ token: null, refreshToken: null, role: null, userId: null, user: null })
      },

      fetchMe: async () => {
        try {
          const res = await axios.get(`${API}/auth/me`)
          set({ user: res.data })
        } catch { /* ignore */ }
      },
    }),
    { name: 'auth-store' }
  )
)

// Rehydrate axios on page load
const token = useAuthStore.getState().token
if (token) axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
