import type { Configuration } from '@azure/msal-browser'

type AuthMode = 'entra' | 'b2c' | 'off'

export interface ClientAuthSettings {
  mode: AuthMode
  clientId: string
  tenantId?: string
  redirectUri: string
  postLogoutRedirectUri: string
  scopes: string[]
  authority?: string
  signInAuthority?: string
  knownAuthorities?: string[]
  bypassAuth: boolean
  councillorClaim: string
  wardClaim?: string
  fallbackCouncillorId: string
}

function readEnv(name: string, fallback = ''): string {
  const value = (import.meta as any).env?.[name]
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

export function getClientAuthSettings(): ClientAuthSettings {
  const modeEnv = readEnv('VITE_AUTH_MODE', 'off').toLowerCase()
  const mode: AuthMode = modeEnv === 'b2c' ? 'b2c' : modeEnv === 'entra' ? 'entra' : 'off'

  const fallbackCouncillorId = readEnv('VITE_AUTH_FALLBACK_COUNCILLOR', 'default-councillor')
  const councillorClaim = readEnv('VITE_AUTH_COUNCILLOR_CLAIM', 'extension_councillorId')
  const wardClaim = readEnv('VITE_AUTH_WARD_CLAIM', 'extension_wardId') || undefined
  const bypassAuth = readEnv('VITE_AUTH_BYPASS', '').toLowerCase() === 'true'

  const redirectUri = readEnv('VITE_AUTH_REDIRECT_URI') || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000')
  const postLogoutRedirectUri = readEnv('VITE_AUTH_POST_LOGOUT_REDIRECT_URI') || redirectUri
  const scopes = readEnv('VITE_AUTH_SCOPES', '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)

  const clientId = readEnv('VITE_AUTH_CLIENT_ID')

  if (mode !== 'off' && !clientId) {
    console.warn('Authentication mode enabled but VITE_AUTH_CLIENT_ID is missing.')
  }

  if (mode === 'entra') {
    const tenantId = readEnv('VITE_AUTH_TENANT_ID')
    const authorityOverride = readEnv('VITE_AUTH_AUTHORITY')
    const authority = authorityOverride || (tenantId ? `https://login.microsoftonline.com/${tenantId}` : undefined)
    return {
      mode,
      clientId,
      tenantId,
      redirectUri,
      postLogoutRedirectUri,
      scopes,
      authority,
      signInAuthority: authority,
      knownAuthorities: undefined,
      bypassAuth,
      councillorClaim,
      wardClaim,
      fallbackCouncillorId
    }
  }

  if (mode === 'b2c') {
    const tenant = readEnv('VITE_AUTH_B2C_TENANT')
    const domain = readEnv('VITE_AUTH_B2C_DOMAIN', tenant ? `${tenant}.b2clogin.com` : '')
    const signInPolicy = readEnv('VITE_AUTH_B2C_SIGNIN_POLICY')

    const authority = tenant && signInPolicy
      ? `https://${domain}/${tenant}.onmicrosoft.com/${signInPolicy}`
      : undefined

    const knownAuthorities = domain ? [domain] : undefined

    return {
      mode,
      clientId,
      tenantId: tenant,
      redirectUri,
      postLogoutRedirectUri,
      scopes,
      authority,
      signInAuthority: authority,
      knownAuthorities,
      bypassAuth,
      councillorClaim,
      wardClaim,
      fallbackCouncillorId
    }
  }

  return {
    mode: 'off',
    clientId,
    redirectUri,
    postLogoutRedirectUri,
    scopes,
    authority: undefined,
    signInAuthority: undefined,
    knownAuthorities: undefined,
    bypassAuth: true,
    councillorClaim,
    wardClaim,
    fallbackCouncillorId
  }
}

export function createMsalConfig(settings: ClientAuthSettings): Configuration {
  console.log('MSAL Config Debug:', {
    clientId: settings.clientId,
    authority: settings.signInAuthority,
    knownAuthorities: settings.knownAuthorities,
    redirectUri: settings.redirectUri,
    tenantId: settings.tenantId
  })
  
  // Since MSAL endpoint discovery keeps failing, let's use a different approach:
  // Use the tenant-specific authority but with cloudDiscoveryMetadata to bypass discovery
  let authority = settings.signInAuthority
  if (settings.mode === 'entra' && settings.tenantId) {
    authority = `https://login.microsoftonline.com/${settings.tenantId}/v2.0`
    console.log('Using explicit tenant authority with metadata override:', authority)
  }
  
  // Create manual cloud discovery metadata to bypass MSAL's endpoint resolution
  const cloudDiscoveryMetadata = {
    "tenant_discovery_endpoint": `https://login.microsoftonline.com/${settings.tenantId}/v2.0/.well-known/openid_configuration`,
    "api-version": "1.1",
    "metadata": [{
      "preferred_network": "login.microsoftonline.com",
      "preferred_cache": "login.windows.net", 
      "aliases": ["login.microsoftonline.com", "login.windows.net"]
    }]
  }
  
  const authorityMetadata = {
    "token_endpoint": `https://login.microsoftonline.com/${settings.tenantId}/oauth2/v2.0/token`,
    "token_endpoint_auth_methods_supported": ["client_secret_post", "private_key_jwt", "client_secret_basic"],
    "jwks_uri": `https://login.microsoftonline.com/${settings.tenantId}/discovery/v2.0/keys`,
    "response_modes_supported": ["query", "fragment", "form_post"],
    "subject_types_supported": ["pairwise"],
    "id_token_signing_alg_values_supported": ["RS256"],
    "response_types_supported": ["code", "id_token", "code id_token", "id_token token"],
    "scopes_supported": ["openid", "profile", "email", "offline_access"],
    "issuer": `https://login.microsoftonline.com/${settings.tenantId}/v2.0`,
    "request_uri_parameter_supported": false,
    "userinfo_endpoint": "https://graph.microsoft.com/oidc/userinfo",
    "authorization_endpoint": `https://login.microsoftonline.com/${settings.tenantId}/oauth2/v2.0/authorize`,
    "device_authorization_endpoint": `https://login.microsoftonline.com/${settings.tenantId}/oauth2/v2.0/devicecode`,
    "http_logout_supported": true,
    "frontchannel_logout_supported": true,
    "end_session_endpoint": `https://login.microsoftonline.com/${settings.tenantId}/oauth2/v2.0/logout`,
    "claims_supported": ["sub", "iss", "cloud_instance_name", "cloud_instance_host_name", "cloud_graph_host_name", "msgraph_host", "aud", "exp", "iat", "auth_time", "acr", "nonce", "preferred_username", "name", "tid", "ver", "at_hash", "c_hash", "email"]
  }
  
  console.log('Using manual metadata to bypass endpoint discovery')
  
  return {
    auth: {
      clientId: settings.clientId,
      authority: authority,
      knownAuthorities: ['login.microsoftonline.com'],
      redirectUri: settings.redirectUri,
      postLogoutRedirectUri: settings.postLogoutRedirectUri,
      navigateToLoginRequestUrl: true,
      // Provide explicit metadata to bypass discovery
      cloudDiscoveryMetadata: JSON.stringify(cloudDiscoveryMetadata),
      authorityMetadata: JSON.stringify(authorityMetadata)
    },
    cache: {
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: true
    },
    system: {
      loggerOptions: {
        loggerCallback: (level, message, containsPii) => {
          if (!containsPii) {
            console.log(`[MSAL ${level}] ${message}`)
          }
        },
        piiLoggingEnabled: false,
        logLevel: 0 // Verbose logging for debugging
      }
    }
  }
}

export function shouldBypassAuth(settings: ClientAuthSettings, pathname: string): boolean {
  if (settings.bypassAuth) return true
  const lower = pathname.toLowerCase()
  return lower.includes('/unsubscribe')
}
