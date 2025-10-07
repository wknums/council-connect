import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { PaperPlaneRight, TextBolder, TextItalic, List, Link, Paperclip } from '@phosphor-icons/react'
import { useKV } from '@github/spark/hooks'
import { toast } from 'sonner'

interface Email {
  id: string
  subject: string
  content: string
  selectedLists: string[]
  status: 'draft' | 'sent'
  createdAt: string
  sentAt?: string
}

interface DistributionList {
  id: string
  name: string
  contacts: any[]
}

export function EmailComposer() {
  const [drafts, setDrafts] = useKV<Email[]>('email-drafts', [])
  const [distributionLists] = useKV<DistributionList[]>('distribution-lists', [])
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [selectedLists, setSelectedLists] = useState<string[]>([])
  const [currentDraft, setCurrentDraft] = useState<string | null>(null)

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

  const sendEmail = () => {
    if (!subject.trim() || !content.trim() || selectedLists.length === 0) {
      toast.error('Please fill in all fields and select at least one distribution list')
      return
    }

    const email: Email = {
      id: currentDraft || Date.now().toString(),
      subject,
      content,
      selectedLists,
      status: 'sent',
      createdAt: currentDraft ? (drafts || []).find(d => d.id === currentDraft)?.createdAt || new Date().toISOString() : new Date().toISOString(),
      sentAt: new Date().toISOString()
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

    setSubject('')
    setContent('')
    setSelectedLists([])
    setCurrentDraft(null)
    toast.success('Email sent successfully!')
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
                  {(distributionLists || []).map((list) => (
                    <SelectItem key={list.id} value={list.id}>
                      {list.name} ({list.contacts?.length || 0} contacts)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedLists.map((listId) => {
                  const list = (distributionLists || []).find(l => l.id === listId)
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
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-content">Email Content</Label>
              <div className="border rounded-md">
                <div className="flex items-center gap-1 p-2 border-b bg-muted/50">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => formatText('bold')}
                  >
                    <TextBolder size={16} />
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
                </div>
                <Textarea
                  id="email-content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write your email content here..."
                  className="min-h-64 border-0 resize-none focus-visible:ring-0"
                />
              </div>
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