-- ===========================================================================
-- GovFit 사용자 데이터 스키마 (Supabase)
--
-- 관심공고(bookmarks)와 마이페이지 프로필(profiles)을 "계정별"로 저장한다.
-- RLS(Row Level Security)로 각 사용자는 자기 행(user_id = auth.uid())만
-- 읽고 쓸 수 있다 → 같은 브라우저에서 다른 사람이 로그인해도 데이터가 섞이지 않고,
-- 기기를 바꿔도 계정을 따라 유지된다.
--
-- 적용 방법: Supabase 대시보드 → SQL Editor → 아래 전체 붙여넣고 Run.
-- (여러 번 실행해도 안전하도록 if not exists / drop policy 사용)
-- ===========================================================================

-- ── 관심공고 ────────────────────────────────────────────────────────────────
create table if not exists public.bookmarks (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  program_id text        not null,
  data       jsonb       not null,           -- 추천 객체(Recommendation) 전체
  created_at timestamptz not null default now(),
  primary key (user_id, program_id)
);

alter table public.bookmarks enable row level security;

drop policy if exists "own_bookmarks" on public.bookmarks;
create policy "own_bookmarks" on public.bookmarks
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── 마이페이지 프로필(디지털 명함) ──────────────────────────────────────────
create table if not exists public.profiles (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  data       jsonb       not null,           -- MyProfile 객체
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "own_profile" on public.profiles;
create policy "own_profile" on public.profiles
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
