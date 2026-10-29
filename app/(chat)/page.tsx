"use client";

import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Globe2,
  Menu,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";

const starterPrompts = [
  { icon: "✳", title: "Explore an idea", subtitle: "Think through something new", prompt: "Help me explore an interesting idea. Ask what I'm curious about first." },
  { icon: "↗", title: "Write something", subtitle: "Make words work better", prompt: "Help me write something. Ask me what it is, who it is for, and the tone I want." },
  { icon: "⌘", title: "Understand a topic", subtitle: "Learn it step by step", prompt: "Teach me a topic clearly, step by step, with examples and a short recap. Ask me which topic." },
  { icon: "⌁", title: "Solve a problem", subtitle: "Work through it together", prompt: "Help me solve a problem methodically. Ask me to describe it and show your reasoning in clear, useful steps." },
];

function getText(message: any) {
  return (message.parts ?? []).filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
}

export default function Page() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showTools, setShowTools] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, error, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const busy = status === "submitted" || status === "streaming";
  const hasMessages = messages.length > 0;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) { return; }
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [input]);

  function startPrompt(prompt: string) {
    setInput("");
    sendMessage({ text: prompt });
  }
  function newChat() {
    setMessages([]);
    router.push("/");
    textareaRef.current?.focus();
  }
  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || busy) { return; }
    setInput("");
    sendMessage({ text: trimmed });
  }
  async function copyText(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <main className="relative flex h-[100dvh] min-h-[520px] overflow-hidden bg-background text-foreground">
      {sidebarOpen && <aside className="z-30 flex w-[268px] shrink-0 flex-col border-r border-border/80 bg-card/70 px-3 py-4 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:w-[290px] max-md:shadow-2xl">
        <div className="mb-7 flex items-center justify-between px-2">
          <a href="/" className="flex items-center gap-2.5" aria-label="Grace AI home">
            <span className="grace-orb flex size-8 items-center justify-center rounded-xl"><Sparkles size={16} className="text-white"/></span>
            <span className="text-[17px] font-semibold tracking-[-.04em]">grace<span className="text-primary">.</span></span>
          </a>
          <button type="button" onClick={() => setSidebarOpen(false)} className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close sidebar"><PanelLeftClose size={17}/></button>
        </div>
        <button type="button" onClick={newChat} className="flex h-10 items-center gap-2.5 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:brightness-110"><SquarePen size={16}/> New conversation <span className="ml-auto rounded-md bg-black/10 px-1.5 py-0.5 text-[10px]">⌘ K</span></button>
        <button type="button" onClick={() => router.push("/")} className="mt-3 flex h-10 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"><Search size={16}/> Search conversations</button>
        <div className="mt-8 px-3 text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground/80">Your workspace</div>
        <div className="mt-2 space-y-1">
          <button type="button" className="flex w-full items-center gap-3 rounded-xl bg-accent/70 px-3 py-2.5 text-left text-sm text-foreground"><MessageSquarePlus size={16} className="text-primary"/> Chats <span className="ml-auto text-[10px] text-muted-foreground">Active</span></button>
          <button type="button" onClick={() => setShowTools(!showTools)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"><Sparkles size={16}/> Explore tools <ChevronDown size={14} className={`ml-auto transition ${showTools ? "rotate-180" : ""}`}/></button>
          {showTools && <div className="ml-7 space-y-1 border-l border-border pl-3">{["Writing studio", "Study partner", "Code assistant", "Research helper"].map((item) => <button type="button" key={item} onClick={() => startPrompt(`Act as my ${item.toLowerCase()}. Ask what I want to work on.`)} className="block w-full rounded-lg px-2 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground">{item}</button>)}</div>}
        </div>
        <div className="mt-auto rounded-2xl border border-border/80 bg-background/70 p-3.5">
          <div className="flex items-center gap-2 text-xs font-medium"><ShieldCheck size={15} className="text-primary"/> Your space, your pace</div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">Keep exploring. Grace is here to help you think clearly.</p>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl px-2 py-2"><div className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">G</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">Grace workspace</div><div className="text-[10px] text-muted-foreground">Personal assistant</div></div><button type="button" className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent" aria-label="Settings"><Settings2 size={16}/></button></div>
      </aside>}
      {sidebarOpen && <button type="button" aria-label="Close navigation overlay" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-20 hidden bg-black/40 max-md:block"/>}
      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="z-10 flex h-[62px] shrink-0 items-center justify-between border-b border-border/60 bg-background/75 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">{!sidebarOpen && <button type="button" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)} className="rounded-xl p-2 text-muted-foreground hover:bg-accent"><Menu size={18}/></button>}<button type="button" className="flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm font-medium hover:bg-accent">Grace AI <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">Beta</span><ChevronDown size={14} className="text-muted-foreground"/></button></div>
          <div className="flex items-center gap-1"><span className="hidden items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 text-[10px] text-muted-foreground sm:flex"><span className="size-1.5 rounded-full bg-emerald-400"/> AI workspace</span><button type="button" onClick={newChat} className="rounded-xl p-2 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="New conversation"><Plus size={17}/></button><button type="button" className="rounded-xl p-2 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="More options"><MoreHorizontal size={18}/></button></div>
        </header>

        {!hasMessages ? <div className="grace-glow relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-8 sm:px-8">
          <div aria-hidden="true" className="grace-grid pointer-events-none absolute inset-0 opacity-40"/>
          <div className="relative z-[1] mx-auto flex w-full max-w-[720px] flex-col items-center">
            <div className="mb-7 flex size-[70px] items-center justify-center rounded-[24px] p-[1px] shadow-[0_0_70px_rgba(137,111,255,.13)]"><div className="grace-orb flex size-full items-center justify-center rounded-[23px]"><Sparkles size={28} className="text-white drop-shadow"/></div></div>
            <div className="mb-3 flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[.06] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[.15em] text-primary"><span className="size-1.5 animate-pulse rounded-full bg-primary"/> A little clarity goes a long way</div>
            <h1 className="text-center text-4xl font-semibold tracking-[-.055em] sm:text-5xl md:text-[58px]">Hello, what’s on<br className="hidden sm:block"/> your <span className="bg-gradient-to-r from-[#b7a8ff] via-[#8f7af5] to-[#72b9e9] bg-clip-text text-transparent">mind?</span></h1>
            <p className="mt-4 max-w-md text-center text-sm leading-6 text-muted-foreground sm:text-[15px]">A space to think, create, and figure things out. Start anywhere — we’ll work through it together.</p>
            <div className="mt-9 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">{starterPrompts.map((card) => <button type="button" key={card.title} onClick={() => startPrompt(card.prompt)} className="grace-card group flex min-h-[86px] items-start gap-3 rounded-2xl p-4 text-left"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg text-primary transition group-hover:bg-primary/15">{card.icon}</span><span className="min-w-0 pt-0.5"><span className="block text-sm font-medium">{card.title}</span><span className="mt-1 block text-xs text-muted-foreground">{card.subtitle}</span></span><ArrowUp size={15} className="ml-auto mt-1 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100"/></button>)}</div>
            <Composer input={input} setInput={setInput} submit={submit} busy={busy} stop={stop} textareaRef={textareaRef} webSearch={webSearch} setWebSearch={setWebSearch}/>
            <p className="mt-3 text-center text-[10px] text-muted-foreground/75">Grace can make mistakes. Check important information.</p>
          </div>
        </div> : <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><div className="flex-1 overflow-y-auto px-4 py-8 sm:px-8"><div className="mx-auto max-w-[760px] space-y-8">{messages.map((message) => { const text = getText(message); const isUser = message.role === "user"; return <article key={message.id} className={`flex gap-3 sm:gap-4 ${isUser ? "flex-row-reverse" : ""}`}><div className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${isUser ? "bg-secondary text-foreground" : "grace-orb text-white"}`}>{isUser ? <span className="text-[11px] font-semibold">Y</span> : <Sparkles size={15}/>}</div><div className={`min-w-0 max-w-[88%] ${isUser ? "rounded-2xl rounded-tr-md bg-secondary/90 px-4 py-3" : "flex-1 pt-1"}`}><div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{isUser ? "You" : "Grace"}</div><div className="whitespace-pre-wrap break-words text-[14px] leading-7 sm:text-[15px]">{text || (busy && !isUser ? <span className="inline-flex items-center gap-2 text-muted-foreground"><span className="size-1.5 animate-bounce rounded-full bg-primary"/><span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:120ms]"/><span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:240ms]"/> Thinking</span> : null)}</div>{!isUser && text && <div className="mt-3 flex items-center gap-1"><button type="button" onClick={() => void copyText(message.id, text)} className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label="Copy response">{copiedId === message.id ? <Check size={14}/> : <Check size={14}/>}</button></div>}</div></article>; })}<div ref={bottomRef}/>{error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Grace couldn’t complete that response. Check your connection or model configuration and try again.</div>}</div></div><div className="shrink-0 px-3 pb-4 pt-2 sm:px-6"><div className="mx-auto max-w-[760px]"><Composer input={input} setInput={setInput} submit={submit} busy={busy} stop={stop} textareaRef={textareaRef} webSearch={webSearch} setWebSearch={setWebSearch}/><p className="mt-2 text-center text-[10px] text-muted-foreground/65">Grace AI · Helpful, thoughtful, not infallible.</p></div></div></div>}
      </section>
    </main>
  );
}

function Composer({ input, setInput, submit, busy, stop, textareaRef, webSearch, setWebSearch }: any) {
  const fileRef = useRef<HTMLInputElement>(null);
  return <form onSubmit={submit} className="grace-composer mt-8 w-full rounded-[22px] border border-border bg-card/95 p-2.5 backdrop-blur-xl sm:p-3">
    <textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="Ask Grace anything…" rows={1} aria-label="Message Grace AI" className="block max-h-[180px] min-h-[52px] w-full resize-none bg-transparent px-2.5 py-3 text-sm leading-6 outline-none placeholder:text-muted-foreground/75 focus-visible:outline-none"/>
    <input ref={fileRef} type="file" className="hidden" onChange={() => {}} aria-label="Choose a file to attach"/>
    <div className="flex items-center justify-between gap-2 px-1 pt-1">
      <div className="flex items-center gap-1.5"><button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach a file" className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-foreground"><Paperclip size={17}/></button><button type="button" onClick={() => setWebSearch(!webSearch)} aria-pressed={webSearch} className={`flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] transition ${webSearch ? "border-primary/40 bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"}`}><Globe2 size={14}/><span className="hidden sm:inline">Web search</span></button></div>
      <div className="flex items-center gap-2"><span className="hidden text-[10px] text-muted-foreground sm:inline">Shift + Enter for new line</span>{busy ? <button type="button" onClick={stop} className="flex size-9 items-center justify-center rounded-xl bg-secondary text-foreground" aria-label="Stop generating"><X size={16}/></button> : <button type="submit" disabled={!input.trim()} className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Send message"><ArrowUp size={18}/></button>}</div>
    </div>
  </form>;
}
