# Supabase Setup (V2 Cloud Sync)

## 1) Create project
- Create a Supabase project.
- Open `Project Settings -> API`.
- Copy:
  - `Project URL`
  - `anon public key`

Set them in `config.public.js` (committed) for production static hosting.
If you want local override, keep using local `config.js` (ignored by Git):
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Start from `config.example.js` and create either:
- `config.public.js` for deployment
- `config.js` for local only

## 2) SQL schema
Run this SQL in `SQL Editor`:

```sql
create table if not exists public.transactions (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  date text not null,
  intitule text not null,
  montant numeric not null,
  type text not null check (type in ('Depense', 'Recette', 'Dépense')),
  categorie text not null,
  note text default '',
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_user_id_id_key unique (user_id, id)
);

create index if not exists transactions_user_id_idx on public.transactions(user_id);

alter table public.transactions enable row level security;

create policy "select own rows"
on public.transactions
for select
to authenticated
using (auth.uid() = user_id);

create policy "insert own rows"
on public.transactions
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "update own rows"
on public.transactions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

## 3) Auth
- In `Authentication -> Providers`, keep Email enabled.
- If email confirmation is enabled, users must confirm before login works.

## 4) Usage in app
- Click `Compte` to sign up / login.
- Click `Sync Cloud` to force full sync.
- App stays local-first: offline works, sync happens when connected.
