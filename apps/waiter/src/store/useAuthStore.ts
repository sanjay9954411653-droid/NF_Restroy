import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import axios from 'axios'
import { authApi } from '../api/endpoints'
import { setToken, getRefreshToken } from '../api/client'
import { useCartStore } from './useCartStore'
import type { User } from '../types'

interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  restoreSession: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user:      null,
      token:     null,
      isLoading: false,

      login: async (email, password) => {
        set({ isLoading: true })
        try {
          const res = await authApi.login(email, password)
          const { token, refreshToken, user } = res.data.data
          setToken(token, refreshToken)
          set({ token, user: { ...user, restaurantId: user.restaurant_id }, isLoading: false })
        } catch (err) {
          set({ isLoading: false })
          throw err
        }
      },

      // Tells the server to revoke this session's refresh token, then clears
      // everything locally. Still logs out locally even if the server call
      // fails (for example, no signal) — a waiter tapping "Log out" should
      // never feel stuck signed in.
      logout: async () => {
        const refreshToken = getRefreshToken()
        if (refreshToken) {
          try { await authApi.logout(refreshToken) } catch { /* best effort */ }
        }
        setToken(null, null)
        useCartStore.getState().resetAll()   // drafts belong to the waiter who made them
        set({ user: null, token: null })
      },

      // Runs once on app start. A saved access token may already be expired
      // (they last 15 minutes) — that's expected, not a failure: the api
      // client's 401 handler will use the refresh token to get a fresh one.
      //
      // Only a genuine auth rejection (both the access token AND the refresh
      // token are invalid — surfaced as a 401 here, since the api client's
      // own interceptor already tried refreshing first) should sign the
      // waiter out. A network blip, a slow/cold-starting backend, or a
      // timeout must NOT clear a perfectly good session — that was
      // logging waiters out just for reopening the app with a shaky signal.
      restoreSession: async () => {
        const { token } = get()
        if (!token && !getRefreshToken()) return
        set({ isLoading: true })
        if (token) setToken(token)
        try {
          const res = await authApi.me()
          const user = res.data.data
          set({ user: { ...user, restaurantId: user.restaurant_id }, isLoading: false })
        } catch (err) {
          const status = axios.isAxiosError(err) ? err.response?.status : undefined
          if (status === 401 || status === 403) {
            setToken(null, null)
            set({ user: null, token: null, isLoading: false })
          } else {
            // Transient failure — keep the existing session and stop
            // loading; the next successful request will pick it back up.
            set({ isLoading: false })
          }
        }
      },
    }),
    {
      name: 'waiter-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
    },
  ),
)
