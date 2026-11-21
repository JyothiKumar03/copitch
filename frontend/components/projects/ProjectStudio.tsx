"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, AudioLines, ChevronRight, FileText, FolderClosed, Globe2, LoaderCircle, LockKeyhole, LogOut, Plus, Presentation, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ResearchWorkspace } from "@/components/research/ResearchWorkspace";
import { WebsiteWalkthrough } from "@/components/walkthrough/WebsiteWalkthrough";
import { savedSession } from "@/lib/research";
import { importPreviousProject, addProject, authenticateAccount, clearPrivateDrafts, loadProjects, signOut } from "@/lib/projects";

const projectUrl = (id: string) => "/research?project=" + encodeURIComponent(id);
const accountEvent = "copitch.account-changed";
const projectDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const studioWorkflow = [
  { icon: AudioLines, title: "Brief by voice or chat" },
  { icon: FileText, title: "Review the research" },
  { icon: Presentation, title: "Prepare and present slides" },
];

export const ProjectStudio = ({ projectId, walkthrough = false }: { projectId?: string; walkthrough?: boolean }) => {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["studio-projects"], queryFn: loadProjects, retry: false, staleTime: 0 });
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
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
    <section className="mx-auto grid min-h-[calc(100svh-7rem)] max-w-5xl items-center gap-7 py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,.92fr)] md:gap-12 lg:gap-20">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-sm font-semibold text-primary"><LockKeyhole size={15} aria-hidden="true" /> Private workspace</p>
        <p className="mt-4 max-w-[12ch] text-[clamp(2.8rem,6vw,5.35rem)] font-semibold leading-[.94] tracking-[-.075em]">
          From first idea to live presentation
        </p>
        <ul className="mt-8 hidden max-w-sm divide-y divide-border border-y border-border md:block">
          {studioWorkflow.map(({ icon: Icon, title }) => (
            <li key={title} className="flex items-center gap-3 py-3 text-sm text-muted-foreground">
              <Icon aria-hidden="true" className="size-4 text-primary" />{title}
            </li>
          ))}
        </ul>
      </div>
      <Card className="rounded-xl p-5 sm:p-8">
        <CardHeader className="gap-2 p-0">
          <h1 className="text-3xl font-semibold leading-none tracking-[-.045em]">{mode === "login" ? "Sign in to your studio" : "Create your account"}</h1>
          <CardDescription className="leading-relaxed">{mode === "login" ? "Open your projects and pick up where you left off." : "Create a private space for your projects."}</CardDescription>
        </CardHeader>
        <CardContent className="p-0 pt-6">
          <form className="grid gap-4" onSubmit={authenticate}>
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor="studio-email">Email
              <Input id="studio-email" name="email" type="email" autoComplete="email" required maxLength={254} /></label>
            <label className="grid gap-1.5 text-sm font-semibold" htmlFor="studio-password">Password
              <Input id="studio-password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 12} maxLength={256}
                aria-describedby={mode === "register" ? "studio-password-requirements" : undefined} /></label>
            {mode === "register" && <p id="studio-password-requirements" className="-mt-2 text-sm text-muted-foreground">Use at least 12 characters.</p>}
            {alert}
            <Button type="submit" className="mt-1 w-full" disabled={busy}>{mode === "login" ? "Sign in" : "Create account"} <ArrowRight aria-hidden="true" className="size-4" /></Button>
          </form>
          <Separator className="mt-6" />
          <Button className="mt-1 justify-start px-0" variant="link" type="button" disabled={busy} onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
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
  const account = <div className="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
    <span className="hidden min-w-0 truncate text-sm text-muted-foreground sm:inline" title={query.data.email}>{query.data.email}</span>
    <Button variant="ghost" size="sm" disabled={busy} onClick={logout}><LogOut aria-hidden="true" size={15} />Sign out</Button>
  </div>;
  if (projectId) return <>
    <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-1.5 sm:gap-3">
      <nav aria-label="Project breadcrumb" className="flex min-w-0 items-center gap-1 sm:gap-2">
        <Button asChild variant="ghost" size="sm" className="px-1.5 sm:px-2.5"><a href="/research"><FolderClosed aria-hidden="true" size={15} />Projects</a></Button>
        <ChevronRight size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        <h1 className="min-w-0 truncate text-sm font-semibold sm:text-base" title={project?.name}>{project?.name ?? "Unavailable project"}</h1>
      </nav>
      <div className="flex min-w-0 items-center gap-1 sm:gap-3">
        {project && (walkthrough
          ? <Button asChild variant="ghost" size="sm"><a href={projectUrl(projectId)}>Back to conversation</a></Button>
          : <Button asChild variant="ghost" size="sm"><a href={projectUrl(projectId) + "&view=walkthrough"}>
            <Globe2 size={16} aria-hidden="true" /> Website walkthrough
          </a></Button>)}
        {account}
      </div>
    </header>
    {alert}
    {project ? (walkthrough ? <WebsiteWalkthrough key={projectId} projectId={projectId} /> : <ResearchWorkspace key={projectId} />)
      : <Card><CardContent><p role="alert">This project is unavailable to your account.</p></CardContent></Card>}
  </>;
  const visibleProjects = query.data.projects.filter(item => item.name.toLocaleLowerCase().includes(projectFilter.trim().toLocaleLowerCase()));
  return <div className="mx-auto max-w-7xl">
    <header className="flex items-center justify-between gap-4 border-b border-border pb-5 pt-5 sm:pt-9">
      <div className="min-w-0">
        <h1 className="text-4xl font-semibold tracking-[-.06em] sm:text-5xl">Projects</h1>
        <p className="mt-1 text-sm text-muted-foreground">Saved research and presentations</p>
      </div>
      {account}
    </header>
    {alert}
    <div className="mt-6 grid min-w-0 items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,21rem)]">
      <section aria-labelledby="saved-projects" className="order-2 min-w-0 lg:order-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
          <h2 id="saved-projects" className="text-xl font-semibold tracking-tight">Your projects</h2>
          {!!query.data.projects.length && <label className="relative min-w-0 flex-1 sm:max-w-60">
            <span className="sr-only">Find a project</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input type="search" placeholder="Find a project" className="pl-9" value={projectFilter}
              onChange={event => setProjectFilter(event.target.value)} />
          </label>}
        </div>
        {visibleProjects.length ? <ul className="divide-y divide-border rounded-xl border border-border bg-card">{visibleProjects.map(item => (
          <li key={item.session_id} className="min-w-0">
            <a aria-label={item.name} className="group flex min-h-[4.7rem] items-center gap-3 rounded-md p-3 transition-colors hover:bg-accent focus-visible:outline-offset-[-3px] motion-reduce:transition-none sm:p-4" href={projectUrl(item.session_id)}>
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-secondary text-primary"><FolderClosed aria-hidden="true" size={17} /></span>
              <span className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between sm:gap-4">
                <span className="block wrap-anywhere text-base font-semibold leading-tight">{item.name}</span>
                <span className="mt-1 block shrink-0 text-xs text-muted-foreground sm:mt-0">{projectDate.format(item.created_at)}</span>
              </span>
              <ArrowUpRight aria-hidden="true" size={16} className="shrink-0 text-muted-foreground transition-transform group-hover:text-primary motion-safe:group-hover:translate-x-0.5" />
            </a>
          </li>
        ))}</ul> : (
          <p className="flex min-h-28 items-center gap-3 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
            <FolderClosed aria-hidden="true" className="size-5 shrink-0 text-primary" />
            {query.data.projects.length ? "No projects match that name." : "Your saved projects will appear here."}
          </p>
        )}
      </section>
      <Card className="order-1 lg:order-2">
        <CardHeader><h2 className="text-xl font-semibold tracking-tight">Start a project</h2></CardHeader>
        <CardContent className="grid gap-4">
          <form className="grid gap-2.5" onSubmit={create}>
            <label htmlFor="project-name" className="text-sm font-semibold">Project name</label>
            <Input id="project-name" name="name" placeholder="e.g. Product launch" required maxLength={100} />
            <Button type="submit" disabled={busy}><Plus aria-hidden="true" size={16} /> New project</Button>
          </form>
          {legacy?.token && <Button variant="outline" className="whitespace-normal" disabled={busy} onClick={() => void run(async () => {
            const existing = await importPreviousProject({ session_id: legacy.session_id, token: legacy.token! });
            window.location.assign(projectUrl(existing.session_id));
          })}><Upload aria-hidden="true" size={15} />Import this tab’s previous pitch</Button>}
        </CardContent>
      </Card>
    </div>
  </div>;
};
