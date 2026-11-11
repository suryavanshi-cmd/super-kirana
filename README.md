# Super Kirana, Niphad · सुपर किराणा, निफाड

Marathi-first billing and customer khata (credit ledger) for kirana shops. One app and one
Supabase backend serve many independent shops; each shop's data is isolated in the database.

- **Frontend:** Next.js (App Router), TypeScript strict, Tailwind CSS, PWA
- **Backend:** Supabase Postgres + Auth, Row Level Security, transactional SQL functions, two edge functions
- **Languages:** Marathi (`mr-IN`, default) and English (`en-IN`)

## What it does

| Area | Status |
| --- | --- |
| Login with username + password, forced password change, generic errors, rate limiting | Working, tested |
| Simple shop screen: **उधारी नोंदवा** and **फोटोवरून बिल**, plus the list of who owes what | Working, tested |
| Multiple shops, owner / cashier roles; admin can only **add and update** shops and people, never sees money | Working, tested |
| Customers, opening balance, products with units and fractional quantities | Working, tested |
| Billing: full / partial / zero payment, old-dues split, walk-in must settle | Working, tested |
| Collecting old dues (oldest first), receipts, reversals, returns / credits | Working, tested |
| Home dashboard, daily / range reports, outstanding report, cash vs UPI, CSV, print, share | Working, tested |
| Scan a list with OCR.space (Engine 3 handwriting, Engine 2 fallback), review every line | Working, tested against a stand-in; real accuracy depends on the photo |
| On-device OCR when OCR.space is unreachable (printed text only) | Working, tested |
| Offline: cached lists, bill drafts, sync-status screen | Working, tested |
| Offline **posting** of bills / payments | Deliberately not built — posting needs a connection |
| Email / SMS password reset | Not built — recovery is by owner or admin |
| Stock that goes down automatically, GST / tax invoices, owner MFA | Not built |

See `docs/ACCOUNTING.md`, `docs/SECURITY.md` and `docs/OCR.md` for the rules behind each area.

## Run it locally

Needs Node 20+, PostgreSQL 16+ (any plain local server) and Deno 2 (only for the browser tests).

```bash
npm install
cp .env.example .env.local          # fill in your Supabase URL + publishable key
npm run dev                         # http://localhost:3000
```

### Tests

```bash
npm run typecheck
npm test                 # unit: money, units, rounding, translations, OCR parsing, CSV
npm run test:db          # database: ledger, idempotency, concurrency, RLS, roles, onboarding
npm run test:e2e         # browser: the real UI against the real SQL + edge function
```

`test:db` and `test:e2e` use a local Postgres (`PGHOST`, `PGPORT`, `PGUSER`; default
`127.0.0.1:54329`, user `postgres`). `tests/harness/` contains a small stand-in for the Supabase
gateway so the tests need neither Docker nor a cloud project; it runs the real migrations and the
real edge function. After a first-run setup on the local stack, `tests/harness/seed-local.sql`
adds sample products and customers.

## Deploy

1. **Supabase** — create a project, run the four files in `supabase/migrations/` in order
   (`supabase db push`, or paste them in the SQL editor), then deploy both edge functions:
   `supabase functions deploy auth-admin --no-verify-jwt` and `supabase functions deploy ocr --no-verify-jwt`
   (both check the caller themselves).
2. **First admin** — store the hash of a one-time setup code, then open `/setup` in the app:
   ```sql
   insert into public.platform_setup(id, code_hash, expires_at)
   values (1, encode(sha256(convert_to('YOUR-ONE-TIME-CODE', 'UTF8')), 'hex'), now() + interval '7 days');
   ```
   Setup creates the administrator and the shop "Super Kirana, Niphad" with that person as owner.
   The code works once. There are no default or demo accounts.
3. **Vercel** — import the repository and set two environment variables:
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Nothing secret goes to Vercel.
4. Optional: set the edge-function secret `APP_ORIGIN` to your site URL to restrict browser
   origins, and `OCR_SPACE_API_KEY` (from ocr.space) to switch on cloud OCR.

Use a separate Supabase project for testing; never point a test build at the production project.

## Backups and recovery

- All records live in Supabase Postgres. Phones hold only a cache and unfinished drafts.
- Turn on **daily backups** (included on paid Supabase plans) and, once the shop depends on the
  app, **point-in-time recovery**. On the free plan, run `supabase db dump` (or `pg_dump`) on a
  schedule and keep the file off the server. Practise a restore into a spare project once.
- Owners can download CSV from Reports (daily summary, bills, collections, outstanding) and any
  customer's statement, at any time.
- **Lost or stolen phone:** log in on another phone and change your password; an owner or the
  admin can also disable the account, which blocks it at once. Nothing needs to be recovered from
  the lost phone.
- Posted bills and payments are never edited or deleted; mistakes are fixed with a reversal, so
  the history is always complete.

## Layout

```
supabase/migrations/   schema, security (RLS, immutability), financial functions, app API
supabase/functions/    auth-admin (login, onboarding, staff), ocr-vision (optional cloud OCR)
src/app/               screens            src/lib/   money, drafts, request tracking, OCR, i18n
tests/unit|db|e2e      test suites        tests/harness/   local Supabase stand-in
```
