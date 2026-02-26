const overlayState = {
  root: null,
  mainMemoEl: null,
  timeMemoContainer: null,
  videoId: null,
  mainVisible: false,
  mainHideTimer: null,
  timeHideTimers: new Map(),
  timeTriggeredAtSecond: {},
  overlayEnabled: true,
  drag: { active: false, x: 20, y: 80, offsetX: 0, offsetY: 0 }
};

function getVideoId() {
  const watchMatch = location.search.match(/[?&]v=([^&]+)/);
  if (watchMatch) return watchMatch[1];
  const shortsMatch = location.pathname.match(/\/shorts\/([^/]+)/);
  return shortsMatch ? shortsMatch[1] : null;
}

function normalizeData(raw) {
  if (!raw || typeof raw !== "object") return null;
  const mainMemo = typeof raw.mainMemo === "string"
    ? raw.mainMemo
    : (Array.isArray(raw.memos) ? (raw.memos.find((m) => (m?.time || 0) === 0)?.text || "") : "");

  const timeMemos = Array.isArray(raw.timeMemos)
    ? raw.timeMemos
    : (Array.isArray(raw.memos) ? raw.memos.filter((m) => Number(m?.time) > 0) : []);

  return {
    mainMemo: mainMemo || "",
    timeMemos: timeMemos.map((m) => ({ id: m.id || `${m.time}-${m.text}`, time: Math.max(1, Math.floor(Number(m.time) || 0)), text: String(m.text || "") }))
  };
}

function ensureOverlay() {
  if (overlayState.root) return;
  const root = document.createElement("section");
  root.id = "yt-memo-box";
  root.innerHTML = `
    <header id="yt-memo-header">
      <strong>📌 YouTube Memo</strong>
      <button id="yt-memo-close">✕</button>
    </header>
    <div id="yt-main-memo"></div>
    <div id="yt-time-container"></div>
  `;
  document.body.appendChild(root);

  overlayState.root = root;
  overlayState.mainMemoEl = root.querySelector("#yt-main-memo");
  overlayState.timeMemoContainer = root.querySelector("#yt-time-container");

  root.querySelector("#yt-memo-close").onclick = () => hideOverlay();

  const header = root.querySelector("#yt-memo-header");
  header.addEventListener("mousedown", (e) => {
    overlayState.drag.active = true;
    overlayState.drag.offsetX = e.clientX - overlayState.drag.x;
    overlayState.drag.offsetY = e.clientY - overlayState.drag.y;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!overlayState.drag.active) return;
    overlayState.drag.x = Math.max(0, e.clientX - overlayState.drag.offsetX);
    overlayState.drag.y = Math.max(0, e.clientY - overlayState.drag.offsetY);
    root.style.left = `${overlayState.drag.x}px`;
    root.style.top = `${overlayState.drag.y}px`;
    root.style.right = "auto";
  });

  document.addEventListener("mouseup", () => {
    overlayState.drag.active = false;
  });
}

function hideOverlay() {
  if (!overlayState.root) return;
  overlayState.root.classList.add("hidden");
  overlayState.mainVisible = false;
  clearTimeout(overlayState.mainHideTimer);
}

function showMainMemo(text, force = false) {
  if (!overlayState.overlayEnabled && !force) return;
  if (!text) return;
  ensureOverlay();

  overlayState.mainMemoEl.textContent = text;
  overlayState.root.classList.remove("hidden");
  overlayState.root.classList.remove("fade-out");
  overlayState.mainVisible = true;

  clearTimeout(overlayState.mainHideTimer);
  overlayState.mainHideTimer = setTimeout(() => {
    if (!overlayState.root) return;
    overlayState.root.classList.add("fade-out");
    setTimeout(() => {
      if (overlayState.root) overlayState.root.classList.add("hidden");
      overlayState.root?.classList.remove("fade-out");
      overlayState.mainVisible = false;
    }, 240);
  }, 6000);
}

function showTimeMemoPopup(memo) {
  ensureOverlay();
  overlayState.root.classList.remove("hidden");

  const item = document.createElement("div");
  item.className = "time-pill";
  item.textContent = `⏱ ${memo.text}`;
  overlayState.timeMemoContainer.appendChild(item);

  const key = memo.id;
  if (overlayState.timeHideTimers.has(key)) {
    clearTimeout(overlayState.timeHideTimers.get(key));
  }

  const timer = setTimeout(() => {
    item.classList.add("fade-out");
    setTimeout(() => item.remove(), 240);
    overlayState.timeHideTimers.delete(key);
  }, 3000);

  overlayState.timeHideTimers.set(key, timer);
}

function checkVideoMemos() {
  const video = document.querySelector("video");
  const videoId = getVideoId();
  if (!video || !videoId) return;

  if (overlayState.videoId !== videoId) {
    overlayState.videoId = videoId;
    overlayState.timeTriggeredAtSecond = {};
  }

  chrome.storage.local.get([videoId, "__overlayEnabled"], (result) => {
    overlayState.overlayEnabled = result.__overlayEnabled !== false;
    const data = normalizeData(result[videoId]);
    if (!data) return;

    const second = Math.floor(video.currentTime);
    data.timeMemos.forEach((memo) => {
      if (memo.time === second) {
        const seenKey = `${memo.id}:${second}`;
        if (overlayState.timeTriggeredAtSecond[seenKey]) return;
        overlayState.timeTriggeredAtSecond[seenKey] = true;
        showTimeMemoPopup(memo);
      }
    });
  });
}

function showForCurrentVideo(force = false) {
  const videoId = getVideoId();
  if (!videoId) return;
  chrome.storage.local.get([videoId, "__overlayEnabled"], (result) => {
    overlayState.overlayEnabled = result.__overlayEnabled !== false;
    const data = normalizeData(result[videoId]);
    if (!data || !data.mainMemo) return;
    showMainMemo(data.mainMemo, force);
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_TIME") {
    const video = document.querySelector("video");
    sendResponse({ time: video ? video.currentTime : 0 });
    return;
  }

  if (request.type === "SHOW_MAIN_MEMO") {
    showForCurrentVideo(true);
  }

  if (request.type === "HIDE_MEMO_POPUP") {
    hideOverlay();
  }
});

let lastUrl = location.href;
new MutationObserver(() => {
  if (lastUrl === location.href) return;
  lastUrl = location.href;
  overlayState.videoId = null;
  overlayState.timeTriggeredAtSecond = {};
  showForCurrentVideo(false);
}).observe(document, { subtree: true, childList: true });

setInterval(checkVideoMemos, 250);
showForCurrentVideo(false);
