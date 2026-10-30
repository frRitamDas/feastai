type VerifyOptions = {
  token: FormDataEntryValue | null;
  secret: string | undefined;
  expectedHost: string | undefined;
  production: boolean;
  request?: typeof fetch;
};

/** Verify a single-use, hostname- and action-bound Cloudflare challenge. */
export async function verifyTurnstileChallenge({
  token,
  secret,
  expectedHost,
  production,
  request = fetch,
  action,
}: VerifyOptions & {
  action: "register" | "admin-mfa" | "admin-bootstrap";
}): Promise<boolean> {
  if (!secret || !expectedHost) {
    return !production && !secret;
  }
  if (typeof token !== "string" || token.length < 1 || token.length > 2048) {
    return false;
  }
  let host: string;
  try {
    host = new URL(expectedHost).hostname.toLowerCase();
  } catch {
    return false;
  }
  try {
    const response = await request(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        body: new URLSearchParams({ response: token, secret }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!response.ok) {
      return false;
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== "object") {
      return false;
    }
    const checked = result as {
      success?: unknown;
      hostname?: unknown;
      action?: unknown;
    };
    return (
      checked.success === true &&
      typeof checked.hostname === "string" &&
      checked.hostname.toLowerCase() === host &&
      checked.action === action
    );
  } catch {
    return false;
  }
}

/** Registration requires Cloudflare verification in production. */
export function verifyRegistrationChallenge(options: VerifyOptions) {
  return verifyTurnstileChallenge({ ...options, action: "register" });
}
