"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertCircle, Loader2, RotateCcw, Send, Sparkles, X } from "lucide-react";

import { getAssistantSession, sendAssistantMessage } from "@/lib/ai/chat-actions";
import type { ChatMsg } from "@/lib/ai/chat";
import { Button } from "@/components/ui/button";

/**
 * Global floating assistant — mounted once in the dashboard layout, so it's on
 * every page and keeps its conversation across client-side navigation. Collapsed
 * to a bubble; expands to a panel. "Reset" starts a fresh session (the old one
 * stays recorded). Data answers are scoped to the page you're viewing + your
 * district access (enforced server-side).
 */
export function AiAssistantWidget({
  name,
  greeting,
  hasAvatar,
}: {
  name: string;
  greeting: string | null;
  hasAvatar: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // AI-6: a "Help me fix this" prompt seeded from a finding card, queued until the
  // panel has loaded its session.
  const [pending, setPending] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Resizable panel — drag the top-left corner (the panel is anchored bottom-right,
  // so dragging up/left grows it). Size persists across opens.
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 400, h: 560 });
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("netmon:assistant-size");
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s?.w === "number" && typeof s?.h === "number") setSize({ w: s.w, h: s.h });
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("netmon:assistant-size", JSON.stringify(size));
    } catch {
      /* ignore */
    }
  }, [size]);

  function onResizeDown(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h };
  }
  function onResizeMove(e: React.PointerEvent) {
    const s = resizeStart.current;
    if (!s) return;
    const maxW = Math.round(window.innerWidth * 0.95);
    const maxH = Math.round(window.innerHeight * 0.9);
    setSize({
      w: Math.min(maxW, Math.max(320, s.w + (s.x - e.clientX))),
      h: Math.min(maxH, Math.max(380, s.h + (s.y - e.clientY))),
    });
  }
  function onResizeUp(e: React.PointerEvent) {
    resizeStart.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  // Load the active session the first time the panel is opened.
  useEffect(() => {
    if (!open || loaded) return;
    getAssistantSession()
      .then((r) => {
        if (r.error) setError(r.error);
        else {
          setConversationId(r.conversationId);
          setMessages(r.messages);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, loaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending, open]);

  // AI-6: other parts of the UI (e.g. a finding's "Help me fix this" button) can
  // ask the assistant by dispatching a window event. Open the panel and queue the
  // prompt; it's sent once the session has loaded.
  useEffect(() => {
    function onAsk(e: Event) {
      const prompt = (e as CustomEvent).detail?.prompt;
      if (typeof prompt === "string" && prompt.trim()) {
        setOpen(true);
        setPending(prompt.trim());
      }
    }
    window.addEventListener("netmon:ask-assistant", onAsk as EventListener);
    return () => window.removeEventListener("netmon:ask-assistant", onAsk as EventListener);
  }, []);

  // Send the queued prompt once the panel is open + the session is loaded.
  useEffect(() => {
    if (pending && loaded && !sending) {
      const p = pending;
      setPending(null);
      void send(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, loaded, sending]);

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (!text || sending) return;
    setError(null);
    if (textArg === undefined) setInput("");
    setMessages((m) => [
      ...m,
      { id: -Date.now(), role: "user", content: text, createdAt: new Date() },
    ]);
    setSending(true);
    try {
      const res = await sendAssistantMessage(pathname, conversationId, text);
      if ("error" in res) setError(res.error);
      else {
        setConversationId(res.conversationId);
        setMessages((m) => [...m, res.message]);
      }
    } catch {
      setError("The assistant failed to respond.");
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setMessages([]);
    setConversationId(null);
    setError(null);
    setInput("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open ${name}`}
        className="fixed bottom-4 right-4 z-50 flex size-28 items-center justify-center overflow-hidden rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {hasAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/ai/avatar" alt="" className="size-full object-cover" />
        ) : (
          <Sparkles className="size-12" />
        )}
      </button>
    );
  }

  return (
    <div
      style={{ width: size.w, height: size.h }}
      className="fixed bottom-4 right-4 z-50 flex max-h-[90vh] max-w-[95vw] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
    >
      {/* Drag the top-left corner to resize. */}
      <div
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        title="Drag to resize"
        className="absolute left-0 top-0 z-20 size-5 cursor-nwse-resize"
      >
        <span className="absolute left-1 top-1 size-2 rounded-tl border-l-2 border-t-2 border-muted-foreground/40" />
      </div>
      <div className="flex items-center gap-2 border-b px-3 py-2.5 pl-5">
        {hasAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/ai/avatar" alt="" className="size-5 rounded object-cover" />
        ) : (
          <Sparkles className="size-4 text-primary" />
        )}
        <span className="text-sm font-semibold">{name}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={reset}
            title="Reset AI session"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            title="Close"
            className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {!loaded ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </p>
        ) : messages.length === 0 ? (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {greeting ||
              "Ask about the network, a device, or how the dashboard works. On a school or district page I can see that site's latest scan data — within the districts you have access to."}
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={m.role === "user" ? "max-w-[85%] self-end" : "max-w-[92%] self-start"}
            >
              <div
                className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "border bg-muted/40"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {sending && (
          <p className="flex items-center gap-2 self-start text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Thinking…
          </p>
        )}
      </div>

      {error && (
        <p className="flex items-center gap-2 border-t px-3 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" /> {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2 border-t p-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Ask a question…"
          disabled={sending}
          className="max-h-28 min-h-9 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
        />
        <Button type="submit" size="sm" disabled={sending || !input.trim()}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </form>
    </div>
  );
}
