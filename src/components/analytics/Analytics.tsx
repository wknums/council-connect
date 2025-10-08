import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ChartBar, Envelope, Eye, UserMinus, Users, TrendUp } from '@phosphor-icons/react'
import { useKV } from '@github/spark/hooks'
import { getCouncillorKey } from '@/lib/utils'
import { getEmailMetrics, EmailMetrics as TrackingEmailMetrics } from '@/lib/email-tracking'

interface Email {
  id: string
  subject: string
  content: string
  selectedLists: string[]
  status: 'draft' | 'sent'
  createdAt: string
  sentAt?: string
  totalRecipients?: number
}

export function Analytics() {
  const [drafts] = useKV<Email[]>(getCouncillorKey('email-drafts'), [])
  const [distributionLists] = useKV<any[]>(getCouncillorKey('distribution-lists'), [])
  const [unsubscribedEmails] = useKV<string[]>(getCouncillorKey('unsubscribed-emails'), [])
  const [emailMetrics, setEmailMetrics] = useState<TrackingEmailMetrics[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const sentEmails = (drafts || []).filter(email => email.status === 'sent')

  // Load email metrics
  useEffect(() => {
    const loadMetrics = async () => {
      if (sentEmails.length === 0) return
      
      setIsLoading(true)
      try {
        const metrics = await Promise.all(
          sentEmails.map(email => 
            getEmailMetrics(email.id, email.totalRecipients || 0)
          )
        )
        setEmailMetrics(metrics)
      } catch (error) {
        console.error('Error loading email metrics:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadMetrics()
  }, [sentEmails])

  const totalRecipients = (distributionLists || []).reduce((total, list) => total + (list.contacts?.length || 0), 0)
  const totalUnsubscribed = (unsubscribedEmails || []).length
  const totalSent = sentEmails.length
  const totalOpens = emailMetrics.reduce((total, metric) => total + metric.totalOpened, 0)
  const totalEmailsSent = emailMetrics.reduce((total, metric) => total + metric.totalSent, 0)
  const totalUnsubscribesFromEmails = emailMetrics.reduce((total, metric) => total + metric.totalUnsubscribed, 0)

  const avgOpenRate = totalEmailsSent > 0 ? (totalOpens / totalEmailsSent) * 100 : 0
  const avgUnsubscribeRate = totalEmailsSent > 0 ? (totalUnsubscribesFromEmails / totalEmailsSent) * 100 : 0

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
            <div className="text-2xl font-bold">{totalSent}</div>
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
          {emailMetrics.length === 0 ? (
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
                        {new Date(email.sentAt || email.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>{metric.totalSent.toLocaleString()}</TableCell>
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
              {(unsubscribedEmails || []).slice(0, 5).map((email, index) => (
                <div key={index} className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded">
                  <span className="text-sm">{email}</span>
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