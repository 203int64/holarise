-- Migration 0028: Unified Feedback Inbox (Site Feedback + Bug Reports + Post-Event Feedback)
-- Extends `event_feedbacks` with optional site/bug metadata and migrates legacy feedback rows
-- out of `registrations` so "Đơn đăng ký & Check-in" only contains real registrations.

ALTER TABLE event_feedbacks ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'event';
ALTER TABLE event_feedbacks ADD COLUMN topic_label TEXT NOT NULL DEFAULT '';
ALTER TABLE event_feedbacks ADD COLUMN page_url TEXT NOT NULL DEFAULT '';
ALTER TABLE event_feedbacks ADD COLUMN attachment_url TEXT NOT NULL DEFAULT '';
ALTER TABLE event_feedbacks ADD COLUMN diagnostics TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_event_feedbacks_source_status
  ON event_feedbacks(source_kind, status, created_at DESC);

INSERT OR IGNORE INTO event_feedbacks (
  id,
  event_id,
  event_slug,
  event_title,
  source_kind,
  topic_label,
  page_url,
  attachment_url,
  diagnostics,
  category,
  content,
  author_name,
  author_contact,
  member_id,
  is_anonymous,
  status,
  admin_note,
  created_at,
  updated_at
)
SELECT
  'efb_mig_' || replace(id, '-', '_'),
  '',
  '',
  COALESCE(NULLIF(activity_title, ''), 'Góp ý trên web'),
  CASE
    WHEN (COALESCE(role, '') || ' ' || COALESCE(activity_title, '')) LIKE '%lỗi%'
      OR (COALESCE(role, '') || ' ' || COALESCE(activity_title, '')) LIKE '%Lỗi%'
      OR lower(COALESCE(role, '') || ' ' || COALESCE(activity_title, '')) LIKE '%bug%'
      OR note LIKE '%/api/admin/bug-screenshot/%'
    THEN 'bug'
    ELSE 'site'
  END,
  COALESCE(NULLIF(role, ''), NULLIF(activity_title, ''), 'Góp ý'),
  CASE WHEN organization LIKE '/%' THEN organization ELSE '' END,
  CASE
    WHEN instr(note, '/api/admin/bug-screenshot/') > 0 THEN
      substr(
        note,
        instr(note, '/api/admin/bug-screenshot/'),
        CASE
          WHEN instr(substr(note, instr(note, '/api/admin/bug-screenshot/')), char(10)) > 0
            THEN instr(substr(note, instr(note, '/api/admin/bug-screenshot/')), char(10)) - 1
          WHEN instr(substr(note, instr(note, '/api/admin/bug-screenshot/')), ' ') > 0
            THEN instr(substr(note, instr(note, '/api/admin/bug-screenshot/')), ' ') - 1
          ELSE length(substr(note, instr(note, '/api/admin/bug-screenshot/')))
        END
      )
    ELSE ''
  END,
  CASE
    WHEN instr(note, '[Ngữ cảnh kỹ thuật]:') > 0
      THEN trim(substr(note, instr(note, '[Ngữ cảnh kỹ thuật]:') + 21), ' ' || char(10) || char(13) || char(9))
    ELSE ''
  END,
  CASE
    WHEN (COALESCE(role, '') || ' ' || COALESCE(activity_title, '')) LIKE '%Đề xuất%'
      OR (COALESCE(role, '') || ' ' || COALESCE(activity_title, '')) LIKE '%đề xuất%'
      OR lower(COALESCE(role, '') || ' ' || COALESCE(activity_title, '')) LIKE '%idea%'
    THEN 'de-xuat'
    WHEN (COALESCE(role, '') || ' ' || COALESCE(activity_title, '')) LIKE '%Khác%'
      OR (COALESCE(role, '') || ' ' || COALESCE(activity_title, '')) LIKE '%khác%'
      OR lower(COALESCE(role, '') || ' ' || COALESCE(activity_title, '')) LIKE '%other%'
    THEN 'khac'
    ELSE 'cai-thien'
  END,
  trim(
    CASE
      WHEN instr(note, '[Ảnh màn hình lỗi (Admin)]:') > 0
        THEN substr(note, 1, instr(note, '[Ảnh màn hình lỗi (Admin)]:') - 1)
      WHEN instr(note, '[Ngữ cảnh kỹ thuật]:') > 0
        THEN substr(note, 1, instr(note, '[Ngữ cảnh kỹ thuật]:') - 1)
      ELSE note
    END,
    ' ' || char(10) || char(13) || char(9)
  ),
  CASE
    WHEN COALESCE(full_name, '') IN ('', 'Thành viên đóng góp', 'Community contributor') THEN 'Ẩn danh'
    ELSE full_name
  END,
  CASE
    WHEN COALESCE(phone, '') IN ('', 'Ẩn danh', 'Anonymous') THEN COALESCE(email, '')
    ELSE phone
  END,
  COALESCE(member_id, ''),
  CASE
    WHEN COALESCE(full_name, '') IN ('', 'Thành viên đóng góp', 'Community contributor')
      AND COALESCE(phone, '') IN ('', 'Ẩn danh', 'Anonymous')
      AND COALESCE(email, '') = ''
    THEN 1
    ELSE 0
  END,
  CASE status
    WHEN 'attended' THEN 'resolved'
    WHEN 'cancelled' THEN 'resolved'
    WHEN 'contacted' THEN 'read'
    ELSE 'new'
  END,
  COALESCE(admin_note, ''),
  created_at,
  updated_at
FROM registrations
WHERE event_id = ''
  AND (
    activity_title LIKE 'Đóng góp · %'
    OR activity_title LIKE 'Feedback · %'
    OR note LIKE '%/api/admin/bug-screenshot/%'
    OR note LIKE '%[Ngữ cảnh kỹ thuật]:%'
  );

DELETE FROM registrations
WHERE event_id = ''
  AND (
    activity_title LIKE 'Đóng góp · %'
    OR activity_title LIKE 'Feedback · %'
    OR note LIKE '%/api/admin/bug-screenshot/%'
    OR note LIKE '%[Ngữ cảnh kỹ thuật]:%'
  );
