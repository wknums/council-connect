import { getCouncillorKey } from './utils'

export interface EmailTrackingData {
  emailId: string
  recipientEmail: string
  openedAt?: string
  unsubscribedAt?: string
  userAgent?: string
  ipAddress?: string
}

export interface EmailMetrics {
  emailId: string
  totalSent: number
  totalOpened: number
  totalUnsubscribed: number
  openRate: number
  uniqueOpenRate: number
  unsubscribeRate: number
  opens: EmailTrackingData[]
  uniqueOpens: EmailTrackingData[]
  unsubscribes: EmailTrackingData[]
}

/**
 * Generates a unique tracking ID for email/recipient combinations
 */
export function generateTrackingId(emailId: string, recipientEmail: string): string {
  // Create a simple hash-like ID that's not easily guessable
  const combined = `${emailId}:${recipientEmail}:${Date.now()}`
  return btoa(combined).replace(/[+=\/]/g, '').substring(0, 16)
}

/**
 * Creates an unsubscribe URL for a specific email/recipient
 */
export function createUnsubscribeUrl(emailId: string, recipientEmail: string, campaignId?: string, contactId?: string, councillorId?: string): string {
  // Use the configured API base URL, fallback to localhost development API
  const configuredApiUrl = (import.meta as any).env?.VITE_API_BASE_URL
  const apiBaseUrl = configuredApiUrl || 'http://localhost:7071/api'
  
  // Build query parameters
  const params = new URLSearchParams({
    email: recipientEmail
  })
  
  if (campaignId) params.set('campaignId', campaignId)
  if (contactId) params.set('contactId', contactId)
  if (councillorId) params.set('councillorId', councillorId)
  
  return `${apiBaseUrl}/unsubscribe?${params.toString()}`
}

/**
 * Creates a tracking pixel URL for email open tracking
 */
export function createTrackingPixelUrl(emailId: string, recipientEmail: string, campaignId?: string, contactId?: string, councillorId?: string): string {
  // Use the configured API base URL, fallback to localhost development API
  const configuredApiUrl = (import.meta as any).env?.VITE_API_BASE_URL
  const apiBaseUrl = configuredApiUrl || 'http://localhost:7071/api'
  
  // Build query parameters for tracking pixel
  const params = new URLSearchParams({
    email: recipientEmail
  })
  
  if (campaignId) params.set('campaignId', campaignId)
  if (contactId) params.set('contactId', contactId) 
  if (councillorId) params.set('councillorId', councillorId)
  
  return `${apiBaseUrl}/track/pixel?${params.toString()}`
}

/**
 * Processes email content to add unsubscribe links and tracking pixels
 */
export function processEmailContent(
  content: string, 
  emailId: string, 
  recipientEmail: string,
  userProfile?: { name?: string; ward?: string },
  campaignId?: string,
  contactId?: string,
  councillorId?: string
): string {
  const unsubscribeUrl = createUnsubscribeUrl(emailId, recipientEmail, campaignId, contactId, councillorId)
  const trackingPixelUrl = createTrackingPixelUrl(emailId, recipientEmail, campaignId, contactId, councillorId)
  
  // Add tracking pixel (1x1 transparent image)
  const trackingPixel = `<img src="${trackingPixelUrl}" width="1" height="1" style="display:block;border:0;outline:none;text-decoration:none;" alt="" />`
  
  // Create unsubscribe footer
  const senderInfo = userProfile ? `${userProfile.name}${userProfile.ward ? ` - ${userProfile.ward}` : ''}` : 'Municipal Office'
  const unsubscribeFooter = `
    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; line-height: 1.4;">
      <p style="margin: 0 0 8px 0;">
        This email was sent by ${senderInfo}. 
      </p>
      <p style="margin: 0;">
        If you no longer wish to receive these communications, you can 
        <a href="${unsubscribeUrl}" style="color: #3b82f6; text-decoration: underline;">unsubscribe here</a>.
      </p>
    </div>
  `
  
  // Convert plain text to HTML if needed
  let htmlContent = content.includes('<') ? content : content.replace(/\n/g, '<br>')
  
  // Wrap in basic HTML structure if not already HTML
  if (!htmlContent.includes('<html>') && !htmlContent.includes('<body>')) {
    htmlContent = `
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          ${htmlContent}
          ${unsubscribeFooter}
          ${trackingPixel}
        </body>
      </html>
    `
  } else {
    // Insert footer and tracking pixel before closing body tag
    htmlContent = htmlContent.replace(
      /<\/body>/i, 
      `${unsubscribeFooter}${trackingPixel}</body>`
    )
  }
  
  return htmlContent
}

/**
 * Records an email open event
 */
export async function recordEmailOpen(
  emailId: string, 
  recipientEmail: string, 
  userAgent?: string, 
  ipAddress?: string
): Promise<void> {
  const tracking: EmailTrackingData = {
    emailId,
    recipientEmail,
    openedAt: new Date().toISOString(),
    userAgent,
    ipAddress
  }
  
  // Store in KV with tracking ID as key
  const trackingId = generateTrackingId(emailId, recipientEmail)
  if (typeof window !== 'undefined' && window.spark) {
    await window.spark.kv.set(`tracking:${trackingId}`, tracking)
    
    // Also update aggregated opens list
    const opensKey = getCouncillorKey(`email-opens:${emailId}`)
    const existingOpens = await window.spark.kv.get<EmailTrackingData[]>(opensKey) || []
    
    // Check if already opened to avoid duplicates
    const alreadyOpened = existingOpens.some(open => open.recipientEmail === recipientEmail)
    if (!alreadyOpened) {
      await window.spark.kv.set(opensKey, [...existingOpens, tracking])
    }
  }
}

/**
 * Records an unsubscribe event
 */
export async function recordUnsubscribe(emailId: string, recipientEmail: string): Promise<void> {
  const tracking: EmailTrackingData = {
    emailId,
    recipientEmail,
    unsubscribedAt: new Date().toISOString()
  }
  
  if (typeof window !== 'undefined' && window.spark) {
    // Add to unsubscribed emails list
    const unsubscribedKey = getCouncillorKey('unsubscribed-emails')
    const currentUnsubscribed = await window.spark.kv.get<string[]>(unsubscribedKey) || []
    
    if (!currentUnsubscribed.includes(recipientEmail)) {
      await window.spark.kv.set(unsubscribedKey, [...currentUnsubscribed, recipientEmail])
    }
    
    // Record the unsubscribe event
    const unsubscribesKey = getCouncillorKey(`email-unsubscribes:${emailId}`)
    const existingUnsubscribes = await window.spark.kv.get<EmailTrackingData[]>(unsubscribesKey) || []
    await window.spark.kv.set(unsubscribesKey, [...existingUnsubscribes, tracking])
  }
}

/**
 * Gets email metrics for a specific email
 */
export async function getEmailMetrics(emailId: string, totalSent: number): Promise<EmailMetrics> {
  if (typeof window === 'undefined' || !window.spark) {
    return {
      emailId,
      totalSent,
      totalOpened: 0,
      totalUnsubscribed: 0,
      openRate: 0,
      uniqueOpenRate: 0,
      unsubscribeRate: 0,
      opens: [],
      uniqueOpens: [],
      unsubscribes: []
    }
  }
  
  const opensKey = getCouncillorKey(`email-opens:${emailId}`)
  const unsubscribesKey = getCouncillorKey(`email-unsubscribes:${emailId}`)
  
  const opens = await window.spark.kv.get<EmailTrackingData[]>(opensKey) || []
  const unsubscribes = await window.spark.kv.get<EmailTrackingData[]>(unsubscribesKey) || []
  
  // Calculate unique opens by email address (one open per recipient)
  const uniqueOpensMap = new Map<string, EmailTrackingData>()
  opens.forEach(open => {
    const key = open.recipientEmail
    if (!uniqueOpensMap.has(key) || new Date(open.openedAt || '') < new Date(uniqueOpensMap.get(key)!.openedAt || '')) {
      uniqueOpensMap.set(key, open)
    }
  })
  const uniqueOpens = Array.from(uniqueOpensMap.values())

  return {
    emailId,
    totalSent,
    totalOpened: opens.length,
    totalUnsubscribed: unsubscribes.length,
    openRate: totalSent > 0 ? (opens.length / totalSent) * 100 : 0,
    uniqueOpenRate: totalSent > 0 ? (uniqueOpens.length / totalSent) * 100 : 0,
    unsubscribeRate: totalSent > 0 ? (unsubscribes.length / totalSent) * 100 : 0,
    opens,
    uniqueOpens,
    unsubscribes
  }
}