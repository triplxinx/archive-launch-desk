# Archive Launch Desk

A standalone, mobile-friendly lead desk for photographers and visual freelancers. The dashboard and scout run independently of ChatGPT.

## Included

- Email sign-in, private portfolio references, tagged matches, three editable pitch drafts per opportunity, lead status, and JSON workspace export.
- Supabase migration with row-level access policies for drafts and portfolio records. The shared lead table contains only public job metadata.
- A Node.js scout for Greenhouse, Lever, and Ashby. Four initial employer boards are in [boards.json](scout/boards.json). The [73-source catalog](scout/source-catalog.json) is a research registry for additional connectors.
- Scheduled refresh using GitHub Actions, with a manual run option. A successful board refresh archives listings the board no longer returns. A failed fetch leaves that board’s previous records intact.
- Template-based drafting without an AI API or an outreach integration.

## Deploy

1. Create a Supabase project that you control. In its SQL Editor, run [001_archive.sql](supabase/migrations/001_archive.sql), then [002_pitch_projects.sql](supabase/migrations/002_pitch_projects.sql). Then apply [003_private_portfolio_images.sql](supabase/migrations/003_private_portfolio_images.sql). For an existing project, apply only migrations you have not run.
2. In GitHub for this repository, open **Settings → Pages**. Select **Deploy from a branch**, **main**, and **/docs**, then save. The expected project URL is https://triplxinx.github.io/archive-launch-desk/.
3. In Supabase **Authentication → URL Configuration**, set the Site URL and allowed redirect URL to the published site, including its trailing slash. For beta users outside the project team, configure a custom SMTP provider and verify mail delivery before inviting them. See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
4. Edit [docs/config.js](docs/config.js) with the project URL and the **publishable** key. These two client values are intended to be visible in the browser. Keep the service-role key out of this file and all tracked files.
5. Under GitHub **Settings → Secrets and variables → Actions**, set the repository variable **SUPABASE_URL** and repository secret **SUPABASE_SERVICE_ROLE_KEY**. Use the project’s legacy service_role JWT for the provided worker. Run **Actions → Scout employer boards → Run workflow** and check the per-source counts.
6. Sign in with two separate test accounts. Confirm each can save a sample and a draft, each sees only its own data, sign-out clears the workspace view, and workspace export includes only the signed-in customer’s records.

The cron is preset to 16:17 UTC. The sync step skips if the repository has no SUPABASE_URL variable. Public-repository schedules can pause after 60 days of inactivity. For a production deployment, use a dedicated scheduled worker or private workflow and alert on missed runs.

## Pitch projects

Open any lead's pitch editor to start with a draft based on the lead and matching portfolio tags. Add an optional quote. Swipe down on the **Archive pitch and quote** strip, or tap it, to save version 1 and create the lead project. After a project exists, **Generate new pitch** archives a new version and carries forward the editable quote. Generation uses templates and leaves prices for you to enter.

The **Projects** tab links back to each exact archived version. Use **Download** for a Markdown copy. Editing a reopened version and saving updates the working draft. Archiving saves a separate version. Archived snapshots are included in workspace exports and stay behind the workspace's sign-in.

## Run the scout on your own machine

Use Node.js 22+ and a supported shell. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your process environment using a secret manager or private local configuration. Run:

```sh
node --test scout/scout.test.mjs
node scout/scout.mjs
```

Use employer public boards only where the intended collection and product use are permitted. The worker stores links and minimal metadata. Review source terms before enabling a board for a paid product. Do not add private candidate data, portfolio files, or secrets to the public repository.

## Beta scope

The portfolio stores private images, links, names and tags. Wider source connectors, billing, native Android sync, and workspace backup import are future work. The app shows a setup panel until Supabase is configured. Confirm the live database policies and background run before opening the beta.

## Portfolio image imports

Use **Import images** to select local files, optionally crop or upscale, then upload. The first 50 are selected automatically. After the batch is complete, **Select next 50** advances the queue. Preview loading and uploads continue while you switch dashboard tabs. Keep the dashboard open until uploads finish.

The **Crop / upscale** dialog supports dragging on the preview or entering percentage bounds. Without edits it uploads the original. The optional 4× mode resizes both dimensions with browser resampling, so it does not generate new detail. Outputs above the browser's 40-megapixel edit budget are rejected. Crop tighter or switch off upscale. The storage bucket is private, with up to 50 MiB per image subject to your project's storage limit.

For Google Photos, enable the Photos Picker API in your Google project, create a web OAuth client, add your Pages site's origin as an authorized JavaScript origin, and set its public client ID as **googlePhotosClientId** in **docs/config.js**. Configure the OAuth consent screen and test users as needed. Open the picker, choose the album photos you authorize, then return to the dashboard. Enter the same album label when you reselect it in the same dashboard tab; progress is remembered for files Google returns with the same IDs. If Picker access is unavailable, download the photos and select those files locally. Tokens stay in memory, and uploaded images remain private to your workspace.

## Optional on-device pitch plans

Open **Local AI settings** and enable it for the session. In a lead's editor, open **Local AI asset and deliverable plans** and optionally paste criteria from the brief. The first generation downloads a small Qwen model, then runs inference on your device through WebGPU. No hosted inference account, API key, or app-imposed request quota is needed. Browser compatibility, storage and device memory determine whether the model can run.

Use **Portfolio → Pitch metadata** to tag samples and approve their titles and tags for suggestions. The model receives only the lead fields, optional criteria, and the titles and tags of up to eight approved samples ranked by overlap. It does not receive photo bytes, album or storage URLs, or EXIF. Review asset and deliverable suggestions before using a plan. Applying a plan keeps your existing quote and archives a new version if the lead already has a project. The regular template generator stays available.
