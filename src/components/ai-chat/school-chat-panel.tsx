"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, Send, Sparkles } from "lucide-react";

import { getSchoolChat, sendSchoolChat } from "@/lib/ai/chat-actions";
import type { ChatMsg } from "@/lib/ai/chat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SchoolChatPanel({
  districtSlug,
  schoolSlug,
  schoolLabel,
}: {
  districtSlug: string;
  schoolSlug: string;
  schoolLabel: string;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getSchoolChat(districtSlug, schoolSlug)
      .then((r) => {
        if (!alive) return;
        if (r.error) setError(r.error);
        else {
          setConversationId(r.conversationId);
          setMessages(r.messages);
        }
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [districtSlug, schoolSlug]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setError(null);
    setInput("");
    const optimistic: ChatMsg = {
      id: -Date.now(),
      role: "user",
      content: text,
      createdAt: new Date(),
    };
    setMessages((m) => [...m, optimistic]);
    setSending(true);
    try {
      const res = await sendSchoolChat(districtSlug, schoolSlug, conversationId, text);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" /> Ask NetMon Assistant
          <span className="text-sm font-normal text-muted-foreground">
            about {schoolLabel}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          ref={scrollRef}
          className="flex max-h-96 min-h-32 flex-col gap-3 overflow-y-auto"
        >
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ask about this site&apos;s devices, topology, DHCP/DNS, SNMP coverage, or
              findings — or how to read the dashboard. The assistant sees a snapshot of
              this school&apos;s latest scan data.
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={m.role === "user" ? "max-w-[85%] self-end" : "max-w-[90%] self-start"}
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
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" /> {error}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="flex items-end gap-2"
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
            rows={2}
            placeholder="Ask a question…"
            disabled={sending}
            className="min-h-10 flex-1 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <Button type="submit" size="sm" disabled={sending || !input.trim()}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </form>
        <p className="text-[11px] text-muted-foreground">
          Grounded in the latest scan snapshot; may be incomplete where SNMP coverage is
          sparse. Verify before acting.
        </p>
      </CardContent>
    </Card>
  );
}
