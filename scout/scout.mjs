
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const providers = {
  greenhouse: slug => "https://boards-api.greenhouse.io/v1/boards/" + slug + "/jobs?content=true",
  ashby: slug => "https://api.ashbyhq.com/posting-api/job-board/" + slug + "?includeCompensation=true",
  lever: slug => "https://api.lever.co/v0/postings/" + slug + "?mode=json"
};
const signal = /\b(photo(?:graph(?:y|ic|er)?|shopping|s)?|retouch(?:er|ing)?|image (?:research|licens|sourc|curat|edit)|picture (?:editor|research)|digital asset|visual (?:editor|qa|research)|image evaluation|brand evaluat(?:or|ion)|metadata|rights and clearances)\b/i;
const keywords = {
  retouching: /retouch|image edit|photoshop/i,
  licensing: /licens|rights and clearances/i,
  archive: /archive|metadata|digital asset/i,
  editorial: /editorial|newsroom|image research|picture editor/i,
  photography: /photo|image|picture/i,
  design: /design|creative|brand/i
};

function knownUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function normalize(board, payload) {
  const entries = board.provider === "lever" ? payload : payload?.jobs;
  if (!Array.isArray(entries)) throw new Error("Unexpected job feed format");
  const result = new Map();
  for (const item of entries) {
    if (!item || item.isListed === false) continue;
    const title = item.title ?? item.text;
    const location = item.location?.name ?? item.location ?? item.categories?.location ?? "";
    const workplace = item.workplaceType ?? "";
    const remotely = item.isRemote === true || /^remote$/i.test(workplace) ||
      (!/^hybrid|on.?site/i.test(workplace) && typeof location === "string" && /\bremote\b/i.test(location) &&
        !/\b(?:hybrid|non.remote|no remote|on.?site)\b/i.test(location));
    const details = String(item.descriptionPlain ?? item.description ?? item.content ?? "").slice(0,20000);
    const url = knownUrl(item.absolute_url ?? item.jobUrl ?? item.hostedUrl);
    const id = item.id == null && url && board.provider === "ashby" ? url : item.id;
    if (!id || !url || typeof title !== "string" || !title.trim() || !remotely || !signal.test(title)) continue;
    const salary = item.compensation?.compensationTierSummary ?? item.salaryDescription;
    result.set(String(id),{
      external_id:String(id),title:title.trim().slice(0,300),company:board.company.trim().slice(0,150),url,
      posted_pay:typeof salary === "string" ? salary.replace(/<[^>]*>/g," ").trim().slice(0,300) || null : null,
      location:String(location || "Remote").slice(0,250),
      tags:Object.entries(keywords).filter(([,pattern]) => pattern.test(title + " " + details)).map(([tag]) => tag)
    });
  }
  return [...result.values()];
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url,{...options,signal:AbortSignal.timeout(20000),redirect:"error"});
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

async function main() {
  const boards = JSON.parse(await readFile(new URL("./boards.json",import.meta.url),"utf8"));
  if (!Array.isArray(boards) || !boards.length) throw new Error("Configure approved employer boards in scout/boards.json.");
  const url = new URL(process.env.SUPABASE_URL ?? "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url.protocol !== "https:" || url.username || url.password || !key) throw new Error("Configure the Supabase URL and service-role secret.");
  let failures = 0;
  for (const board of boards) {
    const provider = Object.hasOwn(providers,board.provider) ? providers[board.provider] : null;
    if (!provider || !/^[\w-]+$/.test(board.slug) || typeof board.company !== "string" || !board.company.trim()) {
      failures++; console.error("Skipped invalid board configuration."); continue;
    }
    const source = board.provider + ":" + board.slug;
    try {
      const leads = normalize(board,await fetchJson(provider(board.slug)));
      await fetchJson(new URL("/rest/v1/rpc/sync_source_leads",url),{
        method:"POST",
        headers:{apikey:key,authorization:"Bearer " + key,"content-type":"application/json"},
        body:JSON.stringify({p_source:source,p_rows:leads})
      });
      console.log(source + " refreshed (" + leads.length + " matches)");
    } catch (error) {
      failures++; console.error(source + " failed: " + error.message);
    }
  }
  if (failures) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
