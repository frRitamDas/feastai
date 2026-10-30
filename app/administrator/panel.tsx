// biome-ignore-all lint/performance/noJsxPropsBind: Per-row actions require the selected record.
// biome-ignore-all lint/suspicious/noAlert: Explicit confirmation is required before deleting provider credentials.
"use client";

import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Key = {
  id: string;
  provider: string;
  label: string;
  enabled: boolean;
  priority: number;
  discoveryStatus: string;
};
type Model = {
  id: string;
  provider: string;
  upstreamId: string;
  name: string;
  enabled: boolean;
  keyId: string;
  permitted: boolean;
  available: boolean;
  verifiedAt: string | null;
  lastCheckAt: string | null;
  lastCheckStatus: string | null;
  lastLatencyMs: number | null;
  supportsVision: boolean;
  requiredPlan: "free" | "custom";
  connectionsOpened: number;
  connectionFailures: number;
  lastRuntimeAt: string | null;
  lastRuntimeStatus: string | null;
  lastRuntimeLatencyMs: number | null;
  cooldownUntil: string | null;
};
type Overview = {
  announcements: {
    id: string;
    title: string;
    body: string;
    enabled: boolean;
    createdAt: string;
  }[];
  role: "owner" | "operator" | "viewer";
  catalogConfigured: boolean;
  settings: {
    registrationEnabled: boolean;
    chatEnabled: boolean;
    updatedAt: string;
  };
  counts: { users: number; chats: number; messages: number };
  usage: {
    completedCalls: number;
    inputTokens: string | number | null;
    outputTokens: string | number | null;
    incompleteReports: number;
  };
  usageByModel: {
    model: string;
    provider: string | null;
    upstreamModel: string | null;
    completedCalls: number;
    inputTokens: string | number | null;
    outputTokens: string | number | null;
    incompleteReports: number;
  }[];
  keys: Key[];
  models: Model[];
  routes: {
    id: string;
    name: string;
    enabled: boolean;
    strategy: "manual" | "fastest" | "reliable" | "balanced";
    requiredPlan: "free" | "custom";
    modelId: string | null;
    modelName: string | null;
    provider: string | null;
    priority: number | null;
  }[];
  users: {
    id: string;
    email: string;
    isAnonymous: boolean;
    createdAt: string;
    adminRole: "owner" | "operator" | "viewer" | null;
    adminEnabled: boolean | null;
    accountEnabled: boolean;
    hourlyQuota: number;
    plan: "free" | "custom";
    planExpiresAt: string | null;
  }[];
  logs: {
    id: string;
    action: string;
    target: string | null;
    outcome: string;
    createdAt: string;
  }[];
};
const sections = [
  "Dashboard",
  "Providers & keys",
  "Models & routing",
  "Users",
  "Announcements",
  "System settings",
  "Audit log",
] as const;

export function AdminConsole({ verified }: { verified: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [challengeToken, setChallengeToken] = useState("");
  const challengeRef = useRef<TurnstileInstance>(null);
  const [section, setSection] =
    useState<(typeof sections)[number]>("Dashboard");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState("groq");
  const [label, setLabel] = useState("");
  const [credential, setCredential] = useState("");
  const [accountId, setAccountId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [keyId, setKeyId] = useState("");
  const [upstreamId, setUpstreamId] = useState("");
  const [modelName, setModelName] = useState("");
  const [routeName, setRouteName] = useState("");
  const [routeId, setRouteId] = useState("");
  const [routeModel, setRouteModel] = useState("");
  const [routePriority, setRoutePriority] = useState("50");
  const [adminUserId, setAdminUserId] = useState("");
  const [adminRole, setAdminRole] = useState("viewer");
  const [adminTotp, setAdminTotp] = useState("");
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementBody, setAnnouncementBody] = useState("");
  const [policyUser, setPolicyUser] = useState("");
  const [policyQuota, setPolicyQuota] = useState("10");
  const [policyPlan, setPolicyPlan] = useState("free");
  const [policyExpiry, setPolicyExpiry] = useState("");
  const [policyEnabled, setPolicyEnabled] = useState(true);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/administrator/overview", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        "Unable to load administrator data. Check the session and catalog configuration."
      );
    }
    setData(await response.json());
  }, []);
  useEffect(() => {
    if (verified) {
      refresh().catch(() =>
        setError(
          "Unable to load administrator data. Check the session and catalog configuration."
        )
      );
    }
  }, [refresh, verified]);
  const action = async (name: string, body: Record<string, unknown>) => {
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`/api/administrator/${name}`, {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "Action failed");
      }
      if (result.status && result.status !== "discovered") {
        throw new Error(`Discovery: ${result.status}`);
      }
      if (result.verified === false) {
        throw new Error(
          "Inference verification failed. The model remains unavailable."
        );
      }
      if (name === "mfa") {
        router.refresh();
      } else {
        await refresh();
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!verified) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
        <p className="text-sm uppercase tracking-widest text-muted-foreground">
          Grace AI
        </p>
        <h1 className="text-3xl font-semibold">Administrator verification</h1>
        <p className="text-sm text-muted-foreground">
          Enter the six-digit code from your authenticator.
        </p>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            const verifiedMfa = await action("mfa", {
              code,
              ...(challengeToken ? { challengeToken } : {}),
            });
            if (!verifiedMfa) {
              setChallengeToken("");
              challengeRef.current?.reset();
            }
          }}
        >
          <Input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => setCode(event.target.value)}
            placeholder="000000"
            value={code}
          />
          {process.env.NEXT_PUBLIC_GRACE_TURNSTILE_SITE_KEY ? (
            <Turnstile
              onError={() => setChallengeToken("")}
              onExpire={() => setChallengeToken("")}
              onSuccess={setChallengeToken}
              options={{ action: "admin-mfa" }}
              ref={challengeRef}
              siteKey={process.env.NEXT_PUBLIC_GRACE_TURNSTILE_SITE_KEY}
            />
          ) : process.env.NODE_ENV === "production" ? (
            <p className="text-sm text-destructive">
              Administrator verification is unavailable.
            </p>
          ) : null}
          <Button
            disabled={
              busy ||
              code.length !== 6 ||
              (process.env.NODE_ENV === "production" && !challengeToken)
            }
            type="submit"
          >
            Verify
          </Button>
        </form>
        {Boolean(error) && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </main>
    );
  }
  const canEdit = data?.role !== "viewer" && data?.catalogConfigured === true;
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[.2em] text-muted-foreground">
              Grace AI by Ritam Das
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Administrator</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your workspace and verified provider catalog.
            </p>
          </div>
          <span className="rounded-full border px-3 py-1 text-xs">
            {data?.role ?? "Loading"}
          </span>
        </header>
        <nav
          aria-label="Administrator sections"
          className="mb-8 flex flex-wrap gap-2"
        >
          {sections.map((item) => (
            <button
              className={`rounded-lg px-3 py-2 text-sm ${section === item ? "bg-foreground text-background" : "bg-muted"}`}
              key={item}
              onClick={() => setSection(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </nav>
        {Boolean(error) && (
          <p
            className="mb-6 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
        {data ? (
          <>
            {!data.catalogConfigured && (
              <p className="mb-6 rounded-lg border p-3 text-sm text-muted-foreground">
                Provider catalog is not enabled or its encryption key is not
                configured.
              </p>
            )}
            {section === "Dashboard" && (
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-3">
                  {Object.entries(data.counts).map(([name, count]) => (
                    <div className="rounded-2xl border bg-card p-5" key={name}>
                      <p className="text-sm capitalize text-muted-foreground">
                        {name}
                      </p>
                      <p className="mt-3 text-3xl font-semibold">{count}</p>
                    </div>
                  ))}
                </div>
                <section className="rounded-2xl border p-5">
                  <h2 className="font-semibold">Reported usage</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {data.usage.completedCalls} completed generations ·{" "}
                    {data.usage.inputTokens ?? "not reported"} input tokens ·{" "}
                    {data.usage.outputTokens ?? "not reported"} output tokens
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {data.usage.incompleteReports} calls lacked one or more
                    token counts. Failed or interrupted calls may not be
                    represented.
                  </p>
                </section>
                <section className="rounded-2xl border p-5">
                  <h2 className="font-semibold">
                    Usage by model · last 30 days
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Provider is shown only when Grace selected it directly.
                    Unknown token counts remain unreported.
                  </p>
                  <div className="mt-4 space-y-3">
                    {data.usageByModel.map((item) => (
                      <div
                        className="border-b pb-3 text-sm"
                        key={`${item.model}-${item.provider ?? "unknown"}-${item.upstreamModel ?? "unknown"}`}
                      >
                        <strong>
                          {item.provider ?? "Gateway / unknown"} ·{" "}
                          {item.upstreamModel ?? item.model}
                        </strong>
                        <p className="text-muted-foreground">
                          {item.completedCalls} completed ·{" "}
                          {item.inputTokens ?? "not reported"} input ·{" "}
                          {item.outputTokens ?? "not reported"} output ·{" "}
                          {item.incompleteReports} incomplete reports
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
            {section === "Providers & keys" && (
              <div className="space-y-6">
                <div className="rounded-2xl border bg-card p-5">
                  <h2 className="font-semibold">Add provider credential</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Stored encrypted. New keys are disabled until explicitly
                    enabled.
                  </p>
                  <form
                    className="mt-4 grid gap-3 md:grid-cols-4"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (
                        await action("add-key", {
                          credential,
                          label,
                          provider,
                          ...(provider === "cloudflare" ? { accountId } : {}),
                          ...(provider === "custom" ? { baseUrl } : {}),
                        })
                      ) {
                        setCredential("");
                        setLabel("");
                        setAccountId("");
                        setBaseUrl("");
                      }
                    }}
                  >
                    <select
                      aria-label="Provider"
                      className="rounded-lg border bg-background px-3"
                      onChange={(event) => setProvider(event.target.value)}
                      value={provider}
                    >
                      {[
                        "groq",
                        "openrouter",
                        "gemini",
                        "huggingface",
                        "cloudflare",
                        "custom",
                        "cerebras",
                        "sambanova",
                        "mistral",
                      ].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                    <Input
                      onChange={(event) => setLabel(event.target.value)}
                      placeholder="Key label"
                      required
                      value={label}
                    />
                    {provider === "cloudflare" && (
                      <Input
                        onChange={(event) => setAccountId(event.target.value)}
                        placeholder="Cloudflare account ID"
                        required
                        value={accountId}
                      />
                    )}
                    {provider === "custom" && (
                      <Input
                        onChange={(event) => setBaseUrl(event.target.value)}
                        placeholder="Allowed HTTPS base URL"
                        required
                        type="url"
                        value={baseUrl}
                      />
                    )}
                    <Input
                      autoComplete="off"
                      onChange={(event) => setCredential(event.target.value)}
                      placeholder="API key"
                      required
                      type="password"
                      value={credential}
                    />
                    <Button disabled={busy || !canEdit} type="submit">
                      Add key
                    </Button>
                  </form>
                </div>
                <div className="space-y-3">
                  {data.keys.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No provider keys yet.
                    </p>
                  )}
                  {data.keys.map((key) => (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
                      key={key.id}
                    >
                      <div>
                        <strong>{key.label}</strong>
                        <p className="text-sm text-muted-foreground">
                          {key.provider} · {key.discoveryStatus} · priority{" "}
                          {key.priority} ·{" "}
                          {key.enabled ? "enabled" : "disabled"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={busy || !canEdit}
                          onClick={() => action("discover", { keyId: key.id })}
                          variant="outline"
                        >
                          Discover
                        </Button>
                        <Button
                          disabled={busy || !canEdit}
                          onClick={() =>
                            action("key-enabled", {
                              enabled: !key.enabled,
                              keyId: key.id,
                            })
                          }
                          variant="outline"
                        >
                          {key.enabled ? "Disable" : "Enable"}
                        </Button>
                        {data.role === "owner" && (
                          <Button
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Permanently delete this provider key and its permissions?"
                                )
                              ) {
                                action("delete-key", { keyId: key.id });
                              }
                            }}
                            variant="destructive"
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {section === "Models & routing" && (
              <div className="space-y-5">
                <div className="rounded-2xl border p-5">
                  <h2 className="font-semibold">Automatic routes</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Group interchangeable models across providers. Only verified
                    and permitted members are used. Priority breaks ties; health
                    strategies use observed connection attempts, not completion
                    rates.
                  </p>
                  <form
                    className="mt-4 flex flex-wrap gap-3"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (await action("route-create", { name: routeName })) {
                        setRouteName("");
                      }
                    }}
                  >
                    <Input
                      className="max-w-sm"
                      onChange={(event) => setRouteName(event.target.value)}
                      placeholder="Route name"
                      required
                      value={routeName}
                    />
                    <Button disabled={busy || !canEdit} type="submit">
                      Create route
                    </Button>
                  </form>
                  <form
                    className="mt-4 grid gap-3 md:grid-cols-4"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      await action("route-member", {
                        modelId: routeModel,
                        priority: Number(routePriority),
                        routeId,
                      });
                    }}
                  >
                    <select
                      aria-label="Route"
                      className="rounded-lg border bg-background px-3"
                      onChange={(event) => setRouteId(event.target.value)}
                      required
                      value={routeId}
                    >
                      <option value="">Select route</option>
                      {data.routes
                        .filter(
                          (route, index, all) =>
                            all.findIndex((item) => item.id === route.id) ===
                            index
                        )
                        .map((route) => (
                          <option key={route.id} value={route.id}>
                            {route.name}
                          </option>
                        ))}
                    </select>
                    <select
                      aria-label="Route model"
                      className="rounded-lg border bg-background px-3"
                      onChange={(event) => setRouteModel(event.target.value)}
                      required
                      value={routeModel}
                    >
                      <option value="">Select model</option>
                      {data.models
                        .filter(
                          (model, index, all) =>
                            all.findIndex((item) => item.id === model.id) ===
                            index
                        )
                        .map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.provider} · {model.name}
                          </option>
                        ))}
                    </select>
                    <Input
                      aria-label="Route priority"
                      max={100}
                      min={0}
                      onChange={(event) => setRoutePriority(event.target.value)}
                      required
                      type="number"
                      value={routePriority}
                    />
                    <Button disabled={busy || !canEdit} type="submit">
                      Save member
                    </Button>
                  </form>
                  <div className="mt-5 space-y-3">
                    {data.routes
                      .filter(
                        (route, index, all) =>
                          all.findIndex((item) => item.id === route.id) ===
                          index
                      )
                      .map((route) => (
                        <div className="rounded-xl border p-4" key={route.id}>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <strong>
                              {route.name} ·{" "}
                              {route.enabled ? "enabled" : "disabled"}
                            </strong>
                            <Button
                              disabled={busy || !canEdit}
                              onClick={() =>
                                action("route-enabled", {
                                  enabled: !route.enabled,
                                  routeId: route.id,
                                })
                              }
                              variant="outline"
                            >
                              {route.enabled ? "Disable" : "Enable"}
                            </Button>
                          </div>
                          <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                            Routing strategy
                            <select
                              aria-label={`Routing strategy for ${route.name}`}
                              className="rounded-lg border bg-background p-2"
                              disabled={busy || !canEdit}
                              onChange={(event) =>
                                action("route-strategy", {
                                  routeId: route.id,
                                  strategy: event.target.value,
                                })
                              }
                              value={route.strategy}
                            >
                              <option value="manual">Priority</option>
                              <option value="fastest">
                                Fastest connection
                              </option>
                              <option value="reliable">
                                Most reliable connection
                              </option>
                              <option value="balanced">Balanced</option>
                            </select>
                          </label>
                          <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                            Entitlement
                            <select
                              aria-label={`Required plan for ${route.name}`}
                              className="rounded-lg border bg-background p-2"
                              disabled={
                                busy || !canEdit || data.role !== "owner"
                              }
                              onChange={(event) =>
                                action("route-plan", {
                                  plan: event.target.value,
                                  routeId: route.id,
                                })
                              }
                              value={route.requiredPlan}
                            >
                              <option value="free">Free</option>
                              <option value="custom">Custom</option>
                            </select>
                          </label>
                          {data.routes
                            .filter(
                              (member) =>
                                member.id === route.id && member.modelId
                            )
                            .map((member) => (
                              <div
                                className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm"
                                key={member.modelId}
                              >
                                <span>
                                  {member.provider} · {member.modelName} ·
                                  priority {member.priority}
                                </span>
                                <Button
                                  disabled={busy || !canEdit}
                                  onClick={() =>
                                    action("route-remove", {
                                      modelId: member.modelId,
                                      routeId: route.id,
                                    })
                                  }
                                  size="sm"
                                  variant="outline"
                                >
                                  Remove
                                </Button>
                              </div>
                            ))}
                        </div>
                      ))}
                  </div>
                </div>
                <div className="rounded-2xl border p-5">
                  <h2 className="font-semibold">Register a model</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Manual entries must pass inference verification before they
                    can be used.
                  </p>
                  <form
                    className="mt-4 grid gap-3 md:grid-cols-4"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (
                        await action("register-model", {
                          keyId,
                          name: modelName,
                          upstreamId,
                        })
                      ) {
                        setUpstreamId("");
                        setModelName("");
                      }
                    }}
                  >
                    <select
                      aria-label="Provider key"
                      className="rounded-lg border bg-background px-3"
                      onChange={(event) => setKeyId(event.target.value)}
                      required
                      value={keyId}
                    >
                      <option value="">Select key</option>
                      {data.keys.map((key) => (
                        <option key={key.id} value={key.id}>
                          {key.provider} · {key.label}
                        </option>
                      ))}
                    </select>
                    <Input
                      onChange={(event) => setUpstreamId(event.target.value)}
                      placeholder="Upstream model ID"
                      required
                      value={upstreamId}
                    />
                    <Input
                      onChange={(event) => setModelName(event.target.value)}
                      placeholder="Display name"
                      required
                      value={modelName}
                    />
                    <Button disabled={busy || !canEdit} type="submit">
                      Register
                    </Button>
                  </form>
                </div>
                <p className="text-sm text-muted-foreground">
                  Lower priority numbers are selected first when multiple
                  verified keys can serve the same model. Enable images only
                  after confirming the provider model accepts image input; the
                  text verification check does not test vision.
                </p>
                {data.keys.map((key) => (
                  <div className="flex items-center gap-3" key={key.id}>
                    <span className="min-w-40 text-sm">{key.label}</span>
                    <select
                      aria-label={`Priority for ${key.label}`}
                      className="rounded-lg border bg-background p-2"
                      disabled={busy || !canEdit}
                      onChange={(event) =>
                        action("key-priority", {
                          keyId: key.id,
                          priority: Number(event.target.value),
                        })
                      }
                      value={key.priority}
                    >
                      {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(
                        (priority) => (
                          <option key={priority} value={priority}>
                            {priority}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                ))}
                <div className="space-y-3">
                  {data.models.map((model) => (
                    <div
                      className="rounded-xl border p-4"
                      key={`${model.id}:${model.keyId}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <strong>{model.name}</strong>
                          <p className="text-sm text-muted-foreground">
                            {model.provider} · {model.upstreamId} ·{" "}
                            {model.verifiedAt ? "verified" : "not verified"} ·{" "}
                            {model.available ? "registered" : "not discovered"}{" "}
                            · {model.requiredPlan} plan
                            {model.lastCheckAt
                              ? ` · last check: ${model.lastCheckStatus} (${model.lastLatencyMs} ms)`
                              : " · never checked"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Connections: {model.connectionsOpened} opened,{" "}
                            {model.connectionFailures} failed
                            {model.lastRuntimeAt
                              ? ` · latest: ${model.lastRuntimeStatus} (${model.lastRuntimeLatencyMs} ms)`
                              : " · no runtime observations"}
                            {model.cooldownUntil
                              ? ` · cooldown until ${new Date(model.cooldownUntil).toLocaleTimeString()}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={busy || !canEdit || !model.available}
                            onClick={() =>
                              action("verify", {
                                keyId: model.keyId,
                                modelId: model.id,
                              })
                            }
                            variant="outline"
                          >
                            Verify
                          </Button>
                          <Button
                            disabled={busy || !canEdit || !model.available}
                            onClick={() =>
                              action("permission", {
                                enabled: !model.permitted,
                                keyId: model.keyId,
                                modelId: model.id,
                              })
                            }
                            variant="outline"
                          >
                            {model.permitted ? "Revoke" : "Permit"}
                          </Button>
                          <select
                            aria-label={`Required plan for ${model.name}`}
                            className="rounded-lg border bg-background p-2 text-sm"
                            disabled={busy || !canEdit || data.role !== "owner"}
                            onChange={(event) =>
                              action("model-plan", {
                                modelId: model.id,
                                plan: event.target.value,
                              })
                            }
                            value={model.requiredPlan}
                          >
                            <option value="free">Free</option>
                            <option value="custom">Custom</option>
                          </select>
                          <Button
                            disabled={busy || !canEdit}
                            onClick={() =>
                              action("model-vision", {
                                enabled: !model.supportsVision,
                                modelId: model.id,
                              })
                            }
                            variant="outline"
                          >
                            {model.supportsVision
                              ? "Disable images"
                              : "Enable images"}
                          </Button>
                          <Button
                            disabled={busy || !canEdit}
                            onClick={() =>
                              action("model-enabled", {
                                enabled: !model.enabled,
                                modelId: model.id,
                              })
                            }
                            variant="outline"
                          >
                            {model.enabled ? "Disable" : "Enable"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {section === "System settings" && (
              <section className="space-y-5 rounded-2xl border p-5">
                <div>
                  <h2 className="font-semibold">Emergency controls</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Changes take effect on the next request. Existing sessions
                    and conversations are preserved. Only owners can change
                    these settings.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <strong>Chat generation</strong>
                    <p className="text-sm text-muted-foreground">
                      {data.settings.chatEnabled ? "Enabled" : "Paused"}
                    </p>
                  </div>
                  <Button
                    disabled={busy || data.role !== "owner"}
                    onClick={() =>
                      action("system-settings", {
                        chatEnabled: !data.settings.chatEnabled,
                        registrationEnabled: data.settings.registrationEnabled,
                      })
                    }
                    variant="outline"
                  >
                    {data.settings.chatEnabled ? "Pause chat" : "Enable chat"}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <strong>New registrations</strong>
                    <p className="text-sm text-muted-foreground">
                      {data.settings.registrationEnabled ? "Enabled" : "Paused"}
                    </p>
                  </div>
                  <Button
                    disabled={busy || data.role !== "owner"}
                    onClick={() =>
                      action("system-settings", {
                        chatEnabled: data.settings.chatEnabled,
                        registrationEnabled: !data.settings.registrationEnabled,
                      })
                    }
                    variant="outline"
                  >
                    {data.settings.registrationEnabled
                      ? "Pause registrations"
                      : "Enable registrations"}
                  </Button>
                </div>
              </section>
            )}
            {section === "Announcements" && (
              <div className="space-y-5">
                <div>
                  <h2 className="font-semibold">Announcements</h2>
                  <p className="text-sm text-muted-foreground">
                    Publish plain-text messages to signed-in users. New
                    announcements start disabled.
                  </p>
                </div>
                {data.role !== "viewer" && (
                  <form
                    className="grid gap-3 rounded-2xl border p-5"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (
                        await action("create-announcement", {
                          body: announcementBody,
                          title: announcementTitle,
                        })
                      ) {
                        setAnnouncementTitle("");
                        setAnnouncementBody("");
                      }
                    }}
                  >
                    <Input
                      aria-label="Announcement title"
                      maxLength={120}
                      onChange={(event) =>
                        setAnnouncementTitle(event.target.value)
                      }
                      placeholder="Title"
                      required
                      value={announcementTitle}
                    />
                    <textarea
                      aria-label="Announcement message"
                      className="min-h-24 rounded-lg border bg-background p-3 text-sm"
                      maxLength={2000}
                      onChange={(event) =>
                        setAnnouncementBody(event.target.value)
                      }
                      placeholder="Message"
                      required
                      value={announcementBody}
                    />
                    <Button disabled={busy} type="submit">
                      Create announcement
                    </Button>
                  </form>
                )}
                {data.announcements.map((item) => (
                  <div className="rounded-2xl border p-4" key={item.id}>
                    <div className="flex items-center justify-between gap-3">
                      <strong>{item.title}</strong>
                      <span className="text-xs text-muted-foreground">
                        {item.enabled ? "Published" : "Draft"}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      {item.body}
                    </p>
                    {data.role !== "viewer" && (
                      <Button
                        className="mt-3"
                        disabled={busy}
                        onClick={() =>
                          action("set-announcement", {
                            announcementId: item.id,
                            enabled: !item.enabled,
                          })
                        }
                        size="sm"
                        variant="outline"
                      >
                        {item.enabled ? "Unpublish" : "Publish"}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {section === "Users" && (
              <div className="space-y-2">
                {data.role === "owner" && (
                  <div className="mb-6 rounded-2xl border p-5">
                    <h2 className="font-semibold">
                      Grant or update administrator access
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Provision a TOTP secret securely for the selected account.
                      Existing administrator sessions are invalidated when
                      access changes.
                    </p>
                    <form
                      className="mt-4 grid gap-3 md:grid-cols-4"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (
                          await action("set-administrator", {
                            role: adminRole,
                            totpSecret: adminTotp,
                            userId: adminUserId,
                          })
                        ) {
                          setAdminTotp("");
                        }
                      }}
                    >
                      <select
                        aria-label="Account"
                        className="rounded-lg border bg-background px-3"
                        onChange={(event) => setAdminUserId(event.target.value)}
                        required
                        value={adminUserId}
                      >
                        <option value="">Select account</option>
                        {data.users
                          .filter((user) => !user.isAnonymous)
                          .map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.email}
                            </option>
                          ))}
                      </select>
                      <select
                        aria-label="Administrator role"
                        className="rounded-lg border bg-background px-3"
                        onChange={(event) => setAdminRole(event.target.value)}
                        value={adminRole}
                      >
                        <option value="viewer">Viewer</option>
                        <option value="operator">Operator</option>
                        <option value="owner">Owner</option>
                      </select>
                      <Input
                        autoComplete="off"
                        onChange={(event) => setAdminTotp(event.target.value)}
                        placeholder="Base32 TOTP secret"
                        required
                        type="password"
                        value={adminTotp}
                      />
                      <Button disabled={busy} type="submit">
                        Save access
                      </Button>
                    </form>
                  </div>
                )}
                {data.role === "owner" && (
                  <form
                    className="mb-6 grid gap-3 rounded-2xl border p-5 md:grid-cols-6"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      await action("set-user-policy", {
                        enabled: policyEnabled,
                        hourlyQuota: Number(policyQuota),
                        plan: policyPlan,
                        planExpiresAt:
                          policyPlan === "custom" && policyExpiry
                            ? new Date(
                                `${policyExpiry}T23:59:59.999Z`
                              ).toISOString()
                            : null,
                        userId: policyUser,
                      });
                    }}
                  >
                    <select
                      aria-label="Account policy user"
                      className="rounded-lg border bg-background px-3"
                      onChange={(event) => {
                        const selected = data.users.find(
                          (user) => user.id === event.target.value
                        );
                        setPolicyUser(event.target.value);
                        if (selected) {
                          setPolicyQuota(String(selected.hourlyQuota));
                          setPolicyPlan(selected.plan);
                          setPolicyExpiry(
                            selected.planExpiresAt?.slice(0, 10) ?? ""
                          );
                          setPolicyEnabled(selected.accountEnabled);
                        }
                      }}
                      required
                      value={policyUser}
                    >
                      <option value="">Select account</option>
                      {data.users
                        .filter((user) => !user.adminEnabled)
                        .map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.email}
                          </option>
                        ))}
                    </select>
                    <Input
                      aria-label="Hourly request quota"
                      max="1000"
                      min="1"
                      onChange={(event) => setPolicyQuota(event.target.value)}
                      required
                      type="number"
                      value={policyQuota}
                    />
                    <select
                      aria-label="Plan"
                      className="rounded-lg border bg-background px-3"
                      onChange={(event) => setPolicyPlan(event.target.value)}
                      value={policyPlan}
                    >
                      <option value="free">Free</option>
                      <option value="custom">Custom</option>
                    </select>
                    <Input
                      aria-label="Custom plan expiry (UTC date)"
                      disabled={policyPlan !== "custom"}
                      onChange={(event) => setPolicyExpiry(event.target.value)}
                      type="date"
                      value={policyExpiry}
                    />
                    <select
                      aria-label="Account access"
                      className="rounded-lg border bg-background px-3"
                      onChange={(event) =>
                        setPolicyEnabled(event.target.value === "enabled")
                      }
                      value={policyEnabled ? "enabled" : "disabled"}
                    >
                      <option value="enabled">Enabled</option>
                      <option value="disabled">Disabled</option>
                    </select>
                    <Button disabled={busy} type="submit">
                      Save policy
                    </Button>
                    <p className="text-sm text-muted-foreground md:col-span-6">
                      Per-account hourly generation requests; network limits
                      still apply. Custom access can expire at the end of the
                      selected UTC day (blank means no expiry). Plans control
                      shared catalog access, not billing; payments are not
                      connected.
                    </p>
                  </form>
                )}
                <h2 className="font-semibold">Recent users</h2>
                <p className="text-sm text-muted-foreground">
                  Showing the latest 100 accounts.
                </p>
                {data.users.map((user) => (
                  <div
                    className="flex justify-between gap-3 border-b py-3 text-sm"
                    key={user.id}
                  >
                    <span>
                      {user.email} ·{" "}
                      {user.accountEnabled ? "enabled" : "disabled"} ·{" "}
                      {user.plan}
                      {user.planExpiresAt
                        ? ` until ${user.planExpiresAt.slice(0, 10)} UTC`
                        : ""}{" "}
                      · {user.hourlyQuota}/hour
                    </span>
                    <span className="text-muted-foreground">
                      {user.isAnonymous
                        ? "Guest"
                        : user.adminRole
                          ? `${user.adminRole} · ${user.adminEnabled ? "enabled" : "disabled"}`
                          : "Account"}
                    </span>
                    {data.role === "owner" && user.adminEnabled && (
                      <Button
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Disable this administrator's access?"
                            )
                          ) {
                            action("disable-administrator", {
                              userId: user.id,
                            });
                          }
                        }}
                        size="sm"
                        variant="outline"
                      >
                        Disable admin
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {section === "Audit log" && (
              <div className="space-y-2">
                <h2 className="font-semibold">
                  Recent administrative activity
                </h2>
                {data.logs.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No audit entries.
                  </p>
                )}
                {data.logs.map((entry) => (
                  <div
                    className="flex flex-wrap justify-between gap-3 border-b py-3 text-sm"
                    key={entry.id}
                  >
                    <span>
                      {entry.action} · {entry.outcome}{" "}
                      {entry.target ? `· ${entry.target}` : ""}
                    </span>
                    <time className="text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString()}
                    </time>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Loading administrator data…</p>
        )}
      </div>
    </main>
  );
}
