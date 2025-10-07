import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Gear, User, Bell, Shield, Trash, Plus } from '@phosphor-icons/react'
import { useKV } from '@github/spark/hooks'
import { toast } from 'sonner'

interface UserProfile {
  name: string
  ward: string
  title: string
  email: string
  phone: string
  signature: string
}

export function Settings() {
  const [userProfile, setUserProfile] = useKV<UserProfile>('user-profile', {
    name: 'Councilor Smith',
    ward: 'Ward 5',
    title: 'City Councilor',
    email: 'smith@city.gov',
    phone: '(555) 123-4567',
    signature: 'Best regards,\nCouncilor Smith\nWard 5 City Council'
  })
  
  const [unsubscribedEmails, setUnsubscribedEmails] = useKV<string[]>('unsubscribed-emails', [])
  const [emailNotifications, setEmailNotifications] = useKV<boolean>('email-notifications', true)
  const [autoSaveDrafts, setAutoSaveDrafts] = useKV<boolean>('auto-save-drafts', true)
  const [newUnsubscribeEmail, setNewUnsubscribeEmail] = useState('')

  const defaultProfile: UserProfile = {
    name: 'Councilor Smith',
    ward: 'Ward 5', 
    title: 'City Councilor',
    email: 'smith@city.gov',
    phone: '(555) 123-4567',
    signature: 'Best regards,\nCouncilor Smith\nWard 5 City Council'
  }

  const profile = userProfile || defaultProfile

  const saveProfile = () => {
    toast.success('Profile updated successfully')
  }

  const addUnsubscribeEmail = () => {
    if (!newUnsubscribeEmail.trim()) return
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newUnsubscribeEmail)) {
      toast.error('Please enter a valid email address')
      return
    }

    if ((unsubscribedEmails || []).includes(newUnsubscribeEmail)) {
      toast.error('Email already in unsubscribe list')
      return
    }

    setUnsubscribedEmails(current => [...(current || []), newUnsubscribeEmail])
    setNewUnsubscribeEmail('')
    toast.success('Email added to unsubscribe list')
  }

  const removeUnsubscribeEmail = (email: string) => {
    setUnsubscribedEmails(current => (current || []).filter(e => e !== email))
    toast.success('Email removed from unsubscribe list')
  }

  const updateProfile = (field: keyof UserProfile, value: string) => {
    setUserProfile(prev => ({
      ...defaultProfile,
      ...prev,
      [field]: value
    }))
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-muted-foreground">Manage your profile and system preferences</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User size={20} />
              Profile Information
            </CardTitle>
            <CardDescription>
              Update your councilor profile and contact information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={profile.name}
                  onChange={(e) => updateProfile('name', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ward">Ward</Label>
                <Input
                  id="ward"
                  value={profile.ward}
                  onChange={(e) => updateProfile('ward', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={profile.title}
                  onChange={(e) => updateProfile('title', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  value={profile.email}
                  onChange={(e) => updateProfile('email', e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                value={profile.phone}
                onChange={(e) => updateProfile('phone', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signature">Email Signature</Label>
              <Textarea
                id="signature"
                value={profile.signature}
                onChange={(e) => updateProfile('signature', e.target.value)}
                rows={4}
              />
            </div>
            <Button onClick={saveProfile}>Save Profile</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell size={20} />
              Preferences
            </CardTitle>
            <CardDescription>
              Configure system notifications and behavior
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Email Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Receive notifications for email delivery status
                </p>
              </div>
              <Switch
                checked={emailNotifications || false}
                onCheckedChange={setEmailNotifications}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Auto-save Drafts</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically save email drafts every 30 seconds
                </p>
              </div>
              <Switch
                checked={autoSaveDrafts || false}
                onCheckedChange={setAutoSaveDrafts}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield size={20} />
              Unsubscribe Management
            </CardTitle>
            <CardDescription>
              Manage the global unsubscribe list for email compliance
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Enter email to add to unsubscribe list"
                value={newUnsubscribeEmail}
                onChange={(e) => setNewUnsubscribeEmail(e.target.value)}
              />
              <Button onClick={addUnsubscribeEmail}>
                <Plus size={16} className="mr-2" />
                Add
              </Button>
            </div>

            {(unsubscribedEmails || []).length === 0 ? (
              <p className="text-muted-foreground text-sm">No unsubscribed emails</p>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium">
                    Unsubscribed Emails ({(unsubscribedEmails || []).length})
                  </p>
                  <Badge variant="outline">
                    Auto-filtered from all sends
                  </Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email Address</TableHead>
                      <TableHead className="w-20">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(unsubscribedEmails || []).map((email) => (
                      <TableRow key={email}>
                        <TableCell>{email}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeUnsubscribeEmail(email)}
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
          </CardContent>
        </Card>
      </div>
    </div>
  )
}