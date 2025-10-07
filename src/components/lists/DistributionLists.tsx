import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Plus, Users, Trash, PencilSimple, Download, Upload } from '@phosphor-icons/react'
import { useKV } from '@github/spark/hooks'
import { toast } from 'sonner'

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
  const [distributionLists, setDistributionLists] = useKV<DistributionList[]>('distribution-lists', [])
  const [unsubscribedEmails] = useKV<string[]>('unsubscribed-emails', [])
  const [isCreating, setIsCreating] = useState(false)
  const [editingList, setEditingList] = useState<DistributionList | null>(null)
  const [newListName, setNewListName] = useState('')
  const [newListDescription, setNewListDescription] = useState('')
  const [newContactEmail, setNewContactEmail] = useState('')
  const [newContactFirstName, setNewContactFirstName] = useState('')
  const [newContactLastName, setNewContactLastName] = useState('')

  const createList = () => {
    if (!newListName.trim()) {
      toast.error('Please enter a list name')
      return
    }

    const newList: DistributionList = {
      id: Date.now().toString(),
      name: newListName,
      description: newListDescription,
      contacts: [],
      createdAt: new Date().toISOString()
    }

    setDistributionLists(currentLists => [...(currentLists || []), newList])
    setNewListName('')
    setNewListDescription('')
    setIsCreating(false)
    toast.success('Distribution list created')
  }

  const deleteList = (listId: string) => {
    setDistributionLists(currentLists => 
      (currentLists || []).filter(list => list.id !== listId)
    )
    toast.success('Distribution list deleted')
  }

  const addContact = (listId: string) => {
    if (!newContactEmail.trim() || !newContactFirstName.trim() || !newContactLastName.trim()) {
      toast.error('Please fill in all contact fields')
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newContactEmail)) {
      toast.error('Please enter a valid email address')
      return
    }

    const newContact: Contact = {
      id: Date.now().toString(),
      email: newContactEmail,
      firstName: newContactFirstName,
      lastName: newContactLastName,
      addedAt: new Date().toISOString()
    }

    setDistributionLists(currentLists => 
      (currentLists || []).map(list => 
        list.id === listId 
          ? { ...list, contacts: [...list.contacts, newContact] }
          : list
      )
    )

    setNewContactEmail('')
    setNewContactFirstName('')
    setNewContactLastName('')
    toast.success('Contact added')
  }

  const removeContact = (listId: string, contactId: string) => {
    setDistributionLists(currentLists => 
      (currentLists || []).map(list => 
        list.id === listId 
          ? { ...list, contacts: list.contacts.filter(contact => contact.id !== contactId) }
          : list
      )
    )
    toast.success('Contact removed')
  }

  const getActiveContacts = (contacts: Contact[]) => {
    return contacts.filter(contact => !(unsubscribedEmails || []).includes(contact.email))
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
                    <div className="flex justify-between items-center">
                      <h4 className="font-medium">Contacts</h4>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          <Upload size={16} className="mr-2" />
                          Import
                        </Button>
                        <Button variant="outline" size="sm">
                          <Download size={16} className="mr-2" />
                          Export
                        </Button>
                      </div>
                    </div>

                    {activeContacts.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No contacts in this list</p>
                    ) : (
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
                          {activeContacts.slice(0, 5).map((contact) => (
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
                    )}

                    {activeContacts.length > 5 && (
                      <p className="text-sm text-muted-foreground">
                        And {activeContacts.length - 5} more contacts...
                      </p>
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