export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export function resolveApiBase(configured, location) {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const base = configured?.trim() || (local ? "http://localhost:3000" : "");
  if (!base)
    throw new ApiError(
      "Lessons are unavailable while the service is being configured.",
    );
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new ApiError("The lesson service address is invalid.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (!local && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new ApiError("The lesson service needs a valid HTTPS address.");
  }
  return url.origin;
}

export function createApi(base, fetcher = fetch, timeoutMs = 90000) {
  return async function request(path, { method = "GET", body, signal, token, form = false } = {}) {
    const deadline = Date.now() + timeoutMs;
    const read = method === "GET";
    // A fresh second GET can recover a stalled Safari connection. Keep the
    // overall cold-start budget bounded; never replay a mutation automatically.
    for (let attempt = 0; attempt < (read ? 2 : 1); attempt++) {
      if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const remaining = Math.max(1, deadline - Date.now());
      const budget = read && attempt === 0 ? Math.min(15000, Math.max(1, remaining / 2)) : remaining;
      const timer = setTimeout(abort, budget);
      const freshPath = attempt === 0 ? path : path + (path.includes("?") ? "&" : "?") + "_retry=" + Date.now();
      try {
        const response = await fetcher(base + freshPath, {
          method, cache: "no-store", credentials: "omit", signal: controller.signal,
          headers: {
            ...(body === undefined ? {} : { "Content-Type": form ? "application/x-www-form-urlencoded;charset=UTF-8" : "application/json" }),
            ...(token ? { Authorization: "Bearer " + token } : {}),
          },
          ...(body === undefined ? {} : { body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) }),
        });
        const data = await response.json().catch((error) => {
          if (controller.signal.aborted) throw error;
          return null;
        });
        if (!response.ok) throw new ApiError(data?.error || "The request failed. Please try again.", response.status);
        if (data === null) throw new ApiError("The lesson service returned an unexpected response.");
        return data;
      } catch (error) {
        if (signal?.aborted || error instanceof ApiError) throw error;
        if (read && attempt === 0 && Date.now() < deadline) continue;
        throw new ApiError(controller.signal.aborted
          ? "The service is taking longer than expected. Please retry."
          : "Unable to reach the lesson service. Please check your connection and retry.");
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    }
  };
}
