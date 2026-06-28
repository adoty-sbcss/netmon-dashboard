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
// FULL-SHELL posture (CON-7): a session the dashboard minted in mode="full"
// (after an email one-time-code step-up) instead relays the interactive PTY
// frames {type:"i"|"resize"} operator->sensor — the fixed-argv allow-list does
// NOT apply to those sessions. The mode is authoritative from the dashboard's
// /validate response; the sensor independently re-gates (it only spawns a PTY
// when its open-console command carried mode=full). Restricted sessions are
// byte-identical to before. Every frame still rides the transcript recorder.
//
// Endpoints it CALLS on the dashboard (authenticated by the per-session
// recordKey the dashboard hands back from /validate):
//   POST /api/broker/validate    {token, role, sid}    -> {ok, sid, sensorId, expiresAt, recordKey, mode}
//   GET  /api/broker/alive?sid=  (header x-record-key)  -> {alive: bool}
//   POST /api/broker/transcript  {sid, events, closed}  (header x-record-key)
//
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = parseInt(process.env.BROKER_PORT || "8080", 10);
const DASHBOARD_URL = (process.env.DASHBOARD_URL || "").replace(/\/+$/, "");
// Absolute ceiling from session creation regardless of the dashboard's expiresAt.
// The real (possibly extended, CON-6) deadline is driven by the dashboard via
// /validate + /alive; this just caps how far an extend can ever push. Keep in
// sync with CONSOLE_ABS_MAX_MS on the dashboard.
const ABS_MAX_MS = 60 * 60 * 1000;
const IDLE_MS = 2 * 60 * 1000;
const ALIVE_POLL_MS = 10 * 1000;
const TRANSCRIPT_FLUSH_MS = 30 * 1000;
const MAX_PAYLOAD = 256 * 1024;
const MAX_TRANSCRIPT_EVENTS = 5000;

// Defense-in-depth allow-list; mirrors the sensor's _DIAG_COMMANDS +
// _CONTROL_COMMANDS registries. The sensor is the source of truth and
// re-validates every id; this just refuses to relay anything off-list.
const ALLOWED_CMDS = new Set([
  // read-only diagnostics
  "diag-interfaces",
  "diag-routes",
  "diag-arp",
  "diag-disk",
  "diag-uptime",
  "diag-dns",
  "diag-ping",
  "diag-sftp-test",
  "diag-selftest",
  // state-changing controls (CON-5) — in-container scope; dashboard confirms + audits
  "ctl-flush-arp",
  // in-container operational commands — run live via the sensor's _LIVE_OPS path.
  // HOST actions + `update` stay OFF the live broker (queued near-live path).
  "run-scan",
  "upload-now",
  "config-backup",
  "collect-logs",
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
      mode: "restricted", // "restricted" (allow-list) | "full" (CON-7 PTY); set from /validate
      operator: null,
      sensor: null,
      createdAt: now(),
      lastActivity: now(),
      expiresAt: now() + ABS_MAX_MS,
      transcript: [],
      timers: { idle: null, hard: null, alive: null, flush: null },
      closing: false,
    };
    sessions.set(sid, s);
  }
  return s;
}

function record(session, dir, frame) {
  const len = session.transcript.length;
  if (len >= MAX_TRANSCRIPT_EVENTS) return;
  if (len === MAX_TRANSCRIPT_EVENTS - 1) {
    // Final slot: leave an EXPLICIT marker that recording stopped, so a truncated
    // transcript can never be mistaken for a complete one (the recording is a
    // forensic control for full-shell sessions). The collector also coalesces
    // burst output to make hitting this cap far less likely.
    session.transcript.push({
      t: now(),
      dir: "broker",
      frame: `[transcript truncated — session exceeded ${MAX_TRANSCRIPT_EVENTS} recorded events; further I/O is NOT recorded]`,
    });
    return;
  }
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

// Returns { alive, expiresAt? }. Fail-open on transient dashboard errors (the
// hard ceiling still bounds the session); expiresAt is omitted when unknown.
async function checkAlive(session) {
  if (!session.recordKey) return { alive: true };
  try {
    const res = await dashboardFetch(
      `/api/broker/alive?sid=${encodeURIComponent(session.sid)}`,
      { headers: { "x-record-key": session.recordKey } }
    );
    if (!res.ok) return { alive: true };
    const data = await res.json();
    return {
      alive: !data || data.alive !== false,
      expiresAt: data && typeof data.expiresAt === "number" ? data.expiresAt : undefined,
    };
  } catch {
    return { alive: true };
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

// (Re)arm ONLY the hard time-box timer from the current session.expiresAt. Split
// out of armTimers so an extend can push the deadline back without disturbing the
// idle/alive/flush intervals.
function armHard(session) {
  if (session.timers.hard) clearTimeout(session.timers.hard);
  const hardMs = Math.max(1000, Math.min(ABS_MAX_MS, session.expiresAt - now()));
  session.timers.hard = setTimeout(
    () => closeSession(session, 1000, "time-box reached"),
    hardMs
  );
}

// Adopt a new authoritative deadline (from /validate or /alive), capped to the
// absolute ceiling. If it actually moves the deadline, re-arm the hard timer and
// tell both ends so the operator's countdown tracks it. Returns true if changed.
function applyExpiry(session, expiresAtMs) {
  if (typeof expiresAtMs !== "number") return false;
  const capped = Math.min(session.createdAt + ABS_MAX_MS, expiresAtMs);
  if (capped <= session.expiresAt) return false;
  session.expiresAt = capped;
  armHard(session);
  const msg = JSON.stringify({ type: "expiry", expiresAt: session.expiresAt });
  for (const sock of [session.operator, session.sensor]) {
    if (sock && sock.readyState === sock.OPEN) {
      try {
        sock.send(msg);
      } catch {}
    }
  }
  return true;
}

function armTimers(session) {
  clearTimers(session);
  armHard(session);
  session.timers.idle = setInterval(() => {
    if (now() - session.lastActivity > IDLE_MS) {
      closeSession(session, 1000, "idle timeout");
    }
  }, 15 * 1000);
  session.timers.alive = setInterval(async () => {
    const { alive, expiresAt } = await checkAlive(session);
    if (!alive) {
      closeSession(session, 1000, "killed by operator");
      return;
    }
    applyExpiry(session, expiresAt); // picks up extends (CON-6)
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

  // FULL-SHELL sessions (CON-7): the fixed-argv allow-list does NOT apply. Relay
  // only the PTY-bridge frames (keystrokes + window resize) operator->sensor;
  // refuse anything else. The sensor independently re-gates (it only spawns a
  // PTY when its open-console command carried mode=full).
  if (session.mode === "full") {
    if (!parsed || (parsed.type !== "i" && parsed.type !== "resize")) {
      record(session, "broker", { type: "rejected", reason: "bad-shell-frame", got: parsed && parsed.type });
      return;
    }
    const sensorSock = session.sensor;
    if (!sensorSock || sensorSock.readyState !== sensorSock.OPEN) {
      if (session.operator && session.operator.readyState === session.operator.OPEN) {
        session.operator.send(JSON.stringify({ type: "err", message: "sensor not connected" }));
      }
      return;
    }
    record(session, "op->sensor", parsed.type === "i" ? { type: "i" } : parsed); // don't store raw keystrokes verbatim beyond marker
    sensorSock.send(raw);
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
  // The dashboard owns the session mode (set when it minted the session). Both
  // the operator's and the sensor's /validate return it; adopt "full" only when
  // the dashboard says so — default stays restricted.
  if (result.mode === "full" || result.mode === "restricted") {
    session.mode = result.mode;
  }
  if (typeof result.expiresAt === "number") {
    // The sensor's /validate resets the clock to pairing-time, so this may move
    // the deadline LATER than the click-time provisional value — adopt it
    // directly (capped), don't just shrink toward it.
    session.expiresAt = Math.min(session.createdAt + ABS_MAX_MS, result.expiresAt);
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
    // Carry the authoritative (pairing-based) deadline so the operator's
    // countdown reflects real remaining time, not the click-time estimate.
    const ready = JSON.stringify({ type: "ready", expiresAt: session.expiresAt });
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
