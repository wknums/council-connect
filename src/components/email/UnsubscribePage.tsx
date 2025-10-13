import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { CheckCircle, XCircle, Envelope } from '@phosphor-icons/react'
import { recordUnsubscribe } from '@/lib/email-tracking'
import { useOptionalKV } from '@/hooks/useOptionalKV'
import { getCouncillorKey } from '@/lib/utils'
import { toast } from 'sonner'
import { apiClient } from '@/api/client'

interface UnsubscribePageProps {
  trackingId?: string
  email?: string
  campaignId?: string
  contactId?: string
  councillorId?: string
}

export function UnsubscribePage({ trackingId, email: initialEmail, campaignId, contactId }: UnsubscribePageProps) {
  const [email, setEmail] = useState(initialEmail || '')
  const [isUnsubscribed, setIsUnsubscribed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [unsubscribedEmails, setUnsubscribedEmails] = useOptionalKV<string[]>(getCouncillorKey('unsubscribed-emails'), [])
  const kvTestMode = (import.meta as any).env?.VITE_FE_TEST_KV === 'true'

  // Check if already unsubscribed
  useEffect(() => {
    if (email && (unsubscribedEmails || []).includes(email)) {
      setIsUnsubscribed(true)
    }
  }, [email, unsubscribedEmails])

  const handleUnsubscribe = async () => {
    if (!email) {
      setError('Please enter your email address')
      return
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      // Add to unsubscribed list
      const currentUnsubscribed = unsubscribedEmails || []
      if (!currentUnsubscribed.includes(email)) {
        setUnsubscribedEmails([...currentUnsubscribed, email])
      }

      if (kvTestMode) {
        if (trackingId) {
          await recordUnsubscribe(trackingId, email)
        }
      } else {
        if (campaignId && contactId) {
          await apiClient.recordUnsubscribeEvent({ campaignId, contactId })
        } else {
          await apiClient.addUnsubscribe({ email })
        }
      }

      setIsUnsubscribed(true)
      toast.success('Successfully unsubscribed from municipal emails')
    } catch (err) {
      setError('An error occurred while processing your request. Please try again.')
      console.error('Unsubscribe error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleResubscribe = async () => {
    if (!email) return

    setIsLoading(true)
    try {
      const currentUnsubscribed = unsubscribedEmails || []
      const updatedList = currentUnsubscribed.filter(e => e !== email)
      setUnsubscribedEmails(updatedList)
      if (!kvTestMode) {
        await apiClient.deleteUnsubscribeByEmail(email)
      }
      setIsUnsubscribed(false)
      toast.success('Successfully resubscribed to municipal emails')
    } catch (err) {
      setError('An error occurred while processing your request. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (isUnsubscribed) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircle size={48} className="text-green-500 mx-auto mb-4" />
            <CardTitle>Unsubscribed Successfully</CardTitle>
            <CardDescription>
              You have been removed from our email list
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                Email: <span className="font-medium">{email}</span>
              </p>
              <p className="text-sm">
                You will no longer receive municipal communications at this email address.
              </p>
            </div>
            
            <Separator />
            
            <div className="text-center space-y-3">
              <p className="text-sm text-muted-foreground">
                Changed your mind?
              </p>
              <Button 
                variant="outline" 
                onClick={handleResubscribe}
                disabled={isLoading}
                className="w-full"
              >
                <Envelope size={16} className="mr-2" />
                Resubscribe to Updates
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Envelope size={48} className="text-primary mx-auto mb-4" />
          <CardTitle>Unsubscribe from Municipal Emails</CardTitle>
          <CardDescription>
            We're sorry to see you go. Enter your email address to unsubscribe from future communications.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email address"
              disabled={isLoading}
            />
            {error && (
              <p className="text-sm text-destructive flex items-center gap-2">
                <XCircle size={16} />
                {error}
              </p>
            )}
          </div>

          <Button 
            onClick={handleUnsubscribe}
            disabled={isLoading || !email}
            className="w-full"
          >
            {isLoading ? 'Processing...' : 'Unsubscribe'}
          </Button>

          <Separator />

          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              You can also contact us directly at{' '}
              <a href="mailto:council@municipality.gov" className="text-primary hover:underline">
                council@municipality.gov
              </a>
              {' '}to manage your email preferences.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}