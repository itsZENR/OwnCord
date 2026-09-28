/** One identity for a server in forms, profiles and credential storage. */
export function normalizeServerAddress(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return trimmed;
    return url.host.toLowerCase();
  } catch { return trimmed; }
}
