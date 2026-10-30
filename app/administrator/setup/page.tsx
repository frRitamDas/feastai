import Link from "next/link";
import { Suspense } from "react";
import { auth } from "@/app/(auth)/auth";
import { getAdminDatabase } from "@/lib/server/admin/runtime";
import { isValidCredentialKey } from "@/lib/server/credential-crypto";
import { BootstrapForm } from "./setup-form";

export default function SetupPage() {
  return (
    <Suspense fallback={<main className="p-8">Loading setup…</main>}>
      <SetupContent />
    </Suspense>
  );
}

async function SetupContent() {
  const session = await auth();
  if (!session?.user?.id || session.user.type !== "regular") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-3xl font-semibold">Set up the first owner</h1>
        <p className="text-muted-foreground">
          Sign in with a regular account first.
        </p>
        <Link className="underline" href="/login">
          Sign in
        </Link>
      </main>
    );
  }
  if (!isValidCredentialKey(process.env.GRACE_ENCRYPTION_KEY)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-3xl font-semibold">Setup unavailable</h1>
        <p className="text-muted-foreground">
          The server encryption key is missing or invalid. An operator must
          configure a base64-encoded 32-byte key and redeploy before setup.
        </p>
        <Link className="underline" href="/administrator">
          Back to administrator
        </Link>
      </main>
    );
  }
  let available = false;
  if ((process.env.GRACE_BOOTSTRAP_SECRET?.length ?? 0) >= 32) {
    try {
      const owners = await getAdminDatabase().query(
        'SELECT "userId" FROM "GraceAdministrator" WHERE "role" = \'owner\' LIMIT 1'
      );
      available = owners.length === 0;
    } catch {
      available = false;
    }
  }
  if (!available) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-3xl font-semibold">Setup unavailable</h1>
        <p className="text-muted-foreground">
          First-owner setup is disabled or an owner already exists. Contact an
          authorized operator.
        </p>
        <Link className="underline" href="/administrator">
          Back to administrator
        </Link>
      </main>
    );
  }
  return <BootstrapForm />;
}
