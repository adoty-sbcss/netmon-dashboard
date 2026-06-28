"use client";

/**
 * FULL-shell remote console (CON-7) — an UNRESTRICTED interactive PTY on the
 * sensor, the SSH-like escalation from the allow-listed RemoteConsoleLive.
 *
 * Because a full shell removes the fixed-argv allow-list containment, opening one
 * is gated behind an email one-time-code STEP-UP: the operator requests a code
 * (emailed, no link — slips past the Defender quarantine, registry CON-10), then
 * enters it to mint a `mode=full` session. The session is otherwise identical to
 * the restricted one (same broker, same 30m/60m time-box, kill-switch) and the
 * broker records the WHOLE session into the transcript.
 *
 * Frames vs. the restricted console: instead of {type:"cmd"} buttons we bridge a
 * real terminal — operator keystrokes go up as {type:"i", data:<base64>}, window
 * size as {type:"resize", cols, rows}; the sensor streams PTY output down as
 * {type:"o", data:<base64>} and a final {type:"shell-exit"} when bash exits.
 *
 * xterm is imported lazily inside the effect so the module never loads during SSR
 * (`next build`); only the stylesheet is statically imported.
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { TerminalSquare, Square, Loader2, Clock, ShieldAlert, KeyRound } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  requestFullShellStepUpAction,
  openFullShellSessionAction,
  killConsoleSessionAction,
  extendConsoleSessionAction,
  type SensorActionState,
} from "@/lib/admin/sensor-actions";

type ConnState = "idle" | "connecting" | "waiting" | "ready" | "closed" | "error";

/** UTF-8 string -> base64 (btoa is latin1-only, so encode bytes first). */
function toB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** base64 -> raw bytes (PTY output may be non-UTF-8 mid-sequence). */
function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function FullShellConsole({
  sensorId,
  basePath,
}: {
  sensorId: number;
  basePath: string;
}) {
  const [reqState, requestAction, requesting] = useActionState<SensorActionState, FormData>(
    requestFullShellStepUpAction,
    {},
  );
  const [openState, openAction, opening] = useActionState<SensorActionState, FormData>(
    openFullShellSessionAction,
    {},
  );
  const [, killAction] = useActionState<SensorActionState, FormData>(killConsoleSessionAction, {});
  const [extendState, extendAction, extending] = useActionState<SensorActionState, FormData>(
    extendConsoleSessionAction,
    {},
  );

  const [conn, setConn] = useState<ConnState>("idle");
  const [remaining, setRemaining] = useState<number>(0);
  const [liveExpiresAt, setLiveExpiresAt] = useState<number | null>(null);

  const termHostRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const readyRef = useRef(false);

  const challengeId = reqState.stepUp?.challengeId ?? null;
  const session = openState.session;

  // Open + drive the operator WebSocket + xterm terminal once a session is minted.
  useEffect(() => {
    if (!session || !termHostRef.current) return;
    let disposed = false;
    setConn("connecting");
    setLiveExpiresAt(session.expiresAt);

    let term: import("@xterm/xterm").Terminal | null = null;
    let ws: WebSocket | null = null;
    let ka: ReturnType<typeof setInterval> | null = null;
    let ro: ResizeObserver | null = null;

    (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      if (disposed || !termHostRef.current) return;

      const fit = new FitAddon();
      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
        theme: { background: "#09090b", foreground: "#e4e4e7" },
        scrollback: 5000,
      });
      term.loadAddon(fit);
      term.open(termHostRef.current);
      try {
        fit.fit();
      } catch {
        /* container not laid out yet */
      }
      term.writeln("\x1b[90mConnecting to broker…\x1b[0m");

      const url = `${session.broker}?role=operator&token=${encodeURIComponent(
        session.operatorToken,
      )}&sid=${encodeURIComponent(session.sid)}`;
      ws = new WebSocket(url);
      wsRef.current = ws;

      const sendResize = () => {
        if (!term || !ws || ws.readyState !== ws.OPEN) return;
        try {
          fit.fit();
        } catch {
          /* noop */
        }
        ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      };

      ws.onopen = () =>
        term?.writeln("\x1b[90mWaiting for the sensor to dial in…\x1b[0m");
      ws.onmessage = (ev) => {
        let f: Record<string, unknown>;
        try {
          f = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch {
          return;
        }
        switch (f.type) {
          case "waiting":
            setConn("waiting");
            break;
          case "ready":
            setConn("ready");
            readyRef.current = true;
            if (typeof f.expiresAt === "number") setLiveExpiresAt(f.expiresAt);
            term?.writeln("\x1b[32mSensor connected — shell ready.\x1b[0m");
            sendResize(); // nudge bash to (re)draw its prompt at our size
            term?.focus();
            break;
          case "expiry":
            if (typeof f.expiresAt === "number") setLiveExpiresAt(f.expiresAt);
            break;
          case "o":
            if (typeof f.data === "string") term?.write(fromB64(f.data));
            break;
          case "shell-exit":
            term?.writeln(`\r\n\x1b[90m[shell exited — code ${String(f.code ?? "?")}]\x1b[0m`);
            break;
          case "err":
            term?.writeln(`\r\n\x1b[31m${String(f.message ?? "error")}\x1b[0m`);
            break;
          case "closed":
            term?.writeln(`\r\n\x1b[90m[session closed: ${String(f.reason ?? "")}]\x1b[0m`);
            setConn("closed");
            readyRef.current = false;
            break;
          default:
            break;
        }
      };
      ws.onerror = () => {
        setConn("error");
        term?.writeln("\r\n\x1b[31mWebSocket error.\x1b[0m");
      };
      ws.onclose = () => {
        readyRef.current = false;
        setConn((c) => (c === "closed" ? c : "closed"));
      };

      // Operator keystrokes -> sensor PTY stdin (only once paired).
      term.onData((d) => {
        if (readyRef.current && ws && ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "i", data: toB64(d) }));
        }
      });

      // Track container size; refit + tell the sensor on layout changes.
      ro = new ResizeObserver(() => sendResize());
      ro.observe(termHostRef.current);

      // Keepalive (broker idle timer); the hard time-box still bounds the session.
      ka = setInterval(() => {
        if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 45_000);
    })();

    return () => {
      disposed = true;
      readyRef.current = false;
      ro?.disconnect();
      if (ka) clearInterval(ka);
      try {
        ws?.close();
      } catch {
        /* noop */
      }
      try {
        term?.dispose();
      } catch {
        /* noop */
      }
      wsRef.current = null;
    };
  }, [session]);

  // Effective time-box = latest of the broker-driven expiry and an optimistic
  // extend result. Derived at render so there's no setState-in-effect cascade;
  // the broker's `expiry` frame confirms the extend within ~10s either way.
  const effectiveExpiresAt = Math.max(liveExpiresAt ?? 0, extendState.extendedExpiresAt ?? 0) || null;

  // Time-box countdown.
  useEffect(() => {
    if (effectiveExpiresAt == null) return;
    const tick = () => setRemaining(Math.max(0, effectiveExpiresAt - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [effectiveExpiresAt]);

  const mmss = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  // --- Phase 1: no challenge yet — show the "request full-shell access" gate. ---
  if (!challengeId && !session) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-50/40 p-3 dark:bg-amber-950/20">
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <ShieldAlert className="size-4" />
          <span className="text-sm font-medium">Full shell (unrestricted)</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Opens an <strong>unrestricted interactive shell</strong> inside the sensor container —
          the fixed-argv allow-list does <strong>not</strong> apply. Requires a one-time code
          emailed to you, and the entire session is recorded. Same 30-min time-box and kill-switch
          as the restricted console.
        </p>
        <form action={requestAction}>
          <input type="hidden" name="sensorId" value={sensorId} />
          <Button type="submit" size="sm" variant="outline" disabled={requesting}>
            {requesting ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            Request full-shell access
          </Button>
        </form>
        {reqState.error && <p className="text-xs text-destructive">{reqState.error}</p>}
      </div>
    );
  }

  // --- Phase 2: code emailed — enter it to mint the session. ---
  if (challengeId && !session) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-50/40 p-3 dark:bg-amber-950/20">
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <KeyRound className="size-4" />
          <span className="text-sm font-medium">Enter the verification code</span>
        </div>
        {reqState.message && <p className="text-xs text-muted-foreground">{reqState.message}</p>}
        <form action={openAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="sensorId" value={sensorId} />
          <input type="hidden" name="challengeId" value={challengeId} />
          <input type="hidden" name="basePath" value={basePath} />
          <Input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d*"
            maxLength={6}
            placeholder="6-digit code"
            className="w-36 font-mono tracking-widest"
            autoFocus
            required
          />
          <Button type="submit" size="sm" disabled={opening}>
            {opening ? <Loader2 className="size-4 animate-spin" /> : <TerminalSquare className="size-4" />}
            Verify &amp; open shell
          </Button>
        </form>
        {openState.error && <p className="text-xs text-destructive">{openState.error}</p>}
        <form action={requestAction}>
          <input type="hidden" name="sensorId" value={sensorId} />
          <button
            type="submit"
            className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
            disabled={requesting}
          >
            {requesting ? "Sending…" : "Send a new code"}
          </button>
        </form>
      </div>
    );
  }

  // --- Phase 3: session minted — the live terminal. ---
  const live = conn === "ready" || conn === "waiting" || conn === "connecting";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge
          variant={conn === "ready" ? "default" : conn === "error" ? "destructive" : "secondary"}
          className="gap-1"
        >
          {live && conn !== "ready" && <Loader2 className="size-3 animate-spin" />}
          {conn === "ready"
            ? "Shell ready"
            : conn === "waiting"
              ? "Waiting for sensor"
              : conn === "connecting"
                ? "Connecting"
                : conn === "error"
                  ? "Error"
                  : "Closed"}
        </Badge>
        <Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-700 dark:text-amber-400">
          <ShieldAlert className="size-3" /> unrestricted
        </Badge>
        {session && (
          <span className="font-mono text-xs text-muted-foreground">
            {session.sid.slice(0, 8)} · {mmss(remaining)} left
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {session && (
            <form action={extendAction}>
              <input type="hidden" name="sid" value={session.sid} />
              <input type="hidden" name="basePath" value={basePath} />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={extending || conn === "closed" || conn === "error"}
              >
                {extending ? <Loader2 className="size-3 animate-spin" /> : <Clock className="size-3" />}
                +30 min
              </Button>
            </form>
          )}
          {session && (
            <form action={killAction}>
              <input type="hidden" name="sid" value={session.sid} />
              <input type="hidden" name="basePath" value={basePath} />
              <Button
                type="submit"
                size="sm"
                variant="destructive"
                onClick={() => {
                  try {
                    wsRef.current?.close();
                  } catch {
                    /* noop */
                  }
                }}
              >
                <Square className="size-3" /> Kill
              </Button>
            </form>
          )}
        </div>
      </div>
      {extendState.error && <p className="text-xs text-destructive">{extendState.error}</p>}
      <div
        ref={termHostRef}
        className="h-80 overflow-hidden rounded-lg border bg-zinc-950 p-2"
        onClick={() => wsRef.current && conn === "ready" && termHostRef.current?.querySelector("textarea")?.focus()}
      />
      <p className="text-xs text-muted-foreground">
        Unrestricted shell inside the sensor container. Everything you type and see is recorded to
        the session transcript. Closing this tab or clicking Kill ends the session.
      </p>
    </div>
  );
}
