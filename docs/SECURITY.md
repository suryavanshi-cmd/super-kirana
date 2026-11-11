# Security

## Identity
- Supabase Auth holds every identity and verifies every password. The app stores no password and
  no password hash, and never implements its own password check.
- People sign in with a **username**. The `auth-admin` edge function resolves the username on the
  server and performs the password sign-in; the caller gets back only session tokens. The auth
  identifier behind a username is random and is never returned to anyone.
- Unknown usernames and wrong passwords give the same answer and take the same path. Attempts are
  limited per submitted username (8 per 15 minutes) and per IP address (40 per 15 minutes).
- Password rule: at least 8 characters, a letter and a digit, not containing the username.
- **Recovery is admin-controlled:** an owner resets a cashier, the platform admin resets anyone.
  The person must choose a new password at the next login, and until then has no shop access.
  Temporary passwords are told in person — the app never sends or displays a password.
- Email / SMS reset is not wired up (accounts have no verified email or phone).

## Isolation between shops
- Every business table has `shop_id` and Row Level Security. Browsers hold only the publishable
  key and get `SELECT` on rows of shops where they are an active member; they have **no** insert,
  update or delete privilege on any table. Anonymous callers can read and execute nothing.
- Every write goes through a `SECURITY DEFINER` function with a fixed empty `search_path` that
  re-checks the caller's membership and role, and looks up every referenced customer, product,
  bill and payment **within the given shop**. Composite foreign keys `(shop_id, id)` make a
  cross-shop reference impossible even for the table owner.
- Membership, shop status and the forced-password-change flag are read on every call, so
  disabling a cashier or suspending a shop takes effect immediately, even for a session that is
  still open. Disabling also deletes the person's refresh sessions.
- The service-role key exists only inside the edge functions.

## Roles
| | Owner | Cashier |
| --- | --- | --- |
| Bills, payments, add customers | yes | yes |
| Products, edit customers, opening balances | yes | no |
| Reversals, returns / credits | yes | no |
| Reports for past days, audit log, staff | yes | no (today's summary only) |

The platform admin acts as owner in every shop and alone can create or suspend shops and change
owners. A shop always keeps at least one active owner.

## On the device
- The session is kept by the Supabase client and refreshed automatically; 12 hours without use
  logs the person out.
- Customer and product lists and unfinished bills are cached in IndexedDB so the app works on a
  poor connection. Logging out wipes them, and so does a different person signing in on the same
  device. On a shared phone: log out.
- The service worker caches only the app's own files, never data responses.
- Production pages are served with a Content-Security-Policy that allows connections only to the
  app itself and its Supabase project.

## Audit
Bills, payments, reversals, credits, opening balances, customer and product changes, staff
changes, shop changes, logins, and password resets are written to `audit_events`, which cannot be
edited or deleted.

## OCR images
Photos are read on the device. With cloud OCR switched on, the photo is sent to the edge function,
held in memory for that request, and never stored or logged. Only recognised text is kept, for 30 days.

## Known limits
- The session token is readable by scripts on the page (as with any single-page app); the CSP and
  the absence of third-party scripts are the mitigation.
- No multi-factor authentication yet.
- Rate limits are per username / IP in the database, not a network-level firewall.
