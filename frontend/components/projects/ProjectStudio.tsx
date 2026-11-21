"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResearchWorkspace } from "@/components/research/ResearchWorkspace";
import { savedSession } from "@/lib/research";
import { importPreviousProject, addProject, authenticateAccount, clearPrivateDrafts, loadProjects, signOut } from "@/lib/projects";

const projectUrl = (id: string) => "/research?project=" + encodeURIComponent(id);
const accountEvent = "copitch.account-changed";

export const ProjectStudio = ({ projectId }: { projectId?: string }) => {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["studio-projects"], queryFn: loadProjects, retry: false, staleTime: 0 });
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onAccountChange = (event: StorageEvent) => {
      if (event.key !== accountEvent) return;
      clearPrivateDrafts();
      window.location.replace("/research");
    };
    const onRestore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("storage", onAccountChange);
    window.addEventListener("pageshow", onRestore);
    return () => {
      window.removeEventListener("storage", onAccountChange);
      window.removeEventListener("pageshow", onRestore);
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); }
    finally { setBusy(false); }
  };
  const notifyTabs = () => {
    try { localStorage.setItem(accountEvent, crypto.randomUUID()); }
    catch { /* Other tabs will revalidate their login on focus. */ }
  };
  const authenticate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void run(async () => {
      await authenticateAccount(mode, String(fields.get("email")), String(fields.get("password")));
      notifyTabs();
      window.location.reload();
    });
  };
  if (query.isPending) return <p role="status">Opening your workspace…</p>;
  if (query.isError) return <p role="alert">{query.error.message} <Button onClick={() => void query.refetch()}>Retry</Button></p>;
  const alert = error && <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (!query.data) return (
    <section className="mx-auto my-12 max-w-md rounded-xl border border-border bg-card p-7">
      <h1 className="mb-6 font-display text-3xl">{mode === "login" ? "Sign in to your studio" : "Create your account"}</h1>
      <form className="space-y-4" onSubmit={authenticate}>
        <label className="block">Email<Input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
        <label className="block">Password<Input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 12} maxLength={256} /></label>
        {mode === "register" && <p className="text-sm text-muted-foreground">Use at least 12 characters.</p>}
        {alert}
        <Button type="submit" disabled={busy}>{mode === "login" ? "Sign in" : "Create account"}</Button>
      </form>
      <Button className="mt-4" variant="link" disabled={busy} onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
        {mode === "login" ? "Create an account" : "Use an existing account"}
      </Button>
    </section>
  );
  const legacy = !projectId ? savedSession() : null;
  const project = query.data.projects.find(item => item.session_id === projectId);
  const logout = () => void run(async () => {
    await signOut();
    clearPrivateDrafts();
    notifyTabs();
    client.clear();
    window.location.replace("/research");
  });
  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "");
    void run(async () => window.location.assign(projectUrl((await addProject(name)).session_id)));
  };
  return <>
    <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-border py-4">
      <div>{projectId && <a className="text-sm text-primary underline" href="/research">Projects</a>}
        <h1 className="font-display text-3xl">{project?.name ?? "Projects"}</h1></div>
      <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-muted-foreground">{query.data.email}</span>
        <Button variant="outline" size="sm" disabled={busy} onClick={logout}>Sign out</Button></div>
    </header>
    {alert}
    {projectId ? project ? <ResearchWorkspace key={projectId} /> : <p role="alert">This project is unavailable to your account.</p> :
      <section className="mx-auto my-8 max-w-2xl">
        <form className="mb-8 grid gap-2" onSubmit={create}>
          <label htmlFor="project-name">Project name</label>
          <div className="flex gap-2"><Input id="project-name" name="name" required maxLength={100} />
            <Button type="submit" disabled={busy}>New project</Button></div>
        </form>
        {legacy?.token && <Button variant="outline" className="mb-6" disabled={busy} onClick={() => void run(async () => {
          const existing = await importPreviousProject({ session_id: legacy.session_id, token: legacy.token! });
          window.location.assign(projectUrl(existing.session_id));
        })}>Import this tab’s previous pitch</Button>}
        <ul className="divide-y divide-border">{query.data.projects.map(item =>
          <li key={item.session_id}><a className="block py-4 font-medium text-primary hover:underline" href={projectUrl(item.session_id)}>{item.name}</a></li>)}</ul>
      </section>}
  </>;
};
