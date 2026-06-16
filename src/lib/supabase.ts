import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase 클라이언트 (브라우저, 클라이언트 사이드 인증용).
 *
 * 환경변수가 없으면 미설정 상태로 두고, 앱은 로그인 없이 그대로 동작한다.
 * (게이트는 isSupabaseConfigured가 true일 때만 적용)
 *   NEXT_PUBLIC_SUPABASE_URL       — Supabase 프로젝트 URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY  — 공개 anon 키 (브라우저 노출 OK)
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Supabase 키가 설정돼 로그인 기능을 켤 수 있는지 */
export const isSupabaseConfigured = Boolean(url && anon);

let client: SupabaseClient | null = null;

/** Supabase 클라이언트를 반환한다(싱글턴). 미설정이면 예외. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!url || !anon) throw new Error("Supabase 환경변수 미설정");
    client = createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}
