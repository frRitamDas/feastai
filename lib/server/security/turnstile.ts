type VerifyOptions = {
  token: FormDataEntryValue | null;
  secret: string | undefined;
  expectedHost: string | undefined;
  production: boolean;
  request?: typeof fetch;
};

/** Registration requires Cloudflare's server-side verification in production. */
export async function verifyRegistrationChallenge({
  token,
  secret,
  expectedHost,
  production,
  request = fetch,
}: VerifyOptions): Promise<boolean> {
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
      checked.action === "register"
    );
  } catch {
    return false;
  }
}
