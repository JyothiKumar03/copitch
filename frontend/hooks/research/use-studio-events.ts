"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiBase } from "@/lib/research";
import type { TResearchSession } from "@/types/research";

export const useStudioEvents = (session: TResearchSession | null) => {
  const client = useQueryClient();
  const project = session?.session_id;
  const token = session?.token;
  useEffect(() => {
    if (!project || token || typeof EventSource === "undefined") return;
    const path = `/api/sessions/${encodeURIComponent(project)}/interview/events`;
    const stream = new EventSource(apiBase + path, { withCredentials: true });
    const dirty = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (keys: string[]) => {
      for (const key of keys) dirty.add(key);
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        for (const key of dirty) void client.invalidateQueries({ queryKey: [key, project] });
        dirty.clear();
      }, 80);
    };
    const update = (event: MessageEvent<string>) => {
      try {
        const value = JSON.parse(event.data);
        if (typeof value.resource_id !== "string") return;
        if (value.kind === "sources") schedule(["source-calls"]);
        if (value.kind === "job") schedule(["research-job", "host-workspace"]);
        if (value.kind === "conversation") schedule(["host-workspace"]);
      } catch { /* Reconciliation on reconnect also covers interrupted events. */ }
    };
    let fallback: ReturnType<typeof setInterval> | undefined;
    const reconcile = () => schedule(["source-calls", "research-job", "host-workspace"]);
    const ready = () => { clearInterval(fallback); fallback = undefined; reconcile(); };
    const disconnected = () => {
      if (!fallback) fallback = setInterval(() => { if (navigator.onLine) reconcile(); }, 5000);
    };
    stream.addEventListener("error", disconnected);
    stream.addEventListener("studio", update);
    stream.addEventListener("ready", ready);
    return () => {
      clearTimeout(timer); clearInterval(fallback);
      stream.removeEventListener("studio", update);
      stream.removeEventListener("ready", ready);
      stream.removeEventListener("error", disconnected);
      stream.close();
    };
  }, [client, project, token]);
};
