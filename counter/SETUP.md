[SETUP.md](https://github.com/user-attachments/files/32426226/SETUP.md)
# Mindhaus Counter — Setup Guide

A privacy-preserving, self-hosted unique-visitor counter for [Mindhaus](../index.html). Runs entirely on Cloudflare's free tier. You own all the data.

## What this counts

Each unique browser within a rolling **90-day window** is counted once.
Returning visitors are recognized by a randomly-generated UUID stored in
their own browser's `localStorage`. After 90 days of inactivity the UUID
expires server-side and the next visit counts as a new unique visitor.

## What this does NOT collect

- No IP addresses (Cloudflare sees them transiently to route requests; the Worker never reads or stores them)
- No User-Agent, Referer, or other request metadata
- No cookies, no fingerprinting, no cross-device tracking
- No third-party analytics services loaded

## Cost

**$0** on Cloudflare's free tier. Limits:
- 100,000 Worker requests/day
- 1,000 KV writes/day, 100,000 KV reads/day
- 1 GB KV storage

A typical Mindhaus deployment will use <1% of these limits.

---

## Setup (~10 minutes)

### 1. Sign up at Cloudflare

https://dash.cloudflare.com/sign-up — free.

### 2. Install Wrangler (the deploy CLI)

```bash
npm install -g wrangler
```

Or with Homebrew: `brew install wrangler`

### 3. Login

```bash
wrangler login
```

A browser window opens. Approve.

### 4. Create the two KV namespaces

```bash
wrangler kv:namespace create VISITORS
wrangler kv:namespace create COUNTER
```

Each prints a JSON block like:
```
{ "id": "abc123def456..." }
```

### 5. Edit `wrangler.toml`

Open `counter/wrangler.toml` and replace the four placeholder IDs:

```toml
[[kv_namespaces]]
binding = "VISITORS"
id = "abc123def456..."            # ← paste here
preview_id = "xyz789ghi012..."    # ← paste preview ID here

[[kv_namespaces]]
binding = "COUNTER"
id = "def456abc123..."            # ← paste here
preview_id = "ghi012xyz789..."    # ← paste preview ID here
```

To get the **preview IDs**, run the same `create` commands again with a `--preview` flag:
```bash
wrangler kv:namespace create VISITORS --preview
wrangler kv:namespace create COUNTER --preview
```

### 6. Deploy

```bash
cd counter
wrangler deploy
```

You'll see:
```
Published mindhaus-counter (X.XX sec)
  https://mindhaus-counter.YOUR_SUBDOMAIN.workers.dev
```

That's your counter URL. Test it:
```bash
curl https://mindhaus-counter.YOUR_SUBDOMAIN.workers.dev/
# → "Mindhaus counter is running. Total unique visitors (90-day window): 0"
```

### 7. Wire it into Mindhaus

Open `../index.html`, search for `const COUNTER_URL = '';` (near the top of the `<script>` block), and set it:

```js
const COUNTER_URL = 'https://mindhaus-counter.YOUR_SUBDOMAIN.workers.dev';
```

Save. Push your updated Mindhaus to GitHub Pages (or wherever you host it).

### 8. Verify

Visit your live Mindhaus site. Wait ~2 seconds. Then read the count:

```bash
# Method 1: the landing page
curl https://mindhaus-counter.YOUR_SUBDOMAIN.workers.dev/

# Method 2: the JSON endpoint
curl https://mindhaus-counter.YOUR_SUBDOMAIN.workers.dev/count
# → {"total":1,"window":"90 days"}

# Method 3: directly from KV
wrangler kv:key get --binding=COUNTER total
```

---

## How to read the count later

| Method | Command |
|---|---|
| Browser/curl | `curl https://mindhaus-counter.YOUR_SUBDOMAIN.workers.dev/` |
| JSON API | `curl https://mindhaus-counter.YOUR_SUBDOMAIN.workers.dev/count` |
| Wrangler CLI | `wrangler kv:key get --binding=COUNTER total` |
| Cloudflare dashboard | Workers & Pages → mindhaus-counter → KV → COUNTER namespace → `total` key |

---

## Privacy considerations

### What the server knows about each request

A single GET to `/ping?id=<random-uuid>`. Cloudflare's network sees the
visitor's IP address in order to route the request — this is unavoidable
for any internet-facing endpoint. The Worker **never reads, logs, or
stores the IP address** — it only sees the `id` query parameter and
interacts with KV. The Worker code has no `request.headers` access and
no IP-touching logic.

### What the user can do to opt out

- **Clear `mh:visitor-id` from localStorage** — next visit will be counted as new, but each *subsequent* visit from the same browser will still be counted (until they clear again). This is opt-out by repetition, not true opt-out.
- **Disable JavaScript** — the ping requires JS. Visitors with JS disabled are simply not counted.
- **Use the app on a different browser or device** — each gets its own UUID.
- **Block the Workers.dev domain** in a content blocker / pi-hole.

If you want **true opt-in** (only count when a user explicitly opts in),
edit the `sendVisitPing()` function in `index.html` to gate on a setting
stored in `localStorage`, and add a toggle in the footer. The Worker
doesn't need any changes.

### What the worker does NOT log

Cloudflare Workers do not log requests to your application by default.
Worker logs (if you enable them in the dashboard) show request metadata
(IP, URL, status) for debugging — but you control whether to enable
them. Recommended: **leave logs off** to keep IP retention minimal.

---

## If you need exact counts (no race conditions)

The default KV-based counter has a small race-condition window: if two
new visitors hit `/ping` at almost the same instant, both could read
`total=42`, both could write `43`, and you'd end up with `43` instead of
`44`. This is rare and the error is bounded — for typical Mindhaus
traffic it's invisible.

For exact accounting, upgrade the `total` counter to a **Cloudflare
Durable Object** with an atomic `++` increment. The Worker code change
is ~15 lines and the free tier allows 100K Durable Object requests/day.
Ask if you want me to make that change.

---

## Disabling the counter

In `index.html`, set `COUNTER_URL = ''` (the default). The `sendVisitPing()`
function returns immediately when the URL is empty. No requests are made.

To fully delete the deployed Worker:
```bash
wrangler delete
```
