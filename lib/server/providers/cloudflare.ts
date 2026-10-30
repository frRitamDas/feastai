/** Cloudflare account IDs are path components, not operator-supplied URLs. */
export function parseCloudflareCredential(value: string): {
  accountId: string;
  apiToken: string;
} {
  const input: unknown = JSON.parse(value);
  if (
    !input ||
    typeof input !== "object" ||
    !("accountId" in input) ||
    !("apiToken" in input) ||
    typeof input.accountId !== "string" ||
    !/^[a-f0-9]{32}$/i.test(input.accountId) ||
    typeof input.apiToken !== "string" ||
    !input.apiToken ||
    input.apiToken.length > 8192 ||
    /[\r\n]/.test(input.apiToken)
  ) {
    throw new Error("Invalid Cloudflare credential");
  }
  return { accountId: input.accountId, apiToken: input.apiToken };
}

export function cloudflareBaseUrl(accountId: string): string {
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("Invalid Cloudflare account");
  }
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai`;
}
