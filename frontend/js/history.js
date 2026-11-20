/* ---------- history ---------- */
import { state, $, esc, api, fmtBytes, timeLabel, timeAgo, API_BASE } from "./core.js";
import { icon } from "./icons.js";
import { toast, showModal, closeModal, confirmDialog, copy } from "./ui.js";
import { pollJobs, ensureEdits, renderJobs } from "./jobs.js";
import { loadDashboard } from "./dashboard.js";

async function loadHistory() {
  try {
    state.history = await api("/clips");
    state.historyLoaded = true;
    const ids = new Set(state.history.map((c) => Number(c.id)));
    Object.keys(state.historySel).forEach((id) => { if (!ids.has(Number(id))) delete state.historySel[id]; });
    renderHistory();
    clearTimeout(state.historyPoll);
    if (state.history.some((c) => c.upload_state === "uploading")) {
      state.historyPoll = setTimeout(() => { if (state.view === "history") loadHistory(); }, 3000);
    }
  } catch (e) { toast("Could not load history: " + e.message, "err"); }
}

function filteredHistory() {
  let list = state.history;
  if (state.historyFilter === "local") list = list.filter((c) => !c.uploaded);
  if (state.historyFilter === "uploaded") list = list.filter((c) => c.uploaded);
  const q = state.historyQuery.trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) => `${c.title || ""} ${c.job_title || ""} ${c.id} ${c.job_id}`.toLowerCase().includes(q));
}

function renderHistory() {
  const grid = $("#historyGrid");
  if (!grid) return;
  const list = filteredHistory();
  const selected = Object.keys(state.historySel).filter((id) => state.historySel[id]).length;
  const count = $("#historyCount");
  if (count) count.textContent = `${state.history.length} clip${state.history.length === 1 ? "" : "s"}${selected ? ` · ${selected} selected` : ""}`;
  const del = $("#historyDeleteSelected");
  if (del) del.disabled = selected === 0;
  const allBtn = $("#historySelectAll");
  if (allBtn) {
    const allOn = list.length > 0 && list.every((c) => state.historySel[c.id]);
    allBtn.innerHTML = `${icon(allOn ? "x" : "check")}${allOn ? "Deselect all" : "Select all"}`;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="empty history-empty"><span class="empty-icon">${icon("film")}</span><strong>${state.history.length ? "No clips match that search" : "No generated clips yet"}</strong><p>${state.history.length ? "Try a different title or job id." : "Render a Short and it will show up here."}</p><button class="btn primary sm" data-go="create">${icon("plus")}New short</button></div>`;
    return;
  }
  grid.innerHTML = list.map((c) => {
    const on = !!state.historySel[c.id];
    const thumb = c.thumb && c.exists ? `${API_BASE}/api/clips/${c.id}/thumb` : "";
    const uploading = c.upload_state === "uploading";
    const failedUpload = c.upload_state === "error";
    const status = !c.exists
      ? `<span class="status bad"><i></i>missing file</span>`
      : c.uploaded
        ? `<span class="status ok"><i></i>${c.scheduled_at ? "Scheduled" : "YouTube"}</span>`
        : uploading
          ? `<span class="status warn"><i></i>uploading ${Math.round(c.upload_progress || 0)}%</span>`
          : failedUpload
            ? `<span class="status bad"><i></i>upload failed</span>`
            : `<span class="status muted"><i></i>not uploaded</span>`;
    const qaPill = c.qa_status && c.qa_status !== "pending" ? `<span class="pill ${c.qa_status === "pass" ? "ok" : c.qa_status === "failed" ? "bad" : "muted"}">QA ${esc(c.qa_status)}</span>` : "";
    return `<article class="history-card${on ? " selected" : ""}" data-history-card="${c.id}">
      <input type="checkbox" class="history-check" data-history-check="${c.id}"${on ? " checked" : ""} aria-label="Select ${esc(c.title)}">
      <div class="history-thumb" data-hist-play="${c.id}" role="button" tabindex="0" aria-label="Play ${esc(c.title)}">
        ${thumb ? `<img src="${thumb}" alt="" loading="lazy">` : `<div style="display:grid;place-items:center;height:100%;color:var(--faint)">${icon("film")}</div>`}
        ${c.exists ? `<span class="history-play" data-hist-play="${c.id}" aria-hidden="true"><span>${icon("play")}</span></span>` : ""}
      </div>
      <div class="history-body">
        <div class="history-title" title="${esc(c.title)}">${esc(c.title)}</div>
        <div class="history-meta"><span>${timeLabel(c.duration)}</span><span>${timeAgo(c.created_at)}</span><span>${qaPill}</span></div>
        <div class="history-meta"><span>${status}</span><span>job #${c.job_id}</span></div>
        ${c.upload_error ? `<div class="history-meta"><span class="inline-error">${esc(c.upload_error)}</span></div>` : ""}
        <div class="history-actions">
          ${c.exists ? `<button class="btn ghost sm" data-hist-play="${c.id}">${icon("play")}Play</button>` : ""}
          ${c.exists && !c.uploaded && !uploading ? `<button class="btn primary sm" data-hist-upload="${c.id}">${icon("youtube")}Upload with AI</button>` : ""}
          <button class="btn ghost sm" data-hist-job="${c.job_id}">${icon("layers")}Job</button>
          ${c.url ? `<a class="btn ghost sm" href="${esc(c.url)}" target="_blank" rel="noopener">${icon("external")}Watch</a>` : ""}
        </div>
      </div>
    </article>`;
  }).join("");
}

async function openHistoryClip(id) {
  let clip = state.history.find((c) => c.id === id);
  if (!clip) {
    try { clip = await api(`/clips/${id}`); } catch (e) { return toast(e.message, "err"); }
  }
  if (!clip) return;
  const clipPath = clip.path || "";
  showModal({
    title: "Clip details",
    wide: true,
    body: `<div class="history-detail">
      ${clip.exists ? `<video class="clip-video" controls autoplay playsinline src="${API_BASE}/api/clips/${clip.id}/file?v=${Date.now()}"></video>` : `<div class="publish-note">${icon("alert")}<span>This clip's local file is missing. Metadata and path are still available below.</span></div>`}
      <p class="hint">${esc(clip.title)} · ${timeLabel(clip.duration)} · ${clip.uploaded ? "Published to YouTube" : "Saved locally"} · job #${clip.job_id} · QA ${esc(clip.qa_status || "pending")}</p>
      <div class="field">
        <div class="field-head"><label for="historyTitle">AI title</label><button class="btn ghost sm" type="button" data-copy-field="#historyTitle">${icon("copy")}Copy</button></div>
        <input id="historyTitle" type="text" maxlength="100" value="${esc(clip.title || "")}">
        <div id="historyTitleOptions" class="choice-list" style="margin-top:8px"></div>
      </div>
      <div class="field">
        <div class="field-head"><label for="historyDescription">AI description</label><button class="btn ghost sm" type="button" data-copy-field="#historyDescription">${icon("copy")}Copy</button></div>
        <textarea id="historyDescription" rows="6">${esc(clip.description || "")}</textarea>
      </div>
      <div class="field">
        <div class="field-head"><label for="historyTags">AI tags</label><button class="btn ghost sm" type="button" data-copy-field="#historyTags">${icon("copy")}Copy</button></div>
        <input id="historyTags" type="text" value="" placeholder="AI tags appear here">
      </div>
      <div class="field">
        <div class="field-head"><label for="historyPath">Video path</label><button class="btn ghost sm" type="button" data-copy-field="#historyPath"${clipPath ? "" : " disabled"}>${icon("copy")}Copy path</button></div>
        <div class="copy-row"><input id="historyPath" type="text" readonly value="${esc(clipPath)}" placeholder="Path unavailable"></div>
        <p class="hint">Use this path to upload the MP4 yourself if you prefer not to publish from the app.</p>
      </div>
      <p class="hint" id="historyAiStatus">Writing AI title options, description and tags…</p>
      ${clip.url ? `<p class="hint"><a href="${esc(clip.url)}" target="_blank" rel="noopener">Open on YouTube ↗</a></p>` : ""}
    </div>`,
    foot: `${clip.uploaded ? `<button class="btn ghost danger-text" id="btnDeleteYt">${icon("trash")}Remove from YouTube</button>` : `<button class="btn primary" id="btnUploadFromView">${icon("youtube")}Upload with AI</button>`}<a class="btn ghost" href="${API_BASE}/api/clips/${clip.id}/export">${icon("download")}Download MP4</a>`
  });
  if ($("#btnUploadFromView")) $("#btnUploadFromView").onclick = () => { closeModal(); openUploadModal(clip.id); };
  if ($("#btnDeleteYt")) $("#btnDeleteYt").onclick = async () => {
    if (!(await confirmDialog("Remove this Short from YouTube?", "The YouTube video is deleted permanently. Your local MP4 stays here.", "Delete from YouTube", true))) return;
    try {
      await api(`/clips/${clip.id}/youtube`, { method: "DELETE" });
      closeModal(); toast("Removed from YouTube", "warn"); loadHistory();
    } catch (e) { toast(e.message, "err"); }
  };
  try {
    const meta = await api(`/clips/${clip.id}/metadata`);
    const status = $("#historyAiStatus");
    const titleInput = $("#historyTitle");
    const descInput = $("#historyDescription");
    const tagsInput = $("#historyTags");
    const options = $("#historyTitleOptions");
    const titles = Array.isArray(meta.titles) ? meta.titles.filter(Boolean) : [];
    if (titles.length && titleInput && !titleInput.dataset.touched) titleInput.value = titles[0];
    if (options && titles.length) {
      options.innerHTML = titles.map((title) => `<button type="button" class="choice-option" data-history-title="${esc(title)}">${esc(title)}</button>`).join("");
      options.querySelectorAll("[data-history-title]").forEach((btn) => {
        btn.onclick = () => {
          if (!titleInput) return;
          titleInput.value = btn.dataset.historyTitle;
          titleInput.dataset.touched = "1";
          copy(btn.dataset.historyTitle);
        };
      });
    }
    if (meta.description && descInput && !descInput.dataset.touched) descInput.value = meta.description;
    if (tagsInput && Array.isArray(meta.tags)) tagsInput.value = meta.tags.join(", ");
    if (status) status.textContent = meta.source === "fallback" ? "AI was unavailable — using a local title, description and tags. Edit or copy them below." : "AI wrote these title options, description and tags. Choose a title, then copy what you need.";
  } catch (e) {
    const status = $("#historyAiStatus");
    if (status) status.textContent = `Could not write AI metadata: ${e.message}. Edit the fields below and copy manually.`;
  }
  const titleInput = $("#historyTitle");
  const descInput = $("#historyDescription");
  if (titleInput) titleInput.addEventListener("input", () => { titleInput.dataset.touched = "1"; });
  if (descInput) descInput.addEventListener("input", () => { descInput.dataset.touched = "1"; });
}

async function openUploadModal(id) {
  let clip = state.history.find((c) => Number(c.id) === Number(id));
  if (!clip) {
    try { clip = await api(`/clips/${id}`); } catch (e) { return toast(e.message, "err"); }
  }
  if (!clip.exists) return toast("This clip's local file is missing", "warn");
  showModal({
    title: "Publish to YouTube",
    wide: true,
    body: `<div class="upload-modal">
      <div class="publish-note" style="margin-bottom:14px"><span data-icon="wand"></span><span id="aiMetaStatus">Writing title, description and tags with your AI provider…</span></div>
      <div class="row">
        <div class="field"><label for="uploadTitle">Title</label><input id="uploadTitle" type="text" maxlength="100" value="${esc(clip.title || "")}"></div>
        <div class="field"><label for="uploadPrivacy">Privacy</label><select id="uploadPrivacy"><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></div>
      </div>
      <div class="field"><label>AI title options</label><div id="aiTitleOptions" class="choice-list"></div></div>
      <div class="field"><label for="uploadDescription">Description</label><textarea id="uploadDescription">${esc(clip.description || "")}</textarea></div>
      <div class="field"><label for="uploadTags">Tags <span class="hint">comma separated</span></label><input id="uploadTags" type="text" value="shorts, clips"></div>
      <div class="field"><label for="uploadSchedule">Schedule <span class="hint">optional · YouTube publishes it privately then at this time</span></label><input id="uploadSchedule" type="datetime-local"></div>
      ${clip.qa_status === "failed" ? `<label class="switch"><input type="checkbox" id="uploadForce"><span class="sw"></span><span>Force upload despite failed QA</span></label>` : ""}
      <div class="auth-error" id="uploadError" hidden></div>
    </div>`,
    foot: `<button class="btn ghost" data-modal-cancel>Cancel</button><button class="btn primary" id="btnDoUpload"><span data-icon="youtube"></span>Upload Short</button>`
  });
  $("#modalFoot").querySelector("[data-modal-cancel]").onclick = closeModal;
  const privacy = clip.privacy || "private";
  if ($("#uploadPrivacy")) $("#uploadPrivacy").value = ["public", "unlisted", "private"].includes(privacy) ? privacy : "private";
  const status = $("#aiMetaStatus");
  try {
    const meta = await api(`/clips/${id}/metadata`);
    if (status) status.textContent = meta.source === "llm" ? "AI wrote these — edit anything before publishing." : "AI is offline; these are safe defaults. Edit before publishing.";
    if (meta.titles?.[0]) $("#uploadTitle").value = meta.titles[0];
    if (meta.description) $("#uploadDescription").value = meta.description;
    if (meta.tags?.length) $("#uploadTags").value = meta.tags.join(", ");
    const options = $("#aiTitleOptions");
    if (options) options.innerHTML = (meta.titles || []).map((t) => `<button class="choice-option" type="button" data-use-title="${esc(t)}">${esc(t)}</button>`).join("") || `<span class="hint">No AI title options — write your own.</span>`;
    options?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-use-title]");
      if (b) $("#uploadTitle").value = b.dataset.useTitle;
    });
  } catch (e) {
    if (status) status.textContent = "Could not generate metadata: " + e.message;
  }
  $("#btnDoUpload").onclick = async () => {
    const btn = $("#btnDoUpload"), err = $("#uploadError");
    err.hidden = true; btn.disabled = true; btn.classList.add("loading");
    const schedule = $("#uploadSchedule").value;
    const scheduled_at = schedule ? new Date(schedule).getTime() / 1000 : null;
    try {
      await api(`/clips/${id}/upload`, { method: "POST", body: JSON.stringify({
        title: $("#uploadTitle").value.trim(), description: $("#uploadDescription").value,
        privacy: $("#uploadPrivacy").value,
        tags: $("#uploadTags").value.split(",").map((t) => t.trim()).filter(Boolean),
        scheduled_at, force: !!$("#uploadForce")?.checked
      }) });
      closeModal();
      toast("Upload started — this can take a few minutes", "ok", "Publishing");
      loadHistory();
    } catch (e) {
      err.textContent = e.message; err.hidden = false;
      btn.disabled = false; btn.classList.remove("loading");
    }
  };
}

async function openCaptionEditor(id, idx) {
  try {
    const data = await api(`/jobs/${id}/candidates/${idx}/captions`);
    const text = (data.segments || []).map((s) => `${Number(s.start).toFixed(2)}|${Number(s.end).toFixed(2)}|${s.text}`).join("\n");
    showModal({
      title: "Caption editor",
      wide: true,
      body: `<div class="cap-editor"><p class="hint">One line per caption: <code>start|end|text</code> in seconds. Leave a line out to drop it. The renderer burns these exact words.</p><textarea id="captionEditorText" spellcheck="false">${esc(text)}</textarea><div class="auth-error" id="captionError" hidden></div></div>`,
      foot: `<button class="btn ghost" data-modal-cancel>Cancel</button><button class="btn primary" id="btnSaveCaptions"><span data-icon="check"></span>Save captions</button>`
    });
    $("#modalFoot").querySelector("[data-modal-cancel]").onclick = closeModal;
    $("#btnSaveCaptions").onclick = async () => {
      const btn = $("#btnSaveCaptions"), err = $("#captionError");
      const segments = [];
      for (const line of $("#captionEditorText").value.split("\n")) {
        if (!line.trim()) continue;
        const parts = line.split("|");
        if (parts.length < 3) continue;
        const start = Number(parts.shift()), end = Number(parts.shift());
        const caption = parts.join("|").trim();
        if (!Number.isFinite(start) || !Number.isFinite(end) || !caption || end <= start) continue;
        segments.push({ start, end, text: caption });
      }
      if (!segments.length) { err.textContent = "Add at least one valid line (start|end|text)."; err.hidden = false; return; }
      btn.disabled = true; btn.classList.add("loading");
      try {
        await api(`/jobs/${id}/candidates/${idx}/captions`, { method: "PUT", body: JSON.stringify({ segments }) });
        closeModal();
        toast(`${segments.length} caption lines saved`, "ok");
        pollJobs(true);
      } catch (e) { err.textContent = e.message; err.hidden = false; }
      finally { btn.disabled = false; btn.classList.remove("loading"); }
    };
  } catch (e) { toast(e.message, "err"); }
}

async function deleteHistory(all) {
  const selected = Object.keys(state.historySel).filter((id) => state.historySel[id]).map(Number);
  if (!all && !selected.length) return toast("Select at least one clip", "warn");
  const total = all ? state.history.length : selected.length;
  if (!(await confirmDialog(
    all ? "Delete all history?" : `Delete ${total} clip${total === 1 ? "" : "s"}?`,
    "This removes the local MP4 files. Videos already published to YouTube stay online. This cannot be undone.",
    all ? "Delete all" : "Delete selected", true,
  ))) return;
  try {
    const r = await api("/clips/delete", { method: "POST", body: JSON.stringify(all ? { all: true } : { ids: selected }) });
    state.historySel = {};
    toast(`${r.deleted} clip${r.deleted === 1 ? "" : "s"} deleted · ${fmtBytes(r.freed)} freed`, "warn", "History updated");
    await loadHistory();
    if (state.view === "dashboard") loadDashboard();
  } catch (e) { toast(e.message, "err"); }
}

export { loadHistory, filteredHistory, renderHistory, openHistoryClip, openUploadModal, openCaptionEditor, deleteHistory };
