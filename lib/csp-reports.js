const directives = new Set(["default-src", "script-src", "script-src-elem", "script-src-attr", "style-src", "style-src-elem", "style-src-attr", "img-src", "connect-src", "font-src", "worker-src", "child-src", "media-src", "frame-src", "object-src", "base-uri", "form-action", "frame-ancestors"]);
const routes = new Set(["account", "admin", "b", "bikes", "journal", "articles", "rides", "market", "about", "records", "u", "login", "register", "verify-email", "reset-password"]);
// Never retain raw URLs, samples, source files, policy (nonce), referrers or keys.
export function cspReports(input, origin) {
  const reports = Array.isArray(input) ? input : [{ type: "csp-violation", body: input?.["csp-report"] }];
  if (!reports.length || reports.length > 10) throw new Error("Invalid report count");
  return reports.map((report) => {
    const b = report?.body;
    if (report?.type !== "csp-violation" || !b || typeof b !== "object") throw new Error("Invalid CSP report");
    const directive = b.effectiveDirective || b["effective-directive"] || b["violated-directive"];
    if (!directives.has(directive)) throw new Error("Invalid directive");
    const url = new URL(b.documentURL || b["document-uri"] || report.url);
    if (url.origin !== origin) throw new Error("Foreign document");
    const segment = url.pathname.split("/")[1];
    const blocked = b.blockedURL || b["blocked-uri"] || "";
    let source = ["inline", "eval", "wasm-eval", "data", "blob"].includes(blocked) ? blocked : "external";
    if (typeof blocked === "string" && /^(data|blob):/.test(blocked)) source = blocked.split(":")[0];
    try { if (new URL(blocked).origin === origin) source = "self"; } catch { /* inline source */ }
    return { directive, route: !segment ? "/" : routes.has(segment) ? `/${segment}/:path` : "/:other", source, disposition: b.disposition === "enforce" ? "enforce" : "report" };
  });
}
