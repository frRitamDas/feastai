import Link from "next/link";
import { Suspense } from "react";
import { authorizedAdmin, getAdminIdentity } from "@/lib/server/admin/runtime";
import { AdminConsole } from "./panel";

export default function AdministratorPage() {
  return (
    <Suspense fallback={<main className="p-8">Loading administrator…</main>}>
      <AdministratorContent />
    </Suspense>
  );
}

async function AdministratorContent() {
  const identity = await getAdminIdentity();
  if (!identity) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-3xl font-semibold">Administrator</h1>
        <p className="text-muted-foreground">
          Sign in with an authorized administrator account to continue.
        </p>
        <Link className="underline" href="/login">
          Sign in
        </Link>
      </main>
    );
  }
  const verified = Boolean(await authorizedAdmin());
  return <AdminConsole verified={verified} />;
}
