
import {beginPicker,clearGooglePhotosToken} from "./photos-picker.mjs";

export const batchSize = 50;
const limit = 50 * 1024 * 1024;
const fullCrop = {left:0,top:0,width:100,height:100};
const mimeTypes = new Set(["image/jpeg","image/png","image/webp","image/gif","image/avif","image/heic","image/heif"]);
export function selectBatch(items, seen) {
  const unique = new Map();
  for (const item of items) if (!seen.has(item.id) && !unique.has(item.id)) unique.set(item.id,item);
  return [...unique.values()].slice(0,batchSize);
}

export function cropValues(input) {
  const clamp = (value,min,max,fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min,Math.min(max,Math.round(n))) : fallback;
  };
  const left = clamp(input.left,0,99,0);
  const top = clamp(input.top,0,99,0);
  return {left,top,width:clamp(input.width,1,100 - left,100 - left),
    height:clamp(input.height,1,100 - top,100 - top)};
}

function transform(blob,crop,scale) {
  if (scale === 1 && Object.keys(fullCrop).every(key => fullCrop[key] === crop[key])) return Promise.resolve(blob);
  return new Promise((resolve,reject) => {
    const worker = new Worker(new URL("./image-worker.mjs",import.meta.url),{type:"module"});
    const timer = setTimeout(() => finish(reject,Error("Image processing timed out.")),90000);
    function finish(deliver,value) { clearTimeout(timer); worker.terminate(); deliver(value); }
    worker.onmessage = ({data}) => data.error ? finish(reject,Error(data.error)) : finish(resolve,data.blob);
    worker.onerror = () => finish(reject,Error("Image editing is unavailable. You can upload the original."));
    worker.postMessage({blob,crop,scale});
  });
}

export function initImageImports({getUser,getClient,onSaved,googleClientId}) {
  const $ = selector => document.querySelector(selector);
  const grid = $("#import-queue");
  const message = $("#import-message");
  const upload = $("#import-upload");
  const next = $("#import-next");
  const picker = $("#google-picker");
  const album = $("#google-album");
  const google = $("#google-start");
  const local = $("#import-local");
  const defaults = $("#import-upscale");
  const preview = $("#import-preview");
  const cropForm = $("#image-crop");
  const cropImage = $("#crop-image");
  const overlay = $("#crop-outline");
  let sources = [], batch = [], seen = new Set(), checkpoint = "", editing, readyToAdvance = false;
  let queueController = new AbortController(), pickerController = new AbortController();
  let busy = false, choosing = false, preloading = 0;
  const previewQueue = [];
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target);
      const job = batch.find(item => item.card === entry.target);
      if (job) schedulePreview(job);
    }
  },{rootMargin:"280px"});

  function status(text) { message.textContent = text; }
  function actions() {
    upload.disabled = busy || !batch.some(item => item.selected && !item.done);
    const advanced = new Set([...seen,...batch.filter(item => item.done || !item.selected).map(item => item.id)]);
    next.disabled = busy || (!readyToAdvance && batch.some(item => item.selected && !item.done)) || !sources.some(item => !advanced.has(item.id));
    google.disabled = busy || choosing || !googleClientId;
    local.disabled = busy;
  }

  function clearBatch() {
    queueController.abort();
    queueController = new AbortController();
    observer.disconnect();
    previewQueue.length = 0;
    if (preview.open) preview.close();
    editing = undefined;
    cropImage.removeAttribute("src");
    for (const job of batch) if (job.previewUrl) URL.revokeObjectURL(job.previewUrl);
    batch = [];
    grid.replaceChildren();
  }

  function reset() {
    clearGooglePhotosToken();
    pickerController.abort();
    pickerController = new AbortController();
    clearBatch();
    picker.hidden = true;
    sources = []; seen = new Set(); checkpoint = "";
    readyToAdvance = false; busy = false; choosing = false;
    local.value = ""; album.value = ""; defaults.disabled = false;
    status(googleClientId ? "" : "Google Photos can be enabled by your workspace admin. Downloaded files work now.");
    actions();
  }

  function loadCheckpoint(key) {
    try {
      const old = JSON.parse(sessionStorage.getItem(key) || "[]");
      return new Set(Array.isArray(old) ? old : []);
    } catch { return new Set(); }
  }

  function remember() {
    if (checkpoint) try { sessionStorage.setItem(checkpoint, JSON.stringify([...seen])); } catch { /* memory still works */ }
  }

  function showBatch() {
    clearBatch();
    readyToAdvance = false;
    batch = selectBatch(sources,seen).map(item => ({
      ...item, recordId:crypto.randomUUID(),selected:true,
      crop:{...fullCrop},scale:defaults.checked ? 4 : 1
    }));
    for (const job of batch) {
      const card = $("#import-card-template").content.firstElementChild.cloneNode(true);
      job.card = card;
      card.querySelector(".image-name").textContent = job.name;
      card.querySelector(".image-selected").onchange = event => {
        job.selected = event.target.checked;
        actions();
      };
      card.querySelector(".edit-image").onclick = () => edit(job);
      grid.append(card);
      observer.observe(card);
    }
    batch.slice(0,6).forEach(schedulePreview);
    status(batch.length ? batch.length + " images selected for this batch." : "No new photos remain in this selection.");
    actions();
  }

  function schedulePreview(job) {
    if (job.previewJob) return job.previewJob;
    const {signal} = queueController;
    job.previewJob = new Promise((resolve,reject) => {
      previewQueue.push({job,signal,resolve,reject});
    });
    job.previewJob.catch(() => {});
    pump();
    return job.previewJob;
  }

  function pump() {
    while (preloading < 3 && previewQueue.length) {
      const {job,signal,resolve,reject} = previewQueue.shift();
      preloading++;
      Promise.resolve().then(() => job.getBlob(true,signal)).then(blob => {
        signal.throwIfAborted();
        job.previewUrl = URL.createObjectURL(blob);
        const img = job.card.querySelector("img");
        img.src = job.previewUrl;
        img.hidden = false;
        resolve(job.previewUrl);
      }).catch(reject).finally(() => { preloading--; pump(); });
    }
  }

  function updateCrop() {
    const crop = cropValues(Object.fromEntries(new FormData(cropForm)));
    Object.assign(overlay.style,{left:crop.left+"%",top:crop.top+"%",width:crop.width+"%",height:crop.height+"%"});
    return crop;
  }

  async function edit(job) {
    if (job.processing || job.done || job.uploaded) return;
    editing = job;
    cropImage.hidden = true;
    cropImage.removeAttribute("src");
    for (const [name,value] of Object.entries(job.crop)) cropForm.elements[name].value = value;
    cropForm.elements.scale.checked = job.scale === 4;
    updateCrop();
    preview.showModal();
    try {
      const url = await schedulePreview(job);
      if (editing === job && preview.open) { cropImage.src = url; cropImage.hidden = false; }
    } catch { if (editing === job) status("Preview unavailable. Try reselecting the image or using a local copy."); }
  }

  const stage = cropImage.parentElement;
  let start;
  function position(event) {
    const bounds = cropImage.getBoundingClientRect();
    return {x:Math.max(0,Math.min(100,Math.round((event.clientX - bounds.left) * 100 / bounds.width))),
      y:Math.max(0,Math.min(100,Math.round((event.clientY - bounds.top) * 100 / bounds.height)))};
  }
  stage.onpointerdown = event => {
    if (cropImage.hidden || !cropImage.naturalWidth || !event.isPrimary || event.button !== 0) return;
    start = {...position(event),id:event.pointerId};
    stage.setPointerCapture(event.pointerId);
  };
  stage.onpointermove = event => {
    if (start?.id !== event.pointerId) return;
    const end = position(event);
    if (Math.abs(start.x - end.x) < 3 || Math.abs(start.y - end.y) < 3) return;
    const bounds = {left:Math.min(start.x,end.x),top:Math.min(start.y,end.y),
      width:Math.abs(start.x - end.x),height:Math.abs(start.y - end.y)};
    for (const [name,value] of Object.entries(bounds)) cropForm.elements[name].value = value;
    updateCrop();
  };
  stage.onpointerup = stage.onpointercancel = () => { start = undefined; };
  cropForm.oninput = updateCrop;
  cropForm.onsubmit = event => {
    event.preventDefault();
    if (editing) {
      editing.crop = updateCrop();
      editing.scale = cropForm.elements.scale.checked ? 4 : 1;
      editing.card.querySelector(".image-state").textContent = "Edits queued";
    }
    preview.close();
  };
  $("#crop-reset").onclick = () => {
    for (const [name,value] of Object.entries(fullCrop)) cropForm.elements[name].value = value;
    cropForm.elements.scale.checked = false;
    updateCrop();
  };
  $("#crop-cancel").onclick = () => preview.close();
  defaults.onchange = () => {
    for (const item of batch) if (!item.done && !item.uploaded) item.scale = defaults.checked ? 4 : 1;
  };

  local.onchange = () => {
    pickerController.abort();
    picker.hidden = true;
    checkpoint = "";
    seen = new Set();
    sources = [...local.files].filter(file => file.type.startsWith("image/"))
      .map((file,index) => ({id:String(index),name:file.name,getBlob:async () => file}));
    showBatch();
    local.value = "";
  };

  google.onclick = async () => {
    const name = album.value.trim().normalize("NFKC").toLowerCase();
    if (!name) { status("Enter an album label so the app can remember your progress."); album.focus(); return; }
    const account = getUser();
    if (!account) return;
    pickerController.abort();
    const controller = new AbortController();
    pickerController = controller;
    choosing = true; actions();
    try {
      status("Connecting to Google Photos…");
      const session = await beginPicker(googleClientId,controller.signal);
      controller.signal.throwIfAborted();
      picker.href = session.url;
      picker.hidden = false;
      status("Open Google Photos and choose the images to make available for batching.");
      const items = await session.items(status);
      controller.signal.throwIfAborted();
      if (busy) throw Error("Finish the current upload, then choose the Google album again.");
      checkpoint = "archive-photo-session:" + account.id + ":" + name;
      seen = loadCheckpoint(checkpoint);
      sources = items;
      showBatch();
    } catch (error) {
      if (!controller.signal.aborted) status(error.message || "Google Photos could not be loaded. Download the images and choose files instead.");
    } finally {
      if (pickerController === controller) { choosing = false; picker.hidden = true; actions(); }
    }
  };

  next.onclick = () => {
    for (const job of batch) if (!job.selected) seen.add(job.id);
    remember(); showBatch();
  };
  upload.onclick = async () => {
    const account = getUser();
    if (!account || busy) return;
    const {signal} = queueController;
    const client = getClient();
    const bucket = client.storage.from("portfolio-images");
    const work = batch.filter(job => job.selected && !job.done);
    busy = true; actions();
    for (const {card} of batch) card.querySelector("input").disabled = true;
    defaults.disabled = true;
    let done = 0, firstError = "";
    try {
      for (const [index,job] of work.entries()) {
        if (signal.aborted) return;
        if (editing === job && preview.open) {
          await new Promise(resolve => preview.addEventListener("close",resolve,{once:true}));
          if (signal.aborted) return;
        }
        job.processing = true;
        const editor = job.card.querySelector(".edit-image");
        editor.disabled = true;
        const label = job.card.querySelector(".image-state");
        status("Uploading " + (index + 1) + " of " + work.length + "…");
        const path = account.id + "/" + job.recordId;
        try {
          if (!job.uploaded) {
            const original = await job.getBlob(false,signal);
            signal.throwIfAborted();
            const output = await transform(original,job.crop,job.scale);
            signal.throwIfAborted();
            if (!mimeTypes.has(output.type) || output.size > limit) throw Error("Use a supported image under 50 MiB.");
            const stored = await bucket.upload(path,output,{contentType:output.type,upsert:false});
            if (stored.error && String(stored.error.statusCode) !== "409") throw stored.error;
            job.uploaded = true;
          }
          const result = await client.from("portfolio_assets").upsert({
            id:job.recordId,user_id:account.id,title:job.name.slice(0,140),tags:[],storage_path:path
          }).select().single();
          if (result.error) throw result.error;
          signal.throwIfAborted();
          job.done = true; seen.add(job.id); remember(); done++;
          label.textContent = "Uploaded";
          onSaved(result.data);
        } catch (error) {
          if (signal.aborted) return;
          firstError ||= error.message || "Upload failed.";
          label.textContent = "Failed: " + (error.message || "Try again.");
        } finally {
          job.processing = false;
          editor.disabled = job.done || job.uploaded;
        }
      }
      readyToAdvance = batch.every(job => job.done || !job.selected);
      if (readyToAdvance) {
        for (const job of batch) if (!job.selected) seen.add(job.id);
        remember();
      }
      status(done + " uploaded." + (firstError ? " " + firstError + " Failed images can be retried." : ""));
    } finally {
      if (!signal.aborted) {
        busy = false; defaults.disabled = false;
        for (const job of batch) {
          job.card.querySelector("input").disabled = job.done;
          job.card.querySelector(".edit-image").disabled = job.done || job.uploaded;
        }
        actions();
      }
    }
  };

  reset();
  return {reset};
}
