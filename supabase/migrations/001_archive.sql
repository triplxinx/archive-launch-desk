begin;

create table public.scouted_leads (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  title text not null check (length(title) between 1 and 300),
  company text not null check (length(company) between 1 and 150),
  url text not null check (url like 'https://%'),
  posted_pay text,
  location text,
  tags text[] not null default '{}',
  checked_on date not null,
  active boolean not null default true,
  unique (source, external_id)
);

create table public.portfolio_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null check (length(trim(title)) between 1 and 140),
  url text check (url like 'https://%' and length(url) <= 1500),
  tags text[] not null default '{}' check (cardinality(tags) <= 20 and length(array_to_string(tags,',')) <= 240),
  draft_allowed boolean not null default false,
  created_at timestamptz not null default now()
);
create index portfolio_assets_owner on public.portfolio_assets(user_id);

create table public.lead_work (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  lead_id uuid not null references public.scouted_leads(id) on delete restrict,
  status text not null check (status in ('saved','drafting','applied','reply','won','closed')),
  portfolio text not null default '' check (length(portfolio) <= 6000),
  scope text not null default '' check (length(scope) <= 6000),
  followup text not null default '' check (length(followup) <= 6000),
  primary key (user_id, lead_id)
);

alter table public.scouted_leads enable row level security;
alter table public.portfolio_assets enable row level security;
alter table public.lead_work enable row level security;
revoke all on public.scouted_leads, public.portfolio_assets, public.lead_work from anon, authenticated;
grant select on public.scouted_leads to authenticated;
grant select, insert, update on public.scouted_leads to service_role;
grant select, insert, update, delete on public.portfolio_assets, public.lead_work to authenticated;

create policy leads_for_signed_in on public.scouted_leads for select to authenticated using (true);
create policy asset_owner on public.portfolio_assets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy draft_owner on public.lead_work for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.sync_source_leads(p_source text, p_rows jsonb)
returns integer language plpgsql set search_path = '' as $$
declare affected integer;
begin
  if p_source is null or p_source !~ '^(ashby|lever|greenhouse):[a-zA-Z0-9_-]+$' then
    raise exception 'invalid source';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'invalid source payload';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_source, 0));
  insert into public.scouted_leads
    (source, external_id, title, company, url, posted_pay, location, tags, checked_on, active)
  select p_source, row.external_id, row.title, row.company, row.url, row.posted_pay, row.location,
    coalesce(row.tags, '{}'), (now() at time zone 'UTC')::date, true
  from jsonb_to_recordset(p_rows) as row(
    external_id text, title text, company text, url text, posted_pay text, location text, tags text[]
  )
  on conflict (source, external_id) do update set title = excluded.title, company = excluded.company,
    url = excluded.url, posted_pay = excluded.posted_pay, location = excluded.location,
    tags = excluded.tags, checked_on = excluded.checked_on, active = true;
  get diagnostics affected = row_count;
  update public.scouted_leads set active = false
    where source = p_source and active and not exists (
      select 1 from jsonb_array_elements(p_rows) item where item->>'external_id' = scouted_leads.external_id
    );
  return affected;
end;
$$;
revoke all on function public.sync_source_leads(text,jsonb) from public, anon, authenticated;
grant execute on function public.sync_source_leads(text,jsonb) to service_role;
commit;
