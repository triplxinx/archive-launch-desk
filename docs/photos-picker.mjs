
const root = "https://photospicker.googleapis.com/v1/";
const scope = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
let gis, token;
let accountRevision = 0;

export function clearGooglePhotosToken() { token = undefined; accountRevision++; }

async function library() {
  if (window.google?.accounts?.oauth2) return window.google.accounts.oauth2;
  if (!gis) gis = new Promise((resolve,reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = () => window.google?.accounts?.oauth2
      ? resolve(window.google.accounts.oauth2) : reject(Error("Google sign-in could not be initialized."));
    script.onerror = () => reject(Error("Could not load Google sign-in."));
    document.head.append(script);
  }).catch(error => { gis = undefined; throw error; });
  return gis;
}

export async function beginPicker(clientId, signal) {
  const revision = accountRevision;
  let auth = token?.clientId === clientId && token.expires > Date.now() + 60000 ? token.value : "";
  if (!auth) {
    const google = await library();
    signal.throwIfAborted();
    const granted = await new Promise((resolve,reject) => {
      const client = google.initTokenClient({
        client_id:clientId,scope,
        callback:result => result.access_token && google.hasGrantedAllScopes(result,scope)
          ? resolve(result) : reject(Error(result.error || "Google Photos permission was not granted.")),
        error_callback:() => reject(Error("Google sign-in closed or was blocked. Try again."))
      });
      client.requestAccessToken({prompt:""});
    });
    signal.throwIfAborted();
    if (revision !== accountRevision) throw Error("The workspace changed. Connect Google Photos again.");
    auth = granted.access_token;
    token = {clientId,value:auth,expires:Date.now() + 1000 * (Number(granted.expires_in) || 0)};
  }
  async function fetchPicker(path, method = "GET") {
    const response = await fetch(root + path,{
      method,signal,headers:{Authorization:"Bearer " + auth,...(method === "POST" ? {"Content-Type":"application/json"} : {})},
      body:method === "POST" ? "{}" : undefined
    });
    if (response.status === 401 && token?.value === auth) token = undefined;
    if (!response.ok) throw Error("Google Photos request failed (" + response.status + "). Try selecting again.");
    return response.json();
  }
  const session = await fetchPicker("sessions","POST");
  const picker = new URL(session.pickerUri);
  if (picker.protocol !== "https:" || picker.hostname !== "photos.google.com") throw Error("Google returned an unexpected picker URL.");
  picker.pathname = picker.pathname.replace(/\/$/,"") + "/autoclose";
  const id = encodeURIComponent(session.id);

  return {
    url:picker.href,
    async items(setStatus) {
      let state = session;
      const expires = Date.parse(session.expireTime) || Date.now() + 20 * 60000;
      while (!state.mediaItemsSet) {
        if (Date.now() >= expires) throw Error("The Google Photos selection expired. Start a new selection.");
        await pause(Math.max(1000,1000 * (parseFloat(state.pollingConfig?.pollInterval) || 5)),signal);
        state = await fetchPicker("sessions/" + id);
      }
      setStatus("Reading the images you selected…");
      const items = [];
      let pageToken = "";
      do {
        const query = new URLSearchParams({sessionId:session.id,pageSize:"100"});
        if (pageToken) query.set("pageToken",pageToken);
        const page = await fetchPicker("mediaItems?" + query);
        for (const item of page.mediaItems ?? []) {
          if (item.type !== "PHOTO" || !item.mediaFile?.baseUrl || !item.id) continue;
          const file = item.mediaFile;
          const base = new URL(file.baseUrl);
          if (base.protocol !== "https:" || !base.hostname.endsWith(".googleusercontent.com")) continue;
          items.push({
            id:item.id,name:file.filename || "Google photo",
            async getBlob(thumbnail, requestSignal) {
              const response = await fetch(base.href + (thumbnail ? "=w480-h480" : "=d"),{
                signal:requestSignal,headers:{Authorization:"Bearer " + auth}
              });
              if (response.status === 401 && token?.value === auth) token = undefined;
              if (!response.ok) throw Error("Google photo expired or could not be downloaded. Select it again or import a downloaded copy.");
              return response.blob();
            }
          });
        }
        pageToken = page.nextPageToken || "";
      } while (pageToken);
      return items;
    }
  };
}

function pause(ms, signal) {
  return new Promise((resolve,reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(() => {
      signal.removeEventListener("abort",cancel);
      resolve();
    },ms);
    function cancel() { clearTimeout(timer); reject(signal.reason); }
    signal.addEventListener("abort",cancel,{once:true});
  });
}
