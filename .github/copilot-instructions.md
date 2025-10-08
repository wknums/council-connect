# CouncilConnect Municipal Email System - Copilot Instructions

## Project Overview

A GitHub Spark-powered municipal email management system for ward councilors to compose emails, manage constituent distribution lists, track analytics, and handle unsubscribe management. Built with React 19, TypeScript, Tailwind CSS 4, and Radix UI components.

## Architecture & Data Patterns

### GitHub Spark Integration
- Uses `@github/spark` framework with KV storage for data persistence
- Key pattern: `useKV<Type>(getCouncilorKey('storage-key'), defaultValue)` for all data operations
- Data isolation via subdomain-based keys using `getCouncilorKey()` utility

### Core Data Storage Keys
```typescript
// Always use getCouncilorKey() for data isolation
const [drafts, setDrafts] = useKV<Email[]>(getCouncilorKey('email-drafts'), [])
const [distributionLists] = useKV<DistributionList[]>(getCouncilorKey('distribution-lists'), [])
const [unsubscribedEmails] = useKV<string[]>(getCouncilorKey('unsubscribed-emails'), [])
const [userProfile] = useKV<UserProfile>(getCouncilorKey('user-profile'), defaultProfile)
```

### Component Architecture
- Tab-based main layout: Compose, Contact Lists, Analytics, Settings
- Each major feature is a separate component in `/src/components/[feature]/`
- Shared UI components from `/src/components/ui/` (shadcn/ui pattern)

## Essential Development Patterns

### Data Isolation & Multi-tenancy
- **Critical**: All storage uses `getCouncilorKey(baseKey)` for councilor-specific data isolation
- Subdomain-based tenant identification: `ward1.example.com` → `ward1:email-drafts`
- Development fallback: `default-councilor` when on localhost

### State Management
- No external state management - uses GitHub Spark's `useKV` hooks
- State updates via setter functions from useKV hooks
- Auto-persistence - no manual save operations needed

### Email Operations
- Drafts auto-save with timestamp-based IDs
- Unsubscribe filtering applied at send-time, not storage-time
- Email status: 'draft' | 'sent' with sentAt timestamps

### Icon Usage
- **Required**: Import icons from `@phosphor-icons/react` (configured in vite plugin)
- Standard icons: `Envelope`, `Users`, `ChartBar`, `Gear`, `Plus`, etc.

## Development Workflow

### Build & Development
```bash
npm run dev          # Start development server
npm run build        # TypeScript build + Vite build
npm run lint         # ESLint check
npm run optimize     # Vite optimization
npm run preview      # Preview built app
```

### GitHub Spark Setup
- DO NOT remove Vite plugins: `createIconImportProxy()` and `sparkPlugin()`
- Runtime config in `runtime.config.json` - app ID for Spark deployment
- KV database type specified in `spark.meta.json`

### Component Creation
- Use shadcn/ui components from `/src/components/ui/`
- Import utility: `import { cn } from '@/lib/utils'` for className merging
- Toast notifications: `import { toast } from 'sonner'`

## Key Implementation Details

### Email Composer
- Rich text formatting with toolbar (bold, italic, lists, links)
- Distribution list selection with recipient count calculations  
- Real-time unsubscribe filtering preview
- Draft management with loadable saved drafts

### Distribution Lists
- CRUD operations for contact lists with CSV import/export capabilities
- Contact validation and duplicate handling
- Integration with unsubscribe management

### Analytics Dashboard
- Mock metrics generation for sent emails (no real email service integration)
- Performance tracking: delivery, open, click rates
- Campaign history with exportable data

### Settings & Profile
- Councilor profile management with email signatures
- Unsubscribe list management (add/remove emails)
- System preferences (notifications, auto-save)

## Styling & Theme

### Tailwind CSS 4 Configuration  
- Custom color system using CSS variables (neutral, accent scales)
- Professional government-appropriate color scheme
- Responsive design with mobile-first approach
- Uses Inter font family (loaded via Google Fonts)

### Component Styling
- Consistent spacing with 8px base unit system
- Card-based layouts for major sections
- Form patterns with proper label associations
- Accessible color contrasts for government compliance

## Common Gotchas

1. **Always use `getCouncilorKey()`** - Direct storage keys break multi-tenancy
2. **Check for null/undefined** - useKV can return null, always provide defaults
3. **Phosphor icons only** - Other icon libraries will break due to Vite proxy plugin  
4. **No manual persistence** - useKV handles all storage automatically
5. **TypeScript strict mode** - All interfaces defined, use proper typing

## Integration Points

- **GitHub Spark Runtime**: Handles deployment, KV storage, and multi-tenant infrastructure
- **Radix UI**: Accessible component primitives with custom styling
- **Sonner**: Toast notification system for user feedback
- **React Error Boundary**: Production error handling with custom fallback UI

When implementing new features, follow the existing patterns: create typed interfaces, use useKV for persistence with getCouncilorKey(), implement proper loading states, and maintain the professional government UI aesthetic.