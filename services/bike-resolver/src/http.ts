import { decodeDocument } from "./charset.js";
import { resolutionContext, trace, checkAbort, abortable } from "./context.js";
import { sourceIdentity } from "./source-url.js";
import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { Agent, fetch } from "undici";
import ipaddr from "ipaddr.js";
import type { Logger } from "pino";
import type { Settings } from "./settings.js";
import { ResolverError, type SourceDocument } from "./domain.js";
export type UrlPolicy = string[] | { blockedDomains: string[] };
export function validateUrl(input: string, allowed: UrlPolicy): URL {
  const u = new URL(input);
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !["https:", "http:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port)) ||
    (Array.isArray(allowed)
      ? !allowed.includes(u.hostname.toLowerCase())
      : !u.hostname.includes(".") ||
        /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(u.hostname) ||
        (ipaddr.isValid(u.hostname.replace(/^\[|\]$/g, "")) &&
          !publicAddress(u.hostname.replace(/^\[|\]$/g, ""))) ||
        allowed.blockedDomains.some(
          (d) => u.hostname === d || u.hostname.endsWith("." + d),
        ))
  )
    throw new ResolverError(
      "upstream_unavailable",
      "URL rejected by manufacturer allowlist",
      false,
      "blocked_source",
    );
  return u;
}
export const publicAddress = (s: string) => {
  try {
    return ipaddr.process(s).range() === "unicast";
  } catch {
    return false;
  }
};
const pause = (ms: number) => {
  const signal = resolutionContext.getStore()?.signal;
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
};
export class ManufacturerHttpClient {
  private queues = new Map<string, Promise<unknown>>();
  private next = new Map<string, number>();
  constructor(
    private logger: Logger,
    private interval = 700,
    private timeout = 10000,
    private settings?: () => Settings,
  ) {}
  async get(
    url: string,
    domains: UrlPolicy,
    headers: Record<string, string> = {},
  ): Promise<SourceDocument> {
    checkAbort();
    url = sourceIdentity(validateUrl(url, domains).href);
    const ctx = resolutionContext.getStore(),
      key = JSON.stringify([url, domains, headers]);
    const existing = ctx?.documents.get(key);
    if (existing) return existing;
    const task = (async () => {
      trace("document_fetch_started", { host: new URL(url).hostname });
      const d = await this.getBytes(url, domains, headers);
      const decoded = decodeDocument(d.bytes, d.contentType);
      trace("document_fetched", {
        host: new URL(d.url).hostname,
        count: d.bytes.length,
      });
      return {
        url: d.url,
        hash: d.hash,
        fetchedAt: d.fetchedAt,
        contentType: d.contentType,
        byteLength: d.bytes.length,
        ...decoded,
      };
    })();
    ctx?.documents.set(key, task);
    return task;
  }
  async getBytes(
    url: string,
    domains: UrlPolicy,
    headers: Record<string, string> = {},
  ) {
    checkAbort();
    const host = validateUrl(url, domains).hostname;
    const prior = this.queues.get(host) || Promise.resolve();
    const task = prior
      .catch(() => {})
      .then(async () => {
        checkAbort();
        await pause(Math.max(0, (this.next.get(host) || 0) - Date.now()));
        checkAbort();
        try {
          return await this.request(url, domains, headers);
        } finally {
          this.next.set(
            host,
            Date.now() + (this.settings?.().requestIntervalMs ?? this.interval),
          );
        }
      });
    this.queues.set(host, task);
    const release = () => {
      if (this.queues.get(host) === task) this.queues.delete(host);
    };
    // A cancelled waiter must not release the host while its predecessor is active.
    void task.then(release, release);
    return await abortable(task, resolutionContext.getStore()?.signal);
  }
  private async request(
    input: string,
    domains: UrlPolicy,
    headers: Record<string, string>,
  ): Promise<{
    url: string;
    bytes: Buffer;
    fetchedAt: string;
    hash: string;
    contentType: string;
  }> {
    let url = input;
    for (let redirects = 0; redirects <= 4; redirects++) {
      const u = validateUrl(url, domains);
      if (this.settings)
        validateUrl(u.href, { blockedDomains: this.settings().blockedDomains });
      for (let attempt = 0; attempt < 3; attempt++) {
        checkAbort();
        const controller = new AbortController();
        const external = resolutionContext.getStore()?.signal;
        const signal = external
          ? AbortSignal.any([controller.signal, external])
          : controller.signal;
        const timer = setTimeout(
          () => controller.abort(),
          this.settings?.().timeoutMs ?? this.timeout,
        );
        let dispatcher: Agent | undefined;
        try {
          const addresses = await abortable(
            lookup(u.hostname, { all: true }),
            signal,
          );
          if (
            !addresses.length ||
            addresses.some((a) => !publicAddress(a.address))
          )
            throw new ResolverError(
              "upstream_unavailable",
              "Non-public manufacturer address rejected",
              false,
              "blocked_source",
            );
          const address = addresses[0];
          // Pin the checked address to this connection: no second DNS lookup/rebinding window.
          dispatcher = new Agent({
            connect: {
              lookup: ((_host: unknown, opts: any, cb: any) =>
                cb(
                  null,
                  ...(opts?.all
                    ? [[address]]
                    : [address.address, address.family]),
                )) as any,
            },
          });
          const response = await fetch(u, {
            dispatcher,
            redirect: "manual",
            signal,
            headers: {
              ...(u.hostname === new URL(input).hostname ? headers : {}),
              "User-Agent":
                "ColaBikeResolver/2.0 (factory specifications; low-rate public catalogue client)",
              "Accept-Language": "en",
              Accept: "text/html,application/json,application/xml;q=0.9",
            },
          });
          trace("source_connected", { host: u.hostname });
          this.logger.info({
            event: "resolver_upstream_requests_total",
            sourceHost: u.hostname,
            statusCode: response.status,
            attempt,
          });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (!location)
              throw new ResolverError(
                "upstream_unavailable",
                "Redirect without location",
              );
            url = validateUrl(new URL(location, u).href, domains).href;
            break;
          }
          if (!response.ok) {
            await response.body?.cancel();
            if (
              (response.status === 429 || response.status >= 500) &&
              attempt < 2
            ) {
              await pause(500 * 2 ** attempt);
              continue;
            }
            throw new ResolverError(
              "upstream_unavailable",
              `Manufacturer HTTP ${response.status}`,
              response.status === 429 || response.status >= 500,
              response.status === 403
                ? "http_403"
                : response.status === 404
                  ? "http_404"
                  : response.status === 429
                    ? "http_429"
                    : "http_error",
            );
          }
          const reader = response.body!.getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 8 * 1024 * 1024) {
              await reader.cancel();
              throw new ResolverError(
                "parse_error",
                "Manufacturer document exceeds 8 MiB",
                false,
                "body_too_large",
              );
            }
            chunks.push(value);
          }
          const bytes = Buffer.concat(chunks);
          const body = bytes.toString("utf8");
          if (
            /<title>\s*(Just a moment|Access Denied)|cf-chl-|_Incapsula_Resource/i.test(
              body,
            )
          )
            throw new ResolverError(
              "upstream_unavailable",
              "Manufacturer access challenge",
              false,
              "access_challenge",
            );
          return {
            url: u.href,
            bytes,
            contentType: response.headers.get("content-type") || "",
            fetchedAt: new Date().toISOString(),
            hash: createHash("sha256").update(bytes).digest("hex"),
          };
        } catch (e) {
          if (external?.aborted)
            throw new ResolverError(
              "upstream_unavailable",
              "Request cancelled",
              false,
              "aborted",
            );
          if (controller.signal.aborted)
            throw new ResolverError(
              "upstream_unavailable",
              "Upstream timeout",
              true,
              "timeout",
            );
          if (e instanceof ResolverError) throw e;
          if (attempt === 2)
            throw new ResolverError(
              "upstream_unavailable",
              "Manufacturer connection failed",
              true,
              ["ENOTFOUND", "EAI_AGAIN"].includes((e as any)?.code)
                ? "dns_failed"
                : "connection_failed",
            );
          await pause(500 * 2 ** attempt);
        } finally {
          clearTimeout(timer);
          await dispatcher?.close();
        }
      }
    }
    throw new ResolverError("upstream_unavailable", "Redirect limit exceeded");
  }
}
