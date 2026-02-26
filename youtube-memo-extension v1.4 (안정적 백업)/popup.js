function getVideoIdFromUrl(url) {
  const match = url.match(/[?&]v=([^&]+)/);
  return match ? match[1] : null;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? Math.floor(seconds) : 0);
  const m = Math.floor(safeSeconds / 60);
  const s = safeSeconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function normalizeMemoData(videoId, rawData) {
  if (rawData && typeof rawData === "object") {
    return {
      title: typeof rawData.title === "string" ? rawData.title : videoId,
      channel: typeof rawData.channel === "string" ? rawData.channel : "Unknown Channel",
      thumbnail: typeof rawData.thumbnail === "string"
        ? rawData.thumbnail
        : `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      memos: Array.isArray(rawData.memos)
        ? rawData.memos
            .filter(m => m && typeof m.text === "string")
            .map(m => ({
              time: Number.isFinite(m.time) ? Math.max(0, Math.floor(m.time)) : 0,
              text: m.text
            }))
        : []
    };
  }

  if (typeof rawData === "string" && rawData.trim()) {
    return {
      title: videoId,
      channel: "Unknown Channel",
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      memos: [{ time: 0, text: rawData.trim() }]
    };
  }

  return null;
}

function sendShowPopupMessage(tabId, videoId) {
  if (!tabId) return;
  setTimeout(() => {
    chrome.tabs.sendMessage(tabId, { type: "SHOW_MEMO_POPUP", videoId }, () => {
      void chrome.runtime.lastError;
    });
  }, 350);
}

function smartOpenVideo(videoId, options = {}) {
  chrome.tabs.query({}, (tabs) => {
    const existingTab = tabs.find(t => t.url && t.url.includes(`watch?v=${videoId}`));

    if (existingTab) {
      chrome.tabs.update(existingTab.id, { active: true }, () => {
        if (options.showPopup) sendShowPopupMessage(existingTab.id, videoId);
      });
    } else {
      chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}` }, (createdTab) => {
        if (options.showPopup) sendShowPopupMessage(createdTab?.id, videoId);
      });
    }
  });
}

function smartOpenVideoAtTime(videoId, time) {
  chrome.tabs.query({}, (tabs) => {
    const existingTab = tabs.find(t => t.url && t.url.includes(`watch?v=${videoId}`));
    const safeTime = Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0;
    const targetUrl = `https://www.youtube.com/watch?v=${videoId}&t=${safeTime}s`;

    if (existingTab) {
      chrome.tabs.update(existingTab.id, { url: targetUrl, active: true });
    } else {
      chrome.tabs.create({ url: targetUrl });
    }
  });
}

let currentVideoId = null;
let allData = {};

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const url = tabs[0]?.url || "";
  currentVideoId = getVideoIdFromUrl(url);

  const label = document.getElementById("currentVideo");
  label.innerText = currentVideoId
    ? `영상 ID: ${currentVideoId}`
    : "유튜브 영상 페이지가 아닙니다.";
});

async function fetchVideoMeta(videoId) {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    const data = await response.json();

    return {
      title: data.title,
      author: data.author_name,
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
    };
  } catch (e) {
    return {
      title: videoId,
      author: "Unknown Channel",
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
    };
  }
}

function saveMemo(videoId, memoText, time) {
  chrome.storage.local.get([videoId], async (result) => {
    let existing = normalizeMemoData(videoId, result[videoId]);

    if (!existing) {
      const meta = await fetchVideoMeta(videoId);
      existing = {
        title: meta.title,
        channel: meta.author,
        thumbnail: meta.thumbnail,
        memos: []
      };
    }

    existing.memos.push({
      time: Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0,
      text: memoText
    });

    chrome.storage.local.set({ [videoId]: existing }, () => {
      document.getElementById("memoInput").value = "";
      loadMemoList();
    });
  });
}

function withActiveYoutubeTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (!tabId) {
      callback(0);
      return;
    }

    chrome.tabs.sendMessage(tabId, { type: "GET_TIME" }, (response) => {
      if (!chrome.runtime.lastError && response && response.time !== undefined) {
        callback(Math.max(0, Math.floor(response.time)));
        return;
      }

      chrome.scripting.executeScript(
        { target: { tabId }, files: ["content.js"] },
        () => {
          if (chrome.runtime.lastError) {
            callback(0);
            return;
          }

          chrome.tabs.sendMessage(tabId, { type: "GET_TIME" }, (retryResponse) => {
            if (chrome.runtime.lastError || !retryResponse || retryResponse.time === undefined) {
              callback(0);
              return;
            }
            callback(Math.max(0, Math.floor(retryResponse.time)));
          });
        }
      );
    });
  });
}

document.getElementById("saveBaseMemoBtn").addEventListener("click", () => {
  const memoText = document.getElementById("memoInput").value.trim();
  if (!currentVideoId || !memoText) return;
  saveMemo(currentVideoId, memoText, 0);
});

document.getElementById("saveTimeBtn").addEventListener("click", () => {
  const memoText = document.getElementById("memoInput").value.trim();
  if (!currentVideoId || !memoText) return;

  withActiveYoutubeTab((time) => {
    saveMemo(currentVideoId, memoText, time);
  });
});

document.getElementById("searchInput").addEventListener("input", (e) => {
  renderList(e.target.value.toLowerCase());
});

document.getElementById("backupBtn").addEventListener("click", () => {
  chrome.storage.local.get(null, (data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `youtube-memo-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
});

document.getElementById("restoreInput").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const sanitized = {};

      Object.keys(parsed).forEach((videoId) => {
        const normalized = normalizeMemoData(videoId, parsed[videoId]);
        if (normalized) sanitized[videoId] = normalized;
      });

      chrome.storage.local.set(sanitized, loadMemoList);
    } catch (err) {
      alert("백업 파일 형식이 올바르지 않습니다.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
});

function updateMemo(videoId, memoIndex, nextText) {
  chrome.storage.local.get([videoId], (result) => {
    const existing = normalizeMemoData(videoId, result[videoId]);
    if (!existing || !existing.memos[memoIndex]) return;

    existing.memos[memoIndex].text = nextText;
    chrome.storage.local.set({ [videoId]: existing }, loadMemoList);
  });
}

function groupedByChannel() {
  const grouped = {};
  Object.keys(allData).forEach((videoId) => {
    const normalized = normalizeMemoData(videoId, allData[videoId]);
    if (!normalized) return;

    const key = normalized.channel || "Unknown Channel";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ videoId, ...normalized });
  });

  return grouped;
}

function loadMemoList() {
  chrome.storage.local.get(null, (data) => {
    allData = data;
    renderList("");
  });
}

function renderList(filterText) {
  const list = document.getElementById("memoList");
  list.innerHTML = "";

  const grouped = groupedByChannel();

  Object.keys(grouped)
    .sort((a, b) => a.localeCompare(b))
    .forEach((channelName) => {
      const videos = grouped[channelName].filter(({ title, memos }) => {
        return (
          title.toLowerCase().includes(filterText) ||
          memos.some((m) => m.text.toLowerCase().includes(filterText))
        );
      });

      if (!videos.length) return;

      const category = document.createElement("div");
      category.className = "channel-category";
      category.innerText = `📺 ${channelName}`;
      list.appendChild(category);

      videos.forEach(({ videoId, title, thumbnail, memos }) => {
        const container = document.createElement("div");
        container.className = "item";

        const container1 = document.createElement("div");
        container1.className = "container1";
        container1.innerHTML = `
          <img class="thumb" src="${thumbnail}" />
          <div class="title">${title}</div>
        `;
        container1.onclick = () => smartOpenVideo(videoId, { showPopup: true });

        memos
          .map((m, index) => ({ ...m, index }))
          .filter((m) => m.time === 0)
          .forEach((m) => {
            const base = document.createElement("div");
            base.className = "base-memo";
            base.innerText = m.text;

            const edit = document.createElement("button");
            edit.className = "edit-btn";
            edit.innerText = "수정";
            edit.onclick = (e) => {
              e.stopPropagation();
              const nextText = prompt("메모 수정", m.text);
              if (!nextText || !nextText.trim()) return;
              updateMemo(videoId, m.index, nextText.trim());
            };

            base.appendChild(edit);
            container1.appendChild(base);
          });

        const container2 = document.createElement("div");
        container2.className = "container2";

        const timeMemos = memos
          .map((m, index) => ({ ...m, index }))
          .filter((m) => m.time > 0)
          .sort((a, b) => a.time - b.time);

        timeMemos.forEach((m) => {
          const memoRow = document.createElement("div");
          memoRow.className = "timeline-row";

          const memo = document.createElement("div");
          memo.className = "timeline-memo";
          memo.innerText = `${formatTime(m.time)} "${m.text}"`;
          memo.onclick = (e) => {
            e.stopPropagation();
            smartOpenVideoAtTime(videoId, m.time);
          };

          const edit = document.createElement("button");
          edit.className = "edit-btn";
          edit.innerText = "수정";
          edit.onclick = (e) => {
            e.stopPropagation();
            const nextText = prompt("메모 수정", m.text);
            if (!nextText || !nextText.trim()) return;
            updateMemo(videoId, m.index, nextText.trim());
          };

          memoRow.appendChild(memo);
          memoRow.appendChild(edit);
          container2.appendChild(memoRow);
        });

        const container3 = document.createElement("div");
        container3.className = "container3";

        const deleteBtn = document.createElement("button");
        deleteBtn.innerText = "삭제";
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          chrome.storage.local.remove(videoId, loadMemoList);
        };

        container3.appendChild(deleteBtn);

        container.appendChild(container1);
        container.appendChild(container2);
        container.appendChild(container3);

        list.appendChild(container);
      });
    });
}

loadMemoList();
