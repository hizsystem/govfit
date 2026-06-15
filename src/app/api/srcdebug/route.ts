import { NextResponse } from "next/server";
import type { SupportProgram } from "@/lib/types";
import {
  fetchBizinfoPrograms,
  fetchBizinfoAgriPrograms,
} from "@/lib/data/bizinfo";
import { fetchKstartupPrograms } from "@/lib/data/kstartup";
import { fetchAtPrograms } from "@/lib/data/at";
import { fetchFanfandaeroPrograms } from "@/lib/data/fanfandaero";
import { fetchSbaPrograms } from "@/lib/data/sba";

// 임시 진단용 — 소스별 로드 개수/실패 원인 파악. 측정 후 삭제 예정.
export const maxDuration = 60;

function preCount(ps: SupportProgram[]): number {
  return ps.filter((p) =>
    `${p.title} ${p.summary} ${p.supportContent} ${p.eligibility ?? ""} ${
      p.target ?? ""
    } ${(p.hashtags ?? []).join(" ")}`.includes("예비창업"),
  ).length;
}

export async function GET() {
  const sources: Array<[string, () => Promise<SupportProgram[]>]> = [
    ["bizinfo", () => fetchBizinfoPrograms()],
    ["bizinfoAgri", () => fetchBizinfoAgriPrograms()],
    ["kstartup", () => fetchKstartupPrograms()],
    ["at", () => fetchAtPrograms()],
    ["fanfandaero", () => fetchFanfandaeroPrograms()],
    ["sba", () => fetchSbaPrograms()],
  ];

  const settled = await Promise.allSettled(sources.map(([, fn]) => fn()));

  const report = settled.map((r, i) => {
    const name = sources[i][0];
    if (r.status === "fulfilled") {
      return {
        source: name,
        ok: true,
        count: r.value.length,
        preFounderMentions: preCount(r.value),
      };
    }
    return {
      source: name,
      ok: false,
      error: String(r.reason).slice(0, 200),
    };
  });

  return NextResponse.json({ report });
}
