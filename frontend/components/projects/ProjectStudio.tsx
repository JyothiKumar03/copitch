"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, AudioLines, FileText, FolderClosed, LoaderCircle, LockKeyhole, LogOut, Plus, Presentation, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ResearchWorkspace } from "@/components/research/ResearchWorkspace";
import { savedSession } from "@/lib/research";
import { importPreviousProject, addProject, authenticateAccount, clearPrivateDrafts, loadProjects, signOut } from "@/lib/projects";

const projectUrl = (id: string) => "/research?project=" + encodeURIComponent(id);
const accountEvent = "copitch.account-changed";
const studioWorkflow = [
  { icon: AudioLines, title: "Brief by voice or chat" },
  { icon: FileText, title: "Review the research" },
  { icon: Presentation, title: "Prepare and present slides" },
];

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
  if (query.isPending) return (
    <div role="status" className="flex min-h-[45vh] items-center justify-center gap-3 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-primary motion-reduce:animate-none" />
      Opening your workspace…
    </div>
  );
  if (query.isError) return (
    <Card className="mx-auto my-12 max-w-md">
      <CardContent className="flex flex-wrap items-center gap-4 p-6">
        <p role="alert" className="flex-1 text-sm text-destructive">{query.error.message}</p>
        <Button onClick={() => void query.refetch()}>Retry</Button>
      </CardContent>
    </Card>
  );
  const alert = error && <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>;
  if (!query.data) return (
    <section className="mx-auto mt-8 grid w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-sm sm:mt-14 md:grid-cols-[.95fr_1.05fr] lg:mt-20">
      <div className="flex flex-col justify-between gap-10 bg-studio-dark p-7 text-studio-light sm:p-10 lg:p-12">
        <div>
          <Badge variant="outline" className="border-studio-light/30 bg-transparent px-2.5 py-1 text-studio-light">
            <LockKeyhole aria-hidden="true" size={13} /> Private workspace
          </Badge>
          <p className="mt-5 max-w-[12ch] font-display text-[clamp(2.5rem,4.5vw,4.5rem)] leading-[.96] tracking-[-.05em]">
            From first idea to live presentation
          </p>
        </div>
        <ul className="hidden gap-3 md:grid">
          {studioWorkflow.map(({ icon: Icon, title }) => (
            <li key={title} className="flex items-center gap-3 border-t border-studio-light/20 pt-3 text-sm text-studio-light/90">
              <Icon aria-hidden="true" className="size-4 text-secondary" />
              {title}
            </li>
          ))}
        </ul>
      </div>
      <Card className="min-w-0 gap-0 rounded-none border-0 bg-transparent p-7 shadow-none sm:p-10 lg:p-12">
        <CardHeader className="gap-2 p-0">
          <h1 className="font-display text-[clamp(2.15rem,3vw,3rem)] leading-none tracking-[-.04em]">{mode === "login" ? "Sign in to your studio" : "Create your account"}</h1>
          <CardDescription className="leading-relaxed">{mode === "login" ? "Open your projects and pick up where you left off." : "Create a private space for your projects."}</CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-7">
          <form className="grid gap-4" onSubmit={authenticate}>
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor="studio-email">Email
              <Input id="studio-email" name="email" type="email" autoComplete="email" required maxLength={254} /></label>
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor="studio-password">Password
              <Input id="studio-password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 12} maxLength={256}
                aria-describedby={mode === "register" ? "studio-password-requirements" : undefined} /></label>
            {mode === "register" && <p id="studio-password-requirements" className="-mt-2 text-sm text-muted-foreground">Use at least 12 characters.</p>}
            {alert}
            <Button type="submit" className="mt-1 h-11 w-full" disabled={busy}>{mode === "login" ? "Sign in" : "Create account"} <ArrowRight aria-hidden="true" className="size-4" /></Button>
          </form>
          <Separator className="mt-6" />
          <Button className="mt-3 px-0" variant="link" type="button" disabled={busy} onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "Create an account" : "Use an existing account"}
          </Button>
        </CardContent>
      </Card>
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
    <header className="mb-5 grid gap-3 border-b border-border pb-4 pt-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-5 sm:pb-5">
      <div className="min-w-0">
        {projectId && (
          <Button asChild variant="link" size="sm" className="mb-1 min-h-8 justify-start gap-1.5 px-0">
            <a href="/research"><ArrowLeft aria-hidden="true" size={14} /> Projects</a>
          </Button>
        )}
        <h1 className="break-words font-display text-[clamp(2.2rem,4.8vw,4rem)] leading-[1] tracking-[-.045em]">{project?.name ?? "Projects"}</h1>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-end">
        <span className="truncate text-sm text-muted-foreground" title={query.data.email}>{query.data.email}</span>
        <Button variant="ghost" size="sm" disabled={busy} onClick={logout}><LogOut aria-hidden="true" size={15} />Sign out</Button>
      </div>
    </header>
    {alert}
    {projectId ? project ? <ResearchWorkspace key={projectId} /> :
      <Card><CardContent className="p-6"><p role="alert">This project is unavailable to your account.</p></CardContent></Card> :
      <section className="mt-5 grid items-start gap-4 md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)] md:gap-6">
        <Card className="gap-0 py-0">
          <CardHeader className="gap-2 p-5 sm:p-6">
            <div className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary"><Plus aria-hidden="true" size={20} /></div>
            <h2 className="mt-1 font-display text-3xl leading-none tracking-tight">Start a project</h2>
            <CardDescription>Name your project to open the studio.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 px-5 pb-5 sm:px-6 sm:pb-6">
            <form className="grid gap-2.5" onSubmit={create}>
              <label htmlFor="project-name" className="text-sm font-semibold">Project name</label>
              <Input id="project-name" name="name" required maxLength={100} />
              <Button className="justify-start" type="submit" disabled={busy}><Plus aria-hidden="true" size={16} /> New project</Button>
            </form>
            {legacy?.token && <Button variant="outline" className="whitespace-normal" disabled={busy} onClick={() => void run(async () => {
              const existing = await importPreviousProject({ session_id: legacy.session_id, token: legacy.token! });
              window.location.assign(projectUrl(existing.session_id));
            })}><Upload aria-hidden="true" size={15} />Import this tab’s previous pitch</Button>}
          </CardContent>
        </Card>
        <Card className="min-w-0 gap-0 py-0">
          <CardHeader className="gap-1.5 p-5 sm:p-6">
            <h2 className="font-display text-3xl leading-none tracking-tight">Your projects</h2>
            <CardDescription>Return to your saved research and presentations.</CardDescription>
          </CardHeader>
          <Separator />
          <CardContent className="p-0">
            {query.data.projects.length ? <ul className="divide-y divide-border">{query.data.projects.map(item => (
              <li key={item.session_id}>
                <a className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-primary/5 focus-visible:relative focus-visible:-outline-offset-2 motion-reduce:transition-none sm:px-6" href={projectUrl(item.session_id)}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border text-primary"><FolderClosed aria-hidden="true" size={17} /></span>
                  <span className="min-w-0 flex-1 break-words text-[.95rem] font-semibold">{item.name}</span>
                  <ArrowRight aria-hidden="true" size={16} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none" />
                </a>
              </li>
            ))}</ul> : (
              <p className="flex items-center gap-3 px-5 py-8 text-sm text-muted-foreground sm:px-6">
                <FolderClosed aria-hidden="true" className="size-5 shrink-0 text-primary" /> No projects yet.
              </p>
            )}
          </CardContent>
        </Card>
      </section>}
  </>;
};
