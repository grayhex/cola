// Node preload used only by disposable test harnesses, never shipped to production.
// Stands in for oauth.yandex.ru and login.yandex.ru. A test builds the
// "authorization code" itself (it carries the account to sign in), and the
// token endpoint checks what the real one checks: the client credentials in a
// Basic header, the grant type and the PKCE verifier against the challenge the
// test read from the authorize URL.
import { createHash } from "node:crypto";
const realFetch = globalThis.fetch;
const clientId = "fixture-yandex-client";
const secret = "fixture-yandex-secret";
const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const decode = (value) =>
  JSON.parse(Buffer.from(value, "base64url").toString());
if (process.env.COLA_YANDEX_FIXTURE === "1")
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url || input);
    const headers = new Headers(options.headers);
    if (url.origin === "https://oauth.yandex.ru" && url.pathname === "/token") {
      const basic = Buffer.from(clientId + ":" + secret).toString("base64");
      const form = new URLSearchParams(String(options.body));
      if (
        options.method !== "POST" ||
        headers.get("authorization") !== "Basic " + basic ||
        form.get("grant_type") !== "authorization_code"
      )
        return Response.json({ error: "invalid_client" }, { status: 400 });
      let account;
      try {
        account = decode(form.get("code"));
      } catch {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      const challenge = createHash("sha256")
        .update(form.get("code_verifier") || "")
        .digest("base64url");
      if (account.fail || account.challenge !== challenge)
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({
        token_type: "bearer",
        access_token: "fixture-yandex-" + encode(account),
        expires_in: 3600,
      });
    }
    if (url.origin === "https://login.yandex.ru" && url.pathname === "/info") {
      const token = (headers.get("authorization") || "").replace(
        /^OAuth fixture-yandex-/,
        "",
      );
      // The documented header form only: a token in the query is not accepted.
      if (!headers.get("authorization")?.startsWith("OAuth fixture-yandex-"))
        return new Response("", { status: 401 });
      const account = decode(token);
      return Response.json({
        id: account.id,
        login: "login-" + account.id,
        client_id: account.clientId || clientId,
        display_name: account.name,
        ...(account.email ? { default_email: account.email } : {}),
      });
    }
    return realFetch(input, options);
  };
