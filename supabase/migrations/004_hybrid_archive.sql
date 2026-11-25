-- Additive private hybrid archive foundation. Apply after existing migrations.
create table public.hybrid_assets (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
 title text not null default '',
 tags text[] not null default '{}',
 rights_status text not null default 'unreviewed' check (rights_status in ('unreviewed','owned','restricted','third_party')),
 created_at timestamptz not null default now(),
 unique(owner_id,sha256), unique(owner_id,id)
);
create table public.hybrid_locations (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 asset_id uuid not null,
 source_kind text not null check(source_kind in ('android','desktop','takeout','photos_picker','remote')),
 locator text not null,
 foreign key(owner_id,asset_id) references public.hybrid_assets(owner_id,id) on delete cascade,
 unique(owner_id,asset_id,source_kind,locator)
);
create table public.hybrid_collections (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null,
 mode text not null,
 filters jsonb not null default '{}',
 unique(owner_id,id)
);
create table public.hybrid_collection_items (
 owner_id uuid not null references auth.users(id) on delete cascade,
 collection_id uuid not null,
 asset_id uuid not null,
 position integer not null default 0,
 primary key(collection_id,asset_id),
 foreign key(owner_id,collection_id) references public.hybrid_collections(owner_id,id) on delete cascade,
 foreign key(owner_id,asset_id) references public.hybrid_assets(owner_id,id) on delete cascade
);
do $$ declare t text; begin
 foreach t in array array['hybrid_assets','hybrid_locations','hybrid_collections','hybrid_collection_items'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('create policy owner_only on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',t);
 execute format('revoke all on public.%I from anon',t);
 execute format('grant select, insert, update, delete on public.%I to authenticated',t);
 end loop;
end $$;
