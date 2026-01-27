// ==UserScript==
// @name         AuraDrop (TM)
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @downloadURL https://raw.githubusercontent.com/auradrain/auradrop/main/auradrop.user.js
// @updateURL   https://raw.githubusercontent.com/auradrain/auradrop/main/auradrop.user.js
// @description  Drop the Aura, restore the vibe
// @match        https://www.linkedin.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      auradrop-api.auradrain1.workers.dev
// ==/UserScript==

(function () {
  "use strict";

  const DEBUG = false;


  const API_URL = "https://auradrop-api.auradrain1.workers.dev/classify";

  // Canonical tag set returned by the backend (must match worker prompt constraints)
  const TAGS = [
    "Real Talk",
    "Humble Brag",
    "Real Impact",
    "Clout Chaser",
    "Word Salad",
    "Self Insert",
    "Just Vibes",
    "Brand Flex",
    "Bot Brain",
    "Extra AF",
    "Name Dropper",
    "Career Glow-Up",
    "Talent Scout",
    "Influencer Lite",
    "Default",
  ];
  const VALID_TAGS = new Set(TAGS);
  const DEFAULT_TAG = "Default";

  // In-memory cache (fast path, current tab/session only)
  const memoryCache = new Map();

  // Rate-limit cooldown (ms) in-memory only
  const RATE_LIMIT_COOLDOWN_MS = 60_000;
  const RATE_LIMIT_MESSAGE = "Rate limited — try again in a minute.";

  const MAX_CLASSIFY_CHARS = 500;
  const LS_PREFIX = "auradrop:";
const DONE_KEY = "auradropDoneV7";
  const LABEL_CLASS = "auradrop-label";
  const STYLE_ID = "auradrop-style";
  const TOOLTIP_CLASS = "auradrop-tooltip";

  // spacing tuned per your earlier tweak
  const CONTENT_PAD_TOP_PX = 22; // smaller gap vs 38
  const LABEL_TOOLTIP_TEXT = "AuraDrop = vibes, not verdicts ✨";

  const log = (...args) => DEBUG && console.log("[AuraDrop TM]", ...args);

  let __auradropScanRunning = false;

  function isFeed() {
    return location.pathname.startsWith("/feed");
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;

    style.textContent = `
      @keyframes auradropGlow {
        0%{background-position:0% 50%}
        50%{background-position:100% 50%}
        100%{background-position:0% 50%}
      }
      @keyframes auradropHue {
        0%{filter:hue-rotate(0deg)}
        100%{filter:hue-rotate(360deg)}
      }

      .${LABEL_CLASS}{
        display:inline-flex !important;
        align-items:center !important;
        line-height:1.2 !important;
        box-sizing:border-box !important;
        padding:6px 12px !important;
        margin:0 0 6px 0 !important;
        border-radius:6px !important;

        font-size:12.3px !important;
        font-weight:900 !important;
        letter-spacing:0.6px !important;
        text-transform:uppercase !important;
        color:#fff !important;

        background: linear-gradient(
          270deg,
          hsl(340,85%,55%),
          hsl(30,85%,55%),
          hsl(140,70%,45%),
          hsl(210,85%,55%),
          hsl(275,75%,60%),
          hsl(340,85%,55%)
        ) !important;

        background-size:600% 600% !important;
        animation: auradropGlow 10s ease infinite, auradropHue 4.5s linear infinite !important;
        box-shadow: 0 0 10px rgba(255,255,255,0.45) !important;
        user-select:none !important;
      }

      /* Wrapper forces label to be its own first line (prevents flex-row/avatar shifts) */
      .auradrop-label-wrap{
        display:block !important;
        width:100% !important;
        margin:0 !important;
        padding:0 !important;
      }

      .${TOOLTIP_CLASS}{
        position: fixed !important;
        z-index: 2147483647 !important;
        padding: 10px 12px !important;
        border-radius: 12px !important;
        background: rgba(12,12,14,0.86) !important;
        color: #fff !important;
        font-size: 12.5px !important;
        font-weight: 750 !important;
        max-width: 320px !important;
        line-height: 1.35 !important;
        box-shadow: 0 18px 45px rgba(0,0,0,0.42) !important;
        backdrop-filter: blur(10px) !important;
        pointer-events: none !important;
        opacity: 0 !important;
        transform: translateY(6px) scale(0.98) !important;
        transition: opacity 120ms ease, transform 120ms ease !important;
      }
      .auradrop-tooltip--show{
        opacity:1 !important;
        transform: translateY(0) scale(1) !important;
      }

      .${TOOLTIP_CLASS}::after{
        content:"" !important;
        position:absolute !important;
        width:10px !important;
        height:10px !important;
        background: rgba(12,12,14,0.86) !important;
        transform: rotate(45deg) !important;
        left: var(--auradrop-arrow-left, 50%) !important;
        top: 100% !important;
        margin-top: -5px !important;
        border-radius: 2px !important;
        box-shadow: 0 10px 22px rgba(0,0,0,0.25) !important;
      }
      .${TOOLTIP_CLASS}.auradrop-tooltip--below::after{
        top: 0 !important;
        margin-top: -5px !important;
      }

      .${LABEL_CLASS},
      .${TOOLTIP_CLASS},
      .${TOOLTIP_CLASS} * {
        font-family: "Comic Neue", "Nunito", "Poppins", "Quicksand",
                     -apple-system, BlinkMacSystemFont, "Segoe UI",
                     Roboto, Helvetica, Arial, sans-serif !important;
        letter-spacing: 0.2px !important;
      }

      @keyframes auradropTooltipTextGlow {
        0%{background-position:0% 50%}
        50%{background-position:100% 50%}
        100%{background-position:0% 50%}
      }
      .auradrop-tooltip-text {
        background: linear-gradient(90deg,#ff6f91,#ffb86b,#6be2b8,#7aa7ff,#c08cff,#ff6f91);
        background-size: 300% 300%;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent !important;
        animation: auradropTooltipTextGlow 9s ease infinite;
      }
    `;

    document.documentElement.appendChild(style);
  }


  /* =========================================================
     TOP BAR — AuraDrop Active (Neon)
     ========================================================= */
  (function auradropTopBarBoot() {
    if (window.__AURADROP_TOP_BAR_BOOTED__) return;
    window.__AURADROP_TOP_BAR_BOOTED__ = true;

    const BAR_ID = "auradrop-active-bar";
    const OFFSET_STYLE_ID = "auradrop-header-offset-style";

    function ensureOffsetStyle(px) {
      let style = document.getElementById(OFFSET_STYLE_ID);
      if (!style) {
        style = document.createElement("style");
        style.id = OFFSET_STYLE_ID;
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = `body { padding-top: ${Math.max(0, Math.round(px))}px !important; }`;
    }

    function ensureBarEl() {
      let bar = document.getElementById(BAR_ID);
      if (bar) return bar;

      bar = document.createElement("div");
      bar.id = BAR_ID;

      bar.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        z-index: 2147483646 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 14px !important;
        padding: 10px 16px !important;
        box-sizing: border-box !important;
        background: #14141b !important;
        animation: auradropHueShift 18s ease-in-out infinite !important;
        will-change: filter !important;
        color: #fff !important;
        box-shadow:
          inset 0 -1px 0 rgba(255,255,255,0.09),
          0 6px 18px rgba(0,0,0,0.38) !important;
        font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif !important;
        isolation: isolate !important;
        overflow: hidden !important;
      `;

      const neon = document.createElement("div");
      neon.style.cssText = `
        position: absolute !important;
        inset: 0 !important;
        pointer-events: none !important;
        background: linear-gradient(90deg,#ff4d7d,#ffb14d,#4dffb0,#4db5ff,#d14dff,#ff4d7d) !important;
        background-size: 320% 320% !important;
        animation: auradropNeon 10s linear infinite !important;
        opacity: 0.16 !important;
        filter: blur(10px) saturate(1.1) !important;
        z-index: 0 !important;
      `;

      bar.innerHTML = `
        <div style="position:relative !important; z-index:1 !important; display:flex !important; align-items:center !important; gap:12px !important; min-width:0 !important;">
          <span style="
            width:9px !important; height:9px !important; border-radius:999px !important;
            background:#4dffb0 !important; box-shadow:0 0 10px rgba(77,255,176,0.55) !important;
            flex:0 0 auto !important;
          "></span>

          <div style="display:flex !important; flex-direction:column !important; gap:1px !important; min-width:0 !important;">
            <div style="font-size:12.5px !important; font-weight:900 !important; letter-spacing:0.4px !important; white-space:nowrap !important;">
              AuraDrop Live
            </div>
            <div style="font-size:12px !important; opacity:0.85 !important; white-space:nowrap !important; overflow:hidden !important; text-overflow:ellipsis !important; max-width:60vw !important;">
              Drop the Aura, restore the vibe ..
            </div>
          </div>
        </div>

        <div style="position:relative !important; z-index:1 !important; display:flex !important; align-items:center !important; gap:10px !important; flex:0 0 auto !important;">

          <a href="https://auradrop.live/" target="_blank" rel="noopener noreferrer"
            style="
              display:inline-flex !important;
              align-items:center !important;
              justify-content:center !important;
              padding:6px 10px !important;
              border-radius:10px !important;
              font-size:12px !important;
              font-weight:850 !important;
              letter-spacing:0.2px !important;
              text-decoration:none !important;
              border:1px solid rgba(255,255,255,0.16) !important;
              color:#fff !important;
              background: linear-gradient(90deg,#ff4d7d,#ffb14d,#4dffb0,#4db5ff,#d14dff,#ff4d7d) !important;
              background-size: 360% 360% !important;
              animation: auradropNeon 6.5s linear infinite, auradropHueShift 12s linear infinite !important;
              box-shadow: 0 10px 26px rgba(0,0,0,0.20) !important;
              white-space:nowrap !important;
            ">
            auradrop.live
          </a>

          <a href="https://buymeacoffee.com/auradrop" target="_blank" rel="noopener noreferrer"
            style="
              display:inline-flex !important;
              align-items:center !important;
              justify-content:center !important;
              padding:6px 10px !important;
              border-radius:10px !important;
              font-size:12px !important;
              font-weight:850 !important;
              letter-spacing:0.2px !important;
              text-decoration:none !important;
              border:1px solid rgba(255, 210, 64, 0.34) !important;
              color: rgba(255, 241, 200, 0.98) !important;
              background: rgba(255, 210, 64, 0.18) !important;
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 26px rgba(0,0,0,0.18) !important;
              white-space:nowrap !important;
            ">
            ☕ buy me a coffee
          </a>

</div>
      `;

      bar.appendChild(neon);
      (document.body || document.documentElement).appendChild(bar);
      const rect = bar.getBoundingClientRect();
      ensureOffsetStyle(rect.height);

      return bar;
    }

    // Keep bar alive across SPA and ensure padding is correct
    function tickBar() {
      if (!/\/feed\/?/.test(location.pathname)) {
        // remove offset on non-feed pages
        ensureOffsetStyle(0);
        const bar = document.getElementById(BAR_ID);
        if (bar) bar.style.display = "none";
        return;
      }
      const bar = ensureBarEl();
      if (bar) bar.style.display = "flex";
      const h = bar?.getBoundingClientRect?.().height || 0;
      ensureOffsetStyle(h);
    }

    tickBar();    setInterval(tickBar, 1500);
  })();

  function findFeed() {
    return document.querySelector('div[data-testid="mainFeed"]') || document.querySelector("main") || document.body;
  }

  function hardResetAuraDropState() {
    document.querySelectorAll("." + LABEL_CLASS).forEach((n) => n.remove());
    document.querySelectorAll(".auradrop-label-wrap").forEach((n) => n.remove());
    document.querySelectorAll("." + TOOLTIP_CLASS).forEach((n) => n.remove());

    document.querySelectorAll("*").forEach((el) => {
      if (el && el.dataset && el.dataset[DONE_KEY] === "1") delete el.dataset[DONE_KEY];
    });
  }

  function isPromoted(card) {
    if (!(card instanceof HTMLElement)) return false;

    // Common LinkedIn sponsored/promoted signals
    const text = (card.innerText || "").toLowerCase();
    if (text.includes("promoted")) return true;
    if (text.includes("sponsored")) return true;

    // Accessibility labels often include Sponsored/Promoted
    if (card.querySelector('[aria-label*="Promoted"], [aria-label*="Sponsored"]')) return true;

    // Data-testid variants LinkedIn uses for ads
    if (card.querySelector('[data-testid*="ad"], [data-testid*="sponsor"]')) return true;

    return false;
}

function isCommentish(card) {
    if (!(card instanceof HTMLElement)) return true;
    if (card.querySelector("textarea")) return true;
    if (card.closest('[aria-label*="Comments"], [aria-label*="comments"]')) return true;

    const t = (card.innerText || "").toLowerCase();
    if (t.includes("reply") && t.includes("like") && t.length < 900) return true;

    return false;
  }

  function looksLikePostCard(el) {
    if (!(el instanceof HTMLElement)) return false;

    const tid = el.getAttribute("data-testid") || "";
    if (tid === "mainFeed") return false;

    const txtLen = (el.innerText || "").trim().length;
    if (txtLen < 200) return false;
    if (txtLen > 25000) return false;

    const btns = el.querySelectorAll("button").length;
    if (btns < 2) return false;

    if (isCommentish(el)) return false;
    if (isPromoted(el)) return false;

    return true;
  }

  function getPostCards(feedEl) {
    const candidates = Array.from(feedEl.querySelectorAll("div")).filter(looksLikePostCard);

    const inner = [];
    for (const el of candidates) {
      const containsAnother = candidates.some((other) => other !== el && el.contains(other));
      if (!containsAnother) inner.push(el);
    }

    const pool = inner.length ? inner : candidates;
    pool.sort((a, b) => {
      const al = (a.innerText || "").trim().length;
      const bl = (b.innerText || "").trim().length;
      const as = Math.abs(al - 1200);
      const bs = Math.abs(bl - 1200);
      return as - bs;
    });

    return pool.slice(0, 30);
  }

  // --------- NEW: robust "insertion target" selection -----------
  function nearestSafeBlockContainer(startEl, card) {
    let cur = startEl;
    for (let i = 0; i < 8 && cur && cur !== card; i++) {
      if (cur instanceof HTMLElement) {
        const tag = cur.tagName.toLowerCase();
        // Avoid injecting into inline tags
        if (tag === "span" || tag === "a" || tag === "time") {
          cur = cur.parentElement;
          continue;
        }

        // Avoid header/actor areas
        if (cur.closest("header")) return null;

        // If this container is a flex row with an image, that's typically the avatar/header row.
        try {
          const cs = window.getComputedStyle(cur);
          if (cs && (cs.display === "flex" || cs.display === "inline-flex")) {
            if (cur.querySelector("img")) {
              cur = cur.parentElement;
              continue;
            }
          }
        } catch (_) {}

        // Prefer a div/p container
        if (tag === "div" || tag === "p") return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  function findMainTextEl(card) {
    // Best anchor: the real post text box when present
    const box = card.querySelector('div[data-testid="expandable-text-box"]');
    if (box) {
      const txt = (box.innerText || box.textContent || "").trim();
      if (txt.length > 20) return box;
    }

    // Keep your old selector list (because it worked),
    // but we will NOT inject into span[dir="ltr"] directly anymore.
    const selectors = [
      ".update-components-text",
      ".feed-shared-text-view",
      ".feed-shared-update-v2__description",
      ".feed-shared-inline-show-more-text",
      ".ql-editor",
      'span[dir="ltr"]',
      "div.break-words",
      "span.break-words",
      "p",
    ];

    for (const sel of selectors) {
      const el = card.querySelector(sel);
      const txt = (el?.innerText || el?.textContent || "").trim();
      if (el && txt.length > 40) return el;
    }

    const nodes = Array.from(card.querySelectorAll("div, span, p"))
      .map((el) => ({ el, len: ((el.innerText || "").trim()).length }))
      .filter((x) => x.len > 80)
      .sort((a, b) => b.len - a.len);

    return nodes[0]?.el || null;
  }


  async function sha256Hex(str) {
    const data = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function sanitizeTag(tag) {
    if (!tag) return DEFAULT_TAG;
    const t = String(tag).trim();
    if (!t) return DEFAULT_TAG;
    if (VALID_TAGS.has(t)) return t;

    // Back-compat with older names
    const lower = t.toLowerCase();
    if (lower === "genuine") return "Real Talk";
    if (lower === "ai") return "Bot Brain";
    if (lower === "clout") return "Clout Chaser";
    return DEFAULT_TAG;
  }

  function sanitizeComment(c) {
    if (!c) return "";
    let s = String(c).replace(/\s+/g, " ").trim();
    s = s.replace(/[<>]/g, "");
    if (s.length > 150) s = s.slice(0, 147).trim() + "...";
    return s;
  }

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, val); } catch {}
  }

  function truncateForClassification(text, maxChars = MAX_CLASSIFY_CHARS) {
    if (!text) return "";
    const s = String(text).trim();
    if (s.length <= maxChars) return s;
    const half = (maxChars / 2) | 0;
    const head = s.slice(0, half).trim();
    const tail = s.slice(-half).trim();
    return `${head}\n…\n${tail}`;
  }



  // ---- Post text extraction (mirrors extension content.js logic) ----
  function findPostTextFromRoot(root) {
    const candidates = Array.from(root.querySelectorAll("div, span, p"))
      .map((el) => {
        const text = (el.innerText || "").trim();
        if (text.length < 60) return null;
        if (/^(like|comment|repost|send)$/i.test(text)) return null;
        return { el, len: text.length };
      })
      .filter(Boolean);

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.len - a.len);
    return candidates[0].el;
  }

  function getCleanPostTextFromRoot(root) {
    const cached = (root.dataset.auradropRawText || "").trim();
    if (cached.length >= 10) return cached;

    const textEl = findPostTextFromRoot(root);
    if (!textEl) return "";

    const clone = textEl.cloneNode(true);
    // remove our own injected UI if present
    clone.querySelectorAll(".auradrop-label-wrap, ." + LABEL_CLASS).forEach((n) => n.remove());

    const clean = (clone.textContent || "").replace(/\s+/g, " ").trim();
    if (clean.length >= 10) root.dataset.auradropRawText = clean;
    return clean;
  }

function debugPreview(text, n = 140) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    return s.length <= n ? s : (s.slice(0, n) + "…");
  }


  function gmPostJson(url, bodyObj) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          method: "POST",
          url,
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify(bodyObj),
          timeout: 15000,
          onload: (res) => {
            let json = null;
            try { json = res.responseText ? JSON.parse(res.responseText) : null; } catch {}
            resolve({ status: res.status, json, responseText: res.responseText, headers: res.responseHeaders || "" });
          },
          ontimeout: () => reject(new Error("GM request timeout")),
          onerror: (e) => reject(new Error("GM request error")),
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function classifyText(text, force) {
    const raw = String(text || "").trim();
    if (raw.length < 10) return { tag: DEFAULT_TAG, comment: "" };

    const key = await sha256Hex(raw);

    if (!force) {
      // memory cache
      if (memoryCache.has(key)) {
        const cached = memoryCache.get(key);
        if (cached?.rateLimitedUntil && Date.now() >= cached.rateLimitedUntil) {
          memoryCache.delete(key);
        } else {
          DEBUG && log("cache-hit: memory", key, cached.tag);
          return cached;
        }
      }

      // localStorage cache
      const stored = lsGet(LS_PREFIX + key);
      if (stored) {
        try {
          const val = JSON.parse(stored);
          const payload = {
            tag: sanitizeTag(val?.tag ?? val),
            comment: sanitizeComment(val?.comment),
          };
          // If cache only contains a blank Default, treat it as a miss so we still hit the backend.
          if (payload.tag === DEFAULT_TAG && !payload.comment) {
            DEBUG && log("cache-miss: default-empty (localStorage)", key);
          } else {
            DEBUG && log("cache-hit: localStorage", key, payload.tag);
            memoryCache.set(key, payload);
            return payload;
          }

        } catch {}
      }
    }

    let tag = DEFAULT_TAG;
    let comment = "";

    try {
      DEBUG && log("fetch->worker", { len: raw.length });
      const resp = await gmPostJson(API_URL, { text: raw });

      if (resp.status === 429) {
        const payload = {
          tag: DEFAULT_TAG,
          comment: RATE_LIMIT_MESSAGE,
          rateLimited: true,
          rateLimitedUntil: Date.now() + RATE_LIMIT_COOLDOWN_MS,
        };
        memoryCache.set(key, payload); // in-memory only
        return payload;
      }

      const ok = resp.status >= 200 && resp.status < 300;
      if (!ok) {
        DEBUG && log("worker-non-ok", resp.status);
      }

      if (ok) {
        const json = resp.json;
        tag = sanitizeTag(json?.tag);
        comment = sanitizeComment(json?.comment);
      }
    } catch {
      tag = DEFAULT_TAG;
      comment = "";
    }

    const payload = { tag, comment };
    memoryCache.set(key, payload);
    lsSet(LS_PREFIX + key, JSON.stringify(payload));
    return payload;
  }

  // ----- Tooltip helpers -----
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  let tooltipEl = null;

  function ensureTooltipEl() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement("div");
    tooltipEl.className = TOOLTIP_CLASS;
    document.documentElement.appendChild(tooltipEl);
    return tooltipEl;
  }

  function showTooltip(text, anchorEl) {
    if (!text || !anchorEl) return;

    const tip = ensureTooltipEl();
    tip.innerHTML = `<span class="auradrop-tooltip-text">${escapeHtml(text)}</span>`;

    const r = anchorEl.getBoundingClientRect();

    tip.style.left = "0px";
    tip.style.top = "0px";
    tip.classList.add("auradrop-tooltip--show");
    tip.classList.remove("auradrop-tooltip--below");

    const tr = tip.getBoundingClientRect();

    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));

    let top = r.top - tr.height - 12;
    let below = false;
    if (top < 8) {
      top = r.bottom + 12;
      below = true;
    }

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;

    const ARROW_HALF = 5;
    const labelCenter = r.left + r.width / 2;
    let arrowLeft = labelCenter - left - ARROW_HALF;
    arrowLeft = Math.max(ARROW_HALF, Math.min(arrowLeft, tr.width - ARROW_HALF));
    tip.style.setProperty("--auradrop-arrow-left", `${arrowLeft}px`);

    if (below) tip.classList.add("auradrop-tooltip--below");
  }

  function hideTooltip() {
    if (!tooltipEl) return;
    tooltipEl.classList.remove("auradrop-tooltip--show");
  }

  // ----- Label injection -----
  async function injectLabel(card) {
    if (isPromoted(card)) return false;

    // Hard idempotency: if label already exists anywhere inside this card, bail.
    if (card.querySelector("." + LABEL_CLASS) || card.querySelector(".auradrop-label-wrap")) {
      card.dataset[DONE_KEY] = "1";
      return false;
    }

    if (card.dataset[DONE_KEY] === "1" || card.dataset.auradropInFlight === "1") return false;
    card.dataset.auradropInFlight = "1";

    const found = findMainTextEl(card);
    if (!found) { card.dataset.auradropInFlight = "0"; return false; }

    const box = card.querySelector('div[data-testid="expandable-text-box"]');
    let target = null;

    if (box) {
      target = box;
    } else {
      target = nearestSafeBlockContainer(found, card) || (found instanceof HTMLElement ? found : null);
    }
    if (!target) { card.dataset.auradropInFlight = "0"; return false; }

    const rawPostText = getCleanPostTextFromRoot(card);
    const postText = truncateForClassification(rawPostText);
    DEBUG && log("post-read", { len: postText.length, preview: debugPreview(postText) });
    if (postText.trim().length < 10) { log("post-read-empty", { preview: debugPreview(rawPostText) }); card.dataset.auradropInFlight = "0"; return false; }


    // Insert a placeholder immediately so concurrent MutationObserver/interval scans won't double-inject.
    const wrap = document.createElement("div");
    wrap.className = "auradrop-label-wrap";

    const label = document.createElement("div");
    label.className = LABEL_CLASS;
    label.style.setProperty("padding-top", "6px", "important");
    label.style.setProperty("padding-bottom", "6px", "important");
    label.style.setProperty("line-height", "1.2", "important");
    label.style.setProperty("box-sizing", "border-box", "important");
    label.textContent = "…"; // temporary while fetching

    wrap.appendChild(label);
    target.prepend(wrap);
    target.style.setProperty("padding-top", `${CONTENT_PAD_TOP_PX}px`, "important");

    // Default hover while loading
    label.onmouseenter = () => showTooltip("Loading…", label);
    label.onmouseleave = hideTooltip;

    // Now fetch (cache-first)
    const payload = await classifyText(postText, false);
    const tag = sanitizeTag(payload?.tag);
    const comment = sanitizeComment(payload?.comment);

    // Retry-on-Default (only once per card, unless rate-limited)
    const canRetry = tag === DEFAULT_TAG && card.dataset.auradropRetryUsed !== "1";
    label.textContent = (tag === DEFAULT_TAG ? (canRetry ? "Retry" : DEFAULT_TAG) : tag);

    const hoverText =
      (tag === DEFAULT_TAG && canRetry)
        ? "Click retry to Aura Drop"
        : (comment || LABEL_TOOLTIP_TEXT);

    label.onmouseenter = () => showTooltip(hoverText, label);
    label.onmouseleave = hideTooltip;

    // Ensure we don't stack multiple click handlers
    label.onclick = null;

    if (tag === DEFAULT_TAG && canRetry) {
      label.style.setProperty("cursor", "pointer", "important");
      label.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (card.dataset.auradropRetryUsed === "1") return;

        const until = Number(card.dataset.auradropRateLimitedUntil || "0");
        if (until && Date.now() < until) {
          showTooltip(RATE_LIMIT_MESSAGE, label);
          setTimeout(hideTooltip, 900);
          return;
        }

        if (card.dataset.auradropRetryInFlight === "1") return;
        card.dataset.auradropRetryInFlight = "1";

        label.textContent = "Retrying…";
        label.style.setProperty("cursor", "default", "important");

        const forced = await classifyText(postText, true);

        if (forced?.rateLimited) {
          const rlUntil = Number(forced?.rateLimitedUntil || 0) || (Date.now() + RATE_LIMIT_COOLDOWN_MS);
          card.dataset.auradropRateLimitedUntil = String(rlUntil);

          // Do NOT consume retry on rate limit; keep it clickable
          label.textContent = "Retry";
          label.style.setProperty("cursor", "pointer", "important");
          label.onmouseenter = () => showTooltip(sanitizeComment(forced?.comment) || RATE_LIMIT_MESSAGE, label);

          card.dataset.auradropRetryInFlight = "0";
          return;
        }

        // Not rate-limited -> consume retry
        card.dataset.auradropRetryUsed = "1";

        const newTag = sanitizeTag(forced?.tag);
        const newComment = sanitizeComment(forced?.comment);

        label.textContent = (newTag === DEFAULT_TAG ? DEFAULT_TAG : newTag);
        label.style.setProperty("cursor", "default", "important");

        const newHover =
          (newTag === DEFAULT_TAG)
            ? (newComment || "Couldn’t classify — try again later.")
            : (newComment || LABEL_TOOLTIP_TEXT);

        label.onmouseenter = () => showTooltip(newHover, label);
        label.onmouseleave = hideTooltip;
        label.onclick = null;

        card.dataset.auradropRetryInFlight = "0";
      };
    } else {
      label.style.setProperty("cursor", "default", "important");
    }

    card.dataset[DONE_KEY] = "1";
    card.dataset.auradropInFlight = "0";
    return true;
  }

  async function scan() {
    if (__auradropScanRunning) return;
    __auradropScanRunning = true;
    try {
      if (!isFeed()) return;

      ensureStyle();

      const feed = findFeed();
      if (!feed) return;

      const cards = getPostCards(feed);

      let labeled = 0;
      let skippedDone = 0;
      let noText = 0;

      for (const c of cards) {
        if (!(c instanceof HTMLElement)) continue;

        // Skip if already processed or currently processing (prevents duplicate labels from concurrent scans)
        if (c.dataset[DONE_KEY] === "1" || c.dataset.auradropInFlight === "1") {
          skippedDone++;
          continue;
        }

        const ok = await injectLabel(c);
        if (ok) {
          labeled++;
        } else {
          noText++;
        }
      }

      DEBUG && log("cards:", cards.length, "labeled:", labeled, "skippedDone:", skippedDone, "noText:", noText);
    } finally {
      __auradropScanRunning = false;
    }
  }


  // ---- Intro popup (CSS-reset via all:initial for CSP/LinkedIn safety) ----
  const POPUP_SUPPRESS_KEY = "auradropFunPopupSuppressed";

  function isPopupSuppressed() {
    try { return localStorage.getItem(POPUP_SUPPRESS_KEY) === "1"; } catch { return false; }
  }
  function setPopupSuppressed(v) {
    try { localStorage.setItem(POPUP_SUPPRESS_KEY, v ? "1" : "0"); } catch {}
  }

  function showFunPopup() {
    if (isPopupSuppressed()) return;
    if (document.getElementById("auradrop-fun-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "auradrop-fun-overlay";
    overlay.style.cssText = `
      all: initial !important;
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 22px !important;
      background: rgba(0,0,0,0.35) !important;
      backdrop-filter: blur(6px) !important;
      -webkit-backdrop-filter: blur(6px) !important;
    `;

    const modal = document.createElement("div");
    modal.style.cssText = `
      all: initial !important;
      width: min(520px, 92vw) !important;
      border-radius: 18px !important;
      background: rgba(255,255,255,0.98) !important;
      box-shadow: 0 22px 70px rgba(0,0,0,0.30) !important;
      overflow: hidden !important;
      position: relative !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      color: #111 !important;
    `;

    // Keyframes for the aura background + button animation
    const style = document.createElement("style");
    style.textContent = `
      @keyframes auradropPopGlow { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
      @keyframes auradropPopHue { 0%{filter:hue-rotate(0deg)} 100%{filter:hue-rotate(360deg)} }
    `;

    const auraBg = document.createElement("div");
    auraBg.style.cssText = `
      all: initial !important;
      position:absolute !important;
      inset:-40px !important;
      background: linear-gradient(90deg,#ff3366,#ff9933,#33ff99,#3399ff,#cc33ff,#ff3366) !important;
      background-size: 300% 300% !important;
      animation: auradropPopGlow 9s ease infinite, auradropPopHue 6.5s linear infinite !important;
      opacity: 0.14 !important;
      filter: blur(12px) saturate(1.15) !important;
      pointer-events:none !important;
      z-index: 0 !important;
    `;

    const content = document.createElement("div");
    content.style.cssText = `
      all: initial !important;
      position: relative !important;
      z-index: 1 !important;
      display:block !important;
      padding:22px 22px 18px !important;
      font-family: inherit !important;
      color: #111 !important;
    `;

    // Title
    const title = document.createElement("div");
    title.textContent = "AuraDrop";
    title.style.cssText = "all:initial !important; display:block !important; font-family:inherit !important; color:#111 !important; font-size:20px !important; font-weight:800 !important; letter-spacing:0.2px !important; margin:0 0 8px !important;";

    // Paragraph 1
    const p1 = document.createElement("div");
    p1.style.cssText = "all:initial !important; display:block !important; font-family:inherit !important; font-size:14.5px !important; line-height:1.55 !important; margin:0 0 10px !important; color:rgba(0,0,0,0.82) !important;";
    p1.append("A ");
    const b1 = document.createElement("b"); b1.textContent = "for-fun"; b1.style.cssText = "all:initial !important; font-weight:900 !important; font-family:inherit !important; color:inherit !important;";
    p1.appendChild(b1);
    p1.append(" project — not a business, not a service. Labels are vibes, not verdicts.");

    // Paragraph 2
    const p2 = document.createElement("div");
    p2.style.cssText = "all:initial !important; display:block !important; font-family:inherit !important; font-size:14.5px !important; line-height:1.55 !important; margin:0 0 18px !important; color:rgba(0,0,0,0.74) !important;";
    p2.append("AuraDrop only analyzes ");
    const b2 = document.createElement("b"); b2.textContent = "publicly visible LinkedIn post text"; b2.style.cssText = "all:initial !important; font-weight:900 !important; font-family:inherit !important; color:inherit !important;";
    p2.appendChild(b2);
    p2.append(". No accounts, no tracking, no ads. Data stays on your device.");

    // Checkbox row
    const label = document.createElement("label");
    label.style.cssText = "all:initial !important; display:flex !important; align-items:center !important; gap:8px !important; margin:0 0 12px !important; padding:6px 8px !important; border-radius:12px !important; background:rgba(0,0,0,0.05) !important; border:1px solid rgba(0,0,0,0.10) !important; font-family:inherit !important; font-size:13px !important; font-weight:850 !important; color:rgba(0,0,0,0.78) !important; cursor:pointer !important; user-select:none !important;";
    const hideCb = document.createElement("input");
    hideCb.id = "auradrop-fun-popup-hide";
    hideCb.type = "checkbox";
    hideCb.style.cssText = "appearance:checkbox !important; -webkit-appearance:checkbox !important; width:18px !important; height:18px !important; cursor:pointer !important; accent-color:#111 !important; background:#fff !important;";
    const hideText = document.createElement("span");
    hideText.textContent = "Do not show this window again";
    hideText.style.cssText = "all:initial !important; font-family:inherit !important; color:inherit !important;";
    label.appendChild(hideCb);
    label.appendChild(hideText);

    // Buttons row
    const row = document.createElement("div");
    row.style.cssText = "all:initial !important; display:flex !important; gap:12px !important; justify-content:space-between !important; align-items:center !important; flex-wrap:wrap !important;";

    const support = document.createElement("a");
    support.href = "https://auradrop.live/";
    support.target = "_blank";
    support.rel = "noopener noreferrer";
    support.textContent = "Support AuraDrop";
    support.style.cssText = `
      all: initial !important;
      box-sizing: border-box !important;
      display:inline-flex !important;
      align-items:center !important;
      justify-content:center !important;

      padding:12px 16px !important;
      min-width:170px !important;
      border-radius:14px !important;

      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif !important;
      font-size:15px !important;
      font-weight:750 !important;
      letter-spacing:0.15px !important;
      line-height:1.15 !important;
      text-transform:none !important;
      -webkit-font-smoothing: antialiased !important;
      -moz-osx-font-smoothing: grayscale !important;

      text-decoration:none !important;
      color:#fff !important;

      background: linear-gradient(90deg,#ff3366,#ff9933,#33ff99,#3399ff,#cc33ff,#ff3366) !important;
      background-size: 320% 320% !important;
      animation: auradropPopGlow 8s ease infinite, auradropPopHue 10s linear infinite !important;

      border:1px solid rgba(255,255,255,0.22) !important;
      box-shadow: 0 10px 26px rgba(0,0,0,0.22) !important;

      white-space:nowrap !important;
      cursor:pointer !important;
    `;

    const okBtn = document.createElement("button");
    okBtn.id = "auradrop-fun-popup-ok";
    okBtn.type = "button";
    okBtn.style.appearance = "none";
    okBtn.style.webkitAppearance = "none";
    okBtn.textContent = "Got it";
    okBtn.style.cssText = "all:initial !important; box-sizing:border-box !important; display:inline-flex !important; align-items:center !important; justify-content:center !important; padding:12px 18px !important; min-width:120px !important; border:none !important; border-radius:14px !important; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif !important; font-size:15px !important; font-weight:750 !important; letter-spacing:0.15px !important; line-height:1.15 !important; -webkit-font-smoothing: antialiased !important; -moz-osx-font-smoothing: grayscale !important; background:#111 !important; color:#fff !important; cursor:pointer !important; box-shadow: 0 10px 26px rgba(0,0,0,0.22) !important; ";

    row.appendChild(support);
    row.appendChild(okBtn);

    content.appendChild(title);
    content.appendChild(p1);
    content.appendChild(p2);
    content.appendChild(label);
    content.appendChild(row);

    modal.appendChild(style);
    modal.appendChild(auraBg);
    modal.appendChild(content);
    overlay.appendChild(modal);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    okBtn.addEventListener("click", () => {
      if (hideCb.checked) setPopupSuppressed(true);
      overlay.remove();
    });

    (document.body || document.documentElement).appendChild(overlay);
  }

function boot() {
    hardResetAuraDropState();

    try { showFunPopup(); } catch {}
    void scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    setInterval(scan, 2000);

    let last = location.pathname;
    setInterval(() => {
      if (location.pathname !== last) {
        last = location.pathname;
        hardResetAuraDropState();
    void scan();
      }
    }, 500);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideTooltip();
    });
  }

  const t = setInterval(() => {
    if (!document.body) return;
    clearInterval(t);
    boot();
  }, 50);
})();
