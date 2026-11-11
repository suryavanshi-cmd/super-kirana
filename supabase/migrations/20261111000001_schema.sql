-- Super Kirana — multi-shop schema.
-- Money is stored as integer paise (BIGINT). Quantities are NUMERIC(12,3). No floats anywhere.
-- Signed ledger convention: amount_paise > 0 increases what the customer owes the shop,
-- amount_paise < 0 decreases it. Customer balance = SUM(ledger_entries.amount_paise).

create schema if not exists app_private;

-- ---------------------------------------------------------------- tenancy / identity
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  shop_username text not null unique
    check (shop_username = lower(shop_username) and shop_username ~ '^[a-z0-9][a-z0-9_-]{2,39}$'),
  name_mr text not null check (length(btrim(name_mr)) between 1 and 120),
  name_en text not null check (length(btrim(name_en)) between 1 and 120),
  status text not null default 'active' check (status in ('active','suspended')),
  default_locale text not null default 'mr-IN' check (default_locale in ('mr-IN','en-IN')),
  secondary_locale text not null default 'en-IN' check (secondary_locale in ('mr-IN','en-IN')),
  currency text not null default 'INR' check (currency = 'INR'),
  timezone text not null default 'Asia/Kolkata',
  invoice_seq bigint not null default 0 check (invoice_seq >= 0),
  payment_seq bigint not null default 0 check (payment_seq >= 0),
  onboarding_request_id uuid unique,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id),
  login_username text not null unique
    check (login_username = lower(login_username) and login_username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  preferred_language text not null default 'mr-IN' check (preferred_language in ('mr-IN','en-IN')),
  must_change_password boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references public.profiles(user_id),
  created_at timestamptz not null default now()
);

create table public.shop_members (
  shop_id uuid not null references public.shops(id),
  user_id uuid not null references public.profiles(user_id),
  role text not null check (role in ('owner','cashier')),
  membership_status text not null default 'active' check (membership_status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (shop_id, user_id)
);
create index shop_members_user_idx on public.shop_members(user_id);

-- ---------------------------------------------------------------- master data
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  mobile text check (mobile is null or mobile ~ '^[0-9+][0-9 -]{5,14}$'),
  notes text check (notes is null or length(notes) <= 500),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id)
);
create index customers_shop_name_idx on public.customers(shop_id, lower(name));

-- Balance cache. Maintained only by the ledger trigger, in the same transaction as the ledger
-- insert, and reconciled against SUM(ledger_entries) by reconcile_customer_ledger().
create table public.customer_balances (
  customer_id uuid primary key,
  shop_id uuid not null,
  balance_paise bigint not null default 0,
  updated_at timestamptz not null default now(),
  foreign key (shop_id, customer_id) references public.customers(shop_id, id)
);
create index customer_balances_shop_idx on public.customer_balances(shop_id) where balance_paise > 0;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  name_en text check (name_en is null or length(name_en) <= 120),
  name_mr text check (name_mr is null or length(name_mr) <= 120),
  unit text not null check (unit in ('kg','g','litre','ml','packet','piece','dozen')),
  default_price_paise bigint not null check (default_price_paise between 0 and 1000000000),
  is_active boolean not null default true,
  barcode text check (barcode is null or length(barcode) between 1 and 64),
  category text check (category is null or length(category) <= 60),
  purchase_cost_paise bigint check (purchase_cost_paise is null or purchase_cost_paise between 0 and 1000000000),
  stock_qty numeric(14,3),
  sku text check (sku is null or length(sku) between 1 and 64),
  created_by uuid not null references public.profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, id)
);
create unique index products_shop_sku_uq on public.products(shop_id, sku) where sku is not null;
create unique index products_shop_barcode_uq on public.products(shop_id, barcode) where barcode is not null;
create index products_shop_name_idx on public.products(shop_id, lower(name));

-- ---------------------------------------------------------------- financial documents
create table public.invoices (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  invoice_no bigint not null check (invoice_no > 0),
  customer_id uuid,                       -- null = walk-in (must be fully settled at posting)
  customer_name text,                     -- snapshot; never rewritten when the customer is edited
  status text not null default 'posted' check (status in ('posted','reversed')),
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  discount_paise bigint not null check (discount_paise >= 0),
  total_paise bigint not null check (total_paise > 0),
  paid_at_posting_paise bigint not null check (paid_at_posting_paise >= 0),  -- applied to this bill
  old_dues_paid_paise bigint not null default 0 check (old_dues_paid_paise >= 0),
  previous_balance_paise bigint not null default 0 check (previous_balance_paise >= 0),
  balance_after_paise bigint not null default 0 check (balance_after_paise >= 0),
  source text not null default 'manual' check (source in ('manual','ocr')),
  ocr_job_id uuid,
  note text check (note is null or length(note) <= 300),
  business_date date not null,
  posted_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(user_id),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(user_id),
  reversal_reason text,
  unique (shop_id, invoice_no),
  unique (shop_id, id),
  foreign key (shop_id, customer_id) references public.customers(shop_id, id),
  check (total_paise = subtotal_paise - discount_paise),
  check (paid_at_posting_paise <= total_paise),
  check ((status = 'reversed') = (reversed_at is not null)),
  check (customer_id is not null or (paid_at_posting_paise = total_paise and old_dues_paid_paise = 0))
);
create index invoices_shop_date_idx on public.invoices(shop_id, business_date);
create index invoices_shop_customer_idx on public.invoices(shop_id, customer_id, posted_at);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  invoice_id uuid not null,
  line_no int not null check (line_no > 0),
  product_id uuid,
  name text not null check (length(btrim(name)) between 1 and 120),
  qty numeric(12,3) not null check (qty > 0 and qty <= 100000),
  unit text not null check (unit in ('kg','g','litre','ml','packet','piece','dozen')),
  price_unit text not null check (price_unit in ('kg','g','litre','ml','packet','piece','dozen')),
  unit_price_paise bigint not null check (unit_price_paise between 0 and 1000000000), -- per price_unit
  gross_paise bigint not null check (gross_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  line_total_paise bigint not null check (line_total_paise >= 0),
  unique (invoice_id, line_no),
  foreign key (shop_id, invoice_id) references public.invoices(shop_id, id),
  foreign key (shop_id, product_id) references public.products(shop_id, id),
  check (discount_paise <= gross_paise),
  check (line_total_paise = gross_paise - discount_paise)
);
create index invoice_items_invoice_idx on public.invoice_items(invoice_id);

create table public.payments (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  payment_no bigint not null check (payment_no > 0),
  customer_id uuid,
  invoice_id uuid,                        -- set only for money taken while billing
  kind text not null check (kind in ('bill_payment','collection')),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),
  method text not null check (method in ('cash','upi','other')),  -- declared by the shopkeeper, not verified
  reference text check (reference is null or length(reference) <= 80),
  note text check (note is null or length(note) <= 300),
  status text not null default 'posted' check (status in ('posted','reversed')),
  previous_balance_paise bigint not null default 0 check (previous_balance_paise >= 0),
  balance_after_paise bigint not null default 0 check (balance_after_paise >= 0),
  business_date date not null,
  posted_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(user_id),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(user_id),
  reversal_reason text,
  unique (shop_id, payment_no),
  unique (shop_id, id),
  foreign key (shop_id, customer_id) references public.customers(shop_id, id),
  foreign key (shop_id, invoice_id) references public.invoices(shop_id, id),
  check ((kind = 'bill_payment') = (invoice_id is not null)),
  check (customer_id is not null or kind = 'bill_payment'),
  check ((status = 'reversed') = (reversed_at is not null))
);
create index payments_shop_date_idx on public.payments(shop_id, business_date);
create index payments_shop_customer_idx on public.payments(shop_id, customer_id, posted_at);
create index payments_invoice_idx on public.payments(invoice_id) where invoice_id is not null;

create table public.credit_notes (
  id uuid primary key,
  shop_id uuid not null references public.shops(id),
  customer_id uuid not null,
  invoice_id uuid,
  kind text not null check (kind in ('return','credit')),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 100000000000),
  reason text not null check (length(btrim(reason)) between 3 and 300),
  status text not null default 'posted' check (status in ('posted','reversed')),
  business_date date not null,
  posted_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(user_id),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles(user_id),
  reversal_reason text,
  unique (shop_id, id),
  foreign key (shop_id, customer_id) references public.customers(shop_id, id),
  foreign key (shop_id, invoice_id) references public.invoices(shop_id, id),
  check ((status = 'reversed') = (reversed_at is not null))
);
create index credit_notes_customer_idx on public.credit_notes(shop_id, customer_id);

-- How each payment / credit was applied. Rows are never edited: a release is a new row with the
-- opposite sign (reverses_id points at the original).
create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  customer_id uuid,
  payment_id uuid,
  credit_note_id uuid,
  target text not null check (target in ('invoice','opening')),
  invoice_id uuid,
  amount_paise bigint not null check (amount_paise <> 0),
  reverses_id uuid references public.payment_allocations(id),
  seq bigint generated always as identity,   -- strict posting order (timestamps are per transaction)
  created_at timestamptz not null default now(),
  foreign key (shop_id, payment_id) references public.payments(shop_id, id),
  foreign key (shop_id, credit_note_id) references public.credit_notes(shop_id, id),
  foreign key (shop_id, invoice_id) references public.invoices(shop_id, id),
  foreign key (shop_id, customer_id) references public.customers(shop_id, id),
  check ((payment_id is not null) <> (credit_note_id is not null)),
  check ((target = 'invoice') = (invoice_id is not null))
);
create index payment_allocations_invoice_idx on public.payment_allocations(invoice_id);
create index payment_allocations_payment_idx on public.payment_allocations(payment_id);
create index payment_allocations_credit_idx on public.payment_allocations(credit_note_id);
create index payment_allocations_customer_idx on public.payment_allocations(customer_id, target);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  customer_id uuid,
  entry_type text not null check (entry_type in
    ('opening_balance','invoice','payment','credit','invoice_reversal','payment_reversal','credit_reversal')),
  amount_paise bigint not null check (amount_paise <> 0),
  invoice_id uuid,
  payment_id uuid,
  credit_note_id uuid,
  business_date date not null,
  posted_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(user_id),
  note text,
  seq bigint generated always as identity,   -- strict posting order (timestamps are per transaction)
  foreign key (shop_id, customer_id) references public.customers(shop_id, id),
  foreign key (shop_id, invoice_id) references public.invoices(shop_id, id),
  foreign key (shop_id, payment_id) references public.payments(shop_id, id),
  foreign key (shop_id, credit_note_id) references public.credit_notes(shop_id, id),
  check (
    (entry_type = 'opening_balance'  and customer_id is not null and invoice_id is null and payment_id is null and credit_note_id is null) or
    (entry_type = 'invoice'          and amount_paise > 0 and invoice_id is not null) or
    (entry_type = 'invoice_reversal' and amount_paise < 0 and invoice_id is not null) or
    (entry_type = 'payment'          and amount_paise < 0 and payment_id is not null) or
    (entry_type = 'payment_reversal' and amount_paise > 0 and payment_id is not null) or
    (entry_type = 'credit'           and amount_paise < 0 and credit_note_id is not null) or
    (entry_type = 'credit_reversal'  and amount_paise > 0 and credit_note_id is not null)
  )
);
-- Each document can hit the ledger exactly once, and be reversed exactly once.
create unique index ledger_invoice_once on public.ledger_entries(invoice_id) where entry_type = 'invoice';
create unique index ledger_invoice_rev_once on public.ledger_entries(invoice_id) where entry_type = 'invoice_reversal';
create unique index ledger_payment_once on public.ledger_entries(payment_id) where entry_type = 'payment';
create unique index ledger_payment_rev_once on public.ledger_entries(payment_id) where entry_type = 'payment_reversal';
create unique index ledger_credit_once on public.ledger_entries(credit_note_id) where entry_type = 'credit';
create unique index ledger_credit_rev_once on public.ledger_entries(credit_note_id) where entry_type = 'credit_reversal';
create index ledger_customer_idx on public.ledger_entries(shop_id, customer_id, posted_at);
create index ledger_shop_date_idx on public.ledger_entries(shop_id, business_date, entry_type);

-- ---------------------------------------------------------------- supporting tables
create table public.ocr_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  created_by uuid not null references public.profiles(user_id),
  provider text not null check (length(provider) <= 40),
  status text not null check (status in ('recognized','low_confidence','failed')),
  raw_text text check (raw_text is null or length(raw_text) <= 20000),
  items jsonb not null default '[]'::jsonb,
  mean_confidence numeric(5,2),
  created_at timestamptz not null default now()
);
create index ocr_jobs_shop_idx on public.ocr_jobs(shop_id, created_at desc);

create table public.audit_events (
  id bigint generated always as identity primary key,
  shop_id uuid references public.shops(id),
  actor_id uuid,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_shop_idx on public.audit_events(shop_id, created_at desc);

create table public.client_mutations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  idempotency_key uuid not null,
  operation text not null,
  request_hash text not null,
  user_id uuid not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (shop_id, idempotency_key)
);

-- Service-only tables (no policies: unreachable from the browser).
create table public.auth_throttle (
  key text primary key,
  window_start timestamptz not null default now(),
  attempts int not null default 0
);
create table public.platform_setup (
  id int primary key check (id = 1),
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid
);
