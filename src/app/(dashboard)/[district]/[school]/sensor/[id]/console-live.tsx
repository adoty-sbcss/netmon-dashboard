"use client";

/**
 * Live remote-console (browser SSH-like) over the zero-secret tunnel broker.
 * Superadmin opens a session -> server mints one-time tokens + queues an
 * `open-console` command -> the sensor dials the broker on its next check-in ->
 * this component bridges to the same broker as the operator and streams output.
 * Restricted-command posture: only the allow-listed diag-* buttons can be sent.
 */
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { Radio, Square, Loader2, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  openConsoleSessionAction,
  killConsoleSessionAction,
  extendConsoleSessionAction,
  type SensorActionState,
} from "@/lib/admin/sensor-actions";
import {
  CONSOLE_COMMANDS,
  CONSOLE_CONTROL_COMMANDS,
  CONSOLE_OP_COMMANDS,
} from "@/lib/admin/console-config";

type Line = { kind: "cmd" | "out" | "err" | "sys"; text: string };
type ConnState = "idle" | "connecting" | "waiting" | "ready" | "closed" | "error";

export function RemoteConsoleLive({
  sensorId,
  basePath,
}: {
  sensorId: number;
  basePath: string;
}) {
  const [openState, openAction, opening] = useActionState<SensorActionState, FormData>(
    openConsoleSessionAction,
    {},
  );
  const [killState, killAction] = useActionState<SensorActionState, FormData>(
    killConsoleSessionAction,
    {},
  );
  const [extendState, extendAction, extending] = useActionState<SensorActionState, FormData>(
    extendConsoleSessionAction,
    {},
  );

  const [conn, setConn] = useState<ConnState>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  // Authoritative time-box: seeded from the open action (click-time estimate),
  // then corrected by the broker's `ready`/`expiry` frames (pairing-time + any
  // extends). The countdown reads this, not the static session value.
  const [liveExpiresAt, setLiveExpiresAt] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const session = openState.session;

  const append = useCallback((kind: Line["kind"], text: string) => {
    setLines((prev) => [...prev.slice(-499), { kind, text }]);
  }, []);

  // Open + drive the operator WebSocket for the minted session.
  useEffect(() => {
    if (!session) return;
    setLines([]);
    setConn("connecting");
    setLiveExpiresAt(session.expiresAt);
    append("sys", `Opening session ${session.sid.slice(0, 8)}…`);

    const url = `${session.broker}?role=operator&token=${encodeURIComponent(
      session.operatorToken,
    )}&sid=${encodeURIComponent(session.sid)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => append("sys", "Connected to broker. Waiting for the sensor to dial in…");
    ws.onmessage = (ev) => {
      let f: Record<string, unknown>;
      try {
        f = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      switch (f.type) {
        case "hello":
          break;
        case "waiting":
          setConn("waiting");
          break;
        case "ready":
          setConn("ready");
          if (typeof f.expiresAt === "number") setLiveExpiresAt(f.expiresAt);
          append("sys", "Sensor connected — session ready.");
          break;
        case "expiry":
          if (typeof f.expiresAt === "number") setLiveExpiresAt(f.expiresAt);
          break;
        case "begin":
          setRunning(String(f.id ?? ""));
          append("cmd", `$ ${String(f.id ?? "")}`);
          break;
        case "out":
          append((f.stream === "stderr" ? "err" : "out"), String(f.data ?? ""));
          break;
        case "exit":
          append("sys", `[exit ${String(f.code ?? "?")}${f.ms ? ` · ${f.ms}ms` : ""}]`);
          setRunning(null);
          break;
        case "err":
          append("err", String(f.message ?? "error"));
          setRunning(null);
          break;
        case "rejected":
          append("err", `command rejected: ${String(f.got ?? "")}`);
          setRunning(null);
          break;
        case "closed":
          append("sys", `Session closed: ${String(f.reason ?? "")}`);
          setConn("closed");
          break;
        default:
          break;
      }
    };
    ws.onerror = () => {
      setConn("error");
      append("err", "WebSocket error.");
    };
    ws.onclose = () => {
      setConn((c) => (c === "closed" ? c : "closed"));
    };

    // Keepalive so the broker's idle timer doesn't trip while the tab is open
    // (the hard 30-min time-box still bounds the session).
    const ka = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 45_000);

    return () => {
      clearInterval(ka);
      try {
        ws.close();
      } catch {
        /* noop */
      }
      wsRef.current = null;
    };
  }, [session, append]);

  // Time-box countdown — driven by the authoritative expiry.
  useEffect(() => {
    if (liveExpiresAt == null) return;
    const tick = () => setRemaining(Math.max(0, liveExpiresAt - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [liveExpiresAt]);

  // Optimistically reflect an extend immediately; the broker's `expiry` frame
  // confirms it within ~10s.
  useEffect(() => {
    if (extendState.extendedExpiresAt) {
      setLiveExpiresAt((prev) => Math.max(prev ?? 0, extendState.extendedExpiresAt!));
    }
  }, [extendState]);

  // Autoscroll output.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const sendCmd = (id: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "cmd", id }));
    }
  };

  // State-changing actions (CON-5) require an explicit confirm before they run.
  const sendControl = (id: string, confirmText: string) => {
    if (typeof window !== "undefined" && !window.confirm(confirmText)) return;
    sendCmd(id);
  };

  const mmss = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const live = conn === "ready" || conn === "waiting" || conn === "connecting";

  if (!session) {
    return (
      <div className="flex flex-col gap-2">
        <form action={openAction}>
          <input type="hidden" name="sensorId" value={sensorId} />
          <input type="hidden" name="basePath" value={basePath} />
          <Button type="submit" size="sm" disabled={opening}>
            {opening ? <Loader2 className="size-4 animate-spin" /> : <Radio className="size-4" />}
            Open live session
          </Button>
        </form>
        {openState.error && <p className="text-xs text-destructive">{openState.error}</p>}
        <p className="text-xs text-muted-foreground">
          Opens a time-boxed (30 min), fully-recorded tunnel to the sensor. The box connects out to
          the broker on its next check-in and the session becomes ready. Only the allow-listed
          diagnostics and in-container commands below can be run — host actions stay on the
          maintenance panel.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge
          variant={conn === "ready" ? "default" : conn === "error" ? "destructive" : "secondary"}
          className="gap-1"
        >
          {live && conn !== "ready" && <Loader2 className="size-3 animate-spin" />}
          {conn === "ready"
            ? "Ready"
            : conn === "waiting"
              ? "Waiting for sensor"
              : conn === "connecting"
                ? "Connecting"
                : conn === "error"
                  ? "Error"
                  : "Closed"}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">
          {session.sid.slice(0, 8)} · {mmss(remaining)} left
        </span>
        <div className="ml-auto flex items-center gap-2">
          <form action={extendAction}>
            <input type="hidden" name="sid" value={session.sid} />
            <input type="hidden" name="basePath" value={basePath} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={extending || conn === "closed" || conn === "error"}
            >
              {extending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Clock className="size-3" />
              )}
              +30 min
            </Button>
          </form>
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
        </div>
      </div>
      {extendState.error && <p className="text-xs text-destructive">{extendState.error}</p>}

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Diagnostics (read-only)</span>
        <div className="flex flex-wrap gap-2">
          {CONSOLE_COMMANDS.map(({ id, label }) => (
            <Button
              key={id}
              type="button"
              variant="outline"
              size="sm"
              disabled={conn !== "ready" || running !== null}
              onClick={() => sendCmd(id)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {CONSOLE_OP_COMMANDS.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-2">
          <span className="text-xs font-medium text-muted-foreground">Run (live, in-container)</span>
          <div className="flex flex-wrap gap-2">
            {CONSOLE_OP_COMMANDS.map(({ id, label }) => (
              <Button
                key={id}
                type="button"
                variant="outline"
                size="sm"
                disabled={conn !== "ready" || running !== null}
                onClick={() => sendCmd(id)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {CONSOLE_CONTROL_COMMANDS.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
            Actions (change state):
          </span>
          {CONSOLE_CONTROL_COMMANDS.map(({ id, label, confirm }) => (
            <Button
              key={id}
              type="button"
              variant="outline"
              size="sm"
              className="border-amber-500/60 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
              disabled={conn !== "ready" || running !== null}
              onClick={() => sendControl(id, confirm)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        className="h-64 overflow-auto rounded-lg border bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-100"
      >
        {lines.length === 0 ? (
          <span className="text-zinc-500">No output yet.</span>
        ) : (
          lines.map((l, i) => (
            <pre
              key={i}
              className={
                l.kind === "cmd"
                  ? "whitespace-pre-wrap text-emerald-400"
                  : l.kind === "err"
                    ? "whitespace-pre-wrap text-red-400"
                    : l.kind === "sys"
                      ? "whitespace-pre-wrap text-zinc-500"
                      : "whitespace-pre-wrap text-zinc-100"
              }
            >
              {l.text}
            </pre>
          ))
        )}
      </div>
      {killState.message && <p className="text-xs text-muted-foreground">{killState.message}</p>}
    </div>
  );
}
