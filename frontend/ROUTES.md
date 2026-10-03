# Likhitex Frontend Routes

## Route Structure

### Public Routes
- `/` - Landing page (marketing)
- `/sign-in` - Authentication page (Clerk)
- `/no-access` - 403 error page (not invited/blocked)

### Protected Routes (require authentication)
- `/projects` - Projects dashboard
- `/editor/[id]` - LaTeX editor workspace
- `/editor-errors/[id]` - Editor with compile error panel
- `/history/[id]` - Version history and diff viewer
- `/settings` - Account and storage settings

### Not Implemented (excluded from scope per requirements)
- `/admin/members` - Admin interface (explicitly excluded - "no admin")

## Navigation Map

### From Landing Page (`/`)
- "Sign in" button → `/sign-in`
- "Request an invite" button → External form or `/sign-in` (to be determined)

### From Sign-In Page (`/sign-in`)
- After successful auth → `/projects`
- If not invited → `/no-access`

### From Projects Dashboard (`/projects`)
- Project row click → `/editor/[projectId]`
- "Settings" nav link → `/settings`
- Logo → `/projects` (stay on dashboard)
- User avatar menu → `/settings`

### From Editor (`/editor/[id]`)
- "Back to Projects" button → `/projects`
- Logo → `/projects`
- "History" button → `/history/[id]`
- "Share" button → Opens ShareProjectModal (in-place)
- Compile error count badge → `/editor-errors/[id]`
- User avatar → `/settings`

### From Editor Errors (`/editor-errors/[id]`)
- "Back to Editor" → `/editor/[id]`
- Logo → `/projects`

### From History (`/history/[id]`)
- "Back to Editor" → `/editor/[id]`
- "Back to Projects" → `/projects`
- Logo → `/projects`

### From Settings (`/settings`)
- "Back to Projects" button → `/projects`
- Logo → `/projects`

### From No Access (`/no-access`)
- "Contact admin" → External email or support form
- Logo → `/` (landing page, since user isn't authenticated/invited)

## Dynamic Route Params
- `[id]` - Project UUID in `/editor/[id]`, `/history/[id]`, `/editor-errors/[id]`
