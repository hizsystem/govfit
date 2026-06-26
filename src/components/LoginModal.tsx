"use client";

import { useState } from "react";
import type { AuthState, OAuthProvider } from "@/lib/auth";

/** 소셜 버튼 정의 (표시 순서대로) */
const SOCIALS: {
  provider: OAuthProvider;
  label: string;
  icon: string;
  className: string;
}[] = [
  {
    provider: "kakao",
    label: "카카오로 계속하기",
    icon: "💬",
    className: "bg-[#FEE500] text-[#191600] hover:brightness-95",
  },
  // 네이버는 Supabase 커스텀 제공자(OIDC) 와 궁합이 안 맞아 보류.
  // 나중에 별도 연동하면 아래 주석을 풀어 버튼을 되살릴 수 있다.
  // {
  //   provider: "naver",
  //   label: "네이버로 계속하기",
  //   icon: "N",
  //   className: "bg-[#03C75A] text-white hover:brightness-95",
  // },
  {
    provider: "google",
    label: "구글로 계속하기",
    icon: "🔵",
    className:
      "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100",
  },
];

type Mode = "login" | "signup";

/**
 * 로그인 / 회원가입 모달.
 * - 소셜: 카카오·네이버·구글 (네이버는 Supabase 커스텀 제공자, 대시보드 설정 필요)
 * - 이메일/비밀번호: 가입·로그인·비밀번호 재설정
 */
export function LoginModal({
  auth,
  onClose,
}: {
  auth: AuthState;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function handleSocial(provider: OAuthProvider) {
    setError(null);
    try {
      await auth.signIn(provider); // 외부 제공자로 리다이렉트
    } catch {
      setError("로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
  }

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!email.trim() || !password) {
      setError("이메일과 비밀번호를 입력해 주세요.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("이름(또는 상호)을 입력해 주세요.");
      return;
    }

    setBusy(true);
    const result =
      mode === "signup"
        ? await auth.signUpEmail(email.trim(), password, name.trim())
        : await auth.signInEmail(email.trim(), password);
    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }
    if (result.notice) {
      setNotice(result.notice); // 메일 인증 안내 등 — 모달 유지
      return;
    }
    onClose(); // 세션 생성 완료
  }

  async function handleReset() {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("재설정 메일을 받을 이메일을 먼저 입력해 주세요.");
      return;
    }
    setBusy(true);
    const result = await auth.resetPassword(email.trim());
    setBusy(false);
    if (result.error) setError(result.error);
    else setNotice(result.notice ?? "비밀번호 재설정 메일을 보냈어요.");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Brand Rise"
            className="mx-auto mb-3 h-12 w-12 rounded-xl object-cover"
          />
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            로그인 / 회원가입
          </h3>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
            관심공고·마이페이지가 기기를 바꿔도 유지돼요.
          </p>
        </div>

        {/* 소셜 로그인 */}
        <div className="mt-6 space-y-2.5">
          {SOCIALS.map((s) => (
            <button
              key={s.provider}
              type="button"
              onClick={() => handleSocial(s.provider)}
              className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition ${s.className}`}
            >
              <span
                aria-hidden
                className={
                  s.provider === "naver"
                    ? "grid h-5 w-5 place-items-center rounded bg-white/20 text-xs font-black"
                    : ""
                }
              >
                {s.icon}
              </span>
              {s.label}
            </button>
          ))}
        </div>

        {/* 구분선 */}
        <div className="my-5 flex items-center gap-3 text-[11px] text-gray-400">
          <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
          또는 이메일로
          <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
        </div>

        {/* 로그인/회원가입 탭 */}
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`rounded-lg py-2 text-sm font-semibold transition ${
                mode === m
                  ? "bg-white text-blue-700 shadow-sm dark:bg-gray-900 dark:text-blue-300"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {m === "login" ? "로그인" : "회원가입"}
            </button>
          ))}
        </div>

        <form onSubmit={handleEmailSubmit} className="space-y-2.5">
          {mode === "signup" && (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="이름 또는 상호"
              autoComplete="name"
              className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일"
            autoComplete="email"
            inputMode="email"
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "비밀번호 (6자 이상)" : "비밀번호"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? "처리 중…" : mode === "signup" ? "회원가입" : "로그인"}
          </button>
        </form>

        {mode === "login" && (
          <button
            type="button"
            onClick={handleReset}
            disabled={busy}
            className="mt-2 w-full text-center text-xs text-gray-400 hover:text-blue-500 disabled:opacity-60"
          >
            비밀번호를 잊으셨나요?
          </button>
        )}

        <p className="mt-4 text-center text-[11px] leading-relaxed text-gray-400">
          가입·로그인 시 서비스 이용약관 및 개인정보 처리방침에 동의하는 것으로
          간주됩니다.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-xl py-2 text-sm font-semibold text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
