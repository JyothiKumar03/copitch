"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TSpeechRecognition } from "@/types/speech";
import type { TChatMessage } from "@/types/chat";
import { useSendMessage } from "@/hooks/chat/use-send-message";
import { Input } from "@/components/ui/input";

export function VoiceAssistant() {
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
    recognition.start();
    setListening(true);
  }, [listening]);

  return (
    <div className="assistant">
      <div className="conversation" ref={scrollRef} aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty">
            <span className="empty-icon" aria-hidden="true">
              ◎
            </span>
            <p>No messages yet. Say hello.</p>
          </div>
        ) : (
          messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`bubble ${message.role}`}
            >
              <span className="role">
                {message.role === "user" ? "You" : "Assistant"}
              </span>
              <p>{message.content}</p>
            </div>
          ))
        )}
        {busy ? <div className="bubble assistant pending">Thinking…</div> : null}
      </div>

      {error ? <p className="error">{error}</p> : null}

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(input);
        }}
      >
        <button
          type="button"
          className={`mic ${listening ? "active" : ""}`}
          onClick={toggleListening}
          aria-label={listening ? "Stop listening" : "Start listening"}
          title={listening ? "Stop listening" : "Start listening"}
        >
          <span aria-hidden="true">{listening ? "■" : "●"}</span>
        </button>
        <Input
          className="flex-1"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={listening ? "Listening…" : "Type or speak a message"}
          aria-label="Message"
        />
        <button type="submit" className="send" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>

      <label className="toggle">
        <input
          type="checkbox"
          checked={speakReplies}
          onChange={(event) => setSpeakReplies(event.target.checked)}
        />
        Read replies aloud
      </label>
    </div>
  );
}
