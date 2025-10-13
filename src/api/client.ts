/** API client abstraction (Phase 0). Falls back to no-op or local KV if needed. */
import type { DistributionList, Contact, Campaign, CampaignMetrics, UnsubscribeEntry } from '@/types/domain'

interface ApiClientOptions {
  baseUrl?: string
  councillorIdProvider?: () => string | undefined
  enabled?: boolean
}

class ApiClient {
  private baseUrl: string
  private getCouncillorId: () => string | undefined
  private enabled: boolean
  private kvTestMode: boolean

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl || '/api'
    this.getCouncillorId = opts.councillorIdProvider || (() => undefined)
    this.enabled = opts.enabled !== false
    // FE_TEST_KV env var (Vite exposes import.meta.env) determines bypass of API calls
    const flag = (typeof window !== 'undefined' && (window as any).__FE_TEST_KV__) || (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_FE_TEST_KV)
    this.kvTestMode = !!(flag === true || flag === 'true')
  }

  private headers(): HeadersInit {
    const cid = this.getCouncillorId()
    return {
      'Content-Type': 'application/json',
      ...(cid ? { 'x-councillor-id': cid } : {})
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.enabled || this.kvTestMode) throw new Error('API client disabled or in KV test mode')
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers || {}) }
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`API ${res.status}: ${text}`)
    }
    return res.json() as Promise<T>
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
