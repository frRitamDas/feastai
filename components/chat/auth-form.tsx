"use client";

import Form from "next/form";
import { type ChangeEvent, useCallback, useState } from "react";

import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function AuthForm({
  action,
  children,
  mode,
}: {
  action: NonNullable<
    string | ((formData: FormData) => void | Promise<void>) | undefined
  >;
  children: React.ReactNode;
  mode: "login" | "register";
}) {
  // Controlled fields remain available if a server action rejects the form.
  // React resets uncontrolled form fields after an action settles, even when
  // that action returns a validation error rather than creating a session.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const handleEmailChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setEmail(event.target.value);
    },
    []
  );
  const handlePasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPassword(event.target.value);
    },
    []
  );

  return (
    <Form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="font-normal text-muted-foreground" htmlFor="email">
          Email
        </Label>
        <Input
          autoComplete="email"
          autoFocus
          className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted"
          id="email"
          maxLength={64}
          name="email"
          onChange={handleEmailChange}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label className="font-normal text-muted-foreground" htmlFor="password">
          Password
        </Label>
        <Input
          autoComplete={
            mode === "register" ? "new-password" : "current-password"
          }
          className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted"
          id="password"
          maxLength={72}
          minLength={mode === "register" ? 8 : undefined}
          name="password"
          onChange={handlePasswordChange}
          placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
          required
          type="password"
          value={password}
        />
        {mode === "register" && (
          <p className="text-xs text-muted-foreground">
            Use at least 8 characters.
          </p>
        )}
      </div>

      {children}
    </Form>
  );
}
