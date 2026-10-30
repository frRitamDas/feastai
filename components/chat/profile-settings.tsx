// biome-ignore-all lint/performance/noJsxPropsBind: Event handlers use the current form state.
"use client";

import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function ProfileSettings({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState("free");
  const [planExpiresAt, setPlanExpiresAt] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    fetch("/api/profile", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load profile");
        }
        const profile = await response.json();
        if (active) {
          setName(profile.name);
          setEmail(profile.email);
          setPlan(profile.plan);
          setPlanExpiresAt(profile.planExpiresAt);
          setMessage("");
        }
      })
      .catch(() => {
        if (active) {
          setMessage("Unable to load profile.");
        }
      });
    return () => {
      active = false;
    };
  }, [open]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/profile", {
        body: JSON.stringify({
          name,
          ...(newPassword ? { currentPassword, newPassword } : {}),
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Unable to save profile");
      }
      setCurrentPassword("");
      setNewPassword("");
      if (result.sessionRevoked) {
        await signOut({ redirectTo: "/login" });
        return;
      }
      setMessage("Profile saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save profile"
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>
            Update your display name or password. Changing your password signs
            out all sessions.
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          Access plan:{" "}
          <strong className="capitalize text-foreground">{plan}</strong>
          {plan === "custom" && planExpiresAt
            ? ` · expires ${new Date(planExpiresAt).toLocaleDateString()}`
            : ""}
        </p>
        <form className="space-y-4" onSubmit={save}>
          <label className="block text-sm" htmlFor="profile-email">
            Email
            <Input disabled id="profile-email" value={email} />
          </label>
          <label className="block text-sm" htmlFor="profile-name">
            Display name
            <Input
              id="profile-name"
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          <label className="block text-sm" htmlFor="profile-current-password">
            Current password
            <Input
              autoComplete="current-password"
              id="profile-current-password"
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              value={currentPassword}
            />
          </label>
          <label className="block text-sm" htmlFor="profile-new-password">
            New password
            <Input
              autoComplete="new-password"
              id="profile-new-password"
              maxLength={72}
              minLength={8}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              value={newPassword}
            />
          </label>
          {Boolean(message) && (
            <p className="text-sm" role="status">
              {message}
            </p>
          )}
          <Button disabled={busy} type="submit">
            Save settings
          </Button>
        </form>
        <div className="border-t pt-3">
          <p className="text-sm text-muted-foreground">
            Unused uploads can be cleared without removing attachments in
            conversations.
          </p>
          <Button
            className="mt-2"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const response = await fetch("/api/files", {
                  method: "DELETE",
                });
                if (!response.ok) {
                  throw new Error("Unable to clear unused uploads.");
                }
                const result = await response.json();
                setMessage(`Cleared ${result.removed} unused upload(s).`);
              } catch {
                setMessage("Unable to clear unused uploads.");
              } finally {
                setBusy(false);
              }
            }}
            type="button"
            variant="outline"
          >
            Clear unused uploads
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
