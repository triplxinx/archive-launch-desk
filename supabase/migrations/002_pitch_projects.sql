begin;

alter table public.lead_work
  add column quote text not null default '' check (length(quote) <= 6000);

create table public.pitch_versions (
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.scouted_leads(id) on delete restrict,
  version integer not null check (version > 0),
  request_id uuid not null,
  lead_name text not null,
  status text not null check (status in ('saved','drafting','applied','reply','won','closed')),
  portfolio text not null check (length(portfolio) <= 6000),
  scope text not null check (length(scope) <= 6000),
  followup text not null check (length(followup) <= 6000),
  quote text not null check (length(quote) <= 6000),
  created_at timestamptz not null default now(),
  primary key (user_id, lead_id, version),
  unique (user_id, lead_id, request_id)
);

alter table public.pitch_versions enable row level security;
revoke all on public.pitch_versions from anon, authenticated;
grant select on public.pitch_versions to authenticated;
create policy pitch_version_owner on public.pitch_versions for select to authenticated
  using ((select auth.uid()) = user_id);

create function public.archive_pitch(p_lead_id uuid, p_request_id uuid, p_draft jsonb)
returns public.pitch_versions
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  saved public.pitch_versions;
  title text;
  next_version integer;
begin
  if owner_id is null or p_lead_id is null or p_request_id is null then
    raise exception 'Sign in and select a lead before archiving.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text || ':' || p_lead_id::text, 0));
  select * into saved from public.pitch_versions
    where user_id = owner_id and lead_id = p_lead_id and request_id = p_request_id;
  if found then return saved; end if;

  select lead.title into title from public.scouted_leads lead where lead.id = p_lead_id;
  if not found then raise exception 'Lead does not exist.'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.pitch_versions
    where user_id = owner_id and lead_id = p_lead_id;

  insert into public.pitch_versions
    (user_id, lead_id, version, request_id, lead_name, status, portfolio, scope, followup, quote)
    values (owner_id, p_lead_id, next_version, p_request_id, title, p_draft->>'status',
      p_draft->>'portfolio', p_draft->>'scope', p_draft->>'followup', p_draft->>'quote')
    returning * into saved;

  insert into public.lead_work (user_id, lead_id, status, portfolio, scope, followup, quote)
    values (owner_id, p_lead_id, saved.status, saved.portfolio, saved.scope, saved.followup, saved.quote)
    on conflict (user_id, lead_id) do update set status = excluded.status,
      portfolio = excluded.portfolio, scope = excluded.scope, followup = excluded.followup, quote = excluded.quote;
  return saved;
end;
$$;

revoke all on function public.archive_pitch(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.archive_pitch(uuid, uuid, jsonb) to authenticated;
commit;
