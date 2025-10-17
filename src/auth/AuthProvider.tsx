import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { MsalProvider, useMsal } from '@azure/msal-react'
import { AccountInfo, InteractionRequiredAuthError, PublicClientApplication } from '@azure/msal-browser'

import { apiClient } from '@/api/client'
import { createMsalConfig, getClientAuthSettings, shouldBypassAuth } from './authConfig'

type AuthContextValue = {
  loading: boolean
  isAuthenticated: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  accessToken?: string
  account?: AccountInfo
  councillorId: string
  wardId?: string
  error?: string
  mode: 'entra' | 'b2c' | 'off'
  bypassed: boolean
}

const settings = getClientAuthSettings()
const msalConfig = createMsalConfig(settings)
const msalInstance = new PublicClientApplication(msalConfig)

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const defaultCouncillorId = settings.fallbackCouncillorId || 'default-councillor'

function publishCouncillorContext(councillorId: string, wardId?: string) {
  if (typeof window === 'undefined') return
  const globalScope = window as unknown as { __councillorContext?: { councillorId: string; wardId?: string } }
  globalScope.__councillorContext = { councillorId, wardId }
}

function useAuthState(): AuthContextValue {
  const { instance } = useMsal()
  const [loading, setLoading] = useState(settings.mode !== 'off')
  const [account, setAccount] = useState<AccountInfo | undefined>(undefined)
  const [accessToken, setAccessToken] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [initialized, setInitialized] = useState(false)

  const bypassed = typeof window !== 'undefined' ? shouldBypassAuth(settings, window.location.pathname) : false
  const scopes = useMemo(() => {
    if (settings.scopes.length > 0) return settings.scopes
    if (!settings.clientId) return []
    return [`api://${settings.clientId}/.default`]
  }, [settings])

  const councillorData = useMemo(() => {
    if (bypassed || settings.mode === 'off') {
      let councillorIdOverride = defaultCouncillorId
      let wardOverride: string | undefined
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        const queryCouncillor = params.get('councillorId')
        const queryWard = params.get('ward')
        if (queryCouncillor) councillorIdOverride = queryCouncillor
        if (queryWard) wardOverride = queryWard
      }
      publishCouncillorContext(councillorIdOverride, wardOverride)
      return { councillorId: councillorIdOverride, wardId: wardOverride }
    }
    const claims = (account?.idTokenClaims as Record<string, unknown> | undefined) ?? undefined
    const councillorClaimValue = claims?.[settings.councillorClaim]
    const wardClaimValue = claims?.[settings.wardClaim ?? '']
    const councillorId = typeof councillorClaimValue === 'string' && councillorClaimValue.length > 0
      ? councillorClaimValue
      : typeof claims?.['oid'] === 'string'
        ? (claims['oid'] as string)
        : defaultCouncillorId
    const wardId = typeof wardClaimValue === 'string' && wardClaimValue.length > 0 ? wardClaimValue : undefined
    publishCouncillorContext(councillorId, wardId)
    return { councillorId, wardId }
  }, [account, bypassed])

  const acquireToken = useCallback(async (force = false): Promise<string | undefined> => {
    if (bypassed || settings.mode === 'off') return undefined
    if (!account) return undefined
    if (scopes.length === 0) return undefined
    
    // For basic authentication (openid, profile, email), we don't need to acquire additional tokens
    // The ID token from login is sufficient
    if (scopes.every(scope => ['openid', 'profile', 'email'].includes(scope))) {
      return undefined // No additional API token needed
    }
    
    try {
      const result = await instance.acquireTokenSilent({
        account,
        scopes,
        authority: settings.signInAuthority,
        forceRefresh: force
      })
      setAccessToken(result.accessToken)
      return result.accessToken
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        await instance.acquireTokenRedirect({ scopes, authority: settings.signInAuthority })
        return undefined
      }
      const message = err instanceof Error ? err.message : 'Token acquisition failed'
      console.error(message)
      setError(message)
      return undefined
    }
  }, [account?.homeAccountId, bypassed]) // Stabilize dependencies to prevent loops

  const syncApiClientAuth = useCallback(() => {
    apiClient.configureAuth({
      tokenProvider: acquireToken,
      councillorIdProvider: () => councillorData.councillorId,
      enabled: bypassed || settings.mode === 'off' || !!settings.clientId,
      allowLegacyHeader: bypassed
    })
  }, [acquireToken, councillorData.councillorId, bypassed])

  useEffect(() => {
    syncApiClientAuth()
  }, [syncApiClientAuth])

  const initialize = useCallback(async () => {
    if (initialized) {
      console.log('Already initialized, skipping...')
      return
    }
    console.log('Auth initialization starting...')
    if (bypassed || settings.mode === 'off') {
      console.log('Auth bypassed or off, setting loading to false')
      setLoading(false)
      setInitialized(true)
      return
    }
    if (!settings.clientId) {
      console.log('No client ID found')
      setError('Authentication client id missing. Check VITE_AUTH_CLIENT_ID.')
      setLoading(false)
      setInitialized(true)
      return
    }
    try {
      console.log('Initializing MSAL instance...')
      await instance.initialize()
      console.log('Handling redirect promise...')
      const redirectResponse = await instance.handleRedirectPromise()
      console.log('Redirect response:', redirectResponse)
      if (redirectResponse?.account) {
        console.log('Setting active account from redirect response')
        instance.setActiveAccount(redirectResponse.account)
        // If we're on the redirect path after successful auth, navigate to root
        if (typeof window !== 'undefined' && window.location.pathname === '/redirect') {
          window.history.replaceState({}, '', '/')
        }
      }
      const active = instance.getActiveAccount() ?? instance.getAllAccounts()[0]
      console.log('Active account:', active)
      if (!active) {
        console.log('No active account found, setting loading to false')
        setLoading(false)
        setInitialized(true)
        return
      }
      instance.setActiveAccount(active)
      setAccount(active)
      console.log('Acquiring token...')
      await acquireToken()
      console.log('Auth initialization complete, setting loading to false')
      setLoading(false)
      setInitialized(true)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      console.error('Auth initialization error:', message)
      setError(message)
      setLoading(false)
      setInitialized(true)
    }
  }, [initialized, bypassed, instance, acquireToken])

  useEffect(() => {
    void initialize()
  }, [initialize])

  const signIn = useCallback(async () => {
    if (bypassed || settings.mode === 'off') return
    try {
      await instance.loginRedirect({
        scopes,
        authority: settings.signInAuthority,
        redirectUri: settings.redirectUri
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      console.error(message)
      setError(message)
    }
  }, [bypassed, instance, scopes])

  const signOut = useCallback(async () => {
    if (bypassed || settings.mode === 'off') return
    try {
      await instance.logoutRedirect({ postLogoutRedirectUri: settings.postLogoutRedirectUri })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Logout failed'
      console.error(message)
      setError(message)
    }
  }, [bypassed, instance])

  useEffect(() => {
    if (!bypassed && settings.mode !== 'off') {
      const subscription = instance.addEventCallback(async (event) => {
        if (event.eventType === 'msal:acquireTokenSuccess' && event.payload && 'account' in event.payload && event.payload.account) {
          setAccount(event.payload.account as AccountInfo)
          await acquireToken()
        }
        if (event.eventType === 'msal:loginSuccess' && event.payload && 'account' in event.payload && event.payload.account) {
          setAccount(event.payload.account as AccountInfo)
          await acquireToken(true)
        }
        if (event.eventType === 'msal:logoutSuccess') {
          setAccount(undefined)
          setAccessToken(undefined)
        }
      })
      return () => {
        if (subscription) instance.removeEventCallback(subscription)
      }
    }
  }, [acquireToken, bypassed, instance])

  return {
    loading,
    isAuthenticated: bypassed || !!account,
    signIn,
    signOut,
    accessToken,
    account,
    councillorId: councillorData.councillorId,
    wardId: councillorData.wardId,
    error,
    mode: settings.mode,
    bypassed
  }
}

const AuthStateProvider = ({ children }: { children: ReactNode }) => {
  const value = useAuthState()

  if (value.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
        <p>Preparing secure session…</p>
      </div>
    )
  }

  if (!value.isAuthenticated && !value.bypassed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground p-6">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-2xl font-semibold">Sign in required</h1>
          <p>Please sign in to manage municipal communications.</p>
          {value.error && <p className="text-sm text-red-500">{value.error}</p>}
        </div>
        <button
          type="button"
          onClick={() => void value.signIn()}
          className="rounded-md bg-blue-600 px-4 py-2 text-white shadow-sm focus:outline-none focus-visible:ring focus-visible:ring-blue-500"
        >
          Sign in with Microsoft
        </button>
      </div>
    )
  }

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  )
}

export const AuthProvider = ({ children }: { children: ReactNode }) => (
  <MsalProvider instance={msalInstance}>
    <AuthStateProvider>{children}</AuthStateProvider>
  </MsalProvider>
)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
