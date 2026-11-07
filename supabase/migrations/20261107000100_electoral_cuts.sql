begin;

create table public.electoral_cuts (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and payload ? 'id' and payload->>'id' is not null and payload->>'id' = id
  ),
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create index electoral_cuts_published_id on public.electoral_cuts (id) where published;

alter table public.electoral_cuts enable row level security;
revoke all on public.electoral_cuts from public, anon, authenticated;
grant select on public.electoral_cuts to anon, authenticated;
grant select, insert, update on public.electoral_cuts to service_role;

create policy "Lectura de cortes publicados"
  on public.electoral_cuts for select
  to anon, authenticated
  using (published);

commit;
