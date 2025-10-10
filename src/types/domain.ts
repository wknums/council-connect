// Shared domain types (Phase 0) for frontend.

export interface DistributionList {
  id: string
  councillorId: string
  name: string
  description: string
  createdAt: string
}

export interface Contact {
  id: string
  councillorId: string
  email: string
  firstName: string
  lastName: string
  addedAt: string
  status: 'active' | 'unsubscribed'
}

export interface Campaign {
  id: string
  councillorId: string
  subject: string
  rawContent: string
  status: 'draft' | 'queued' | 'sending' | 'sent' | 'failed'
  createdAt: string
  sentAt?: string
  totalTargeted?: number
  totalFilteredUnsubscribed?: number
}

export interface CampaignMetrics {
  campaignId: string
  totalTargeted: number
  totalOpens: number
  totalUnsubscribes: number
  openRate: number
  unsubscribeRate: number
}
