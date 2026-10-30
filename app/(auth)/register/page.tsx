"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useRef, useState } from "react";
import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { type RegisterActionState, register } from "../actions";

const errors: Partial<Record<RegisterActionState["status"], string>> = {
  disabled: "Registration is temporarily unavailable.",
  failed: "We couldn't create your account. Please try again later.",
  invalid_data:
    "Enter a valid email and a password of 8–72 characters (up to 72 bytes).",
  rate_limited: "Too many attempts. Please wait an hour and try again.",
  user_exists: "An account with this email already exists. Try signing in.",
  verification_failed:
    "Browser verification failed or expired. Complete the Cloudflare check and try again.",
};

export default function Page() {
  const router = useRouter();
  const challengeRef = useRef<TurnstileInstance>(null);
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [state, formAction] = useActionState<RegisterActionState, FormData>(
    register,
    { status: "idle" }
  );
  const { update: updateSession } = useSession();

  // biome-ignore lint/correctness/useExhaustiveDependencies: router and updateSession are stable refs
  useEffect(() => {
    if (errors[state.status]) {
      challengeRef.current?.reset();
    } else if (state.status === "success") {
      setIsSuccessful(true);
      updateSession()
        .catch(() => null)
        .then(() => {
          router.replace("/");
          router.refresh();
        });
    }
  }, [state.status]);

  const error = errors[state.status];
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <p className="text-sm text-muted-foreground">Get started for free</p>
      <AuthForm action={formAction} mode="register">
        {process.env.NEXT_PUBLIC_GRACE_TURNSTILE_SITE_KEY ? (
          <Turnstile
            options={{ action: "register" }}
            ref={challengeRef}
            siteKey={process.env.NEXT_PUBLIC_GRACE_TURNSTILE_SITE_KEY}
          />
        ) : process.env.NODE_ENV === "production" ? (
          <p className="text-sm text-destructive">
            Registration verification is unavailable.
          </p>
        ) : null}
        {Boolean(error) && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <SubmitButton isSuccessful={isSuccessful}>Sign up</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          {"Have an account? "}
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/login"
          >
            Sign in
          </Link>
        </p>
      </AuthForm>
    </>
  );
}
