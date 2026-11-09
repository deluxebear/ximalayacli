import { readJson } from "./config.mjs";
export class Client {
  constructor(auth, { fetchImpl = fetch, retries = 3, timeout = 30000 } = {}) {
    this.auth = auth;
    this.fetch = fetchImpl;
    this.retries = retries;
    this.timeout = timeout;
  }
  static async from(path, options) {
    return new Client(await readJson(path), options);
  }
  cookie(url) {
    const u = new URL(url);
    return (this.auth.cookies || [])
      .filter((c) => {
        const d = c.domain.replace(/^\./, "");
        return (
          (u.hostname === d ||
            (c.domain.startsWith(".") && u.hostname.endsWith(`.${d}`))) &&
          (!c.secure || u.protocol === "https:") &&
          (!c.expires || c.expires < 0 || c.expires > Date.now() / 1000) &&
          (u.pathname === (c.path || "/") ||
            u.pathname.startsWith((c.path || "/").replace(/\/$/, "") + "/"))
        );
      })
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }
  async request(
    path,
    { method = "GET", body, headers = {}, retry = method === "GET" } = {},
  ) {
    const url = new URL(path, "https://studio.ximalaya.com");
    if (
      url.protocol !== "https:" ||
      !(
        url.hostname === "ximalaya.com" ||
        url.hostname.endsWith(".ximalaya.com")
      )
    )
      throw new Error("API 请求仅允许喜马拉雅 HTTPS 域名");
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await this.fetch(url, {
          method,
          headers: {
            accept: "application/json",
            origin: "https://studio.ximalaya.com",
            referer: "https://studio.ximalaya.com/",
            cookie: this.cookie(url),
            ...(body ? { "content-type": "application/json" } : {}),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeout),
        });
      } catch (e) {
        if (!retry || attempt >= this.retries)
          throw new Error(`网络请求失败：${e.message}`);
      }
      if (
        retry &&
        attempt < this.retries &&
        (!response || [429, 500, 502, 503, 504].includes(response.status))
      ) {
        await new Promise((r) =>
          setTimeout(r, Math.min(500 * 2 ** attempt, 5000)),
        );
        continue;
      }
      if (!response) throw new Error("网络请求失败");
      if ([301, 302, 401, 403].includes(response.status))
        throw new Error(
          `会话失效或请求被拒绝（HTTP ${response.status}），请重新登录`,
        );
      const text = await response.text();
      if (!response.ok) throw new Error(`请求失败 HTTP ${response.status}`);
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("接口未返回 JSON，可能需要重新登录");
      }
      if (data.ret !== undefined && data.ret !== 0 && data.ret !== 200)
        throw new Error(
          `接口错误 ${data.ret}：${data.msg || data.message || "未知错误"}`,
        );
      if (data.res === false || data.success === false)
        throw new Error(data.msg || data.message || "接口拒绝请求");
      return data;
    }
  }
}
