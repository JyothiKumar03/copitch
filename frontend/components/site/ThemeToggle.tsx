"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const eventName = "copitch-theme-change";
const storageKey = "copitch:theme";

const themeSnapshot = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
const serverTheme = () => "dark";

const subscribe = (onChange: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== storageKey) return;
    document.documentElement.dataset.theme = event.newValue === "light" ? "light" : "dark";
    onChange();
  };
  window.addEventListener(eventName, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(eventName, onChange);
    window.removeEventListener("storage", onStorage);
  };
};

export const ThemeToggle = () => {
  const theme = useSyncExternalStore(subscribe, themeSnapshot, serverTheme);
  const next = theme === "light" ? "dark" : "light";
  const Icon = next === "light" ? Sun : Moon;
  const toggle = () => {
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(storageKey, next); } catch { /* The theme still applies to this page. */ }
    window.dispatchEvent(new Event(eventName));
  };
  return (
    <Button type="button" variant="ghost" size="icon" onClick={toggle}
      aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
    </Button>
  );
};
