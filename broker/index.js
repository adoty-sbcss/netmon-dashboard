"use strict";
//
// NetMon tunnel-broker — stateless WebSocket relay for the remote console.
//
// SECURITY POSTURE: this process holds NO secrets and NO database access. It is
// a dumb pipe that, for every connection, asks the dashboard to verify an
// opaque one-time session token. The dashboard owns all session state
// (shell_sessions), the audit trail, the time-box, and the kill-switch. A full
// compromise of this container leaks nothing but in-flight console bytes for
// sessions an operator has explicitly opened.
//
// Two clients meet here, keyed by a session id (sid):
//   - role=operator : the superadmin's browser (rendered terminal)
//   - role=sensor   : the sensor box, dialing OUT over 443 after it sees an
//                     `open-console` command on its next check-in
// The broker pairs them and bridges frames. RESTRICTED-COMMAND posture: only
// operator->sensor frames of the form {type:"cmd", id:"diag-*"} (id in the
// allow-list) are forwarded; the sensor independently re-validates.
//
// Endpoints it CALLS on the dashboard (authenticated by the per-session
// recordKey the dashboard hands back from /validate):
//   POST /api/broker/validate    {token, role, sid}    -> {ok, sid, sensorId, expiresAt, recordKey}
//   GET  /api/broker/alive?sid=  (header x-record-key)  -> {alive: bool}
//   POST /api/broker/transcript  {sid, events, closed}  (header x-record-key)
//
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = parseInt(process.env.BROKER_PORT || "8080", 10);
const DASHBOARD_URL = (process.env.DASHBOARD_URL || "").replace(/\/+$/, "");
const MAX_SESSION_MS = 15 * 60 * 1000; // hard ceiling regardless of expiresAt
const IDLE_MS = 2 * 60 * 1000;
const ALIVE_POLL_MS = 10 * 1000;
const TRANSCRIPT_FLUSH_MS = 30 * 1000;
const MAX_PAYLOAD = 256 * 1024;
const MAX_TRANSCRIPT_EVENTS = 5000;

// Defense-in-depth allow-list; mirrors the sensor's _DIAG_COMMANDS registry.
// The sensor is the source of truth and re-validates every id.
const ALLOWED_CMDS = new Set([
  "diag-interfaces",
  "diag-routes",
  "diag-arp",
  "diag-disk",
  "diag-uptime",
  "diag-dns",
  "diag-selftest",
]);

if (!DASHBOARD_URL) {
  console.error("[broker] FATAL: DASHBOARD_URL is not set");
  process.exit(1);
}

/** @type {Map<string, Session>} sid -> session */
const sessions = new Map();

function now() {
  return Date.now();
}

function log(...args) {
  console.log(`[broker ${new Date().toISOString()}]`, ...args);
}

function getSession(sid) {
  let s = sessions.get(sid);
  if (!s) {
    s = {
      sid,
      sensorId: null,
      recordKey: null,
      operator: null,
      sensor: null,
      createdAt: now(),
      lastActivity: now(),
      expiresAt: now() + MAX_SESSION_MS,
      transcript: [],
      timers: { idle: null, hard: null, alive: null, flush: null },
      closing: false,
    };
    sessions.set(sid, s);
  }
  return s;
}

function record(session, dir, frame) {
  if (session.transcript.length >= MAX_TRANSCRIPT_EVENTS) return;
  session.transcript.push({ t: now(), dir, frame: truncateFrame(frame) });
}

function truncateFrame(frame) {
  // Keep the transcript bounded; raw output frames can be large.
  try {
    const s = typeof frame === "string" ? frame : JSON.stringify(frame);
    return s.length > 8192 ? s.slice(0, 8192) + "…[truncated]" : s;
  } catch {
    return "[unserializable]";
  }
}

async function dashboardFetch(path, opts) {
  const url = `${DASHBOARD_URL}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function validate(token, role, sid) {
  try {
    const res = await dashboardFetch("/api/broker/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, role, sid }),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    return data && data.ok ? data : { ok: false };
  } catch (err) {
    log("validate error:", err && err.message);
    return { ok: false };
  }
}

async function flushTranscript(session, closed) {
  if (!session.recordKey || session.transcript.length === 0) return;
  const events = session.transcript;
  try {
    await dashboardFetch("/api/broker/transcript", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-record-key": session.recordKey,
      },
      body: JSON.stringify({ sid: session.sid, events, closed: !!closed }),
    });
  } catch (err) {
    log(`flush transcript ${session.sid} error:`, err && err.message);
  }
}

async function checkAlive(session) {
  if (!session.recordKey) return true;
  try {
    const res = await dashboardFetch(
      `/api/broker/alive?sid=${encodeURIComponent(session.sid)}`,
      { headers: { "x-record-key": session.recordKey } }
    );
    if (!res.ok) return true; // fail-open on transient dashboard errors; hard ceiling still applies
    const data = await res.json();
    return data && data.alive !== false;
  } catch {
    return true;
  }
}

function clearTimers(session) {
  for (const k of Object.keys(session.timers)) {
    if (session.timers[k]) {
      clearTimeout(session.timers[k]);
      clearInterval(session.timers[k]);
      session.timers[k] = null;
    }
  }
}

function closeSession(session, code, reason) {
  if (session.closing) return;
  session.closing = true;
  clearTimers(session);
  const msg = JSON.stringify({ type: "closed", reason: reason || "closed" });
  for (const sock of [session.operator, session.sensor]) {
    if (sock && sock.readyState === sock.OPEN) {
      try {
        sock.send(msg);
      } catch {}
      try {
        sock.close(code || 1000, (reason || "closed").slice(0, 120));
      } catch {}
    }
  }
  flushTranscript(session, true).finally(() => sessions.delete(session.sid));
  log(`session ${session.sid} closed: ${reason}`);
}

function bumpActivity(session) {
  session.lastActivity = now();
}

function armTimers(session) {
  clearTimers(session);
  const hardMs = Math.max(1000, Math.min(MAX_SESSION_MS, session.expiresAt - now()));
  session.timers.hard = setTimeout(
    () => closeSession(session, 1000, "time-box reached"),
    hardMs
  );
  session.timers.idle = setInterval(() => {
    if (now() - session.lastActivity > IDLE_MS) {
      closeSession(session, 1000, "idle timeout");
    }
  }, 15 * 1000);
  session.timers.alive = setInterval(async () => {
    const alive = await checkAlive(session);
    if (!alive) closeSession(session, 1000, "killed by operator");
  }, ALIVE_POLL_MS);
  session.timers.flush = setInterval(
    () => flushTranscript(session, false),
    TRANSCRIPT_FLUSH_MS
  );
}

function peerOf(session, role) {
  return role === "operator" ? session.sensor : session.operator;
}

function handleOperatorFrame(session, raw) {
  // Operator -> sensor: only allow-listed command frames pass.
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // drop non-JSON from operator
  }
  if (parsed && parsed.type === "ping") {
    if (session.operator && session.operator.readyState === session.operator.OPEN) {
      session.operator.send(JSON.stringify({ type: "pong", t: now() }));
    }
    return;
  }
  if (!parsed || parsed.type !== "cmd" || !ALLOWED_CMDS.has(parsed.id)) {
    record(session, "broker", { type: "rejected", reason: "not-allow-listed", got: parsed && parsed.id });
    if (session.operator && session.operator.readyState === session.operator.OPEN) {
      session.operator.send(
        JSON.stringify({ type: "err", message: `command not permitted: ${parsed && parsed.id}` })
      );
    }
    return;
  }
  const sensor = session.sensor;
  if (!sensor || sensor.readyState !== sensor.OPEN) {
    if (session.operator && session.operator.readyState === session.operator.OPEN) {
      session.operator.send(JSON.stringify({ type: "err", message: "sensor not connected" }));
    }
    return;
  }
  record(session, "op->sensor", parsed);
  sensor.send(JSON.stringify({ type: "cmd", id: parsed.id }));
}

function handleSensorFrame(session, raw) {
  // Sensor -> operator: stream output verbatim (bounded by maxPayload).
  const op = session.operator;
  record(session, "sensor->op", raw);
  if (op && op.readyState === op.OPEN) {
    op.send(raw);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, sessions: sessions.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

server.on("upgrade", async (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    socket.destroy();
    return;
  }
  if (url.pathname !== "/console") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  const role = url.searchParams.get("role");
  const token = url.searchParams.get("token");
  const sid = url.searchParams.get("sid");
  if ((role !== "operator" && role !== "sensor") || !token || !sid) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const result = await validate(token, role, sid);
  if (!result.ok || result.sid !== sid) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    attach(ws, role, result);
  });
});

function attach(ws, role, result) {
  const session = getSession(result.sid);
  if (session.closing) {
    try {
      ws.close(1013, "session closing");
    } catch {}
    return;
  }
  session.sensorId = result.sensorId || session.sensorId;
  session.recordKey = result.recordKey || session.recordKey;
  if (typeof result.expiresAt === "number") {
    session.expiresAt = Math.min(session.createdAt + MAX_SESSION_MS, result.expiresAt);
  }

  // One socket per role; replace a stale one.
  const existing = session[role];
  if (existing && existing.readyState === existing.OPEN) {
    try {
      existing.close(1000, "replaced");
    } catch {}
  }
  session[role] = ws;
  bumpActivity(session);
  log(`session ${session.sid} ${role} connected (sensor=${session.sensorId})`);

  ws.send(JSON.stringify({ type: "hello", role, sid: session.sid }));

  // Notify peer + arm session lifecycle once both ends are present.
  if (session.operator && session.sensor) {
    armTimers(session);
    const ready = JSON.stringify({ type: "ready" });
    for (const sock of [session.operator, session.sensor]) {
      if (sock.readyState === sock.OPEN) sock.send(ready);
    }
    log(`session ${session.sid} paired -> ready`);
  } else {
    // Tell the operator we're still waiting for the sensor to dial in.
    if (role === "operator") {
      ws.send(JSON.stringify({ type: "waiting", message: "waiting for sensor to connect" }));
    }
  }

  ws.on("message", (data, isBinary) => {
    bumpActivity(session);
    const raw = isBinary ? data : data.toString();
    if (role === "operator") handleOperatorFrame(session, raw);
    else handleSensorFrame(session, raw);
  });

  ws.on("close", () => {
    log(`session ${session.sid} ${role} disconnected`);
    closeSession(session, 1000, `${role} disconnected`);
  });

  ws.on("error", (err) => {
    log(`session ${session.sid} ${role} ws error:`, err && err.message);
  });
}

server.listen(PORT, () => {
  log(`tunnel-broker listening on :${PORT}; dashboard=${DASHBOARD_URL}`);
});

process.on("SIGTERM", () => {
  log("SIGTERM; draining sessions");
  for (const s of sessions.values()) closeSession(s, 1001, "broker shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
});
