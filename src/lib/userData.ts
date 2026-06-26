"use client";

/**
 * 사용자별 데이터(관심공고·마이페이지 프로필) 저장소 — Supabase.
 *
 * 모든 행은 RLS로 본인(user_id = auth.uid())만 읽고 쓸 수 있다(아래 SQL 참고).
 * localStorage와 달리 계정에 묶이므로 기기를 바꿔도 유지되고, 같은 브라우저에서
 * 다른 사람이 로그인해도 데이터가 섞이지 않는다.
 */

import { getSupabase } from "@/lib/supabase";
import type { Recommendation } from "@/lib/types";

// ── 관심공고(bookmarks) ──────────────────────────────────────────────

/** 계정의 관심공고 전체를 {programId: Recommendation} 맵으로 불러온다. */
export async function fetchBookmarks(
  userId: string,
): Promise<Record<string, Recommendation>> {
  const { data, error } = await getSupabase()
    .from("bookmarks")
    .select("program_id, data")
    .eq("user_id", userId);
  if (error) throw error;
  const map: Record<string, Recommendation> = {};
  for (const row of data ?? []) {
    map[row.program_id as string] = row.data as Recommendation;
  }
  return map;
}

/** 관심공고 1건 저장(있으면 갱신). */
export async function putBookmark(
  userId: string,
  programId: string,
  data: Recommendation,
): Promise<void> {
  const { error } = await getSupabase()
    .from("bookmarks")
    .upsert(
      { user_id: userId, program_id: programId, data },
      { onConflict: "user_id,program_id" },
    );
  if (error) throw error;
}

/** 관심공고 1건 삭제. */
export async function removeBookmark(
  userId: string,
  programId: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("bookmarks")
    .delete()
    .eq("user_id", userId)
    .eq("program_id", programId);
  if (error) throw error;
}

// ── 마이페이지 프로필(profiles) ───────────────────────────────────────

/** 계정의 프로필을 불러온다(없으면 null). 형태는 호출 측 타입에 맡긴다. */
export async function fetchProfileData<T>(userId: string): Promise<T | null> {
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.data as T) ?? null;
}

/** 계정의 프로필을 저장(있으면 갱신). */
export async function putProfileData<T>(
  userId: string,
  data: T,
): Promise<void> {
  const { error } = await getSupabase()
    .from("profiles")
    .upsert({ user_id: userId, data }, { onConflict: "user_id" });
  if (error) throw error;
}
