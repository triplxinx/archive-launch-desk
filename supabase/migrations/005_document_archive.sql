-- Apply after 004_hybrid_archive.sql. No anonymous writes or file publication by default.
create table public.archive_documents (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 asset_id uuid not null,
 original_filename text not null,
 short_title text not null,
 proposed_filename text not null,
 page_count integer check(page_count > 0),
 metadata jsonb not null default '{}',
 review_status text not null default 'pending' check(review_status in ('pending','approved','rejected')),
 security_status text not null default 'pending' check(security_status in ('pending','flagged','reviewed')),
 created_at timestamptz not null default now(),
 foreign key(owner_id,asset_id) references public.hybrid_assets(owner_id,id) on delete cascade,
 unique(owner_id,asset_id)
);
alter table public.archive_documents enable row level security;
revoke all on public.archive_documents from anon;
grant select,insert,update,delete on public.archive_documents to authenticated;
create policy document_owner on public.archive_documents for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create table public.continuous_text_entries (
 id bigint generated always as identity primary key,
 body text not null check(char_length(body) between 1 and 200000),
 source_kind text not null check(source_kind in ('public','import','admin')),
 status text not null default 'pending' check(status in ('pending','published','hidden')),
 created_at timestamptz not null default now()
);
alter table public.continuous_text_entries enable row level security;
revoke all on public.continuous_text_entries from anon, authenticated;
grant select on public.continuous_text_entries to anon, authenticated;
create policy read_published_text on public.continuous_text_entries for select to anon,authenticated using(status='published');
-- Writes must pass through a trusted, rate-limited server endpoint.
-- Never expose the service role key. Implement admin authorization and revision logging before enabling edits.
