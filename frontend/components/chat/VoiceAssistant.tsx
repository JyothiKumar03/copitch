"use client";

import { ArrowUp, Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TSpeechRecognition } from "@/types/speech";
import type { TChatMessage } from "@/types/chat";
import { useSendMessage } from "@/hooks/chat/use-send-message";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export const VoiceAssistant = () => {
  const [messages, setMessages] = useState<TChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const { mutateAsync: sendMessage, isPending: busy } = useSendMessage();
  const [speakReplies, setSpeakReplies] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<TSpeechRecognition | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const Constructor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) return;

    const recognition = new Constructor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setInput(transcript);
    };
    recognition.onerror = (event) => {
      setError(`Speech recognition error: ${event.error}`);
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    return () => {
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const speak = useCallback(
    (text: string) => {
      if (!speakReplies || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    },
    [speakReplies],
  );

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      const history = [...messages, { role: "user" as const, content: trimmed }];
      setMessages(history);
      setInput("");
      setError(null);

      try {
        const reply = await sendMessage({ message: trimmed, history: messages });
        setMessages([...history, { role: "assistant", content: reply }]);
        speak(reply);
      } catch (cause) {
        setMessages(history);
        setError(
          cause instanceof Error ? cause.message : "Something went wrong",
        );
      }
    },
    [busy, messages, sendMessage, speak],
  );

  const toggleListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError(
        "Speech recognition is unavailable in this browser. Use Chrome or Edge, or type below.",
      );
      return;
    }

    setError(null);
    if (listening) {
      recognition.stop();
      setListening(false);
      return;
    }

    setInput("");
    window.speechSynthesis?.cancel();
    recognition.start();
    setListening(true);
  }, [listening]);

  return (
    <Card role="region" aria-label="Practice conversation" className="overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-8">
        <h2 className="font-display text-2xl">Conversation</h2>
        <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm text-muted-foreground">
          <input type="checkbox" className="size-4 accent-primary" checked={speakReplies}
            onChange={event => { setSpeakReplies(event.target.checked); if (!event.target.checked) window.speechSynthesis?.cancel(); }} />
          Read replies aloud
        </label>
      </header>
      <div ref={scrollRef} role="log" aria-label="Conversation messages" aria-live="polite"
        className="max-h-[52dvh] min-h-60 overflow-y-auto px-5 py-6 sm:min-h-72 sm:px-8">
        {messages.length === 0 ? (
          <div className="flex min-h-48 flex-col items-start justify-center gap-4">
            <p className="font-display text-3xl tracking-tight sm:text-4xl">What would you like to rehearse?</p>
            <div className="flex flex-wrap gap-2">
              {["Help me open my pitch", "Ask me a tough audience question"].map(prompt =>
                <Button key={prompt} type="button" variant="outline" onClick={() => void submit(prompt)}>{prompt}</Button>)}
            </div>
          </div>
        ) : messages.map((message, index) => (
          <article key={index} className="grid gap-1 border-b border-border py-4 first:pt-0 last:border-0 sm:grid-cols-[6rem_1fr] sm:gap-6">
            <h3 className="text-sm font-semibold text-muted-foreground">{message.role === "user" ? "You" : "copitch"}</h3>
            <p className="max-w-prose whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>
          </article>
        ))}
        {busy && <p role="status" className="mt-3 text-sm text-muted-foreground">Preparing a reply…</p>}
      </div>
      <form className="space-y-3 border-t border-border px-5 py-5 sm:px-8" onSubmit={event => {
        event.preventDefault(); void submit(input);
      }}>
        <label htmlFor="practice-message" className="block text-sm font-semibold">Your message</label>
        <Textarea id="practice-message" rows={2} value={input} onChange={event => setInput(event.target.value)}
          placeholder={listening ? "Listening…" : "Type a question or dictate a message"}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault(); void submit(input);
            }
          }} />
        {error && <p role="alert" className="text-sm font-medium text-foreground">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="outline" aria-pressed={listening} onClick={toggleListening}>
            {listening ? <Square size={15} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
            {listening ? "Stop dictation" : "Dictate"}
          </Button>
          <Button type="submit" disabled={busy || !input.trim()}>Send message <ArrowUp size={16} aria-hidden="true" /></Button>
        </div>
      </form>
    </Card>
  );
};
