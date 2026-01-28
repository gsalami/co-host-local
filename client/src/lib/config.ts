// Base path for when the app is served behind a reverse proxy with a path prefix.
// The proxy strips this prefix before forwarding to the app server.
// Set to empty string "" when running directly without a proxy prefix.
export const BASE_PATH = "/co-host";

// Helper to prefix API URLs with the base path
export function apiUrl(path: string): string {
  return `${BASE_PATH}${path}`;
}
