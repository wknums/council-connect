/** API client abstraction (Phase 0). Falls back to no-op or local KV if needed. */
import type { DistributionList, Contact, Campaign, CampaignMetrics, UnsubscribeEntry } from '@/types/domain'

interface ApiClientOptions {
  baseUrl?: string
  councillorIdProvider?: () => string | undefined
  tokenProvider?: () => Promise<string | undefined>
  enabled?: boolean
  allowLegacyHeader?: boolean
}

interface AuthConfiguration {
  councillorIdProvider?: () => string | undefined
  tokenProvider?: () => Promise<string | undefined>
  enabled?: boolean
  allowLegacyHeader?: boolean
}

class ApiClient {
  private baseUrl: string
  private getCouncillorId: () => string | undefined
  private enabled: boolean
  private kvTestMode: boolean
  private tokenProvider?: () => Promise<string | undefined>
  private allowLegacyHeader: boolean

  constructor(opts: ApiClientOptions = {}) {
    const apiHost = (import.meta as any).env?.VITE_API_HOST || 'localhost'
    const apiPort = (import.meta as any).env?.VITE_API_PORT || '7071'
    const apiBaseUrl = (import.meta as any).env?.VITE_API_BASE_URL
    
    let defaultBaseUrl: string
    if (apiBaseUrl) {
      // Use explicit API base URL if provided
      defaultBaseUrl = `${apiBaseUrl}/api`
    } else if (import.meta.env.DEV) {
      // Development mode
      defaultBaseUrl = `http://${apiHost}:${apiPort}/api`
    } else {
      // Production fallback
      defaultBaseUrl = '/api'
    }
    
    this.baseUrl = opts.baseUrl || defaultBaseUrl
    this.getCouncillorId = opts.councillorIdProvider || (() => undefined)
    this.enabled = opts.enabled !== false
    this.tokenProvider = opts.tokenProvider
    this.allowLegacyHeader = opts.allowLegacyHeader ?? true
    // FE_TEST_KV env var (Vite exposes import.meta.env) determines bypass of API calls
    const flag = (typeof window !== 'undefined' && (window as any).__FE_TEST_KV__) || (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_FE_TEST_KV)
    this.kvTestMode = !!(flag === true || flag === 'true')
  }

  configureAuth(config: AuthConfiguration) {
    if (config.councillorIdProvider) {
      this.getCouncillorId = config.councillorIdProvider
    }
    if (config.tokenProvider) {
      this.tokenProvider = config.tokenProvider
    }
    if (typeof config.enabled === 'boolean') {
      this.enabled = config.enabled
    }
    if (typeof config.allowLegacyHeader === 'boolean') {
      this.allowLegacyHeader = config.allowLegacyHeader
    }
  }

  private headers(): HeadersInit {
    const cid = this.getCouncillorId()
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    }
    if (cid && this.allowLegacyHeader) {
      headers['x-councillor-id'] = cid
    }
    return headers
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.enabled || this.kvTestMode) throw new Error('API client disabled or in KV test mode')
    const headers = { ...this.headers(), ...(init?.headers || {}) }
    if (this.tokenProvider) {
      try {
        const token = await this.tokenProvider()
        if (token) headers['Authorization'] = `Bearer ${token}`
      } catch (err) {
        console.error('Unable to acquire access token for API request', err)
      }
    }
    
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`API ${res.status}: ${text}`)
      }
      return res.json() as Promise<T>
    } catch (err) {
      // Check if this is a CORS or network error indicating backend unavailability
      const errMsg = String(err)
      if (errMsg.includes('CORS') || errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError')) {
        console.warn('Backend API unavailable, falling back to local KV mode')
        throw new Error('Backend unavailable - using local storage mode')
      }
      throw err
    }
  }

  // Distribution Lists
  listDistributionLists(): Promise<{ items: DistributionList[] }> {
    return this.request('/distribution-lists')
  }

  createDistributionList(payload: { name: string; description: string }): Promise<DistributionList> {
    return this.request('/distribution-lists', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }

  deleteDistributionList(id: string): Promise<{ status: string }> {
    return this.request(`/distribution-lists/${id}`, { method: 'DELETE' })
  }

  addContact(listId: string, payload: { email: string; firstName: string; lastName: string }): Promise<Contact> {
    return this.request(`/distribution-lists/${listId}/contacts`, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }

  deleteContact(contactId: string): Promise<{ status: string }> {
    return this.request(`/contacts/${contactId}`, { method: 'DELETE' })
  }

  listContactsForList(listId: string): Promise<{ items: Contact[] }> {
    return this.request(`/distribution-lists/${listId}/contacts`)
  }

  listContacts(): Promise<{ items: Contact[] }> {
    return this.request('/contacts')
  }

  createCampaign(payload: { subject: string; content: string; listIds: string[]; attachments?: { name: string; contentType: string; base64: string }[] }): Promise<Campaign> {
    return this.request('/campaigns', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }

  deleteCampaign(campaignId: string): Promise<{ status: string }> {
    return this.request(`/campaigns/${campaignId}`, { method: 'DELETE' })
  }

  listCampaigns(): Promise<{ items: Campaign[] }> {
    return this.request('/campaigns')
  }

  getCampaignMetrics(campaignId: string): Promise<CampaignMetrics> {
    return this.request(`/campaigns/${campaignId}/metrics`)
  }

  listUnsubscribes(): Promise<{ items: UnsubscribeEntry[] }> {
    return this.request('/unsubscribes')
  }

  addUnsubscribe(payload: { email: string }): Promise<UnsubscribeEntry> {
    return this.request('/unsubscribes', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }

  deleteUnsubscribe(unsubscribeId: string): Promise<{ status: string }> {
    return this.request(`/unsubscribes/${unsubscribeId}`, { method: 'DELETE' })
  }

  deleteUnsubscribeByEmail(email: string): Promise<{ status: string }> {
    const safe = encodeURIComponent(email)
    return this.request(`/unsubscribes?email=${safe}`, { method: 'DELETE' })
  }

  recordUnsubscribeEvent(payload: { campaignId: string; contactId: string }): Promise<{ status: string }> {
    return this.request('/track/unsubscribe', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
  }
}

export const apiClient = new ApiClient({
  councillorIdProvider: () => {
    // Derive from subdomain (mirrors getCouncillorKey logic). This is a simplified client-side inference.
    if (typeof window === 'undefined') return undefined
    const sub = window.location.hostname.split('.')[0]
    return sub === 'localhost' ? 'default-councillor' : sub
  }
})

export type { DistributionList, Contact, Campaign, CampaignMetrics, UnsubscribeEntry }
