import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ChartBar, Envelope, Eye, Mouse, Users } from '@phosphor-icons/react'
import { useKV } from '@github/spark/hooks'
import { getCouncilorKey } from '@/lib/utils'

interface EmailMetrics {
  id: string
  subject: string
  sentAt: string
  recipientCount: number
  deliveredCount: number
  openedCount: number
  clickedCount: number
  unsubscribedCount: number
}

export function Analytics() {
  const [drafts] = useKV<any[]>(getCouncilorKey('email-drafts'), [])
  const [distributionLists] = useKV<any[]>(getCouncilorKey('distribution-lists'), [])

  const sentEmails = (drafts || []).filter(email => email.status === 'sent')
  
  const mockMetrics: EmailMetrics[] = sentEmails.map(email => ({
    id: email.id,
    subject: email.subject,
    sentAt: email.sentAt || email.createdAt,
    recipientCount: Math.floor(Math.random() * 500) + 100,
    deliveredCount: Math.floor(Math.random() * 480) + 90,
    openedCount: Math.floor(Math.random() * 200) + 50,
    clickedCount: Math.floor(Math.random() * 50) + 10,
    unsubscribedCount: Math.floor(Math.random() * 5)
  }))

  const totalRecipients = (distributionLists || []).reduce((total, list) => total + (list.contacts?.length || 0), 0)
  const totalSent = sentEmails.length
  const totalOpens = mockMetrics.reduce((total, metric) => total + metric.openedCount, 0)
  const totalClicks = mockMetrics.reduce((total, metric) => total + metric.clickedCount, 0)

  const avgOpenRate = totalSent > 0 ? (totalOpens / mockMetrics.reduce((total, metric) => total + metric.recipientCount, 0)) * 100 : 0
  const avgClickRate = totalSent > 0 ? (totalClicks / mockMetrics.reduce((total, metric) => total + metric.recipientCount, 0)) * 100 : 0

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Email Analytics</h2>
        <p className="text-muted-foreground">Track engagement and performance metrics</p>
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
              This month
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
            <CardTitle className="text-sm font-medium">Avg Click Rate</CardTitle>
            <Mouse size={16} className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgClickRate.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              {totalClicks} total clicks
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ChartBar size={20} />
            Campaign Performance
          </CardTitle>
          <CardDescription>
            Detailed metrics for your recent email campaigns
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mockMetrics.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <ChartBar size={48} className="text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No campaigns yet</h3>
              <p className="text-muted-foreground">Send your first email to see analytics</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Sent Date</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Delivered</TableHead>
                  <TableHead>Opens</TableHead>
                  <TableHead>Clicks</TableHead>
                  <TableHead>Open Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockMetrics.map((metric) => {
                  const openRate = (metric.openedCount / metric.recipientCount) * 100
                  const deliveryRate = (metric.deliveredCount / metric.recipientCount) * 100
                  
                  return (
                    <TableRow key={metric.id}>
                      <TableCell className="font-medium">
                        <div className="max-w-48 truncate">{metric.subject}</div>
                      </TableCell>
                      <TableCell>
                        {new Date(metric.sentAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>{metric.recipientCount.toLocaleString()}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {metric.deliveredCount.toLocaleString()}
                          <Badge 
                            variant={deliveryRate > 95 ? "default" : deliveryRate > 90 ? "secondary" : "destructive"}
                            className="text-xs"
                          >
                            {deliveryRate.toFixed(0)}%
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>{metric.openedCount.toLocaleString()}</TableCell>
                      <TableCell>{metric.clickedCount.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge 
                          variant={openRate > 25 ? "default" : openRate > 15 ? "secondary" : "outline"}
                          className="text-xs"
                        >
                          {openRate.toFixed(1)}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}