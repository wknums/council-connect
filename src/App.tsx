import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Envelope, Users, ChartBar, Gear, Plus } from '@phosphor-icons/react'
import { EmailComposer } from '@/components/email/EmailComposer'
import { DistributionLists } from '@/components/lists/DistributionLists'
import { Analytics } from '@/components/analytics/Analytics'
import { Settings } from '@/components/settings/Settings'
import { Toaster } from '@/components/ui/sonner'
import { useKV } from '@github/spark/hooks'

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
  const [user] = useKV<UserProfile | null>('user-profile', null)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Municipal Email System</h1>
            <p className="text-muted-foreground">Ward Councilor Communications Portal</p>
          </div>
          <div className="flex items-center gap-4">
            {user && (
              <div className="text-right">
                <p className="font-medium text-foreground">{user.name}</p>
                <p className="text-sm text-muted-foreground">{user.ward}</p>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
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