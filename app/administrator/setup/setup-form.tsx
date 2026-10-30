// biome-ignore-all lint/performance/noJsxPropsBind: Form handlers use the current setup state.
"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function generateSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let encoded = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += alphabet[(value >>> bits) & 31];
      value &= (1 << bits) - 1;
    }
  }
  return encoded;
}

export function BootstrapForm() {
  const [secret, setSecret] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [code, setCode] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const challengeRef = useRef<TurnstileInstance>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/administrator/bootstrap", {
        body: JSON.stringify({
          bootstrapSecret,
          ...(challengeToken ? { challengeToken } : {}),
          code,
          totpSecret: secret,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Setup failed.");
      }
      setBootstrapSecret("");
      setSecret("");
      setCode("");
      setComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed.");
      setChallengeToken("");
      challengeRef.current?.reset();
    } finally {
      setBusy(false);
    }
  }

  if (complete) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
        <h1 className="text-3xl font-semibold">Owner created</h1>
        <p className="text-muted-foreground">
          Remove the one-time bootstrap secret from Vercel. Wait for a new
          authenticator code, then continue to administrator verification.
        </p>
        <Link className="underline" href="/administrator">
          Continue to administrator
        </Link>
      </main>
    );
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-5 px-6 py-12">
      <p className="text-sm uppercase tracking-widest text-primary">Grace AI</p>
      <h1 className="text-3xl font-semibold">Set up the first owner</h1>
      <p className="text-sm text-muted-foreground">
        Generate a key and enter it in your authenticator as a time-based
        account. Keep it private. Enter the resulting code to prove enrollment.
      </p>
      <Button
        onClick={() => setSecret(generateSecret())}
        type="button"
        variant="outline"
      >
        {secret
          ? "Generate a new authenticator key"
          : "Generate authenticator key"}
      </Button>
      {Boolean(secret) && (
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-2 text-xs text-muted-foreground">
            Authenticator setup key
          </p>
          <code className="break-all text-primary">{secret}</code>
        </div>
      )}
      <form className="space-y-4" onSubmit={submit}>
        <label className="block space-y-2 text-sm" htmlFor="bootstrap-secret">
          <span>One-time bootstrap secret</span>
          <Input
            autoComplete="off"
            id="bootstrap-secret"
            onChange={(event) => setBootstrapSecret(event.target.value)}
            required
            type="password"
            value={bootstrapSecret}
          />
        </label>
        <label className="block space-y-2 text-sm" htmlFor="bootstrap-code">
          <span>Authenticator code</span>
          <Input
            autoComplete="one-time-code"
            id="bootstrap-code"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => setCode(event.target.value)}
            required
            value={code}
          />
        </label>
        {process.env.NEXT_PUBLIC_GRACE_TURNSTILE_SITE_KEY ? (
          <Turnstile
            onError={() => setChallengeToken("")}
            onExpire={() => setChallengeToken("")}
            onSuccess={setChallengeToken}
            options={{ action: "admin-bootstrap" }}
            ref={challengeRef}
            siteKey={process.env.NEXT_PUBLIC_GRACE_TURNSTILE_SITE_KEY}
          />
        ) : process.env.NODE_ENV === "production" ? (
          <p className="text-sm text-destructive">
            Setup verification is unavailable.
          </p>
        ) : null}
        {Boolean(error) && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          disabled={
            busy ||
            !secret ||
            code.length !== 6 ||
            (process.env.NODE_ENV === "production" && !challengeToken)
          }
          type="submit"
        >
          Create owner
        </Button>
      </form>
      <Link
        className="text-sm text-muted-foreground underline"
        href="/administrator"
      >
        Back to administrator
      </Link>
    </main>
  );
}
