import { useState, useEffect, useMemo } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Envelope, Users, ChartBar, Gear, Plus } from '@phosphor-icons/react'
import { EmailComposer } from '@/components/email/EmailComposer'
import { UnsubscribePage } from '@/components/email/UnsubscribePage'
import { DistributionLists } from '@/components/lists/DistributionLists'
import { Analytics } from '@/components/analytics/Analytics'
import { Settings } from '@/components/settings/Settings'
import { Toaster } from '@/components/ui/sonner'
import { Logo } from '@/components/ui/Logo'
import { AzureLogo } from '@/components/ui/AzureLogo'
import { useOptionalKV } from '@/hooks/useOptionalKV'
import { getCouncillorKey } from '@/lib/utils'
import { useAuth } from '@/auth/AuthProvider'

interface UserProfile {
  name: string
  ward: string
  title: string
  email: string
  phone: string
  signature: string
}

function App() {
  const [activeTab, setActiveTab] = useState('compose')
  const [user] = useOptionalKV<UserProfile | null>(getCouncillorKey('user-profile'), null)
  const [isUnsubscribePage, setIsUnsubscribePage] = useState(false)
  const [unsubscribeParams, setUnsubscribeParams] = useState<{trackingId?: string, email?: string, campaignId?: string, contactId?: string, councillorId?: string}>({})
  const { account, councillorId, wardId, signOut, bypassed } = useAuth()

  // Check URL for unsubscribe parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const trackingId = urlParams.get('id')
    const email = urlParams.get('email')
    const campaignId = urlParams.get('campaignId')
    const contactId = urlParams.get('contactId')
    const councillorId = urlParams.get('councillorId')
    
    if (window.location.pathname.includes('/unsubscribe') || trackingId || email) {
      setIsUnsubscribePage(true)
      setUnsubscribeParams({
        trackingId: trackingId || undefined,
        email: email || undefined,
        campaignId: campaignId || undefined,
        contactId: contactId || undefined,
        councillorId: councillorId || undefined
      })
    }
  }, [])

  // Handle unsubscribe page
  if (isUnsubscribePage) {
    return <UnsubscribePage {...unsubscribeParams} />
  }

  const headerName = useMemo(() => user?.name || account?.name || account?.username || 'Signed-in user', [user, account])
  const headerWard = useMemo(() => wardId || user?.ward || councillorId, [user, wardId, councillorId])

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size={40} />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Municipal Email System</h1>
              <p className="text-muted-foreground flex items-center gap-2">
                Ward Councillor Communications Portal - Powered by Azure
                <AzureLogo size={40} />
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-medium text-foreground">{headerName}</p>
              <p className="text-sm text-muted-foreground">{headerWard}</p>
            </div>
            {!bypassed && (
              <Button variant="outline" size="sm" onClick={() => void signOut()}>
                Sign out
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={(val) => {
          setActiveTab(val)
          if (val === 'compose') {
            window.dispatchEvent(new CustomEvent('email-composer-activated'))
          }
        }} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="compose" className="flex items-center gap-2">
              <Envelope size={16} />
              Compose
            </TabsTrigger>
            <TabsTrigger value="lists" className="flex items-center gap-2">
              <Users size={16} />
              Contact Lists
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-2">
              <ChartBar size={16} />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Gear size={16} />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="compose" className="mt-6">
            <EmailComposer />
          </TabsContent>

          <TabsContent value="lists" className="mt-6">
            <DistributionLists />
          </TabsContent>

          <TabsContent value="analytics" className="mt-6">
            <Analytics />
          </TabsContent>

          <TabsContent value="settings" className="mt-6">
            <Settings />
          </TabsContent>
        </Tabs>
      </main>

      <Toaster />
    </div>
  )
}

export default App