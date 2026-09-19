import { env } from 'cloudflare:workers';
import { json } from '@/server/http/response';
import type { AppUser } from './medguard-types';
import { reviewerPeriods } from './reviewer-periods';

export async function reviewerPerformance(user: AppUser, url: URL) {
  // Match the administration portal, without granting reviewers a new read permission.
  if (!user.isAdmin || !user.mfaVerified) return json({ error: 'Admin access required.' }, 403);
  let periods: ReturnType<typeof reviewerPeriods>;
  try { periods = reviewerPeriods(url.searchParams.get('timeZone') || 'Asia/Riyadh'); }
  catch { return json({ error: 'Invalid time zone.' }, 400); }
  const rows = await env.DB.prepare(`WITH monthly AS (
    SELECT r.reviewer_id,count(*) AS month,
      sum(r.created_at>=? AND r.created_at<?) AS today,
      sum(r.decision='approved' AND coalesce(json_extract(r.metadata,'$.edited'),json_extract(p.payload,'$.type')='question_edit',0)=0) AS approved,
      sum(r.decision='approved' AND coalesce(json_extract(r.metadata,'$.edited'),json_extract(p.payload,'$.type')='question_edit',0)=1) AS edited,
      sum(r.decision='rejected') AS rejected
    FROM contribution_reviews r LEFT JOIN records p ON p.type='questionProposals' AND p.id=r.proposal_id
    WHERE r.created_at>=? AND r.created_at<? AND r.decision IN ('approved','rejected')
    GROUP BY r.reviewer_id
  ), roster AS (
    SELECT uid AS id,json_extract(profile_json,'$.displayName') AS name FROM profiles p
    WHERE (json_extract(profile_json,'$.status')='approved' AND (
      json_extract(profile_json,'$.role') IN ('reviewer','moderator','super_admin') OR
      EXISTS (SELECT 1 FROM json_each(profile_json,'$.platformRoles') WHERE value IN ('reviewer','moderator')) OR
      EXISTS (SELECT 1 FROM records m WHERE m.type='qbankMemberships' AND json_extract(m.payload,'$.userId')=p.uid AND json_extract(m.payload,'$.role')='reviewer') OR
      EXISTS (SELECT 1 FROM records b,json_each(b.payload,'$.reviewerIds') ids WHERE b.type='qbanks' AND ids.value=p.uid)
    )) OR uid IN (SELECT reviewer_id FROM monthly)
  ) SELECT roster.id,roster.name,coalesce(monthly.today,0) AS today,coalesce(monthly.month,0) AS month,
    coalesce(monthly.approved,0) AS approved,coalesce(monthly.edited,0) AS edited,coalesce(monthly.rejected,0) AS rejected
    FROM roster LEFT JOIN monthly ON monthly.reviewer_id=roster.id ORDER BY month DESC,roster.name`)
    .bind(periods.todayStart, periods.todayEnd, periods.monthStart, periods.monthEnd).all();
  return json({ reviewers: rows.results, ...periods });
}
