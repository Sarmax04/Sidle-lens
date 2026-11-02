// The only way the importer goes on the network. Every request passes assertAllowedUrl first.
// Hard rule: never contact sharetextures.com or sketchfab.com (or any of their subdomains),
// not even to read a page; local models from those sites are imported from files on disk.

export const BLOCKED_HOSTS = ["sharetextures.com", "sketchfab.com"]

/** True when `host` is a blocked domain or one of its subdomains. */
export function isBlockedHost(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "")
  return BLOCKED_HOSTS.some((b) => h === b || h.endsWith(`.${b}`))
}

/** Throws for blocked hosts. Non-network URLs (file:, data:) are allowed. */
export function assertAllowedUrl(url) {
  const u = url instanceof URL ? url : new URL(String(url))
  if (/^https?:$|^wss?:$/.test(u.protocol) && isBlockedHost(u.hostname)) {
    throw new Error(`refusing to contact ${u.hostname}: the importer never contacts ${BLOCKED_HOSTS.join(" or ")}`)
  }
  return u
}

/** fetch() that refuses blocked hosts, also after redirects. */
export async function safeFetch(url, init = {}) {
  assertAllowedUrl(url)
  let res = await globalThis.fetch(url, {...init, redirect: "manual"})
  for (let hops = 0; res.status >= 300 && res.status < 400 && res.headers.get("location"); hops++) {
    if (hops >= 10) throw new Error(`${url}: too many redirects`)
    const next = new URL(res.headers.get("location"), url)
    assertAllowedUrl(next)
    url = next.href
    res = await globalThis.fetch(url, {...init, redirect: "manual"})
  }
  return res
}
