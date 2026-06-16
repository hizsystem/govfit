"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

export type OAuthProvider = "kakao" | "google";

export interface AuthState {
  /** 로그인한 사용자 (없으면 null) */
  user: User | null;
  /** 초기 세션 확인이 끝났는지 (false 동안엔 로딩) */
  ready: boolean;
  /** Supabase 키가 설정돼 로그인 기능이 켜져 있는지 */
  configured: boolean;
  signIn: (provider: OAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * 클라이언트 사이드 인증 훅.
 * - 미설정(키 없음)이면 항상 비로그인 상태로 두고 ready=true (게이트 미적용).
 * - 설정돼 있으면 세션을 읽고 변화를 구독한다.
 */
export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sb = getSupabase();
    sb.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(provider: OAuthProvider): Promise<void> {
    await getSupabase().auth.signInWithOAuth({
      provider,
      options: {
        // 로그인 후 현재 사이트로 복귀
        redirectTo:
          typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });
  }

  async function signOut(): Promise<void> {
    if (isSupabaseConfigured) await getSupabase().auth.signOut();
    setUser(null);
  }

  return { user, ready, configured: isSupabaseConfigured, signIn, signOut };
}

/** 사용자 표시 이름 (이메일/이름/닉네임 중 있는 것) */
export function displayUserName(user: User | null): string {
  if (!user) return "";
  const m = user.user_metadata ?? {};
  return (
    (m.name as string) ||
    (m.full_name as string) ||
    (m.nickname as string) ||
    user.email ||
    "회원"
  );
}
