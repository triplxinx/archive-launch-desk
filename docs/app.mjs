import { initImageImports } from "./image-imports.mjs";

import { config } from "./config.js";

const $ = selector => document.querySelector(selector);
const tags = value => new Set((value ?? []).flatMap(tag => tag.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
const [setup, auth, workspace, notice] = ["#setup", "#auth", "#workspace", "#notice"].map($);
let api, user, leads = [], assets = [], drafts = new Map();
let versions = [];
let revision = 0;
const previews = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    const img = entry.target;
    previews.unobserve(img);
    const current = revision;
    api.storage.from("portfolio-images").createSignedUrl(img.dataset.path,900).then(({data,error}) => {
      if (!error && current === revision && img.isConnected) img.src = data.signedUrl;
    }).catch(() => {});
  }
},{rootMargin:"240px"});
const imageImports = initImageImports({
  getUser:() => user,getClient:() => api,googleClientId:config.googlePhotosClientId,
  onSaved:asset => {
    assets = [asset,...assets.filter(item => item.id !== asset.id)];
  }
});
const draftFields = ["status","portfolio","scope","followup","quote"];

function notify(message, error = false) {
  notice.textContent = message;
  notice.hidden = !message;
  notice.dataset.error = String(error);
}

function safeLink(input) {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function matches(lead) {
  const wanted = tags(lead.tags);
  return assets.map(asset => ({
    asset,
    score: [...tags(asset.tags)].filter(tag => wanted.has(tag)).length
  })).filter(match => match.score).sort((a, b) => b.score - a.score);
}

function starter(lead) {
  const sample = matches(lead).find(match => match.asset.draft_allowed)?.asset.title;
  const hello = "Hi " + lead.company + ", ";
  return {
    status: "drafting",
    quote: "",
    portfolio: hello + "I’m interested in " + lead.title + "." +
      (sample ? " A relevant portfolio sample is " + sample + "." : "") +
      " Could you share the deliverables, timeline, and intended usage?",
    scope: hello + "Are you still reviewing candidates for " + lead.title +
      "? If you share the first deliverable and deadline, I can put together a scope and quote.",
    followup: hello + "I’m following up on " + lead.title +
      ". I’d be happy to send a scoped proposal if you’re still reviewing."
  };
}

function nextPitch(lead, current, nextVersion) {
  const generated = {...starter(lead), status:current.status, quote:current.quote};
  if (nextVersion % 2 === 0) {
    const sample = matches(lead).find(match => match.asset.draft_allowed)?.asset.title;
    generated.portfolio = "Hi " + lead.company + ", I’m reaching out about " + lead.title + "." +
      (sample ? " I can share " + sample + " as a starting point." : "") +
      " What would you want to see in a first delivery, and when would you need it?";
    generated.scope = "Hi " + lead.company + ", if " + lead.title + " is still open, I can quote a small first " +
      "milestone. Could you share the intended usage, deliverable format, and review process?";
  }
  return generated;
}

function bindForm(form, run) {
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try { await run(new FormData(form)); }
    catch (error) { notify(error.message || "That request could not be completed.", true); }
    finally { submit.disabled = false; }
  });
}

function selectTab(id) {
  for (const tab of document.querySelectorAll("[data-tab]")) {
    const selected = tab.dataset.tab === id;
    tab.setAttribute("aria-pressed",String(selected));
    $("#" + tab.dataset.tab).hidden = !selected;
  }
  if (id === "portfolio") renderAssets();
}

function filename(version) {
  const title = version.lead_name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").trim().slice(0,120) || "lead";
  return title + "_pitch-v" + version.version + ".md";
}

function download(name, content, type) {
  const objectUrl = URL.createObjectURL(new Blob([content],{type}));
  const link = document.createElement("a");
  link.href = objectUrl; link.download = name;
  link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl),1000);
}

function renderProjects() {
  const list = $("#project-list");
  list.replaceChildren();
  const byLead = new Map();
  for (const version of versions) {
    if (!byLead.has(version.lead_id)) byLead.set(version.lead_id, []);
    byLead.get(version.lead_id).push(version);
  }
  for (const history of byLead.values()) {
    const card = document.createElement("article");
    card.className = "card";
    const title = document.createElement("h3");
    title.textContent = history[0].lead_name;
    const links = document.createElement("ul");
    links.className = "project-links";
    for (const version of history.sort((a,b) => b.version - a.version)) {
      const entry = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#" + new URLSearchParams({lead:version.lead_id,pitch:version.version});
      link.textContent = filename(version);
      link.onclick = event => {
        if (location.hash !== link.hash || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openPitchLink();
      };
      const save = document.createElement("button");
      save.type = "button";
      save.textContent = "Download";
      save.onclick = () => download(filename(version), [
        "# " + version.lead_name, "## Portfolio pitch\n\n" + version.portfolio,
        "## Scope pitch\n\n" + version.scope, "## Follow-up\n\n" + version.followup,
        "## Quote\n\n" + (version.quote || "Quote pending")
      ].join("\n\n") + "\n", "text/markdown;charset=utf-8");
      entry.append(link, save); links.append(entry);
    }
    card.append(title, links); list.append(card);
  }
  if (!byLead.size) list.textContent = "Archive a pitch to start a lead project.";
}

function openPitchLink() {
  if (!user || !location.hash.startsWith("#lead=")) return;
  const params = new URLSearchParams(location.hash.slice(1));
  const snapshot = versions.find(version =>
    version.lead_id === params.get("lead") && String(version.version) === params.get("pitch"));
  if (!snapshot) return notify("This pitch version is unavailable in your workspace.", true);
  selectTab("leads");
  renderLeads(snapshot);
  $("#pitch-" + snapshot.lead_id)?.focus();
}

function bindArchiveSwipe(button, archive) {
  let start, suppressClickUntil = 0;
  button.onpointerdown = event => {
    if (event.pointerType !== "touch" || !event.isPrimary) return;
    start = {id:event.pointerId, x:event.clientX, y:event.clientY};
    button.setPointerCapture(event.pointerId);
  };
  button.onpointercancel = () => { start = undefined; };
  button.onpointerup = event => {
    if (start?.id !== event.pointerId) return;
    const down = event.clientY - start.y;
    const across = Math.abs(event.clientX - start.x);
    start = undefined;
    if (Math.max(Math.abs(down),across) < 15) return;
    suppressClickUntil = performance.now() + 450;
    if (down >= 48 && down >= across * 1.5) archive();
  };
  button.onclick = event => {
    if (event.detail === 0 || performance.now() >= suppressClickUntil) archive();
  };
}

function renderLeads(snapshot) {
  const filter = $("#filter").value;
  const ranked = leads.map(lead => ({lead, matches: matches(lead)}))
    .filter(({lead}) => lead.id === snapshot?.lead_id || (filter === "saved"
      ? drafts.has(lead.id) : lead.active && (filter !== "paid" || Boolean(lead.posted_pay))))
    .sort((a, b) => Number(Boolean(b.lead.posted_pay)) - Number(Boolean(a.lead.posted_pay)) ||
      (b.matches[0]?.score ?? 0) - (a.matches[0]?.score ?? 0));
  const list = $("#lead-list");
  list.replaceChildren();
  $("#lead-count").textContent = ranked.length ? ranked.length + " listings" : "No listings in this view.";
  for (const {lead, matches: suggestions} of ranked) {
    const href = safeLink(lead.url);
    if (!href) continue;
    const node = $("#lead-template").content.cloneNode(true);
    const inCard = selector => node.querySelector(selector);
    inCard("h3").textContent = lead.title;
    inCard(".source").textContent = lead.source + (lead.active ? "" : " · Listing inactive");
    inCard(".payment").textContent = lead.posted_pay || "Pay unlisted";
    inCard(".company").textContent = [lead.company, lead.location, "Checked " + lead.checked_on].filter(Boolean).join(" · ");
    inCard(".matches").textContent = suggestions.length
      ? "Portfolio fit: " + suggestions.slice(0, 3).map(x => x.asset.title).join(", ")
      : "Add a tagged sample to look for a portfolio match.";
    inCard(".apply").href = href;
    const form = inCard(".pitch");
    const edit = inCard(".edit");
    const archived = snapshot?.lead_id === lead.id ? snapshot : null;
    const regenerate = inCard(".regenerate");
    const archiveButton = inCard(".archive");
    const versionLabel = inCard(".pitch-version");
    let busy = false, request;
    function fill(draft) {
      for (const field of draftFields) form.elements.namedItem(field).value = draft[field] ?? "";
      versionLabel.textContent = draft.version ? filename(draft) : "Working draft";
    }
    form.id = "pitch-" + lead.id;
    form.tabIndex = -1;
    fill(archived ?? drafts.get(lead.id) ?? starter(lead));
    if (archived) { form.hidden = false; edit.textContent = "Hide pitch"; }
    edit.addEventListener("click", () => {
      form.hidden = !form.hidden;
      edit.textContent = form.hidden ? "Open pitch" : "Hide pitch";
      if (!form.hidden) form.elements.portfolio.focus();
    });
    async function write(draft, archive) {
      if (busy || !user) return;
      busy = true;
      const current = revision;
      const controls = [...form.querySelectorAll("button, select, textarea")];
      controls.forEach(control => { control.disabled = true; });
      try {
        if (archive) {
          const payload = JSON.stringify(draft);
          if (request?.payload !== payload) request = {payload,id:crypto.randomUUID()};
          const {data,error} = await api.rpc("archive_pitch",{
            p_lead_id:lead.id,p_request_id:request.id,p_draft:draft
          }).single();
          if (error) throw error;
          request = undefined;
          if (current !== revision) return;
          versions = [data,...versions.filter(item => item.lead_id !== data.lead_id || item.version !== data.version)];
          drafts.set(lead.id, data);
          fill(data); renderProjects(); notify("Archived " + filename(data));
        } else {
          const {error} = await api.from("lead_work").upsert({...draft,user_id:user.id,lead_id:lead.id});
          if (error) throw error;
          if (current !== revision) return;
          drafts.set(lead.id,draft); fill(draft); notify("Working draft saved.");
        }
      } catch (error) {
        if (current === revision) notify(error.message || "Couldn’t save the pitch. Try again when connected.", true);
      } finally {
        busy = false;
        controls.forEach(control => { control.disabled = false; });
      }
    }
    const readDraft = () => Object.fromEntries(new FormData(form));
    form.onsubmit = event => { event.preventDefault(); write(readDraft(), false); };
    bindArchiveSwipe(archiveButton, () => write(readDraft(), true));
    regenerate.onclick = () => {
      const current = readDraft();
      const prior = versions.find(version => version.lead_id === lead.id);
      const generated = nextPitch(lead,current,(prior?.version ?? 1) + 1);
      if (prior) {
        write(generated, true);
      } else {
        fill(generated);
        notify("New draft ready. Archive it to start a lead project.");
      }
    };
    list.append(node);
  }
}

function renderAssets() {
  const list = $("#asset-list");
  previews.disconnect();
  list.replaceChildren();
  for (const asset of assets) {
    const card = document.createElement("article");
    card.className = "card";
    const title = document.createElement("h3");
    title.textContent = asset.title;
    const detail = document.createElement("p");
    detail.textContent = (asset.tags ?? []).join(", ") || "No tags";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove sample";
    remove.onclick = async () => {
      remove.disabled = true;
      if (asset.storage_path) {
        const removed = await api.storage.from("portfolio-images").remove([asset.storage_path]);
        if (removed.error) { notify(removed.error.message,true); remove.disabled = false; return; }
      }
      const {error} = await api.from("portfolio_assets").delete().eq("id", asset.id);
      if (error) { notify(error.message, true); remove.disabled = false; return; }
      assets = assets.filter(item => item.id !== asset.id);
      renderAssets(); renderLeads();
    };
    if (asset.storage_path) {
      const image = document.createElement("img");
      image.alt = asset.title;
      image.className = "portfolio-preview";
      image.loading = "lazy"; image.decoding = "async";
      image.dataset.path = asset.storage_path;
      card.append(image); previews.observe(image);
    }
    card.append(title, detail);
    if (safeLink(asset.url)) {
      const link = document.createElement("a");
      link.href = safeLink(asset.url);
      link.rel = "noopener noreferrer";
      link.target = "_blank";
      link.textContent = "Open sample";
      const actions = document.createElement("div");
      actions.className = "buttons";
      actions.append(link, remove);
      card.append(actions);
    } else card.append(remove);
    list.append(card);
  }
}

async function readVersions(columns = "*") {
  const rows = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const {data,error} = await api.from("pitch_versions").select(columns)
      .order("lead_id").order("version",{ascending:false}).range(offset,offset + pageSize - 1);
    if (error) return {error};
    rows.push(...data);
    if (data.length < pageSize) return {data:rows};
  }
}

async function loadWorkspace(session) {
  const current = ++revision;
  imageImports.reset(); previews.disconnect();
  user = session?.user ?? null;
  auth.hidden = Boolean(user);
  workspace.hidden = true;
  $("#logout").hidden = !user;
  leads = []; assets = []; drafts = new Map();
  versions = [];
  $("#lead-list").replaceChildren();
  $("#asset-list").replaceChildren();
  $("#project-list").replaceChildren();
  if (!user) return;
  const results = await Promise.all([
    api.from("scouted_leads").select().eq("active",true).order("checked_on",{ascending:false}).limit(150),
    api.from("portfolio_assets").select().order("created_at",{ascending:false}),
    api.from("lead_work").select("*,scouted_leads(*)"),
    readVersions("*,scouted_leads(*)")
  ]);
  if (current !== revision) return;
  const failed = results.find(result => result.error);
  if (failed) return notify(failed.error.message, true);
  const [dbLeads, dbAssets, dbDrafts, dbVersions] = results.map(result => result.data ?? []);
  versions = dbVersions;
  const associated = [...dbDrafts,...versions].map(item => item.scouted_leads).filter(Boolean);
  leads = [...new Map([...associated,...dbLeads].map(lead => [lead.id,lead])).values()]; assets = dbAssets;
  drafts = new Map(dbDrafts.map(draft => [draft.lead_id, draft]));
  workspace.hidden = false;
  renderLeads(); renderAssets(); renderProjects(); openPitchLink();
}

bindForm($("#sign-in"), async fields => {
  const redirect = new URL("./", location.href);
  const {error} = await api.auth.signInWithOtp({email:fields.get("email").trim(),
    options:{emailRedirectTo:redirect.href}});
  if (error) throw error;
  notify("Check your email for a sign-in link.");
});
bindForm($("#add-asset"), async fields => {
  const rawUrl = fields.get("url").trim();
  const url = rawUrl ? safeLink(rawUrl) : null;
  const title = fields.get("title").trim();
  if (!title || (rawUrl && !url)) throw new Error("Add a sample name and, if provided, a valid HTTPS link.");
  const {data,error} = await api.from("portfolio_assets").insert({
    user_id:user.id,title,url,
    tags:[...new Set(fields.get("tags").split(",").map(tag => tag.trim().toLowerCase()).filter(Boolean))].slice(0,20),
    draft_allowed:fields.get("approved") === "on"
  }).select().single();
  if (error) throw error;
  assets.unshift(data); $("#add-asset").reset();
  renderAssets(); renderLeads(); notify("Portfolio sample added.");
});
$("#filter").onchange = () => renderLeads();
window.addEventListener("hashchange",openPitchLink);
for (const button of document.querySelectorAll("[data-tab]")) {
  button.onclick = () => selectTab(button.dataset.tab);
}
$("#logout").onclick = async () => {
  const {error} = await api.auth.signOut();
  notify(error?.message ?? "", Boolean(error));
};
$("#export").onclick = async () => {
  const results = await Promise.all([api.from("portfolio_assets").select(),
    api.from("lead_work").select("*,scouted_leads(title,company,url)"),readVersions()]);
  const failure = results.find(result => result.error);
  if (failure) return notify(failure.error.message,true);
  download("archive-launch-desk-export.json",JSON.stringify({
    exported_at:new Date().toISOString(),
    portfolio:results[0].data,drafts:results[1].data,pitch_versions:results[2].data
  },null,2),"application/json");
};

async function start() {
  if (!config.supabaseUrl || !config.supabasePublishableKey) { setup.hidden = false; return; }
  const {createClient} = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/+esm");
  api = createClient(config.supabaseUrl,config.supabasePublishableKey);
  api.auth.onAuthStateChange((event,session) => {
    if (["INITIAL_SESSION","SIGNED_IN","SIGNED_OUT"].includes(event)) {
      if (event === "SIGNED_IN" && user?.id === session?.user?.id) return;
      setTimeout(() => loadWorkspace(session).catch(error => notify(error.message,true)),0);
    }
  });
}
start().catch(error => notify(error.message,true));
