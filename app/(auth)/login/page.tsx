"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";

import { AuthForm } from "@/components/chat/auth-form";
import { SubmitButton } from "@/components/chat/submit-button";
import { type LoginActionState, login } from "../actions";

export default function Page() {
  const router = useRouter();
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [guestUnavailable, setGuestUnavailable] = useState(false);

  useEffect(() => {
    setGuestUnavailable(
      new URLSearchParams(window.location.search).get("guest") === "unavailable"
    );
  }, []);

  const [state, formAction] = useActionState<LoginActionState, FormData>(
    login,
    { status: "idle" }
  );
  const { update: updateSession } = useSession();

  // biome-ignore lint/correctness/useExhaustiveDependencies: router and updateSession are stable refs
  useEffect(() => {
    if (state.status === "success") {
      setIsSuccessful(true);
      updateSession()
        .catch(() => null)
        .then(() => {
          router.replace("/");
          router.refresh();
        });
    }
  }, [state.status]);

  const error =
    state.status === "failed"
      ? "We couldn't sign you in. Check your email and password and try again."
      : state.status === "invalid_data"
        ? "Enter a valid email and password."
        : null;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-sm text-muted-foreground">
        Sign in to your account to continue
      </p>
      {Boolean(guestUnavailable) && (
        <p className="text-sm text-destructive" role="alert">
          Guest access is temporarily unavailable. Please sign in or try again
          later.
        </p>
      )}
      <AuthForm action={formAction} mode="login">
        {Boolean(error) && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <SubmitButton isSuccessful={isSuccessful}>Sign in</SubmitButton>
        <p className="text-center text-[13px] text-muted-foreground">
          {"No account? "}
          <Link
            className="text-foreground underline-offset-4 hover:underline"
            href="/register"
          >
            Sign up
          </Link>
        </p>
      </AuthForm>
    </>
  );
}
