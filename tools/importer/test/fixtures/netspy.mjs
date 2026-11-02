// Preloaded with --import in importer subprocesses by the tests: records every outgoing
// network call Node makes (fetch, http/https, net/tls) to $SIDLE_NETSPY_LOG, one host per line,
// and refuses all of them.
import {appendFileSync} from "node:fs"
import http from "node:http"
import https from "node:https"
import net from "node:net"
import tls from "node:tls"

const LOG = process.env.SIDLE_NETSPY_LOG

function record(kind, target) {
  let host = ""
  try {
    if (typeof target === "string" || target instanceof URL) host = new URL(String(target)).hostname
    else if (target && typeof target === "object") host = target.hostname || target.host || target.url || ""
  } catch {
    host = String(target)
  }
  if (LOG) appendFileSync(LOG, `${kind} ${host}\n`)
  return new Error(`netspy: ${kind} to ${host} blocked in tests`)
}

globalThis.fetch = async (input) => {
  throw record("fetch", input instanceof Request ? input.url : input)
}
for (const [name, mod] of [["http", http], ["https", https]]) {
  mod.request = (target) => {
    throw record(`${name}.request`, target)
  }
  mod.get = (target) => {
    throw record(`${name}.get`, target)
  }
}
const realConnect = net.connect
net.connect = net.createConnection = (...args) => {
  const o = args[0]
  // local IPC (named pipes / unix sockets, e.g. playwright's browser pipe) is not network
  if (o && typeof o === "object" && o.path) return realConnect(...args)
  if (typeof o === "string" && !/^\d+$/.test(o)) return realConnect(...args)
  throw record("net.connect", typeof o === "object" ? o : {host: args[1] || "localhost"})
}
tls.connect = (...args) => {
  throw record("tls.connect", args[0])
}
