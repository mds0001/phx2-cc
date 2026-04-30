# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ File Writing Rules (CRITICAL — READ FIRST)

- **NEVER** use bash `cat >>`, heredocs, or `echo` commands to write file content — these cause file truncation and corruption on the Windows/Linux VM boundary
- **NEVER** truncate file content with placeholders like `// ... rest of file` or `// existing code` — always write the complete content

### Small files (< 200 lines)
- Use the `Edit` tool for targeted changes, or `Write` for full rewrites
- Always `Read` the file first before editing

### Large files (>= 200 lines) — PYTHON ONLY
- **NEVER** use the `Edit` or `Write` tools on files with 200+ lines — they silently truncate the file, corrupting it
- **ALWAYS** use Python byte-level replacement via `mcp__workspace__bash`:
  ```python
  with open('file.ts', 'rb') as f: content = f.read()
  content = content.replace(b'old string', b'new string')
  with open('file.ts', 'wb') as f: f.write(content)
  ```
- Check line count first if unsure: `wc -l filename`
- This rule applies to ALL large files without exception — no matter how small the change

## Commands

```bash
npm run dev          # Start dev server (Next.js, http://localhost:3000)
npm run build        # Production build
npm run lint         # ESLint via next lint
npm run seed         # Copy production data → dev Supabase (skips existing rows)
npm run seed:fresh   # Wipe dev tables first, then copy production data
npm run seed:reset   # Wipe dev completely, create single admin@dev.local admin user
npm run seed:system  # Sync all system templates (is_system=true) from prod → dev
```

No test suite is configured — there is no test runner or test files in this project.

## Environment Variables

Required in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key (used in browser and middleware)
- `SUPABASE_SERVICE_ROLE_KEY` — Service role key (server-only, bypasses RLS; used for user management in API routes)
- `ANTHROPIC_API_KEY` — Required for the AI lookup feature (`/api/ai-lookup`)

## Architecture

This is a **Next.js 15 App Router** application with Supabase as the backend. The pattern throughout is **Server Component fetches data → passes to Client Component for interactivity**.

### Auth & Middleware

`middleware.ts` gates every route (except `/login`, static assets, and `/api/*`). It uses `@supabase/ssr` with cookies, redirecting unauthenticated users to `/login` and already-authenticated users away from `/login` to `/dashboard`.

### Supabase Clients

Three clients — choose the right one:
- `src/lib/supabase-browser.ts` — browser client for Client Components (`"use client"`)
- `src/lib/supabase-server.ts` — server client for Server Components and Server Actions (reads cookies via `next/headers`)
- `src/lib/supabase-admin.ts` — service-role client that bypasses RLS; used only in API routes for user management operations

### Page Structure

Each feature follows the same pattern:
1. **Server page** (`src/app/<feature>/page.tsx`) — fetches initial data via the server Supabase client, passes it as props
2. **Client component** (`src/components/<Feature>Client.tsx`) — all interactivity, real-time updates, and mutations happen here using the browser Supabase client

### Core Domain: Task Scheduler

`ScheduledTask` (in `src/lib/types.ts`) is the central entity. Tasks have:
- `rule_type_id` → references a `RuleTypeRecord` (user-defined rule type)
- `mapping_profile_id` → references a `MappingProfile` (field mapping config)
- `source_connection_id` / `target_connection_id` → references `EndpointConnection`

When a task runs in `SchedulerClient`, it reads Excel source data, applies the mapping profile (`applyMappingProfile` in `src/lib/types.ts`), optionally calls `/api/ai-lookup` for AI-classified fields, filters rows via `evaluateFilter` in `src/lib/filterExpression.ts`, then POSTs to the target via a proxy route (`/api/ivanti-proxy`, `/api/dell-proxy`, or `/api/cdw-proxy`).

### Mapping Profiles & Filter Expressions

`MappingProfile` maps source Excel fields to target fields with transforms (`none`, `uppercase`, `lowercase`, `trim`, `static`, `concat`, `ai_lookup`). The `ai_lookup` transform calls `/api/ai-lookup` which hits Claude Haiku (`claude-haiku-4-5-20251001`) to classify IT asset attributes into structured fields.

`src/lib/filterExpression.ts` is a self-contained lexer/parser/evaluator for row-level filter expressions. It runs client-side to skip rows before they're sent to the target system.

### Connection Types

`EndpointConnection.type` is one of: `file | cloud | smtp | odbc | portal | ivanti | dell | cdw`. Each type has a corresponding typed config interface in `src/lib/types.ts`. The proxy routes (`/api/ivanti-proxy`, `/api/dell-proxy`, `/api/cdw-proxy`) forward requests server-side to avoid CORS issues and hide credentials.

### Back of House (BOH)

`src/app/boh/` is a separate section for customer and license management (`Customer`, `CustomerLicense` types). The dashboard summarizes BOH alerts (failed payments, expiring licenses).

### User Management

`/api/users/invite` and `/api/users/[id]` use the admin Supabase client (service role) to invite users and manage profiles. Users have a `user_type` (`admin | user`) and `role` (`administrator | schedule_administrator`).

### UI Conventions

- Dark theme by default via `next-themes` (set in `layout.tsx`, `ThemeProvider`)
- Icons from `lucide-react`
- Tailwind CSS for all styling
- No UI component library — all components are hand-rolled

## ⚠️ Update / Test / Push — MANDATORY WORKFLOW (CRITICAL)

**NEVER push code or apply changes to prod without explicit user confirmation that dev testing passed. No exceptions.**

### The only allowed workflow is:
1. **Update** — make the change (code or DB) on **dev only** (`lxcentwfpiefosjkarlx`)
2. **Test** — tell the user to test on dev and wait for explicit confirmation ("works", "good", "confirmed", etc.)
3. **Push** — only then push code to Vercel / apply to prod (`ogolfqzuqnfslyjivntm`)

### This applies to ALL changes:
- Code changes (always test locally or on dev Vercel before push)
- Supabase `execute_sql` (mapping profiles, schema, data mutations)
- Any change that affects live data or the production app

### After completing every change, Claude MUST:
- Remind the user: **"Please test on dev before I push."**
- Wait for confirmation before running `push.ps1` or touching prod Supabase

## Shell Command Formatting

- When providing shell commands (PowerShell, bash, etc.) for the user to copy and paste, always end the code block with a trailing newline after the last command so that it executes when pasted into a terminal
