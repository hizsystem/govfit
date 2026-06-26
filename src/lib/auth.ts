"use client";

import { useEffect, useState } from "react";
import type { Provider, User } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";

/** 소셜 로그인 제공자 (카카오·구글·네이버) */
export type OAuthProvider = "kakao" | "google" | "naver";

/**
 * Supabase 제공자 식별자.
 * 카카오·구글은 기본 지원, 네이버는 Supabase 대시보드의 "커스텀 OAuth 제공자"로
 * custom:naver 식별자를 쓴다(표준 Provider 타입엔 없어 캐스팅이 필요).
 */
const PROVIDER_ID: Record<OAuthProvider, string> = {
  kakao: "kakao",
  google: "google",
  naver: "custom:naver",
};

/**
 * 제공자별 OAuth scope (지정 안 하면 Supabase 기본값 사용).
 * 카카오: 기본값이 account_email을 포함하는데, 카카오 이메일은 "비즈앱 전환"이 있어야
 *   받을 수 있어 미설정 시 KOE205 에러가 난다. 그래서 닉네임만 요청한다.
 */
const PROVIDER_SCOPES: Partial<Record<OAuthProvider, string>> = {
  kakao: "profile_nickname",
};

/** 이메일 가입/로그인 등 결과 — 성공이면 error=null */
export interface AuthResult {
  error: string | null;
  /** 메일 확인이 필요한 경우 등 사용자에게 보여줄 안내 (선택) */
  notice?: string;
}

export interface AuthState {
  /** 로그인한 사용자 (없으면 null) */
  user: User | null;
  /** 초기 세션 확인이 끝났는지 (false 동안엔 로딩) */
  ready: boolean;
  /** Supabase 키가 설정돼 로그인 기능이 켜져 있는지 */
  configured: boolean;
  /** 소셜 로그인 (외부 제공자로 리다이렉트) */
  signIn: (provider: OAuthProvider) => Promise<void>;
  /** 이메일·비밀번호 회원가입 */
  signUpEmail: (
    email: string,
    password: string,
    name: string,
  ) => Promise<AuthResult>;
  /** 이메일·비밀번호 로그인 */
  signInEmail: (email: string, password: string) => Promise<AuthResult>;
  /** 비밀번호 재설정 메일 보내기 */
  resetPassword: (email: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

/** 로그인 후 돌아올 현재 사이트 주소 (서버 렌더 시 undefined) */
function siteOrigin(): string | undefined {
  return typeof window !== "undefined" ? window.location.origin : undefined;
}

/** Supabase 에러를 한국어 안내로 변환 (없으면 원문/기본값) */
function toMessage(error: { message?: string } | null): string | null {
  if (!error) return null;
  const m = error.message ?? "";
  if (/invalid login credentials/i.test(m))
    return "이메일 또는 비밀번호가 올바르지 않아요.";
  if (/already registered|already exists/i.test(m))
    return "이미 가입된 이메일이에요. 로그인해 주세요.";
  if (/password should be at least/i.test(m))
    return "비밀번호는 6자 이상이어야 해요.";
  if (/email not confirmed/i.test(m))
    return "메일 인증이 아직이에요. 받은 메일의 링크를 눌러 인증해 주세요.";
  return m || "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
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
      // custom:naver는 표준 Provider 유니언에 없어 캐스팅한다.
      provider: PROVIDER_ID[provider] as Provider,
      options: { redirectTo: siteOrigin(), scopes: PROVIDER_SCOPES[provider] },
    });
  }

  async function signUpEmail(
    email: string,
    password: string,
    name: string,
  ): Promise<AuthResult> {
    const { data, error } = await getSupabase().auth.signUp({
      email,
      password,
      options: { data: { name }, emailRedirectTo: siteOrigin() },
    });
    if (error) return { error: toMessage(error) };
    // 메일 인증이 켜져 있으면 세션이 바로 생기지 않는다.
    if (!data.session)
      return {
        error: null,
        notice: "인증 메일을 보냈어요. 메일의 링크를 눌러 가입을 완료해 주세요.",
      };
    return { error: null };
  }

  async function signInEmail(
    email: string,
    password: string,
  ): Promise<AuthResult> {
    const { error } = await getSupabase().auth.signInWithPassword({
      email,
      password,
    });
    return { error: toMessage(error) };
  }

  async function resetPassword(email: string): Promise<AuthResult> {
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: siteOrigin(),
    });
    if (error) return { error: toMessage(error) };
    return { error: null, notice: "비밀번호 재설정 메일을 보냈어요." };
  }

  async function signOut(): Promise<void> {
    if (isSupabaseConfigured) await getSupabase().auth.signOut();
    setUser(null);
  }

  return {
    user,
    ready,
    configured: isSupabaseConfigured,
    signIn,
    signUpEmail,
    signInEmail,
    resetPassword,
    signOut,
  };
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
