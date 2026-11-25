(() => {
  const states = new Map();
  const pageDomain = location.hostname.split(".").slice(-2).join(".");
  const isTikTok = pageDomain === "tiktok.com";
  const tiktokPlayers = 'section[data-e2e="feed-video"],[data-e2e="video-player"],[data-e2e="player-container"],[data-e2e="browse-video"],.xgplayer,tiktok-video,tiktok-player,video-player';
  const postSelector = {
    "x.com": 'article,[data-testid="tweet"]',
    "twitter.com": 'article,[data-testid="tweet"]',
    "instagram.com": 'article,[role="dialog"]',
    "tiktok.com": 'article,[data-e2e="recommend-list-item-container"],[data-e2e="browse-video"]'
  }[pageDomain];
  let open;
  let raf;

  function linksIn(scope, selector) {
    const domain = pageDomain === "twitter.com" ? "x.com" : pageDomain;
    return new Set([...scope.querySelectorAll(selector)].map(anchor => videoLink(anchor.href, location.href))
      .filter(link => link && new URL(link).hostname.replace(/^www\./, "") === domain));
  }

  function linkFor(video) {
    const primary = videoLink(location.href);
    const anchor = video.closest("a[href]");
    if (anchor) {
      const link = videoLink(anchor.href, location.href);
      const domain = pageDomain === "twitter.com" ? "x.com" : pageDomain;
      if (link && new URL(link).hostname.replace(/^www\./, "") === domain) return link;
    }
    if (pageDomain === "youtube.com" && primary && video.closest("#movie_player,ytd-reel-video-renderer[is-active]")) {
      return primary;
    }
    const post = postSelector && video.closest(postSelector);
    if (post) {
      // The timestamp normally links to the post itself, even when it quotes another post.
      const timestamps = linksIn(post, "a[href]:has(time)");
      if (timestamps.size === 1) return timestamps.values().next().value;
      const links = linksIn(post, "a[href]");
      if (links.size === 1) return links.values().next().value;
      if (primary && links.has(primary)) return primary;
    }
    for (let scope = video.parentElement, depth = 0; scope && depth < 16; scope = scope.parentElement, depth++) {
      if (scope.matches("body,main,#contents") || scope.querySelectorAll("video").length > 1) break;
      if (scope === post) continue;
      const links = linksIn(scope, "a[href]");
      if (links.size === 1) return links.values().next().value;
    }
    const visible = [...document.querySelectorAll("video")].filter(item => videoBounds(item));
    return primary && (visible.length === 1 || video.closest('[role="dialog"]'))
      ? primary : null;
  }

  function tiktokLink(player) {
    const primary = videoLink(location.href);
    const post = player.closest(postSelector) || player;
    const enclosing = player.closest("a[href]");
    const direct = enclosing && videoLink(enclosing.href, location.href);
    if (direct?.startsWith("https://www.tiktok.com/")) return direct;
    const links = linksIn(post, 'a[href*="/video/"]');
    if (primary && links.has(primary)) return primary;
    if (links.size === 1) return links.values().next().value;
    const wrapper = player.closest('[id^="xgwrapper-"]') || player.querySelector('[id^="xgwrapper-"]');
    const id = post.getAttribute("data-video-id") || post.getAttribute("data-item-id") ||
      /^xgwrapper-\d+-(\d{10,25})$/.exec(wrapper?.id ?? "")?.[1];
    if (primary && (primary.endsWith("/video/" + id) ||
        !id && !post.matches('[data-e2e="recommend-list-item-container"]'))) return primary;
    const authors = new Set([...post.querySelectorAll('a[href*="/@"]')].map(anchor => {
      const url = URL.parse(anchor.href);
      return url?.hostname === location.hostname && /^\/@[\w.-]+\/?$/.test(url.pathname)
        ? url.pathname.replace(/\/$/, "") : "";
    }).filter(Boolean));
    if (/^\d{10,25}$/.test(id ?? "")) {
      const author = authors.size === 1 ? authors.values().next().value : "/@_";
      return videoLink(author + "/video/" + id, location.href);
    }
    return null;
  }

  function tiktokTargets() {
    const targets = new Map();
    const players = [...document.querySelectorAll(tiktokPlayers)];
    for (const player of players) {
      if (player.closest('[data-e2e="photo-mode"]') || player.querySelector('[data-e2e="photo-mode"]')) continue;
      const shadow = player.shadowRoot || chrome.dom?.openOrClosedShadowRoot(player);
      const video = player.querySelector("video") || shadow?.querySelector("video");
      if (video || !player.querySelector(tiktokPlayers)) {
        targets.set(player, video || null);
      }
    }
    for (const video of document.querySelectorAll("video")) {
      if (!video.closest(tiktokPlayers) && !video.closest('[data-e2e="photo-mode"]')) targets.set(video, video);
    }
    // Use the innermost visible player when TikTok nests several player wrappers.
    return [...targets].reverse().filter(([player], index, entries) =>
      !entries.slice(0, index).some(([inner]) => player.contains(inner) && videoBounds(inner)));
  }

  function videoBounds(video) {
    if (video.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) return null;
    const rect = video.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 50) return null;
    let left = Math.max(0, rect.left);
    let right = Math.min(innerWidth, rect.right);
    let top = Math.max(0, rect.top);
    let bottom = Math.min(innerHeight, rect.bottom);
    for (let ancestor = video.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const { overflowX, overflowY, display } = getComputedStyle(ancestor);
      if (display === "contents" || overflowX === "visible" && overflowY === "visible") continue;
      const bounds = ancestor.getBoundingClientRect();
      if (overflowX !== "visible") {
        left = Math.max(left, bounds.left);
        right = Math.min(right, bounds.right);
      }
      if (overflowY !== "visible") {
        top = Math.max(top, bounds.top);
        bottom = Math.min(bottom, bounds.bottom);
      }
    }
    return right - left >= 44 && bottom - top >= 44 ? { right, top } : null;
  }

  function close() {
    if (!open) return;
    open.menu.hidden = true;
    open.button.setAttribute("aria-expanded", "false");
    open = undefined;
  }

  function download(state, quality, report = () => {}) {
    const url = isTikTok ? tiktokLink(state.player) : linkFor(state.video);
    if (!url) {
      state.status.textContent = "Videoyu kendi gönderi sayfasında aç.";
      report(state.status.textContent);
      return;
    }
    state.busy = true;
    state.menu.querySelectorAll("button").forEach(button => button.disabled = true);
    state.status.textContent = "İndiriliyor…";
    const port = chrome.runtime.connect({ name: "video-download" });
    let completed = false;
    function finish(message) {
      state.busy = false;
      state.status.textContent = message;
      state.menu.querySelectorAll("button").forEach(button => button.disabled = false);
      report(message);
    }
    port.onMessage.addListener(result => {
      completed = true;
      finish(result.error || "İndirilenler klasörüne kaydedildi.");
      port.disconnect();
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (!completed) finish("Bağlantı kesildi. Yeniden dene.");
    });
    const size = state.video?.videoWidth ? { width: state.video.videoWidth, height: state.video.videoHeight }
      : state.player.getBoundingClientRect();
    port.postMessage({ url, quality, vertical: size.height > size.width });
  }

  function create(player, video) {
    const host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed!important;z-index:2147483647!important;pointer-events:none!important;";
    const shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        .toggle, .menu { pointer-events:auto; font:600 13px system-ui,sans-serif; }
        button { cursor:pointer; font:inherit; }
        .toggle { display:grid; place-items:center; width:28px; height:28px; padding:0; border:1px solid #ffffff80;
          border-radius:7px; color:white; background:#087b42; box-shadow:0 2px 8px #0005; }
        .toggle:hover { background:#056438; }
        button:focus-visible { outline:2px solid #3aed99; outline-offset:2px; }
        .menu { position:absolute; right:0; top:34px; width:178px; box-sizing:border-box; padding:8px;
          border:1px solid #ffffff25; border-radius:9px; color:white; background:#17251e; box-shadow:0 4px 14px #0006; }
        .options { display:flex; gap:6px; }
        .options button { flex:1; padding:5px 0; border:0; border-radius:5px; background:#e1f6e8; color:#123d25; }
        .options button:disabled { opacity:.6; cursor:wait; }
        .status { font-weight:400; font-size:11px; margin-top:6px; overflow-wrap:anywhere; }
        .status:empty { display:none; }
      </style>
      <button class="toggle" type="button" aria-label="Videoyu indir" aria-expanded="false" title="Videoyu indir">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/></svg>
      </button>
      <div class="menu" hidden>
        <div class="options"><button type="button" data-quality="480">480p</button><button type="button" data-quality="720">720p</button></div>
        <div class="status" role="status"></div>
      </div>`;
    const button = shadow.querySelector(".toggle");
    const menu = shadow.querySelector(".menu");
    const state = { player, video, host, button, menu, status: shadow.querySelector(".status") };
    host.addEventListener("click", event => event.stopPropagation());
    button.addEventListener("click", () => {
      if (open === state) {
        close();
        return;
      }
      close();
      open = state;
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
    });
    menu.addEventListener("click", event => {
      if (event.target.dataset.quality && !state.busy) download(state, Number(event.target.dataset.quality));
    });
    return state;
  }

  function update() {
    raf = undefined;
    const targets = new Map(isTikTok ? tiktokTargets() : [...document.querySelectorAll("video")].map(video => [video, video]));
    for (const [player, state] of states) {
      if (targets.has(player)) continue;
      if (open === state) close();
      state.host.remove();
      states.delete(player);
    }
    const fullscreen = document.fullscreenElement;
    const modal = [...document.querySelectorAll('dialog[open],[aria-modal="true"]')].find(dialog =>
      dialog.getBoundingClientRect().width > 0 && dialog.checkVisibility?.({ visibilityProperty: true }) !== false);
    const parent = fullscreen && fullscreen.tagName !== "VIDEO" ? fullscreen :
      modal?.tagName === "DIALOG" ? modal : document.documentElement;
    const occupied = new Set();
    for (const [player, video] of targets) {
      const bounds = (!fullscreen || fullscreen === video || fullscreen.contains(player)) && (!modal || modal.contains(player)) &&
        (video && videoBounds(video) || videoBounds(player));
      const x = bounds && bounds.right - 36;
      const y = bounds && bounds.top + 8;
      const position = Math.round(x) + ":" + Math.round(y);
      let state = states.get(player);
      if (!bounds || occupied.has(position)) {
        if (state) {
          if (open === state) close();
          state.host.style.setProperty("display", "none", "important");
        }
        continue;
      }
      occupied.add(position);
      if (!state) {
        state = create(player, video);
        states.set(player, state);
      }
      state.video = video;
      if (state.host.parentNode !== parent) parent.append(state.host);
      state.host.style.setProperty("display", "block", "important");
      state.host.style.left = x + "px";
      state.host.style.top = y + "px";
    }
  }

  function schedule() {
    if (raf === undefined) raf = requestAnimationFrame(update);
  }

  new MutationObserver(records => {
    if (records.some(record => Array.from(record.addedNodes).concat(Array.from(record.removedNodes))
      .some(node => node.nodeType === 1 && (node.matches("video") || node.querySelector("video"))))) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  document.addEventListener("loadedmetadata", schedule, true);
  document.addEventListener("fullscreenchange", schedule);
  document.addEventListener("pointerdown", event => {
    if (open && !event.composedPath().includes(open.host)) close();
  }, true);
  document.addEventListener("keydown", event => {
    if (open && event.key === "Escape") {
      open.button.focus();
      close();
    }
  });
  if (window === window.top) chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (request?.type !== "toolbar-download" || ![480, 720].includes(request.quality)) return;
    const visible = [...states.values()].filter(state => state.host.getBoundingClientRect().width > 0);
    const state = visible.find(state => state === open) || visible.sort((a, b) => {
      const distance = item => {
        const rect = (item.video || item.player).getBoundingClientRect();
        return Math.abs((rect.top + rect.bottom) / 2 - innerHeight / 2);
      };
      return distance(a) - distance(b);
    })[0];
    if (!state || state.busy) {
      respond({ message: state ? "Bu video zaten indiriliyor." : "Bu sekmede görünür bir video bulunamadı." });
      return;
    }
    download(state, request.quality, message => respond({ message }));
    return true;
  });
  setInterval(schedule, 1000);
  schedule();
})();
