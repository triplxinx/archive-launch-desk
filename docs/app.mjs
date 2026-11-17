
import { config } from "./config.js";

const $ = selector => document.querySelector(selector);
const tags = value => new Set((value ?? []).flatMap(tag => tag.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
const [setup, auth, workspace, notice] = ["#setup", "#auth", "#workspace", "#notice"].map($);
let api, user, leads = [], assets = [], drafts = new Map();
let revision = 0;

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
    portfolio: hello + "I’m interested in " + lead.title + "." +
      (sample ? " A relevant portfolio sample is " + sample + "." : "") +
      " Could you share the deliverables, timeline, and intended usage?",
    scope: hello + "Are you still reviewing candidates for " + lead.title +
      "? If you share the first deliverable and deadline, I can put together a scope and quote.",
    followup: hello + "I’m following up on " + lead.title +
      ". I’d be happy to send a scoped proposal if you’re still reviewing."
  };
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

function renderLeads() {
  const filter = $("#filter").value;
  const ranked = leads.map(lead => ({lead, matches: matches(lead)}))
    .filter(({lead}) => filter === "saved" ? drafts.has(lead.id) : lead.active && (filter !== "paid" || Boolean(lead.posted_pay)))
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
    const draft = drafts.get(lead.id) ?? starter(lead);
    for (const field of ["status","portfolio","scope","followup"]) form.elements.namedItem(field).value = draft[field];
    edit.addEventListener("click", () => {
      form.hidden = !form.hidden;
      edit.textContent = form.hidden ? "Open pitch" : "Hide pitch";
      if (!form.hidden) form.elements.portfolio.focus();
    });
    bindForm(form, async fields => {
      const patch = Object.fromEntries(fields);
      const {error} = await api.from("lead_work").upsert({...patch, user_id:user.id, lead_id:lead.id});
      if (error) throw error;
      drafts.set(lead.id, patch);
      notify("Drafts and status saved.");
    });
    list.append(node);
  }
}

function renderAssets() {
  const list = $("#asset-list");
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
      const {error} = await api.from("portfolio_assets").delete().eq("id", asset.id);
      if (error) { notify(error.message, true); remove.disabled = false; return; }
      assets = assets.filter(item => item.id !== asset.id);
      renderAssets(); renderLeads();
    };
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

async function loadWorkspace(session) {
  const current = ++revision;
  user = session?.user ?? null;
  auth.hidden = Boolean(user);
  workspace.hidden = true;
  $("#logout").hidden = !user;
  leads = []; assets = []; drafts = new Map();
  $("#lead-list").replaceChildren();
  $("#asset-list").replaceChildren();
  if (!user) return;
  const results = await Promise.all([
    api.from("scouted_leads").select().eq("active",true).order("checked_on",{ascending:false}).limit(150),
    api.from("portfolio_assets").select().order("created_at",{ascending:false}),
    api.from("lead_work").select("*,scouted_leads(*)")
  ]);
  if (current !== revision) return;
  const failed = results.find(result => result.error);
  if (failed) return notify(failed.error.message, true);
  const [dbLeads, dbAssets, dbDrafts] = results.map(result => result.data ?? []);
  leads = [...new Map([...dbDrafts.map(d => d.scouted_leads).filter(Boolean), ...dbLeads].map(lead => [lead.id, lead])).values()]; assets = dbAssets;
  drafts = new Map(dbDrafts.map(draft => [draft.lead_id, draft]));
  workspace.hidden = false;
  renderLeads(); renderAssets();
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
$("#filter").onchange = renderLeads;
for (const button of document.querySelectorAll("[data-tab]")) {
  button.onclick = () => {
    for (const tab of document.querySelectorAll("[data-tab]")) {
      const selected = tab === button;
      tab.setAttribute("aria-pressed",String(selected));
      $("#" + tab.dataset.tab).hidden = !selected;
    }
  };
}
$("#logout").onclick = async () => {
  const {error} = await api.auth.signOut();
  notify(error?.message ?? "", Boolean(error));
};
$("#export").onclick = async () => {
  const results = await Promise.all([api.from("portfolio_assets").select(),api.from("lead_work").select("*,scouted_leads(title,company,url)")]);
  const failure = results.find(result => result.error);
  if (failure) return notify(failure.error.message,true);
  const objectUrl = URL.createObjectURL(new Blob([JSON.stringify({
    exported_at:new Date().toISOString(),
    portfolio:results[0].data,drafts:results[1].data
  },null,2)],{type:"application/json"}));
  const link = document.createElement("a");
  link.href = objectUrl; link.download = "archive-launch-desk-export.json";
  link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl),1000);
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
