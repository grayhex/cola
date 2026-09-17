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
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
    const d = await this.getBytes(url, domains, headers);
    return { ...d, body: d.bytes.toString("utf8") };
  }
  async getBytes(
    url: string,
    domains: UrlPolicy,
    headers: Record<string, string> = {},
  ) {
    const host = validateUrl(url, domains).hostname;
    const prior = this.queues.get(host) || Promise.resolve();
    const task = prior
      .catch(() => {})
      .then(async () => {
        await pause(Math.max(0, (this.next.get(host) || 0) - Date.now()));
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
    try {
      return await task;
    } finally {
      if (this.queues.get(host) === task) this.queues.delete(host);
    }
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
      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          this.settings?.().timeoutMs ?? this.timeout,
        );
        let dispatcher: Agent | undefined;
        try {
          const addresses = await Promise.race([
            lookup(u.hostname, { all: true }),
            new Promise<never>((_, reject) =>
              controller.signal.addEventListener(
                "abort",
                () => reject(new Error("DNS timeout")),
                { once: true },
              ),
            ),
          ]);
          if (
            !addresses.length ||
            addresses.some((a) => !publicAddress(a.address))
          )
            throw new ResolverError(
              "upstream_unavailable",
              "Non-public manufacturer address rejected",
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
            signal: controller.signal,
            headers: {
              ...(u.hostname === new URL(input).hostname ? headers : {}),
              "User-Agent":
                "ColaBikeResolver/1.0 (factory specifications; low-rate public catalogue client)",
              "Accept-Language": "en",
              Accept: "text/html,application/json,application/xml;q=0.9",
            },
          });
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
            );
          return {
            url: u.href,
            bytes,
            contentType: response.headers.get("content-type") || "",
            fetchedAt: new Date().toISOString(),
            hash: createHash("sha256").update(body).digest("hex"),
          };
        } catch (e) {
          if (e instanceof ResolverError) throw e;
          if (attempt === 2)
            throw new ResolverError(
              "upstream_unavailable",
              "Manufacturer connection failed",
              true,
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
