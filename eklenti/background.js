importScripts("links.js");

chrome.runtime.onConnect.addListener(port => {
  const page = port.sender?.url;
  if (port.name !== "video-download" || !port.sender?.tab || !page) return;
  const pageHost = new URL(page).hostname.split(".").slice(-2).join(".");
  let host;
  let requested = false;

  port.onDisconnect.addListener(() => host?.disconnect());
  port.onMessage.addListener(request => {
    if (requested) return;
    requested = true;
    const url = typeof request.url === "string" ? videoLink(request.url) : null;
    const target = url && new URL(url).hostname.replace(/^www\./, "");
    const current = pageHost === "twitter.com" ? "x.com" : pageHost;
    if (!url || target !== current ||
        ![480, 720].includes(request.quality)) {
      port.postMessage({ error: "Bu video bağlantısı desteklenmiyor." });
      return;
    }
    host = chrome.runtime.connectNative("com.yesilvideo.downloader");
    let answered = false;
    host.onMessage.addListener(result => {
      answered = true;
      port.postMessage(result);
    });
    host.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message;
      host = undefined;
      if (answered) return;
      const missing = error && /not found|forbidden|access/i.test(error);
      port.postMessage({ error: missing
        ? "Yardımcı bulunamadı. Paketteki Kur.cmd dosyasını çalıştır."
        : "Yardımcı bağlantısı kesildi. Kurulumu tekrar çalıştırıp yeniden dene." });
    });
    host.postMessage({ url, quality: request.quality, vertical: request.vertical === true });
  });
});

