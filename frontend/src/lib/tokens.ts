import { config } from './config'

const ACCESS_KEY = 'dory-access-token'
const REFRESH_KEY = 'dory-refresh-token'
const LEGACY_KEY = 'dory-token'

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY) ?? localStorage.getItem(LEGACY_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY)
}

export function storeTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_KEY, access)
  localStorage.setItem(REFRESH_KEY, refresh)
  // Old single-token clients may still have this lingering — clear it.
  localStorage.removeItem(LEGACY_KEY)
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  localStorage.removeItem(LEGACY_KEY)
}

// Single in-flight refresh shared across concurrent 401s, so we don't
// burn refresh tokens by racing them.
let refreshInFlight: Promise<string | null> | null = null

export async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight

  const refresh = getRefreshToken()
  if (!refresh) return null

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
      if (!res.ok) {
        clearTokens()
        return null
      }
      const data = await res.json()
      storeTokens(data.access_token, data.refresh_token)
      return data.access_token as string
    } catch {
      return null
    } finally {
      refreshInFlight = null
    }
  })()

  return refreshInFlight
}

export function forceLogoutRedirect() {
  clearTokens()
  localStorage.removeItem('dory-session')
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}
