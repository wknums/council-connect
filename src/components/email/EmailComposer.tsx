import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { PaperPlaneRight, TextB, TextItalic, List, Link, Paperclip, Eye } from '@phosphor-icons/react'
import { useKV } from '@github/spark/hooks'
import { useOptionalKV } from '@/hooks/useOptionalKV'
import { toast } from 'sonner'
import { getCouncillorKey } from '@/lib/utils'
import { processEmailContent } from '@/lib/email-tracking'
import { apiClient } from '@/api/client'
// Local minimal prettyBytes fallback to avoid type issues if types not installed
const prettyBytes = (num: number): string => {
  if (num < 1024) return num + ' B'
  const units = ['KB','MB','GB']
  let n = num / 1024
  let u = 0
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++ }
  return n.toFixed(1).replace(/\.0$/, '') + ' ' + units[u]
}

interface Email {
  id: string
  subject: string
  content: string
  selectedLists: string[]
  status: 'draft' | 'sent'
  createdAt: string
  sentAt?: string
  totalRecipients?: number
  processedContent?: string
}

interface DistributionList {
  id: string
  name: string
  contacts: any[]
}

interface UserProfile {
  name: string
  ward: string
  title: string
  email: string
  phone: string
  signature: string
}

export function EmailComposer() {
  // Feature flag: when true, operate fully client-side with KV; when false, use backend API for lists.
  const kvTestMode = (import.meta as any).env?.VITE_FE_TEST_KV === 'true'

  // KV-backed state (always used for drafts; lists only when kvTestMode)
  const [drafts, setDrafts] = useOptionalKV<Email[]>(getCouncillorKey('email-drafts'), [])
  const [kvDistributionLists] = useOptionalKV<DistributionList[]>(getCouncillorKey('distribution-lists'), [])
  const [unsubscribedEmails] = useOptionalKV<string[]>(getCouncillorKey('unsubscribed-emails'), [])
  const [user] = useOptionalKV<UserProfile | null>(getCouncillorKey('user-profile'), null)

  // API-mode distribution lists (authoritative when kvTestMode === false)
  const [apiDistributionLists, setApiDistributionLists] = useState<DistributionList[]>([])

  // Form / UI state
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [selectedLists, setSelectedLists] = useState<string[]>([])
  const [currentDraft, setCurrentDraft] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [attachments, setAttachments] = useState<{ id: string; name: string; size: number; type: string; base64: string }[]>([])
  const MAX_TOTAL_BYTES = 5 * 1024 * 1024 // 5MB aggregate limit (adjust as needed)
  const MAX_FILE_BYTES = 2 * 1024 * 1024 // 2MB single file

  const onSelectAttachments = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const newItems: typeof attachments = []
    let currentTotal = attachments.reduce((sum, a) => sum + a.size, 0)
    for (const f of Array.from(files)) {
      if (f.size > MAX_FILE_BYTES) {
        toast.error(`${f.name} exceeds per-file limit (${prettyBytes(MAX_FILE_BYTES)})`)
        continue
      }
      if (currentTotal + f.size > MAX_TOTAL_BYTES) {
        toast.error(`Adding ${f.name} exceeds total limit (${prettyBytes(MAX_TOTAL_BYTES)})`)
        continue
      }
      try {
        const buf = await f.arrayBuffer()
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
        newItems.push({ id: `${Date.now()}-${f.name}-${Math.random().toString(36).slice(2)}`, name: f.name, size: f.size, type: f.type || 'application/octet-stream', base64: b64 })
        currentTotal += f.size
      } catch (e) {
        toast.error(`Failed to read ${f.name}`)
      }
    }
    if (newItems.length) setAttachments(prev => [...prev, ...newItems])
  }

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }

  const saveDraft = () => {
    const draft: Email = {
      id: currentDraft || Date.now().toString(),
      subject,
      content,
      selectedLists,
      status: 'draft',
      createdAt: currentDraft ? (drafts || []).find(d => d.id === currentDraft)?.createdAt || new Date().toISOString() : new Date().toISOString()
    }

    setDrafts(currentDrafts => {
      if (!currentDrafts) return [draft]
      const existingIndex = currentDrafts.findIndex(d => d.id === draft.id)
      if (existingIndex >= 0) {
        const updated = [...currentDrafts]
        updated[existingIndex] = draft
        return updated
      }
      return [...currentDrafts, draft]
    })

    setCurrentDraft(draft.id)
    toast.success('Draft saved')
  }

  // Backend list refresh (API mode only)
  const refreshApiLists = useCallback(async () => {
    if (kvTestMode) return
    try {
      const r = await apiClient.listDistributionLists()
      const enriched = await Promise.all(r.items.map(async l => {
        try {
          const contactsResp = await apiClient.listContactsForList(l.id)
          return { ...l, contacts: contactsResp.items }
        } catch {
          return { ...l, contacts: [] }
        }
      }))
      setApiDistributionLists(enriched)
    } catch (err) {
      console.warn('Failed to load distribution lists from API', err)
    }
  }, [kvTestMode])

  useEffect(() => {
    if (kvTestMode) return
    refreshApiLists()
    const handler = () => refreshApiLists()
    window.addEventListener('lists-updated', handler)
    // Additional triggers: tab activation event, page visibility changes, and window focus
    const activationHandler = () => refreshApiLists()
    const visibilityHandler = () => {
      if (!document.hidden) refreshApiLists()
    }
    const focusHandler = () => refreshApiLists()
    window.addEventListener('email-composer-activated', activationHandler)
    document.addEventListener('visibilitychange', visibilityHandler)
    window.addEventListener('focus', focusHandler)
    return () => {
      window.removeEventListener('lists-updated', handler)
      window.removeEventListener('email-composer-activated', activationHandler)
      document.removeEventListener('visibilitychange', visibilityHandler)
      window.removeEventListener('focus', focusHandler)
    }
  }, [kvTestMode, refreshApiLists])

  const sendEmail = () => {
    if (!subject.trim() || !content.trim() || selectedLists.length === 0) {
      toast.error('Please fill in all fields and select at least one distribution list')
      return
    }

    // Calculate total recipients after filtering unsubscribed emails
  const effectiveLists = kvTestMode ? (kvDistributionLists || []) : apiDistributionLists
  const selectedDistributionLists = effectiveLists.filter(list => selectedLists.includes(list.id))
    const allRecipients = selectedDistributionLists.flatMap(list => list.contacts || [])
    const activeRecipients = allRecipients.filter(contact => !(unsubscribedEmails || []).includes(contact.email))
    
    if (activeRecipients.length === 0 && !kvTestMode) {
      // In API mode, allow send even if contacts not hydrated locally; backend will resolve recipients.
      toast.info('Sending campaign (contacts will be resolved on server)')
    } else if (activeRecipients.length === 0) {
      toast.error('No active recipients found after applying unsubscribe filters')
      return
    }

    const filteredCount = allRecipients.length - activeRecipients.length
    if (filteredCount > 0) {
      toast.info(`${filteredCount} recipient(s) filtered due to unsubscribe requests`)
    }

    const emailId = currentDraft || Date.now().toString()
    
    // Process email content with tracking and unsubscribe for preview
    const sampleRecipient = activeRecipients[0]
    const processedContent = processEmailContent(content, emailId, sampleRecipient.email, user || undefined)

    const email: Email = {
      id: emailId,
      subject,
      content,
      selectedLists,
      status: 'sent',
      createdAt: currentDraft ? (drafts || []).find(d => d.id === currentDraft)?.createdAt || new Date().toISOString() : new Date().toISOString(),
      sentAt: new Date().toISOString(),
      totalRecipients: activeRecipients.length, // May be 0 in API mode when server resolves
      processedContent
    }

    setDrafts(currentDrafts => {
      if (!currentDrafts) return [email]
      const existingIndex = currentDrafts.findIndex(d => d.id === email.id)
      if (existingIndex >= 0) {
        const updated = [...currentDrafts]
        updated[existingIndex] = email
        return updated
      }
      return [...currentDrafts, email]
    })

    if (!kvTestMode) {
      // Prepare attachment payload (strip base64 if empty)
      const payloadAttachments = attachments.map(a => ({ name: a.name, contentType: a.type, base64: a.base64 }))
      apiClient.createCampaign({ subject, content, listIds: selectedLists, attachments: payloadAttachments })
        .then(() => {
          toast.success(`Campaign queued for ${activeRecipients.length} recipient(s)`)
        })
        .catch(err => {
          toast.error(`Failed to queue campaign: ${err.message}`)
        })
    } else {
      console.log('KV test mode: skipping real backend send.')
    }

    setSubject('')
    setContent('')
    setSelectedLists([])
    setCurrentDraft(null)
  setShowPreview(false)
  setAttachments([])
    toast.success(`Email sent successfully to ${activeRecipients.length} recipient(s)!`)
  }

  const loadDraft = (draft: Email) => {
    setSubject(draft.subject)
    setContent(draft.content)
    setSelectedLists(draft.selectedLists)
    setCurrentDraft(draft.id)
  }

  const formatText = (format: 'bold' | 'italic') => {
    const textarea = document.getElementById('email-content') as HTMLTextAreaElement
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = content.substring(start, end)
    
    if (selectedText) {
      const formatTag = format === 'bold' ? '**' : '*'
      const formattedText = `${formatTag}${selectedText}${formatTag}`
      const newContent = content.substring(0, start) + formattedText + content.substring(end)
      setContent(newContent)
    }
  }

  const pendingDrafts = (drafts || []).filter(d => d.status === 'draft')

  // Calculate recipient counts for selected lists
  const getRecipientCounts = () => {
    if (selectedLists.length === 0) return { total: 0, active: 0, filtered: 0 }
    
  const effectiveLists = kvTestMode ? (kvDistributionLists || []) : apiDistributionLists
  const selectedDistributionLists = effectiveLists.filter(list => selectedLists.includes(list.id))
    const allRecipients = selectedDistributionLists.flatMap(list => list.contacts || [])
    const activeRecipients = allRecipients.filter(contact => !(unsubscribedEmails || []).includes(contact.email))
    
    return {
      total: allRecipients.length,
      active: activeRecipients.length,
      filtered: allRecipients.length - activeRecipients.length
    }
  }

  const recipientCounts = getRecipientCounts()

  // Generate preview content with tracking
  const getPreviewContent = () => {
    if (!content || selectedLists.length === 0) return ''
    
  const effectiveLists = kvTestMode ? (kvDistributionLists || []) : apiDistributionLists
  const selectedDistributionLists = effectiveLists.filter(list => selectedLists.includes(list.id))
    const allRecipients = selectedDistributionLists.flatMap(list => list.contacts || [])
    const activeRecipients = allRecipients.filter(contact => !(unsubscribedEmails || []).includes(contact.email))
    
    if (activeRecipients.length === 0) return content
    
    const sampleRecipient = activeRecipients[0]
    const emailId = currentDraft || 'preview'
    return processEmailContent(content, emailId, sampleRecipient.email, user || undefined)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PaperPlaneRight size={20} />
              Compose Email
            </CardTitle>
            <CardDescription>
              Create and send emails to your constituent distribution lists
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Enter email subject..."
              />
            </div>

            <div className="space-y-2">
              <Label>Distribution Lists</Label>
              <Select
                value=""
                onValueChange={(value) => {
                  if (!selectedLists.includes(value)) {
                    setSelectedLists([...selectedLists, value])
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select distribution lists..." />
                </SelectTrigger>
                <SelectContent>
                  {(kvTestMode ? (kvDistributionLists || []) : apiDistributionLists).map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name} ({list.contacts?.length || 0} contacts)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedLists.map((listId) => {
                  const effectiveLists = kvTestMode ? (kvDistributionLists || []) : apiDistributionLists
                  const list = effectiveLists.find(l => l.id === listId)
                  return list ? (
                    <Badge key={listId} variant="secondary" className="flex items-center gap-1">
                      {list.name}
                      <button
                        onClick={() => setSelectedLists(selectedLists.filter(id => id !== listId))}
                        className="ml-1 hover:text-destructive"
                      >
                        ×
                      </button>
                    </Badge>
                  ) : null
                })}
              </div>
              {selectedLists.length > 0 && (
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Recipients: {recipientCounts.active} active contacts</p>
                  {recipientCounts.filtered > 0 && (
                    <p className="text-amber-600">
                      {recipientCounts.filtered} contact(s) will be filtered due to unsubscribe requests
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="attachments" className="flex items-center gap-2">
                Attachments
                <span className="text-xs text-muted-foreground">(optional)</span>
              </Label>
              <Input id="attachments" type="file" multiple onChange={(e) => onSelectAttachments(e.target.files)} />
              {attachments.length > 0 && (
                <div className="border rounded-md p-2 space-y-2 bg-muted/30">
                  <div className="text-xs text-muted-foreground flex justify-between">
                    <span>{attachments.length} file(s) attached</span>
                    <span>{prettyBytes(attachments.reduce((s,a)=>s+a.size,0))} / {prettyBytes(MAX_TOTAL_BYTES)}</span>
                  </div>
                  <ul className="text-sm space-y-1 max-h-40 overflow-auto">
                    {attachments.map(a => (
                      <li key={a.id} className="flex items-center justify-between gap-2">
                        <span className="truncate" title={a.name}>{a.name} <span className="text-xs text-muted-foreground">({prettyBytes(a.size)})</span></span>
                        <button onClick={() => removeAttachment(a.id)} className="text-destructive text-xs hover:underline">Remove</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="email-content">Email Content</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPreview(!showPreview)}
                  className="flex items-center gap-1"
                >
                  <Eye size={16} />
                  {showPreview ? 'Edit' : 'Preview'}
                </Button>
              </div>
              
              {showPreview ? (
                <div className="border rounded-md p-4 bg-card min-h-64 max-h-96 overflow-auto">
                  <div className="text-sm text-muted-foreground mb-3 pb-3 border-b">
                    <p className="font-medium">Preview (with tracking & unsubscribe)</p>
                    <p className="text-xs">This shows how recipients will see the email</p>
                  </div>
                  <div 
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: getPreviewContent() }}
                  />
                </div>
              ) : (
                <div className="border rounded-md">
                  <div className="flex items-center gap-1 p-2 border-b bg-muted/50">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => formatText('bold')}
                    >
                      <TextB size={16} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => formatText('italic')}
                    >
                      <TextItalic size={16} />
                    </Button>
                    <Button variant="ghost" size="sm">
                      <List size={16} />
                    </Button>
                    <Button variant="ghost" size="sm">
                      <Link size={16} />
                    </Button>
                    <Separator orientation="vertical" className="h-6" />
                    <Button variant="ghost" size="sm">
                      <Paperclip size={16} />
                    </Button>
                    <div className="ml-auto text-xs text-muted-foreground">
                      Unsubscribe link & tracking will be added automatically
                    </div>
                  </div>
                  <Textarea
                    id="email-content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Write your email content here..."
                    className="min-h-64 border-0 resize-none focus-visible:ring-0"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={saveDraft}>
                Save Draft
              </Button>
              <Button onClick={sendEmail}>
                <PaperPlaneRight size={16} className="mr-2" />
                Send Email
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <Card>
          <CardHeader>
            <CardTitle>Drafts</CardTitle>
            <CardDescription>
              Your saved email drafts
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pendingDrafts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No drafts saved</p>
            ) : (
              <div className="space-y-3">
                {pendingDrafts.map((draft) => (
                  <div
                    key={draft.id}
                    className="p-3 border rounded-lg cursor-pointer hover:bg-muted/50"
                    onClick={() => loadDraft(draft)}
                  >
                    <h4 className="font-medium truncate">
                      {draft.subject || 'Untitled Draft'}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      {new Date(draft.createdAt).toLocaleDateString()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {draft.selectedLists.length} lists selected
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}