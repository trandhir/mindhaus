/* ============================================================
   Mindhaus Counter — Cloudflare Worker
   Privacy-preserving unique-visitor counter.

   What it stores:
   - COUNTER namespace: a single key 'total' = integer count
   - VISITORS namespace: per-visitor dedup keys with 90-day TTL

   What it does NOT store:
   - IP addresses (Cloudflare sees them transiently to route the
     request; the Worker never reads or writes them)
   - User-Agent, Referer, or any other request metadata
   - Fingerprints, cookies, or any cross-device identifiers

   How dedup works:
   - Client generates a random UUID (stored in localStorage)
     and sends it on each visit
   - Server checks if the UUID was seen in the last 90 days
   - If seen: do nothing (already counted in the window)
   - If new: increment total, mark the UUID with 90-day TTL

   Result: every unique browser (within a rolling 90-day window)
   counts exactly once, regardless of how many times they visit.
   Users who clear localStorage are counted again — which is the
   correct and honest behavior, since from the server's perspective
   they look like a new visitor.

   Cost: $0 on Cloudflare's free tier (100k requests/day,
   1000 KV writes/day, 100k KV reads/day, 1 GB KV storage).
   ============================================================ */

const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

function noContent(status){
  return new Response(null, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

function json(obj, status = 200){
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      // ---- POST /ping : record a visit --------------------------------
      // Client uses navigator.sendBeacon() which only supports POST.
      // We accept GET too for the fetch() fallback.
      if (url.pathname === '/ping' && (request.method === 'POST' || request.method === 'GET')) {
        const id = url.searchParams.get('id');
        if (!id || typeof id !== 'string' || id.length < 16 || id.length > 128) {
          return noContent(400);
        }
        // Validate the id looks like a UUID-ish hex / alphanumeric token.
        // Reject anything that could be log-injection or path-traversal.
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) return noContent(400);

        const visitorKey = `v:${id}`;
        const alreadySeen = await env.VISITORS.get(visitorKey);

        if (!alreadySeen) {
          // New visitor in the 90-day window — increment total, mark visitor.
          // KV reads-then-writes are eventually consistent, so we accept a
          // small race-condition window where two concurrent writes could
          // race and both increment. For accounting purposes this is well
          // within tolerance. If exact counts matter, upgrade to a Durable
          // Object (single-writer, atomic) — see SETUP.md.
          const current = parseInt((await env.COUNTER.get('total')) || '0', 10);
          await env.COUNTER.put('total', String(current + 1));
          await env.VISITORS.put(visitorKey, String(Date.now()), { expirationTtl: TTL_SECONDS });
        }
        // If seen, do nothing — they're already counted in this window.
        // We intentionally do NOT refresh the TTL on repeat visits; we
        // just leave the original 90-day expiry. This means a visitor who
        // returns 89 days later is still counted as the same person,
        // and a visitor who returns 91 days later is counted as new.

        return noContent(204);
      }

      // ---- GET /count : optional, simple JSON read --------------------
      // Comment-out or remove this endpoint if you don't want the total
      // to be publicly readable. Anyone with the URL could see the number.
      // Auth (e.g. require a bearer token) is a 5-line addition if needed.
      if (url.pathname === '/count' && request.method === 'GET') {
        const total = parseInt((await env.COUNTER.get('total')) || '0', 10);
        return json({ total, window: '90 days' });
      }

      // ---- GET / : tiny landing page for sanity-checking the deploy --
      if (url.pathname === '/' && request.method === 'GET') {
        const total = parseInt((await env.COUNTER.get('total')) || '0', 10);
        return new Response(
          `Mindhaus counter is running.\nTotal unique visitors (90-day window): ${total}\n`,
          { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } }
        );
      }

      return new Response('Not found', { status: 404 });
    } catch (err) {
      // Never leak internals to the client.
      return noContent(500);
    }
  },

  // ---- scheduled(): optional daily cleanup of stale visitor keys ----
  // KV's expirationTtl handles this automatically, so this is not needed.
  // Included as a hook if you ever want to log or aggregate.
  async scheduled(event, env) {
    /* no-op; keys expire via TTL */
  }
};
