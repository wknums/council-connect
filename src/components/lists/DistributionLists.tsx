import { ChangeEvent, useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Plus, Users, Trash, PencilSimple, Download, Upload } from '@phosphor-icons/react'
import { useOptionalKV } from '@/hooks/useOptionalKV'
import { toast } from 'sonner'
import { getCouncillorKey } from '@/lib/utils'
import { apiClient } from '@/api/client'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CONTACTS_PER_PAGE = 200
const CSV_REQUIRED_HEADERS = ['firstname', 'lastname', 'email'] as const

type SortField = 'name' | 'email' | 'addedAt'
type SortDirection = 'asc' | 'desc'

interface SortState {
  field: SortField
  direction: SortDirection
}

interface Contact {
  id: string
  email: string
  firstName: string
  lastName: string
  addedAt: string
}

interface DistributionList {
  id: string
  name: string
  description: string
  contacts: Contact[]
  createdAt: string
}

export function DistributionLists() {
  const [distributionLists, setDistributionLists] = useOptionalKV<DistributionList[]>(getCouncillorKey('distribution-lists'), [])
  const [unsubscribedEmails] = useOptionalKV<string[]>(getCouncillorKey('unsubscribed-emails'), [])
  const [isCreating, setIsCreating] = useState(false)
  const [editingList, setEditingList] = useState<DistributionList | null>(null)
  const [newListName, setNewListName] = useState('')
  const [newListDescription, setNewListDescription] = useState('')
  const [newContactEmail, setNewContactEmail] = useState('')
  const [newContactFirstName, setNewContactFirstName] = useState('')
  const [newContactLastName, setNewContactLastName] = useState('')
  const [sortState, setSortState] = useState<Record<string, SortState>>({})
  const [pageState, setPageState] = useState<Record<string, number>>({})
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const downloadHrefRefs = useRef<Record<string, HTMLAnchorElement | null>>({})
  const [importStatus, setImportStatus] = useState<Record<string, { total: number; completed: number; pending: number; skippedDuplicates: number; skippedInvalid: number }>>({})
  const [importingLists, setImportingLists] = useState<Record<string, boolean>>({})

  const kvTestMode = (import.meta as any).env?.VITE_FE_TEST_KV === 'true'

  const ensureListUiState = (lists: DistributionList[] | undefined) => {
    if (!lists || lists.length === 0) return
    setSortState(prev => {
      const next = { ...prev }
      let changed = false
      lists.forEach(list => {
        if (!next[list.id]) {
          next[list.id] = { field: 'addedAt', direction: 'desc' }
          changed = true
        }
      })
      return changed ? next : prev
    })
    setPageState(prev => {
      const next = { ...prev }
      let changed = false
      lists.forEach(list => {
        if (!next[list.id]) {
          next[list.id] = 1
          changed = true
        }
      })
      return changed ? next : prev
    })
  }

  useEffect(() => {
    ensureListUiState(distributionLists || [])
  }, [distributionLists])

  useEffect(() => {
    if (kvTestMode) return
    let cancelled = false
    apiClient.listDistributionLists()
      .then(async r => {
        const lists = r.items
        // Fetch contacts per list in parallel
        const enriched = await Promise.all(lists.map(async l => {
          try {
            const resp = await apiClient.listContactsForList(l.id)
            return { ...l, contacts: resp.items }
          } catch {
            return { ...l, contacts: [] }
          }
        }))
        if (!cancelled) {
          setDistributionLists(enriched as any)
          ensureListUiState(enriched as any)
        }
      })
      .catch(err => {
        console.error('List fetch failed', err)
        toast.error('Failed to load distribution lists')
      })
    return () => { cancelled = true }
  }, [kvTestMode, setDistributionLists])

  const createList = () => {
    if (!newListName.trim()) {
      toast.error('Please enter a list name')
      return
    }
    if (kvTestMode) {
      const newList: DistributionList = {
        id: Date.now().toString(),
        name: newListName,
        description: newListDescription,
        contacts: [],
        createdAt: new Date().toISOString()
      }
      setDistributionLists(currentLists => [...(currentLists || []), newList])
      ensureListUiState([newList])
      toast.success('Distribution list created')
    } else {
      apiClient.createDistributionList({ name: newListName, description: newListDescription })
        .then(created => {
          const newList = { ...created, contacts: [] as Contact[] }
          setDistributionLists(curr => [...(curr || []), newList])
          ensureListUiState([newList])
          toast.success('Distribution list created')
          window.dispatchEvent(new CustomEvent('lists-updated'))
        })
        .catch(err => {
          const msg = /404/.test(err.message) ? 'API endpoint not found (check Functions host running & proxy).' : err.message
          toast.error(`Failed to create list: ${msg}`)
        })
    }
    setNewListName('')
    setNewListDescription('')
    setIsCreating(false)
  }

  const deleteList = (listId: string) => {
    if (kvTestMode) {
      setDistributionLists(currentLists => 
        (currentLists || []).filter(list => list.id !== listId)
      )
      toast.success('Distribution list deleted')
      return
    }
    const prev = distributionLists
    setDistributionLists(currentLists => (currentLists || []).filter(l => l.id !== listId))
    apiClient.deleteDistributionList(listId)
      .then(() => toast.success('Distribution list deleted'))
      .catch(err => {
        setDistributionLists(() => prev || [])
        toast.error(`Delete failed: ${err.message}`)
      })
      .finally(() => {
        window.dispatchEvent(new CustomEvent('lists-updated'))
      })
  }

  const addContact = (listId: string) => {
    if (!newContactEmail.trim() || !newContactFirstName.trim() || !newContactLastName.trim()) {
      toast.error('Please fill in all contact fields')
      return
    }

    if (!EMAIL_REGEX.test(newContactEmail)) {
      toast.error('Please enter a valid email address')
      return
    }

    const normalizedEmail = newContactEmail.trim().toLowerCase()
    const targetList = (distributionLists || []).find(list => list.id === listId)

    if (!targetList) {
      toast.error('Unable to find distribution list')
      return
    }

    const hasDuplicate = targetList.contacts.some(contact => contact.email.trim().toLowerCase() === normalizedEmail)
    if (hasDuplicate) {
      toast.error('Email address already exists in this list')
      return
    }

    if (kvTestMode) {
      const newContact: Contact = {
        id: Date.now().toString(),
        email: newContactEmail,
        firstName: newContactFirstName,
        lastName: newContactLastName,
        addedAt: new Date().toISOString()
      }
      setDistributionLists(currentLists => (currentLists || []).map(list => list.id === listId ? { ...list, contacts: [...list.contacts, newContact] } : list))
    } else {
      apiClient.addContact(listId, { email: newContactEmail, firstName: newContactFirstName, lastName: newContactLastName })
        .then(contact => setDistributionLists(currentLists => (currentLists || []).map(list => list.id === listId ? { ...list, contacts: [...list.contacts, contact] } : list)))
        .catch(err => toast.error(`Add contact failed: ${err.message}`))
    }

    setNewContactEmail('')
    setNewContactFirstName('')
    setNewContactLastName('')
    toast.success('Contact added')
  }

  const removeContact = (listId: string, contactId: string) => {
    if (kvTestMode) {
      setDistributionLists(currentLists => (currentLists || []).map(list => list.id === listId ? { ...list, contacts: list.contacts.filter(c => c.id !== contactId) } : list))
      toast.success('Contact removed')
      return
    }
    const prev = distributionLists
    setDistributionLists(currentLists => (currentLists || []).map(list => list.id === listId ? { ...list, contacts: list.contacts.filter(c => c.id !== contactId) } : list))
    apiClient.deleteContact(contactId)
      .then(() => toast.success('Contact removed'))
      .catch(err => {
        setDistributionLists(() => prev || [])
        toast.error(`Remove failed: ${err.message}`)
      })
      .finally(() => {
        window.dispatchEvent(new CustomEvent('lists-updated'))
      })
  }

  const getActiveContacts = (contacts: Contact[]) => {
    return contacts.filter(contact => !(unsubscribedEmails || []).includes(contact.email))
  }

  const getSortSettings = (listId: string): SortState => {
    return sortState[listId] || { field: 'addedAt', direction: 'desc' }
  }

  const sortContacts = (listId: string, contacts: Contact[]) => {
    const currentSort = getSortSettings(listId)
    const sorted = [...contacts].sort((a, b) => {
      let aValue: string | number
      let bValue: string | number

      switch (currentSort.field) {
        case 'name':
          aValue = `${a.firstName} ${a.lastName}`.trim().toLowerCase()
          bValue = `${b.firstName} ${b.lastName}`.trim().toLowerCase()
          break
        case 'email':
          aValue = a.email.toLowerCase()
          bValue = b.email.toLowerCase()
          break
        default:
          aValue = new Date(a.addedAt).getTime()
          bValue = new Date(b.addedAt).getTime()
          break
      }

      if (aValue < bValue) return currentSort.direction === 'asc' ? -1 : 1
      if (aValue > bValue) return currentSort.direction === 'asc' ? 1 : -1
      return 0
    })

    return sorted
  }

  const updateSortField = (listId: string, field: SortField) => {
    setSortState(prev => ({
      ...prev,
      [listId]: {
        field,
        direction: prev[listId]?.direction || 'asc',
      },
    }))
    setPageState(prev => ({
      ...prev,
      [listId]: 1,
    }))
  }

  const updateSortDirection = (listId: string, direction: SortDirection) => {
    setSortState(prev => ({
      ...prev,
      [listId]: {
        field: prev[listId]?.field || 'addedAt',
        direction,
      },
    }))
    setPageState(prev => ({
      ...prev,
      [listId]: 1,
    }))
  }

  const changePage = (listId: string, nextPage: number) => {
    setPageState(prev => ({
      ...prev,
      [listId]: Math.max(1, nextPage),
    }))
  }

  const downloadContactsCsv = (listId: string, contacts: Contact[]) => {
    if (contacts.length === 0) {
      toast.error('No contacts in this list to export')
      return
    }

    const headers = ['firstName', 'lastName', 'email']
    const rows = contacts.map(contact => [
      contact.firstName,
      contact.lastName,
      contact.email,
    ])

    const csvContent = [headers, ...rows]
      .map(cols => cols.map(value => {
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          return '"' + value.replace(/"/g, '""') + '"'
        }
        return value
      }).join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)

    const link = downloadHrefRefs.current[listId]
    if (!link) {
      toast.error('Unable to initiate download')
      URL.revokeObjectURL(url)
      return
    }

    link.href = url
    link.download = `${listId}-contacts.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImportClick = (listId: string) => {
    const input = fileInputRefs.current[listId]
    if (input) {
      input.click()
    }
  }

  const parseCsvContacts = (csvContent: string) => {
    const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0)
    if (lines.length === 0) return [] as Array<{ firstName: string; lastName: string; email: string }>

    const headers = lines[0].split(',').map(header => header.trim().toLowerCase())
    const headerIndexes: Record<typeof CSV_REQUIRED_HEADERS[number], number> = {
      firstname: headers.indexOf('firstname'),
      lastname: headers.indexOf('lastname'),
      email: headers.indexOf('email'),
    }

    const hasAllHeaders = CSV_REQUIRED_HEADERS.every(header => headerIndexes[header] >= 0)
    if (!hasAllHeaders) {
      throw new Error('CSV is missing required headers: firstName, lastName, email')
    }

    const contacts: Array<{ firstName: string; lastName: string; email: string }> = []

    for (let i = 1; i < lines.length; i += 1) {
      const row = lines[i]
      if (!row.trim()) continue
      const columns = row.split(',').map(col => col.trim())
      const firstName = columns[headerIndexes.firstname] || ''
      const lastName = columns[headerIndexes.lastname] || ''
      const email = columns[headerIndexes.email] || ''
      contacts.push({ firstName, lastName, email })
    }

    return contacts
  }

  const handleFileChange = async (listId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const targetList = (distributionLists || []).find(list => list.id === listId)
    if (!targetList) {
      toast.error('Unable to locate distribution list for import')
      return
    }

    try {
      setImportingLists(prev => ({ ...prev, [listId]: true }))
      const content = await file.text()
      const parsed = parseCsvContacts(content)
      if (parsed.length === 0) {
        toast.error('No contacts found in import file')
        setImportingLists(prev => ({ ...prev, [listId]: false }))
        return
      }

      const existingEmails = new Set(targetList.contacts.map(contact => contact.email.trim().toLowerCase()))
      const seenInImport = new Set<string>()

      const validEntries: Array<{ firstName: string; lastName: string; email: string }> = []
      let skippedInvalid = 0
      let skippedDuplicates = 0

      parsed.forEach(({ firstName, lastName, email }) => {
        const normalizedEmail = email.trim().toLowerCase()
        if (!firstName.trim() || !lastName.trim() || !EMAIL_REGEX.test(email)) {
          skippedInvalid += 1
          return
        }
        if (existingEmails.has(normalizedEmail) || seenInImport.has(normalizedEmail)) {
          skippedDuplicates += 1
          return
        }

        seenInImport.add(normalizedEmail)
        validEntries.push({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim() })
      })

      setImportStatus(prev => ({
        ...prev,
        [listId]: {
          total: validEntries.length,
          completed: 0,
          pending: validEntries.length,
          skippedDuplicates,
          skippedInvalid,
        },
      }))

      if (validEntries.length === 0) {
        toast.error('No new contacts to import (all were invalid or duplicates)')
        setImportingLists(prev => ({ ...prev, [listId]: false }))
        return
      }

      if (kvTestMode) {
        const addedContacts: Contact[] = validEntries.map((entry, index) => ({
          id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tmp-${Date.now()}-${index}`,
          firstName: entry.firstName,
          lastName: entry.lastName,
          email: entry.email,
          addedAt: new Date(Date.now() + index).toISOString(),
        }))

        setDistributionLists(currentLists => (currentLists || []).map(list =>
          list.id === listId ? { ...list, contacts: [...list.contacts, ...addedContacts] } : list
        ))

        setImportStatus(prev => ({
          ...prev,
          [listId]: {
            total: addedContacts.length,
            completed: addedContacts.length,
            pending: 0,
            skippedDuplicates,
            skippedInvalid,
          },
        }))
        setImportingLists(prev => ({ ...prev, [listId]: false }))

        toast.success(`Imported ${addedContacts.length} contacts${skippedDuplicates ? `, ${skippedDuplicates} duplicates skipped` : ''}${skippedInvalid ? `, ${skippedInvalid} invalid skipped` : ''}`)
        return
      }

      const addedContacts: Contact[] = []
      let failedAdds = 0

      for (const entry of validEntries) {
        try {
          const contact = await apiClient.addContact(listId, entry)
          addedContacts.push(contact)
          setImportStatus(prev => {
            const status = prev[listId]
            if (!status) return prev
            const completed = status.completed + 1
            return {
              ...prev,
              [listId]: {
                ...status,
                completed,
                pending: Math.max(0, status.total - completed),
              },
            }
          })
        } catch (error) {
          console.error('Failed to import contact', error)
          failedAdds += 1
        }
      }

      if (addedContacts.length > 0) {
        setDistributionLists(currentLists => (currentLists || []).map(list =>
          list.id === listId ? { ...list, contacts: [...list.contacts, ...addedContacts] } : list
        ))
        toast.success(`Imported ${addedContacts.length} contacts${skippedDuplicates ? `, ${skippedDuplicates} duplicates skipped` : ''}${skippedInvalid ? `, ${skippedInvalid} invalid skipped` : ''}${failedAdds ? `, ${failedAdds} failed` : ''}`)
        window.dispatchEvent(new CustomEvent('lists-updated'))
      }

      if (failedAdds && addedContacts.length === 0) {
        toast.error('Import failed for all contacts. Please check API availability.')
      }

      setImportStatus(prev => ({
        ...prev,
        [listId]: {
          total: prev[listId]?.total ?? validEntries.length,
          completed: prev[listId]?.completed ?? addedContacts.length,
          pending: Math.max(0, (prev[listId]?.total ?? validEntries.length) - (prev[listId]?.completed ?? addedContacts.length)),
          skippedDuplicates,
          skippedInvalid,
        },
      }))
      setImportingLists(prev => ({ ...prev, [listId]: false }))
    } catch (error: any) {
      console.error('Contact import failed', error)
      toast.error(error?.message || 'Failed to import contacts')
      setImportingLists(prev => ({ ...prev, [listId]: false }))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Distribution Lists</h2>
          <p className="text-muted-foreground">Manage your constituent contact lists</p>
        </div>
        <Dialog open={isCreating} onOpenChange={setIsCreating}>
          <DialogTrigger asChild>
            <Button>
              <Plus size={16} className="mr-2" />
              Create List
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Distribution List</DialogTitle>
              <DialogDescription>
                Add a new list to organize your contacts
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="list-name">List Name</Label>
                <Input
                  id="list-name"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="e.g., Ward 5 Residents"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="list-description">Description</Label>
                <Input
                  id="list-description"
                  value={newListDescription}
                  onChange={(e) => setNewListDescription(e.target.value)}
                  placeholder="Brief description of this list"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsCreating(false)}>
                  Cancel
                </Button>
                <Button onClick={createList}>Create List</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6">
        {(distributionLists || []).length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Users size={48} className="text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No distribution lists yet</h3>
              <p className="text-muted-foreground mb-4">Create your first list to start organizing contacts</p>
              <Button onClick={() => setIsCreating(true)}>
                <Plus size={16} className="mr-2" />
                Create First List
              </Button>
            </CardContent>
          </Card>
        ) : (
          (distributionLists || []).map((list) => {
            const activeContacts = getActiveContacts(list.contacts)
            const sortedContacts = sortContacts(list.id, activeContacts)
            const totalContacts = sortedContacts.length
            const totalPages = Math.max(1, Math.ceil(totalContacts / CONTACTS_PER_PAGE))
            const currentPage = Math.min(pageState[list.id] || 1, totalPages)
            const pageStart = (currentPage - 1) * CONTACTS_PER_PAGE
            const pageEnd = pageStart + CONTACTS_PER_PAGE
            const pagedContacts = sortedContacts.slice(pageStart, pageEnd)
            const sortSettings = getSortSettings(list.id)
            return (
              <Card key={list.id}>
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Users size={20} />
                        {list.name}
                      </CardTitle>
                      <CardDescription>{list.description}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">
                        {activeContacts.length} active contacts
                      </Badge>
                      <Button variant="ghost" size="sm">
                        <PencilSimple size={16} />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => deleteList(list.id)}
                      >
                        <Trash size={16} />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <h4 className="font-medium">Contacts</h4>
                      <div className="flex flex-wrap items-center gap-3">
                        <Select
                          value={sortSettings.field}
                          onValueChange={(value) => updateSortField(list.id, value as SortField)}
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue placeholder="Sort by" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="addedAt">Newest added</SelectItem>
                            <SelectItem value="name">Name</SelectItem>
                            <SelectItem value="email">Email</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={sortSettings.direction}
                          onValueChange={(value) => updateSortDirection(list.id, value as SortDirection)}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue placeholder="Direction" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="asc">Ascending</SelectItem>
                            <SelectItem value="desc">Descending</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex gap-2">
                          <input
                            type="file"
                            accept=".csv,text/csv"
                            className="hidden"
                            ref={(element) => {
                              fileInputRefs.current[list.id] = element
                            }}
                            onChange={(event) => handleFileChange(list.id, event)}
                          />
                          <a
                            className="hidden"
                            ref={(element) => {
                              downloadHrefRefs.current[list.id] = element
                            }}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleImportClick(list.id)}
                            disabled={!!importingLists[list.id]}
                          >
                            <Upload size={16} className="mr-2" />
                            Import
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => downloadContactsCsv(list.id, sortedContacts)}
                            disabled={sortedContacts.length === 0}
                          >
                            <Download size={16} className="mr-2" />
                            Export
                          </Button>
                        </div>
                      </div>
                    </div>

                    {sortedContacts.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No contacts in this list</p>
                    ) : (
                      <div className="overflow-auto border rounded-md">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>Added</TableHead>
                              <TableHead className="w-20">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pagedContacts.map((contact) => (
                              <TableRow key={contact.id}>
                                <TableCell>{contact.firstName} {contact.lastName}</TableCell>
                                <TableCell>{contact.email}</TableCell>
                                <TableCell>
                                  {new Date(contact.addedAt).toLocaleDateString()}
                                </TableCell>
                                <TableCell>
                                  <Button 
                                    variant="ghost" 
                                    size="sm"
                                    onClick={() => removeContact(list.id, contact.id)}
                                  >
                                    <Trash size={14} />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}

                    {importStatus[list.id] && (
                      <div className="space-y-1 rounded-md border bg-muted/40 p-3">
                        <div className="flex items-center justify-between text-sm font-medium">
                          <span>Import progress</span>
                          <span>{importStatus[list.id].completed}/{importStatus[list.id].total}</span>
                        </div>
                        <Progress
                          value={importStatus[list.id].total === 0
                            ? 0
                            : (importStatus[list.id].completed / Math.max(importStatus[list.id].total, 1)) * 100}
                        />
                        {(importStatus[list.id].skippedDuplicates > 0 || importStatus[list.id].skippedInvalid > 0) && (
                          <p className="text-xs text-muted-foreground">
                            {importStatus[list.id].skippedDuplicates > 0 ? `${importStatus[list.id].skippedDuplicates} duplicates skipped` : ''}
                            {importStatus[list.id].skippedDuplicates > 0 && importStatus[list.id].skippedInvalid > 0 ? ' · ' : ''}
                            {importStatus[list.id].skippedInvalid > 0 ? `${importStatus[list.id].skippedInvalid} invalid skipped` : ''}
                          </p>
                        )}
                      </div>
                    )}

                    {sortedContacts.length > CONTACTS_PER_PAGE && (
                      <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>
                          Showing {pageStart + 1} - {Math.min(pageEnd, totalContacts)} of {totalContacts} contacts
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage === 1}
                            onClick={() => changePage(list.id, currentPage - 1)}
                          >
                            Previous
                          </Button>
                          <span>Page {currentPage} of {totalPages}</span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={currentPage === totalPages}
                            onClick={() => changePage(list.id, currentPage + 1)}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="border-t pt-4">
                      <h5 className="font-medium mb-3">Add Contact</h5>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <Input
                          placeholder="First name"
                          value={newContactFirstName}
                          onChange={(e) => setNewContactFirstName(e.target.value)}
                        />
                        <Input
                          placeholder="Last name"
                          value={newContactLastName}
                          onChange={(e) => setNewContactLastName(e.target.value)}
                        />
                        <Input
                          placeholder="Email address"
                          value={newContactEmail}
                          onChange={(e) => setNewContactEmail(e.target.value)}
                        />
                        <Button onClick={() => addContact(list.id)}>
                          <Plus size={16} className="mr-2" />
                          Add
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}