# Accounting rules

## Money and quantities
- Money is **integer paise** (`BIGINT`). Quantities are `NUMERIC(12,3)`. No floating-point number
  is used for any authoritative amount, in the database or in the browser.
- Rupee text is converted to paise by string parsing (`parseRupees`); more than two decimals is
  rejected, not rounded.
- **Rounding policy:** a line is `quantity × unit price`, converted between units with exact
  whole-number ratios (1 kg = 1000 g, 1 litre = 1000 ml, 1 dozen = 12 pieces), then rounded
  **half-up to the nearest paisa**. A bill total is the sum of its line totals. Nothing is rounded
  to a rupee. The browser preview and the database use the same integer arithmetic
  (`lineGrossPaise` and `app_private.line_gross`), and a test checks they agree.
- A line stores its quantity, the unit it was measured in, the unit the price is quoted in, and
  the price — so "500 g at ₹42 per kg" can never become "500 kg".

## Ledger
`ledger_entries.amount_paise` is signed: **positive = the customer owes more, negative = owes less.**

| Entry | Sign |
| --- | --- |
| opening_balance | + (set by the owner; later corrections post the difference) |
| invoice | + bill total |
| payment | − amount |
| credit (return / allowance) | − amount |
| invoice_reversal | − bill total |
| payment_reversal | + amount |
| credit_reversal | + amount |

**Customer balance = sum of that customer's ledger entries.** The `customer_balances` table is a
cache kept by a trigger in the same transaction as each ledger insert. `reconcile_customer_ledger`
compares three independent figures — the cache, the ledger sum, and the unpaid amounts on
documents — and all three must be equal. Walk-in entries have no customer and must net to zero.

## Posting
- Totals are computed in the database from quantities and prices. Totals sent by a client are ignored.
- Every posting function runs as one transaction, locks the customer row, and takes an
  **idempotency key**. Sending the same key again returns the first result; it can never post twice.
- Bill numbers come from a per-shop counter inside the posting transaction: unique, never reused.
- Posted bills, items, payments, allocations, ledger entries and audit rows cannot be updated or
  deleted (database triggers). A bill, payment or credit can only move from *posted* to *reversed*.

## Payment allocation
- Money taken while billing is applied to **that bill**. Anything above the bill total is recorded
  as a separate **old-dues collection**, never as extra sales.
- A collection is applied to the **opening balance first, then the oldest unpaid bill**. Every
  allocation is stored and shown on the receipt and in the customer's history.

## Policies
- **Overpayment: rejected.** A customer can never hold an advance; a database check at commit
  refuses any transaction that would leave a negative balance.
- **Walk-in bills must be paid in full.** There is no anonymous credit.
- **Reversing a bill** also reverses the money taken with it (a refund). Collections applied to it
  later are moved to the customer's other dues; if they do not fit, the owner must reverse that
  payment first.
- **Returns / credits** reduce what the customer owes and cannot exceed it. To refund a bill that
  was already paid in full, reverse the bill. Partial cash refunds are not supported.
- Reversals, credits and opening balances are **owner only**, need a reason, and are audited.

## Reports
- A day is the shop's local calendar day (`shops.timezone`, Asia/Kolkata), fixed on each entry as
  `business_date` when it is posted. The day changes at midnight shop time.
- **Sales** = bills posted that day − bills reversed that day − returns/credits that day.
- **Collections** = payments posted that day − payments reversed that day, split by cash / UPI / other.
- Collecting old dues never changes sales. Outstanding credit is a balance, not revenue.
- The payment method is what the shopkeeper declared. The app does not verify UPI payments.
- No tax is calculated. Receipts are not tax invoices.
