# Archive Launch Desk

A standalone, mobile-friendly lead desk for photographers and visual freelancers. The dashboard and scout run independently of ChatGPT.

## Included

- Email sign-in, private portfolio references, tagged matches, three editable pitch drafts per opportunity, lead status, and JSON workspace export.
- Supabase migration with row-level access policies for drafts and portfolio records. The shared lead table contains only public job metadata.
- A Node.js scout for Greenhouse, Lever, and Ashby. Four initial employer boards are in [boards.json](scout/boards.json). The [73-source catalog](scout/source-catalog.json) is a research registry for additional connectors.
- Scheduled refresh using GitHub Actions, with a manual run option. A successful board refresh archives listings the board no longer returns. A failed fetch leaves that board’s previous records intact.
- Template-based drafting without an AI API or an outreach integration.

## Deploy

1. Create a Supabase project that you control. In its SQL Editor, run [001_archive.sql](supabase/migrations/001_archive.sql) once on the new project.
2. In GitHub for this repository, open **Settings → Pages**. Select **Deploy from a branch**, **main**, and **/docs**, then save. The expected project URL is https://triplxinx.github.io/archive-launch-desk/.
3. In Supabase **Authentication → URL Configuration**, set the Site URL and allowed redirect URL to the published site, including its trailing slash. For beta users outside the project team, configure a custom SMTP provider and verify mail delivery before inviting them. See [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).
4. Edit [docs/config.js](docs/config.js) with the project URL and the **publishable** key. These two client values are intended to be visible in the browser. Keep the service-role key out of this file and all tracked files.
5. Under GitHub **Settings → Secrets and variables → Actions**, set the repository variable **SUPABASE_URL** and repository secret **SUPABASE_SERVICE_ROLE_KEY**. Use the project’s legacy service_role JWT for the provided worker. Run **Actions → Scout employer boards → Run workflow** and check the per-source counts.
6. Sign in with two separate test accounts. Confirm each can save a sample and a draft, each sees only its own data, sign-out clears the workspace view, and workspace export includes only the signed-in customer’s records.

The cron is preset to 16:17 UTC. The sync step skips if the repository has no SUPABASE_URL variable. Public-repository schedules can pause after 60 days of inactivity. For a production deployment, use a dedicated scheduled worker or private workflow and alert on missed runs.

## Run the scout on your own machine

Use Node.js 22+ and a supported shell. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your process environment using a secret manager or private local configuration. Run:

```sh
node --test scout/scout.test.mjs
node scout/scout.mjs
```

Use employer public boards only where the intended collection and product use are permitted. The worker stores links and minimal metadata. Review source terms before enabling a board for a paid product. Do not add private candidate data, portfolio files, or secrets to the public repository.

## Beta scope

The portfolio currently stores links, names and tags. Direct image upload, wider source connectors, billing, native Android sync, and client-data import are future work. The app shows a setup panel until Supabase is configured. Confirm the live database policies and background run before opening the beta.
