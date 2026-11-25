const rules = [
  { domain: "youtube.com", path: /^\/(shorts|live)\/[\w-]{11}\/?$/ },
  { domain: "x.com", path: /^\/(?:[\w]+|i\/web)\/status\/\d+(?:\/video\/\d+)?\/?$/ },
  { domain: "twitter.com", path: /^\/(?:[\w]+|i\/web)\/status\/\d+(?:\/video\/\d+)?\/?$/ },
  { domain: "instagram.com", path: /^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/[\w-]+\/?$/ },
  { domain: "tiktok.com", path: /^\/@[\w.-]+\/video\/\d+\/?$/ }
];

function videoLink(value, base) {
  let url;
  try {
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const site = rules.find(({ domain }) => url.hostname === domain || url.hostname.endsWith("." + domain));
  if (!site) return null;
  const id = url.searchParams.get("v");
  if (site.domain === "youtube.com" && url.pathname === "/watch" && /^[\w-]{11}$/.test(id ?? "")) {
    return "https://www.youtube.com/watch?v=" + id;
  }
  if (!site.path.test(url.pathname)) return null;
  let path = url.pathname.replace(/\/$/, "");
  const domain = site.domain === "twitter.com" ? "x.com" : site.domain;
  if (domain === "x.com") path = path.replace(/\/video\/\d+$/, "");
  if (domain === "instagram.com") path = path.replace(/^\/[\w.]+\/(p|reels?|tv)\//, "/$1/").replace(/^\/reels\//, "/reel/");
  const host = domain === "x.com" ? domain : "www." + domain;
  return "https://" + host + path;
}

