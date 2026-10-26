/**
 * Host half of the DSH hardware monitor: one read-only JSON route carrying the
 * current CPU/GPU/fan snapshot. The browser half polls it while visible.
 *
 * Route: GET /api/hw-monitor/snapshot
 *
 * @module dsh-hw-monitor
 */

import { collectSnapshot } from './collect.js'

const SNAPSHOT_PATH = '/api/hw-monitor/snapshot'
const SNAPSHOT_TTL_MS = 750
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

/** Loader entry id, also exported as the plugin name. */
export const name = 'hw-monitor'

/** The Web carrier must exist before the route can be registered. */
export const inject = ['webServer']

let cache = null
let inflight = null

/**
 * One cached snapshot, shared by every connected page.
 * @returns {Promise<object>}
 */
function snapshot() {
  const now = Date.now()
  if (cache !== null && now - cache.at < SNAPSHOT_TTL_MS) return Promise.resolve(cache.value)
  if (inflight !== null) return inflight
  inflight = collectSnapshot()
    .then((value) => {
      cache = { at: Date.now(), value }
      return value
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * Whether a request originates from this machine.
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
function isLoopback(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

/**
 * Accept loopback always, and an authenticated/paired browser session for
 * remote access. Hardware telemetry is read-only and carries no secrets, but
 * an unpaired LAN request still gets no response body.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
function isAllowed(ctx, req) {
  if (isLoopback(req)) return true
  try {
    const connection = typeof ctx.get === 'function' ? ctx.get('connection', false) : undefined
    if (connection !== undefined && connection !== null && typeof connection.requestRejection === 'function') {
      return connection.requestRejection(req) === undefined
    }
  } catch {
    return false
  }
  return false
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  if (res.headersSent || res.writableEnded) return
  const text = JSON.stringify(body)
  res.writeHead(status, {
    ...JSON_HEADERS,
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

/**
 * Route handler: method fence, trust fence, then one snapshot.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
async function handle(ctx, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  if (!isAllowed(ctx, req)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  try {
    const value = await snapshot()
    if (req.method === 'HEAD') {
      res.writeHead(200, JSON_HEADERS)
      res.end()
      return
    }
    sendJson(res, 200, value)
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Register the telemetry route for the lifetime of this plugin fiber.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SNAPSHOT_PATH,
    handler: (req, res) => handle(ctx, req, res),
  }), 'hw-monitor: snapshot route')
}
