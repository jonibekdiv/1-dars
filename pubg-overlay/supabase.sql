-- Supabase SQL Editor'da bir marta ishga tushiring.

create table if not exists public.overlay_state (
  room text not null,
  key text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (room, key)
);

-- Kimlar o'zgartira oladi: shu jadvaldagi email egalari
create table if not exists public.overlay_admins (email text primary key);

alter table public.overlay_state enable row level security;
alter table public.overlay_admins enable row level security; -- API orqali hech kim o'qiy/yoza olmaydi

create or replace function public.is_overlay_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.overlay_admins a
    where lower(a.email) = lower(auth.jwt() ->> 'email')
  );
$$;

drop policy if exists "overlay read" on public.overlay_state;
drop policy if exists "overlay insert" on public.overlay_state;
drop policy if exists "overlay update" on public.overlay_state;

-- Overlay (OBS) hammaga ochiq o'qiydi
create policy "overlay read" on public.overlay_state for select using (true);
-- Faqat adminlar yozadi
create policy "overlay insert" on public.overlay_state for insert to authenticated
  with check (public.is_overlay_admin());
create policy "overlay update" on public.overlay_state for update to authenticated
  using (public.is_overlay_admin()) with check (public.is_overlay_admin());

-- Real vaqt
alter publication supabase_realtime add table public.overlay_state;

-- Birinchi ro'yxatdan o'tgan hisob avtomatik admin bo'ladi va darhol tasdiqlanadi.
create or replace function public.overlay_first_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is not null and not exists (select 1 from public.overlay_admins) then
    insert into public.overlay_admins (email) values (lower(new.email));
    new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  end if;
  return new;
end;
$$;
revoke execute on function public.overlay_first_admin() from public, anon, authenticated;

create trigger overlay_first_admin before insert on auth.users
  for each row execute function public.overlay_first_admin();

-- Adminlar admin paneldan boshqa adminlarni ko'rishi, qo'shishi va olib tashlashi mumkin
create policy "admins read" on public.overlay_admins for select to authenticated using (public.is_overlay_admin());
create policy "admins add" on public.overlay_admins for insert to authenticated with check (public.is_overlay_admin());
create policy "admins remove" on public.overlay_admins for delete to authenticated using (public.is_overlay_admin());
revoke execute on function public.is_overlay_admin() from anon, public;
grant execute on function public.is_overlay_admin() to authenticated;
