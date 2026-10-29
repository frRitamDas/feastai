import { ArrowLeftIcon, Sparkles } from "lucide-react";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh w-full overflow-hidden bg-background text-foreground">
      <div aria-hidden="true" className="grace-grid pointer-events-none absolute inset-0 opacity-50"/>
      <section className="relative z-10 flex w-full flex-col bg-background/70 p-6 backdrop-blur-xl sm:p-10 xl:w-[540px] xl:border-r xl:border-border/70 xl:px-16">
        <Link className="flex w-fit items-center gap-2 text-xs text-muted-foreground transition hover:text-foreground" href="/">
          <ArrowLeftIcon size={15}/> Back to Grace
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <Link href="/" className="mb-10 flex items-center gap-3">
            <span className="grace-orb flex size-11 items-center justify-center rounded-2xl"><Sparkles size={19} className="text-white"/></span>
            <span className="text-2xl font-semibold tracking-[-.055em]">grace<span className="text-primary">.</span></span>
          </Link>
          <div className="flex flex-col gap-2">{children}</div>
          <p className="mt-9 text-center text-[11px] leading-5 text-muted-foreground">A little clarity goes a long way.<br/>By continuing, you agree to use Grace AI responsibly.</p>
        </div>
      </section>
      <section className="relative hidden flex-1 flex-col items-center justify-center overflow-hidden xl:flex">
        <div className="grace-orb absolute size-[420px] rounded-full opacity-20 blur-[90px]"/>
        <div className="relative z-10 flex max-w-lg flex-col items-center px-10 text-center">
          <div className="grace-orb mb-10 flex size-24 items-center justify-center rounded-[30px]"><Sparkles size={36} className="text-white"/></div>
          <h2 className="text-4xl font-semibold tracking-[-.06em]">Space to think.<br/><span className="text-primary">Room to grow.</span></h2>
          <p className="mt-5 max-w-sm text-sm leading-7 text-muted-foreground">Your thoughtful AI companion for learning, creating, and figuring things out — one conversation at a time.</p>
          <div className="mt-10 flex items-center gap-2 text-[11px] text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-400"/> Thoughtful by design</div>
        </div>
      </section>
    </main>
  );
}
