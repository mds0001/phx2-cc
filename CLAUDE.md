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

```bash
npm run import:xml    # Import XML-defined templates into the DB (scripts/import-xml-templates.mjs)
```

### Deployment scripts (repo root, PowerShell)

- `push.ps1` — stage all, prompt for a commit message, commit, push `origin main` → triggers a Vercel deploy. **Do not run without confirmed dev testing** (see the mandatory workflow below). Note its hard-coded default commit message is stale — always supply a real message.
- `commit.ps1 "msg"` — same, plus it clears stale `.git/*.lock` files first; pushes to the current branch's upstream.
- `start-dev.ps1` — thin wrapper around `npm run dev`.

Vercel auto-deploys on push to `main`; there is no separate deploy command.

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

It also enforces **MFA**: if a user's `app_metadata.mfa_enabled === true`, requests without a valid `mfa_verified` cookie are bounced to `/login?mfa=required` (except the `/api/auth/mfa/*` routes needed to complete verification). The MFA endpoints (`/api/auth/mfa/{send,verify,enable,disable}`) and cookie validation live in `src/lib/mfa-server.ts`.

### Supabase Clients

Three clients — choose the right one:
- `src/lib/supabase-browser.ts` — browser client for Client Components (`"use client"`)
- `src/lib/supabase-server.ts` — server client for Server Components and Server Actions (reads cookies via `next/headers`)
- `src/lib/supabase-admin.ts` — service-role client that bypasses RLS; used only in API routes for user management operations

#### ⚠️ New tables need explicit GRANTs (Supabase Data API change)

Supabase is flipping the default that auto-exposes `public` tables to the Data API. **Starting Oct 30, 2026**, any *new* table created in `public` will be invisible to `supabase-js` / PostgREST / GraphQL until you add explicit grants. Existing tables are unaffected. This is the **grants** layer (whether the API sees the table at all), separate from **RLS** (which rows a caller sees) — you still need both.

After every `CREATE TABLE` migration, add grants for the roles that table needs:

```sql
grant select, insert, update, delete on table public.<new_table> to anon, authenticated;
grant all on table public.<new_table> to service_role;
-- if the table has a serial/identity PK backed by a sequence:
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
```

Tune the `anon`/`authenticated` privileges to what each role should actually do; RLS still filters rows on top. Forgetting the grant is silent — RLS looks fine but every query returns a permission error.

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

### User Management, Roles & Customer Scoping

`/api/users/invite` and `/api/users/[id]` use the admin Supabase client (service role) to invite users and manage profiles.

A user has a `profiles.user_type` (`admin | user | basic`) **and, separately, one or more role assignments** in the `user_roles` table (`UserRoleAssignment` in `types.ts`). Do not conflate the two — access decisions are driven by the *active role assignment*, not `user_type`.

- `UserRole` is `administrator | schedule_administrator | basic | schedule_auditor`.
- A user can hold **multiple** `user_roles` rows; one is `is_primary`. The currently active one is chosen by the `active_role_id` cookie (see `src/lib/permissions.ts` → `getActiveRoleAssignment` / `getCurrentUserAssignment`). `isReadOnly()` (basic + schedule_auditor) and `isAuditor()` gate write access.
- **Customer scoping** (`src/lib/customer-context.ts` → `resolveCustomerFilter`): `schedule_administrator` / `schedule_auditor` assignments are pinned to their `customer_id`; an `administrator` uses the cookie-based customer switcher (`active_customer_id`, `null` = all customers). Server pages resolve the active assignment, then the customer filter, and scope their Supabase queries by it. Both cookies are `httpOnly: false` on purpose so the client switchers can update optimistically.

### Agent Subsystem (`/api/agent/*`)

A **desktop runner** (external process, one per customer) pulls jobs and pushes extracted rows to the cloud so on-prem files never need to be exposed. It authenticates with `X-Agent-Id` / `X-Agent-Key` headers, validated in `src/lib/agent-auth.ts` (`validateAgentRequest` — SHA-256 hash compare against `agents.api_key_hash`; `retired` agents are rejected). Managed in the UI via `AgentsClient` / `/api/agent/generate-token`.

Flow: agent `register` → `heartbeat` → `fetch-file` (pull a queued job's source file) → `data` (POST extracted row chunks; the server reads the destination config from `agent_jobs.payload` and forwards to `/api/ivanti-proxy` server-to-server) → `file-result` / `job-complete`. The agent never holds destination credentials — they stay server-side in the job payload.

### Other Subsystems (pointers)

- **Billing** — Stripe (`src/lib/stripe.ts`, `stripe-client.ts`, `/api/stripe/*`: setup-intent, save-card, charge, webhook). Used by BOH customer billing; `StripeCardSection` on the client.
- **CRM pipeline** — `leads → opportunities → quotes`, under `src/app/boh/{leads,opportunities}` with `/api/pipeline/{convert,promote,send-quote}`. Admin-only (`user_type === "admin"` check in the routes).
- **SKU research** — `/api/sku-research-queue`, `/api/sku-run-exceptions`, `/api/sku-exception-notify`; quote-building support (`QuoteBuilderPanel`).
- **Rule-type flow editor** — `RuleTypeEditorClient` / `TaskPlumbingModal` use `@xyflow/react` for a node-graph view of a task's source→mapping→target plumbing.
- **Insight QA** — `/api/insight-qa/*` implements an OAuth token + CustomerInvoice endpoint (a mock/probe of the Insight QA API).

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
