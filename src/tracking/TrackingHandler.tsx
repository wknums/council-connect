import { useEffect } from 'react'
import { recordEmailOpen, recordUnsubscribe } from '@/lib/email-tracking'
import { toast } from 'sonner'

interface TrackingHandlerProps {
  action: 'open' | 'unsubscribe'
  emailId?: string
  recipientEmail?: string
  trackingId?: string
  onComplete?: () => void
}

/**
 * Component to handle email tracking actions
 * In a real application, this would be handled by server endpoints
 */
export function TrackingHandler({ 
  action, 
  emailId, 
  recipientEmail, 
  trackingId, 
  onComplete 
}: TrackingHandlerProps) {
  
  useEffect(() => {
    const handleTracking = async () => {
      if (!emailId || !recipientEmail) return

      try {
        if (action === 'open') {
          await recordEmailOpen(
            emailId, 
            recipientEmail, 
            navigator.userAgent,
            'client-ip' // In real app, this would come from server
          )
          console.log('Email open tracked:', { emailId, recipientEmail })
        } else if (action === 'unsubscribe') {
          await recordUnsubscribe(emailId, recipientEmail)
          toast.success('Successfully unsubscribed from future emails')
          console.log('Unsubscribe tracked:', { emailId, recipientEmail })
        }
        
        onComplete?.()
      } catch (error) {
        console.error('Tracking error:', error)
      }
    }

    handleTracking()
  }, [action, emailId, recipientEmail, trackingId, onComplete])

  return null // This component doesn't render anything
}

/**
 * Utility function to simulate tracking pixel requests
 * In a real app, this would be server endpoints
 */
export function createTrackingHandlers() {
  // Handle tracking pixel requests
  const handleTrackingPixel = (searchParams: URLSearchParams) => {
    const trackingId = searchParams.get('id')
    const email = searchParams.get('email')
    
    if (trackingId && email) {
      // In a real app, you'd extract emailId from trackingId
      const emailId = trackingId // Simplified for demo
      recordEmailOpen(emailId, decodeURIComponent(email))
    }
    
    // Return 1x1 transparent pixel
    return new Response(
      new Uint8Array([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2C, 0x00, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x04, 0x01, 0x00, 0x3B
      ]),
      {
        headers: {
          'Content-Type': 'image/gif',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }
    )
  }

  // Handle unsubscribe requests
  const handleUnsubscribe = async (searchParams: URLSearchParams) => {
    const trackingId = searchParams.get('id')
    const email = searchParams.get('email')
    
    if (trackingId && email) {
      const emailId = trackingId // Simplified for demo
      await recordUnsubscribe(emailId, decodeURIComponent(email))
    }
    
    return { success: true }
  }

  return {
    handleTrackingPixel,
    handleUnsubscribe
  }
}