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
export function AiAssistantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setInput("");
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
        aria-label="Open NetMon Assistant"
        className="fixed bottom-4 right-4 z-50 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <Sparkles className="size-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex h-[min(70vh,560px)] w-[min(92vw,400px)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <Sparkles className="size-4 text-primary" />
        <span className="text-sm font-semibold">NetMon Assistant</span>
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
          <p className="text-sm text-muted-foreground">
            Ask about the network, a device, or how the dashboard works. On a school or
            district page I can see that site&apos;s latest scan data — within the
            districts you have access to.
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
