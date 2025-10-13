import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ChartBar, Envelope, Eye, UserMinus, Users, TrendUp } from '@phosphor-icons/react'
import { useOptionalKV } from '@/hooks/useOptionalKV'
import { getCouncillorKey } from '@/lib/utils'
import { getEmailMetrics, EmailMetrics as TrackingEmailMetrics } from '@/lib/email-tracking'
import { apiClient } from '@/api/client'
import type { UnsubscribeEntry } from '@/types/domain'

interface LocalEmailDraft {
  id: string
  subject: string
  content: string
  selectedLists: string[]
  status: 'draft' | 'sent'
  createdAt: string
  sentAt?: string
  totalRecipients?: number
  dispatchState?: string
  sentCount?: number
  failedCount?: number
}

interface CampaignDoc {
  id: string
  subject: string
  createdAt: string
  sentAt?: string
  dispatchState?: string
  sentCount?: number
  failedCount?: number
  pendingCount?: number
  totalTargeted?: number
  totalFilteredUnsubscribed?: number
}

interface BackendMetricSnapshot {
  totalTargeted: number
  totalSent: number
  totalFailed: number
  totalPending: number
  totalFilteredUnsubscribed: number
  totalOpens: number
  uniqueOpens: number
  totalUnsubscribes: number
  uniqueUnsubscribes: number
  openRate: number
  unsubscribeRate: number
  deliveryStatusBreakdown?: Record<string, number>
}

export function Analytics() {
  const kvTestMode = (import.meta as any).env?.VITE_FE_TEST_KV === 'true'
  const [drafts] = useOptionalKV<LocalEmailDraft[]>(getCouncillorKey('email-drafts'), [])
  const [distributionLists] = useOptionalKV<any[]>(getCouncillorKey('distribution-lists'), [])
  const [unsubscribedEmails] = useOptionalKV<string[]>(getCouncillorKey('unsubscribed-emails'), [])
  const [emailMetrics, setEmailMetrics] = useState<TrackingEmailMetrics[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [backendCampaigns, setBackendCampaigns] = useState<CampaignDoc[]>([])
  const [backendMetrics, setBackendMetrics] = useState<Record<string, BackendMetricSnapshot>>({})
  const [backendUnsubscribes, setBackendUnsubscribes] = useState<UnsubscribeEntry[]>([])
  const pollingRef = useRef<number | null>(null)

  const sentEmails = (drafts || []).filter(email => email.status === 'sent')

  // Backend fetch logic (API mode)
  const fetchBackendCampaigns = useCallback(async () => {
    if (kvTestMode) return
    try {
      setIsLoading(true)
      const [campaignResponse, unsubscribeResponse] = await Promise.all([
        apiClient.listCampaigns(),
        apiClient.listUnsubscribes()
      ])
      const items = campaignResponse.items
      // Basic sort by createdAt desc (API already does, but enforce client side too)
      const sorted = [...items].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      setBackendCampaigns(sorted as CampaignDoc[])
      const unsubscribeEntries = (unsubscribeResponse.items || []).map(entry => ({
        ...entry,
        displayEmail: entry.displayEmail || entry.email
      }))
      setBackendUnsubscribes(unsubscribeEntries)
      // Fetch metrics per campaign sequentially (small scale); could parallelize with Promise.all
      const metricsEntries: [string, BackendMetricSnapshot][] = []
      for (const c of sorted) {
        try {
          const m = await apiClient.getCampaignMetrics(c.id)
          metricsEntries.push([c.id, {
            totalTargeted: m.totalTargeted || 0,
            totalSent: m.totalSent || 0,
            totalFailed: m.totalFailed || 0,
            totalPending: m.totalPending || 0,
            totalFilteredUnsubscribed: m.totalFilteredUnsubscribed || 0,
            totalOpens: m.totalOpens || 0,
            uniqueOpens: m.uniqueOpens || 0,
            totalUnsubscribes: m.totalUnsubscribes || 0,
            uniqueUnsubscribes: m.uniqueUnsubscribes || 0,
            openRate: m.openRate || 0,
            unsubscribeRate: m.unsubscribeRate || 0,
            deliveryStatusBreakdown: m.deliveryStatusBreakdown || {}
          }])
        } catch (err) {
          // Log and continue; keep partial data
          console.warn('Failed fetching metrics for', c.id, err)
        }
      }
  setBackendMetrics(Object.fromEntries(metricsEntries))
    } catch (e) {
      console.error('Failed to load backend campaigns', e)
    } finally {
      setIsLoading(false)
    }
  }, [kvTestMode])

  // Polling setup for backend mode to refresh statuses
  useEffect(() => {
    if (kvTestMode) return
    fetchBackendCampaigns()
    const onVisibility = () => { if (!document.hidden) fetchBackendCampaigns() }
    const onFocus = () => fetchBackendCampaigns()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    // Periodic polling (every 20s) while tab active
    pollingRef.current = window.setInterval(() => {
      if (!document.hidden) fetchBackendCampaigns()
    }, 20000)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      if (pollingRef.current) window.clearInterval(pollingRef.current)
    }
  }, [kvTestMode, fetchBackendCampaigns])

  // Load local (KV) email metrics (only in test mode)
  useEffect(() => {
    if (!kvTestMode) return
    const loadMetrics = async () => {
      if (sentEmails.length === 0) return
      setIsLoading(true)
      try {
        const metrics = await Promise.all(
          sentEmails.map(email => getEmailMetrics(email.id, email.totalRecipients || 0))
        )
        setEmailMetrics(metrics)
      } catch (error) {
        console.error('Error loading email metrics:', error)
      } finally {
        setIsLoading(false)
      }
    }
    loadMetrics()
  }, [sentEmails, kvTestMode])

  // Aggregate stats: choose source depending on mode
  let totalRecipients = (distributionLists || []).reduce((total, list) => total + (list.contacts?.length || 0), 0)
  const totalUnsubscribed = kvTestMode ? (unsubscribedEmails || []).length : backendUnsubscribes.length
  let totalSentCampaigns = 0
  let totalOpens = 0
  let totalEmailsSent = 0
  let totalUnsubscribesFromEmails = 0
  let avgOpenRate = 0
  let avgUnsubscribeRate = 0
  const displayedUnsubscribes = kvTestMode
    ? (unsubscribedEmails || []).map(email => ({ id: email, email, displayEmail: email, unsubscribedAt: undefined }))
    : backendUnsubscribes

  if (kvTestMode) {
    totalSentCampaigns = sentEmails.length
    totalOpens = emailMetrics.reduce((t, m) => t + m.totalOpened, 0)
    totalEmailsSent = emailMetrics.reduce((t, m) => t + m.totalSent, 0)
    totalUnsubscribesFromEmails = emailMetrics.reduce((t, m) => t + m.totalUnsubscribed, 0)
    avgOpenRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0
    avgUnsubscribeRate = totalEmailsSent > 0 ? (totalUnsubscribesFromEmails / totalEmailsSent) * 100 : 0
  } else {
    totalSentCampaigns = backendCampaigns.length
    for (const c of backendCampaigns) {
      const m = backendMetrics[c.id]
      if (m) {
        totalOpens += m.totalOpens
        totalEmailsSent += (m.totalSent || m.totalTargeted)
        totalUnsubscribesFromEmails += m.totalUnsubscribes
      }
    }
    avgOpenRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0
    avgUnsubscribeRate = totalEmailsSent > 0 ? (totalUnsubscribesFromEmails / totalEmailsSent) * 100 : 0
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Email Analytics</h2>
        <p className="text-muted-foreground">Track engagement and performance metrics with real-time data</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Recipients</CardTitle>
            <Users size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRecipients.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Across {(distributionLists || []).length} lists
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Emails Sent</CardTitle>
            <Envelope size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSentCampaigns}</div>
            <p className="text-xs text-muted-foreground">
              {totalEmailsSent.toLocaleString()} total recipients
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Open Rate</CardTitle>
            <Eye size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgOpenRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              {totalOpens} total opens
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unsubscribed</CardTitle>
            <UserMinus size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalUnsubscribed}</div>
            <p className="text-xs text-muted-foreground">
              {avgUnsubscribeRate.toFixed(2)}% rate
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendUp size={20} />
            Campaign Performance
          </CardTitle>
          <CardDescription>
            Real-time tracking data for your email campaigns
          </CardDescription>
        </CardHeader>
        <CardContent>
          {kvTestMode ? (
            emailMetrics.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12">
                <ChartBar size={48} className="text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  {isLoading ? 'Loading analytics...' : 'No campaigns yet'}
                </h3>
                <p className="text-muted-foreground">
                  {isLoading ? 'Fetching tracking data' : 'Send your first email to see analytics'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent Date</TableHead>
                    <TableHead>Recipients</TableHead>
                    <TableHead>Opens</TableHead>
                    <TableHead>Open Rate</TableHead>
                    <TableHead>Unsubscribes</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emailMetrics.map((metric) => {
                    const email = sentEmails.find(e => e.id === metric.emailId)
                    if (!email) return null
                    
                    return (
                      <TableRow key={metric.emailId}>
                        <TableCell className="font-medium">
                          <div className="max-w-48 truncate">{email.subject}</div>
                        </TableCell>
                        <TableCell>
                          {email.dispatchState && (
                            <Badge
                              variant={
                                email.dispatchState === 'sent' ? 'default' :
                                email.dispatchState === 'simulated' ? 'secondary' :
                                email.dispatchState === 'error' ? 'destructive' : 'outline'
                              }
                              className="text-xs"
                            >
                              {email.dispatchState}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {new Date(email.sentAt || email.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {metric.totalSent.toLocaleString()}
                          {typeof email.failedCount === 'number' && email.failedCount > 0 && (
                            <span className="ml-2 text-xs text-destructive">{email.failedCount} failed</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {metric.totalOpened.toLocaleString()}
                            {metric.opens.length > 0 && (
                              <Badge variant="outline" className="text-xs">
                                +{metric.opens.length} unique
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant={metric.openRate > 25 ? "default" : metric.openRate > 15 ? "secondary" : "outline"}
                            className="text-xs"
                          >
                            {metric.openRate.toFixed(1)}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {metric.totalUnsubscribed}
                            {metric.unsubscribeRate > 2 && (
                              <Badge variant="destructive" className="text-xs">
                                {metric.unsubscribeRate.toFixed(1)}%
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm">
                            View Details
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )
          ) : backendCampaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <ChartBar size={48} className="text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {isLoading ? 'Loading analytics...' : 'No campaigns yet'}
              </h3>
              <p className="text-muted-foreground">
                {isLoading ? 'Fetching tracking data' : 'Send your first email to see analytics'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent Date</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Opens</TableHead>
                  <TableHead>Open Rate</TableHead>
                  <TableHead>Unsubscribes</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backendCampaigns.map(c => {
                  const m = backendMetrics[c.id]
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        <div className="max-w-48 truncate">{c.subject}</div>
                      </TableCell>
                      <TableCell>
                        {c.dispatchState && (
                          <Badge
                            variant={
                              c.dispatchState === 'sent' ? 'default' :
                              c.dispatchState === 'simulated' ? 'secondary' :
                              c.dispatchState === 'error' ? 'destructive' : 'outline'
                            }
                            className="text-xs"
                          >
                            {c.dispatchState}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{new Date(c.sentAt || c.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 leading-tight">
                          <span>{(m?.totalSent || 0).toLocaleString()} sent</span>
                          {(m?.totalPending || 0) > 0 && (
                            <span className="text-xs text-muted-foreground">{(m?.totalPending || 0).toLocaleString()} pending</span>
                          )}
                          {(m?.totalFailed || 0) > 0 && (
                            <span className="text-xs text-destructive">{(m?.totalFailed || 0).toLocaleString()} failed</span>
                          )}
                          {(m?.totalFilteredUnsubscribed || 0) > 0 && (
                            <span className="text-xs text-muted-foreground">{(m?.totalFilteredUnsubscribed || 0).toLocaleString()} filtered</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 leading-tight">
                          <span>{(m?.totalOpens || 0).toLocaleString()} total</span>
                          {(m?.uniqueOpens || 0) > 0 && (
                            <span className="text-xs text-muted-foreground">{(m?.uniqueOpens || 0).toLocaleString()} unique</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={(m?.openRate || 0) > 25 ? 'default' : (m?.openRate || 0) > 15 ? 'secondary' : 'outline'}
                          className="text-xs"
                        >
                          {(m?.openRate || 0).toFixed(1)}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 leading-tight">
                          <span>{m?.totalUnsubscribes || 0}</span>
                          {(m?.uniqueUnsubscribes || 0) > 0 && (
                            <span className="text-xs text-muted-foreground">{(m?.uniqueUnsubscribes || 0).toLocaleString()} unique</span>
                          )}
                          {(m?.unsubscribeRate || 0) > 2 && (
                            <Badge variant="destructive" className="text-xs">{(m?.unsubscribeRate || 0).toFixed(1)}%</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={() => fetchBackendCampaigns()}>
                            Refresh
                          </Button>
                          {m?.deliveryStatusBreakdown && Object.keys(m.deliveryStatusBreakdown).length > 0 && (
                            <Badge variant="outline" className="text-xs font-normal">
                              {Object.entries(m.deliveryStatusBreakdown)
                                .map(([status, count]) => `${status}:${count}`)
                                .join(' · ')}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalUnsubscribed > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserMinus size={20} />
              Unsubscribed Contacts
            </CardTitle>
            <CardDescription>
              Contacts who have opted out of email communications
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground mb-4">
              {totalUnsubscribed} contacts have unsubscribed from your emails
            </div>
            <div className="space-y-2">
              {displayedUnsubscribes.slice(0, 5).map((entry) => (
                <div key={entry.id} className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded">
                  <div className="flex flex-col">
                    <span className="text-sm">{entry.displayEmail || entry.email}</span>
                    {entry.unsubscribedAt && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.unsubscribedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    Unsubscribed
                  </Badge>
                </div>
              ))}
              {totalUnsubscribed > 5 && (
                <div className="text-xs text-muted-foreground pt-2">
                  And {totalUnsubscribed - 5} more...
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}