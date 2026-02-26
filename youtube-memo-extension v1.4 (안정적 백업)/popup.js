const STORAGE_KEYS = {
  OVERLAY_ENABLED: "__overlayEnabled",
  RECENT_HIDDEN: "__recentHidden"
};

const state = {
  currentVideoId: null,
  currentTabId: null,
  isShorts: false,
  allData: {},
  currentPage: "main",
  activeMenuId: null,
  searchText: ""
};

function getVideoIdFromUrl(url) {
  const watchMatch = url.match(/[?&]v=([^&]+)/);
  if (watchMatch) return watchMatch[1];
  const shortsMatch = url.match(/\/shorts\/([^?&/]+)/);
  return shortsMatch ? shortsMatch[1] : null;
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMemoData(videoId, rawData) {
  if (rawData && typeof rawData === "object") {
    const mainMemo = typeof rawData.mainMemo === "string"
      ? rawData.mainMemo
      : (Array.isArray(rawData.memos) ? (rawData.memos.find((m) => (m?.time || 0) === 0)?.text || "") : "");

    const timeMemos = Array.isArray(rawData.timeMemos)
      ? rawData.timeMemos
      : Array.isArray(rawData.memos)
        ? rawData.memos.filter((m) => Number(m?.time) > 0).map((m) => ({
            id: m.id || uid(),
            time: Math.max(1, Math.floor(Number(m.time))),
            text: String(m.text || ""),
            createdAt: m.createdAt || Date.now()
          }))
        : [];

    return {
      title: typeof rawData.title === "string" ? rawData.title : videoId,
      channel: typeof rawData.channel === "string" ? rawData.channel : "Unknown Channel",
      thumbnail: typeof rawData.thumbnail === "string" ? rawData.thumbnail : `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      mainMemo,
      timeMemos: timeMemos.filter((m) => m.text),
      updatedAt: rawData.updatedAt || Date.now()
    };
  }

  if (typeof rawData === "string" && rawData.trim()) {
    return {
      title: videoId,
      channel: "Unknown Channel",
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      mainMemo: rawData.trim(),
      timeMemos: [],
      updatedAt: Date.now()
    };
  }

  return null;
}

function createModal({ title, message, showCancel = false, confirmText = "확인", cancelText = "취소", inputValue = null }) {
  const root = document.getElementById("modalRoot");
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal"><h4>${title}</h4><p>${message}</p></div>`;

    const modal = overlay.querySelector(".modal");
    let input = null;
    if (inputValue !== null) {
      input = document.createElement("textarea");
      input.value = inputValue;
      input.rows = 4;
      modal.appendChild(input);
    }

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    if (showCancel) {
      const cancel = document.createElement("button");
      cancel.textContent = cancelText;
      cancel.onclick = () => {
        overlay.remove();
        resolve(null);
      };
      actions.appendChild(cancel);
    }

    const confirm = document.createElement("button");
    confirm.className = "btn-primary";
    confirm.textContent = confirmText;
    confirm.onclick = () => {
      const val = input ? input.value.trim() : true;
      overlay.remove();
      resolve(val);
    };
    actions.appendChild(confirm);

    modal.appendChild(actions);
    root.appendChild(overlay);
    if (input) input.focus();
  });
}

async function fetchVideoMeta(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
    const data = await response.json();
    return { title: data.title, channel: data.author_name, thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` };
  } catch {
    return { title: videoId, channel: "Unknown Channel", thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` };
  }
}

function withActiveYoutubeTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    state.currentTabId = tab?.id || null;
    callback(tab);
  });
}

function setPage(page) {
  state.currentPage = page;
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.getElementById(`${page}Page`).classList.add("active");
  document.body.classList.toggle("wide", page === "list");
  document.getElementById("goSettingsBtn").style.display = page === "settings" ? "none" : "inline-flex";
}

function renderCurrentVideo(tab) {
  const url = tab?.url || "";
  state.currentVideoId = getVideoIdFromUrl(url);
  state.isShorts = /youtube\.com\/shorts\//.test(url);

  document.getElementById("currentVideo").textContent = state.currentVideoId
    ? `영상 ID: ${state.currentVideoId}${state.isShorts ? " (Shorts)" : ""}`
    : "유튜브 영상 페이지가 아닙니다.";

  const saveTimeBtn = document.getElementById("saveTimeBtn");
  saveTimeBtn.disabled = state.isShorts;
  saveTimeBtn.title = state.isShorts ? "쇼츠에서는 시간 메모를 저장할 수 없습니다." : "";
}

function getCurrentVideoData() {
  return state.currentVideoId ? normalizeMemoData(state.currentVideoId, state.allData[state.currentVideoId]) : null;
}

function requestCurrentTime(cb) {
  if (!state.currentTabId) return cb(0);
  chrome.tabs.sendMessage(state.currentTabId, { type: "GET_TIME" }, (response) => {
    if (chrome.runtime.lastError || !response) return cb(0);
    cb(Math.max(0, Math.floor(response.time || 0)));
  });
}

async function saveMainMemo(text) {
  if (!state.currentVideoId || !text) return;

  let existing = getCurrentVideoData();
  if (existing?.mainMemo && existing.mainMemo !== text) {
    const ok = await createModal({ title: "메인 메모 교체", message: "기존 메인 메모를 새 내용으로 교체할까요?", showCancel: true, confirmText: "교체" });
    if (!ok) return;
  }

  if (!existing) {
    const meta = await fetchVideoMeta(state.currentVideoId);
    existing = { ...meta, mainMemo: "", timeMemos: [], updatedAt: Date.now() };
  }

  existing.mainMemo = text;
  existing.updatedAt = Date.now();

  chrome.storage.local.set({ [state.currentVideoId]: existing }, () => {
    loadMemoList();
    document.getElementById("memoInput").value = "";
    notifyOverlay("SHOW_MAIN_MEMO");
  });
}

function saveTimeMemo(text, time) {
  if (!state.currentVideoId || !text) return;
  const existing = getCurrentVideoData() || {
    title: state.currentVideoId,
    channel: "Unknown Channel",
    thumbnail: `https://img.youtube.com/vi/${state.currentVideoId}/hqdefault.jpg`,
    mainMemo: "",
    timeMemos: [],
    updatedAt: Date.now()
  };

  existing.timeMemos.push({ id: uid(), text, time: Math.max(1, Math.floor(time || 0)), createdAt: Date.now() });
  existing.timeMemos.sort((a, b) => a.time - b.time);
  existing.updatedAt = Date.now();

  chrome.storage.local.set({ [state.currentVideoId]: existing }, () => {
    loadMemoList();
    document.getElementById("memoInput").value = "";
  });
}

function notifyOverlay(type) {
  if (!state.currentTabId || !state.currentVideoId) return;
  chrome.tabs.sendMessage(state.currentTabId, { type, videoId: state.currentVideoId }, () => void chrome.runtime.lastError);
}

function buildGroupedData() {
  const grouped = {};
  Object.entries(state.allData).forEach(([videoId, raw]) => {
    if (videoId.startsWith("__")) return;
    const data = normalizeMemoData(videoId, raw);
    if (!data) return;
    const channelKey = data.channel || "Unknown Channel";
    if (!grouped[channelKey]) grouped[channelKey] = [];
    grouped[channelKey].push({ videoId, ...data });
  });

  Object.keys(grouped).forEach((channel) => {
    grouped[channel].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  });

  const current = state.currentVideoId;
  if (current) {
    const foundChannel = Object.keys(grouped).find((channel) => grouped[channel].some((v) => v.videoId === current));
    if (foundChannel) {
      grouped[foundChannel].sort((a, b) => (a.videoId === current ? -1 : b.videoId === current ? 1 : 0));
      return Object.fromEntries([[foundChannel, grouped[foundChannel]], ...Object.entries(grouped).filter(([c]) => c !== foundChannel)]);
    }
  }

  return Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)));
}

function memoMatches(video, searchText) {
  if (!searchText) return true;
  const q = searchText.toLowerCase();
  return video.channel.toLowerCase().includes(q) || video.mainMemo.toLowerCase().includes(q) || video.timeMemos.some((m) => m.text.toLowerCase().includes(q));
}

function highlightText(text, query) {
  if (!query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(${escaped})`, "ig"), "<span class='text-hit'>$1</span>");
}

async function onMenuAction(videoId, memo, action) {
  const video = normalizeMemoData(videoId, state.allData[videoId]);
  if (!video) return;

  if (action === "edit") {
    const nextText = await createModal({ title: "메모 수정", message: "내용을 수정하세요.", inputValue: memo.text, showCancel: true, confirmText: "저장" });
    if (!nextText) return;
    memo.text = nextText;
  }

  if (action === "delete") {
    const ok = await createModal({ title: "시간 메모 삭제", message: "선택한 시간 메모를 삭제할까요?", showCancel: true, confirmText: "삭제" });
    if (!ok) return;
    video.timeMemos = video.timeMemos.filter((m) => m.id !== memo.id);
  }

  video.updatedAt = Date.now();
  chrome.storage.local.set({ [videoId]: video }, loadMemoList);
}

function renderList() {
  const list = document.getElementById("memoList");
  list.innerHTML = "";
  const grouped = buildGroupedData();
  const q = state.searchText;
  let found = false;

  Object.entries(grouped).forEach(([channel, videos]) => {
    const channelBlock = document.createElement("section");
    channelBlock.className = "channel-box";

    const head = document.createElement("h4");
    head.innerHTML = `📺 ${highlightText(channel, q)}`;
    channelBlock.appendChild(head);

    videos.filter((v) => memoMatches(v, q)).forEach((video) => {
      found = true;
      const card = document.createElement("article");
      card.className = `video-box ${video.videoId === state.currentVideoId ? "is-current" : ""}`;

      const title = document.createElement("div");
      title.className = "video-title";
      title.innerHTML = highlightText(video.title, q);
      title.onclick = () => chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${video.videoId}` });
      card.appendChild(title);

      if (video.mainMemo) {
        const main = document.createElement("div");
        main.className = "main-memo";
        main.innerHTML = `📌 ${highlightText(video.mainMemo, q)}`;
        card.appendChild(main);
      }

      video.timeMemos.forEach((memo) => {
        const row = document.createElement("div");
        row.className = `time-row ${video.videoId === state.currentVideoId ? "is-current-video" : ""}`;

        const txt = document.createElement("div");
        txt.className = "time-text";
        txt.innerHTML = `${formatTime(memo.time)} ${highlightText(memo.text, q)}`;
        txt.onclick = () => chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${video.videoId}&t=${memo.time}s` });

        const menuBtn = document.createElement("button");
        menuBtn.className = "icon-btn";
        menuBtn.textContent = "⋯";
        menuBtn.onclick = (e) => {
          e.stopPropagation();
          state.activeMenuId = state.activeMenuId === memo.id ? null : memo.id;
          renderList();
        };

        row.appendChild(txt);
        row.appendChild(menuBtn);

        if (state.activeMenuId === memo.id) {
          const menu = document.createElement("div");
          menu.className = "inline-menu";
          const edit = document.createElement("button");
          edit.textContent = "수정";
          edit.onclick = () => onMenuAction(video.videoId, memo, "edit");
          const del = document.createElement("button");
          del.className = "btn-danger";
          del.textContent = "삭제";
          del.onclick = () => onMenuAction(video.videoId, memo, "delete");
          menu.append(edit, del);
          row.appendChild(menu);
        }

        card.appendChild(row);
      });

      channelBlock.appendChild(card);
    });

    if (channelBlock.children.length > 1) list.appendChild(channelBlock);
  });

  const empty = document.getElementById("emptySearch");
  if (!found && q) {
    empty.classList.remove("hidden");
    empty.textContent = `"${q}"로 등록한 메모가 없어요`;
  } else {
    empty.classList.add("hidden");
  }
}

function renderRecent() {
  const wrap = document.getElementById("recentMemoList");
  wrap.innerHTML = "";

  chrome.storage.local.get([STORAGE_KEYS.RECENT_HIDDEN], (result) => {
    const hidden = new Set(result[STORAGE_KEYS.RECENT_HIDDEN] || []);
    const items = Object.entries(state.allData)
      .filter(([id]) => !id.startsWith("__") && !hidden.has(id))
      .map(([videoId, raw]) => ({ videoId, ...normalizeMemoData(videoId, raw) }))
      .filter((v) => v && (v.mainMemo || v.timeMemos.length))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 5);

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "recent-row";
      row.innerHTML = `<div class='recent-title'>${item.title}</div><div class='recent-time'>${item.timeMemos[0] ? formatTime(item.timeMemos[0].time) : "--:--"}</div>`;

      const remove = document.createElement("button");
      remove.className = "icon-btn";
      remove.textContent = "🗑";
      remove.onclick = () => {
        hidden.add(item.videoId);
        chrome.storage.local.set({ [STORAGE_KEYS.RECENT_HIDDEN]: [...hidden] }, renderRecent);
      };

      row.appendChild(remove);
      wrap.appendChild(row);
    });
  });
}

function loadMemoList() {
  chrome.storage.local.get(null, (data) => {
    state.allData = data;
    renderList();
    renderRecent();
  });
}

function bindEvents() {
  document.getElementById("goMainBtn").onclick = () => setPage("main");
  document.getElementById("goListBtn").onclick = () => setPage("list");
  document.getElementById("goSettingsBtn").onclick = () => setPage("settings");

  document.getElementById("searchInput").addEventListener("input", (e) => {
    state.searchText = e.target.value.trim();
    renderList();
  });

  document.getElementById("clearSearchBtn").onclick = () => {
    state.searchText = "";
    document.getElementById("searchInput").value = "";
    renderList();
  };

  document.getElementById("memoInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const text = e.target.value.trim();
    if (!text) return;
    if (e.shiftKey) {
      e.preventDefault();
      requestCurrentTime((time) => saveTimeMemo(text, time));
      return;
    }
    e.preventDefault();
    saveMainMemo(text);
  });

  document.getElementById("saveBaseMemoBtn").onclick = () => saveMainMemo(document.getElementById("memoInput").value.trim());
  document.getElementById("saveTimeBtn").onclick = () => requestCurrentTime((time) => saveTimeMemo(document.getElementById("memoInput").value.trim(), time));

  document.getElementById("overlaySwitch").addEventListener("change", (e) => {
    chrome.storage.local.set({ [STORAGE_KEYS.OVERLAY_ENABLED]: e.target.checked });
    notifyOverlay(e.target.checked ? "SHOW_MAIN_MEMO" : "HIDE_MEMO_POPUP");
  });

  document.getElementById("backupBtn").onclick = () => {
    chrome.storage.local.get(null, (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `youtube-memo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  document.getElementById("restoreInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const sanitized = {};
        Object.keys(parsed).forEach((videoId) => {
          sanitized[videoId] = normalizeMemoData(videoId, parsed[videoId]);
        });
        chrome.storage.local.set(sanitized, loadMemoList);
      } catch {
        await createModal({ title: "복원 실패", message: "백업 파일 형식이 올바르지 않습니다." });
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  });

  document.getElementById("deleteAllBtn").onclick = async () => {
    const ok = await createModal({ title: "전체 삭제", message: "모든 메모를 삭제할까요?", showCancel: true, confirmText: "삭제" });
    if (!ok) return;
    chrome.storage.local.clear(loadMemoList);
  };
}

function init() {
  bindEvents();
  withActiveYoutubeTab((tab) => {
    renderCurrentVideo(tab);
    chrome.storage.local.get([STORAGE_KEYS.OVERLAY_ENABLED], (res) => {
      document.getElementById("overlaySwitch").checked = res[STORAGE_KEYS.OVERLAY_ENABLED] !== false;
    });
    loadMemoList();
  });

  // document.getElementById("searchInput").addEventListener("focus", enableAutocomplete); // 자동완성 유지(비활성)
}

init();
