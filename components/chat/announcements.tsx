// biome-ignore-all lint/performance/noJsxPropsBind: Event handlers use the current form state.
"use client";

import { useState } from "react";
import useSWR from "swr";

type Announcement = { id: string; title: string; body: string };

export function Announcements() {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const { data } = useSWR<{ announcements: Announcement[] }>(
    "/api/announcements",
    async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Announcements unavailable");
      }
      return response.json();
    }
  );
  const item = data?.announcements.find(
    (entry) => !dismissed.includes(entry.id)
  );
  if (!item) {
    return null;
  }
  return (
    <aside
      aria-label="Announcement"
      className="mx-3 mt-2 flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/50 px-4 py-3 text-sm"
    >
      <div>
        <strong>{item.title}</strong>
        <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
          {item.body}
        </p>
      </div>
      <button
        aria-label="Dismiss announcement"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => setDismissed((previous) => [...previous, item.id])}
        type="button"
      >
        ✕
      </button>
    </aside>
  );
}
