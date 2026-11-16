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

-- =====================================================================
-- Bir nechta turnir: egasi (asosiy admin) va har bir turnirning o'z adminlari
-- =====================================================================
create table if not exists public.overlay_owners (email text primary key check (email = lower(email)));
insert into public.overlay_owners (email) select lower(email) from public.overlay_admins on conflict do nothing;
create table if not exists public.overlay_rooms (
  room text primary key check (room ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.overlay_room_admins (
  room text not null references public.overlay_rooms(room) on delete cascade,
  email text not null check (email = lower(email)),
  added_at timestamptz not null default now(),
  primary key (room, email)
);
insert into public.overlay_rooms (room, name)
  select 'main', coalesce((select data->>'title' from public.overlay_state where room = 'main' and key = 'config'), 'MAIN')
  on conflict do nothing;

create or replace function public.is_overlay_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.overlay_owners o where o.email = lower(auth.jwt() ->> 'email'));
$$;
create or replace function public.can_edit_room(r text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_overlay_owner() or exists (
    select 1 from public.overlay_room_admins m
    where m.room = r and m.email = lower(auth.jwt() ->> 'email'));
$$;
revoke execute on function public.is_overlay_owner() from public, anon;
revoke execute on function public.can_edit_room(text) from public, anon;
grant execute on function public.is_overlay_owner() to authenticated;
grant execute on function public.can_edit_room(text) to authenticated;

alter policy "overlay insert" on public.overlay_state with check (public.can_edit_room(room));
alter policy "overlay update" on public.overlay_state using (public.can_edit_room(room)) with check (public.can_edit_room(room));
create policy "overlay delete" on public.overlay_state for delete to authenticated using (public.is_overlay_owner());
alter policy "admins read" on public.overlay_admins using (public.is_overlay_owner());
alter policy "admins add" on public.overlay_admins with check (public.is_overlay_owner());
alter policy "admins remove" on public.overlay_admins using (public.is_overlay_owner());

alter table public.overlay_owners enable row level security;
create policy "owners read" on public.overlay_owners for select to authenticated using (email = lower(auth.jwt() ->> 'email') or public.is_overlay_owner());
create policy "owners add" on public.overlay_owners for insert to authenticated with check (public.is_overlay_owner());
create policy "owners remove" on public.overlay_owners for delete to authenticated using (public.is_overlay_owner() and email <> lower(auth.jwt() ->> 'email'));
alter table public.overlay_rooms enable row level security;
create policy "rooms read" on public.overlay_rooms for select to authenticated using (public.can_edit_room(room));
create policy "rooms add" on public.overlay_rooms for insert to authenticated with check (public.is_overlay_owner());
create policy "rooms rename" on public.overlay_rooms for update to authenticated using (public.is_overlay_owner()) with check (public.is_overlay_owner());
create policy "rooms remove" on public.overlay_rooms for delete to authenticated using (public.is_overlay_owner());
alter table public.overlay_room_admins enable row level security;
create policy "members read" on public.overlay_room_admins for select to authenticated using (public.can_edit_room(room));
create policy "members add" on public.overlay_room_admins for insert to authenticated with check (public.is_overlay_owner());
create policy "members remove" on public.overlay_room_admins for delete to authenticated using (public.is_overlay_owner());

-- ro'yxatdan o'tish: birinchi hisob egasi bo'ladi, turnirga qo'shilgan emaillar darhol tasdiqlanadi
create or replace function public.overlay_first_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null then return new; end if;
  if not exists (select 1 from public.overlay_owners) then
    insert into public.overlay_owners (email) values (lower(new.email));
    new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  elsif exists (select 1 from public.overlay_room_admins where email = lower(new.email))
     or exists (select 1 from public.overlay_owners where email = lower(new.email)) then
    new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  end if;
  return new;
end;
$$;
revoke execute on function public.overlay_first_admin() from public, anon, authenticated;

-- Musiqa fayllari: OBS hammaga ochiq o'qiydi, yuklash/o'chirish — egasi va o'sha turnir adminlari
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('overlay-media', 'overlay-media', true, 31457280,
        array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','audio/aac','audio/mp4','audio/x-m4a','audio/m4a','audio/webm','audio/flac'])
on conflict (id) do nothing;
create policy "overlay media read" on storage.objects for select to authenticated
  using (bucket_id = 'overlay-media' and public.can_edit_room((storage.foldername(name))[1]));
create policy "overlay media upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'overlay-media' and public.can_edit_room((storage.foldername(name))[1]));
create policy "overlay media remove" on storage.objects for delete to authenticated
  using (bucket_id = 'overlay-media' and public.can_edit_room((storage.foldername(name))[1]));
