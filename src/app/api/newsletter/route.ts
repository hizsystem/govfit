import { NextResponse } from "next/server";
import type { DataSource } from "@/lib/types";
import { loadPrograms } from "@/lib/data/loader";
import {
  pickNewsletterByCategory,
  weekLabel,
  type CategoryGroup,
} from "@/lib/newsletter";

interface NewsletterResponse {
  label: string;
  groups: CategoryGroup[];
  dataSource: DataSource;
}

/**
 * GET /api/newsletter
 *
 * 이번 주 분야별 "주목 지원사업"을 분야당 5개씩 선정해 반환한다.
 * (회사 정보와 무관한 일반 큐레이션)
 */
export async function GET() {
  const { programs, source } = await loadPrograms();
  const groups = pickNewsletterByCategory(programs, 5);

  const body: NewsletterResponse = {
    label: weekLabel(new Date()),
    groups,
    dataSource: source,
  };

  return NextResponse.json(body);
}
