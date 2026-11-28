/**
 * Single Source of Truth for HolaRise Manager RBAC, Departments,
 * Task Playbook Templates, Schema Self-Heal & Audit Trail.
 *
 * Security Invariants:
 * - Sole `super_admin` (`203int64`) remains the ONLY account allowed to hold `super_admin` privileges.
 * - Legacy roles (`editor` -> `content_editor`, `media` -> `media_ctv`) stay 100% backward-compatible.
 * - Fail-closed: endpoints without an explicit `permission` require `super_admin`.
 */

import { cleanStr } from "./validation.js";

export const DEPARTMENTS = [
  "Ban Điều Hành",
  "Ban Sự Kiện",
  "Ban Nội Dung",
  "Ban Hình Ảnh",
  "Ban Đối Ngoại",
];

export const ROLE_ALIAS_MAP = {
  super_admin: "super_admin",
  event_ops: "event_ops",
  content_editor: "content_editor",
  content_ctv: "content_ctv",
  media_manager: "media_manager",
  media_ctv: "media_ctv",
  // Legacy production roles
  editor: "content_editor",
  media: "media_ctv",
};

export const DELEGATABLE_ROLES = new Set([
  "event_ops",
  "content_editor",
  "content_ctv",
  "media_manager",
  "media_ctv",
  "media", // legacy alias preserved for backward-compatible API callers
]);

export const ALL_VALID_ROLES = new Set([
  "super_admin",
  "event_ops",
  "content_editor",
  "content_ctv",
  "media_manager",
  "media_ctv",
  "editor",
  "media",
]);

export const ROLE_META = {
  super_admin: {
    code: "super_admin",
    label: "Chủ nhiệm · Quản trị chính",
    shortLabel: "Chủ nhiệm",
    department: "Ban Điều Hành",
    portal: "manager",
    summary: "Toàn quyền hệ thống, phân quyền nhân sự, cài đặt, xuất dữ liệu gốc và Nhật ký thao tác.",
  },
  event_ops: {
    code: "event_ops",
    label: "Điều phối Sự kiện",
    shortLabel: "Ban Sự Kiện",
    department: "Ban Sự Kiện",
    portal: "manager",
    summary: "Quản lý sự kiện, danh sách đăng ký, hộp thoại khách, phân công CTV & nhiệm vụ hiện trường.",
  },
  content_editor: {
    code: "content_editor",
    label: "Trưởng ban Nội dung",
    shortLabel: "Trưởng ban ND",
    department: "Ban Nội Dung",
    portal: "manager",
    summary: "Biên tập, duyệt và xuất bản bài Hành trình, kiểm duyệt cảm nhận và giao việc Ban Nội Dung.",
  },
  content_ctv: {
    code: "content_ctv",
    label: "CTV Nội dung",
    shortLabel: "CTV Nội dung",
    department: "Ban Nội Dung",
    portal: "manager",
    summary: "Soạn bản nháp bài Hành trình, gửi duyệt cho Trưởng ban Nội dung và cập nhật nhiệm vụ được giao.",
  },
  media_manager: {
    code: "media_manager",
    label: "Trưởng ban Hình ảnh",
    shortLabel: "Quản lý Ảnh",
    department: "Ban Hình Ảnh",
    portal: "media",
    summary: "Quản lý album, duyệt ảnh Safeguarding lên web, AI retouch, mở khóa album riêng và giao việc Ban Ảnh.",
  },
  media_ctv: {
    code: "media_ctv",
    label: "CTV Hình ảnh",
    shortLabel: "CTV Hình ảnh",
    department: "Ban Hình Ảnh",
    portal: "media",
    summary: "Tải ảnh/video vào hàng chờ duyệt tại Cổng Media và cập nhật nhiệm vụ được giao.",
  },
};

export const ROLE_PERMISSIONS = {
  super_admin: ["*"],
  event_ops: [
    "manager.access",
    "overview.read",
    "timeline.read",
    "tasks.read",
    "tasks.write",
    "tasks.assign",
    "events.read",
    "events.write",
    "registrations.read",
    "registrations.write",
    "inbox.read",
    "inbox.write",
    "members.read",
    "members.capabilities",
    "reflections.read",
    "media.read",
    "team.read",
  ],
  content_editor: [
    "manager.access",
    "overview.read",
    "timeline.read",
    "tasks.read",
    "tasks.write",
    "tasks.assign",
    "events.read",
    "posts.read",
    "posts.draft",
    "posts.publish",
    "reflections.read",
    "reflections.moderate",
    "media.read",
    "media.upload",
    "team.read",
  ],
  content_ctv: [
    "manager.access",
    "overview.read",
    "timeline.read",
    "tasks.read",
    "tasks.update_own",
    "events.read",
    "posts.read",
    "posts.draft",
    "media.read",
    "team.read",
  ],
  media_manager: [
    "manager.access",
    "overview.read",
    "timeline.read",
    "tasks.read",
    "tasks.write",
    "tasks.assign",
    "events.read",
    "media.read",
    "media.upload",
    "media.albums_write",
    "media.approve",
    "members.album_grant",
    "team.read",
  ],
  media_ctv: [
    "timeline.read",
    "tasks.read",
    "tasks.update_own",
    "media.read",
    "media.upload",
    "team.read",
  ],
};

export const EVENT_PLAYBOOK_STEPS = [
  {
    key: "venue_survey",
    phase: "before",
    offsetDays: -7,
    department: "Ban Sự Kiện",
    priority: "high",
    title: "Khảo sát địa điểm, ánh sáng & chốt an toàn thực địa",
    description: "Kiểm tra chỗ ngồi, lối đi an toàn, phương án dự phòng thời tiết và xác nhận lại với chủ không gian.",
  },
  {
    key: "invite_copy",
    phase: "before",
    offsetDays: -5,
    department: "Ban Nội Dung",
    priority: "high",
    title: "Hoàn thiện thư mời VN/EN & kiểm duyệt bút pháp",
    description: "Làm rõ 4 điểm cho người đi lần đầu: đi một mình có người đón, chi phí rõ ràng, đường đi/ghép xe và link Nhóm Zalo.",
  },
  {
    key: "ctv_checkin_brief",
    phase: "before",
    offsetDays: -2,
    department: "Ban Sự Kiện",
    priority: "normal",
    title: "Phân công CTV Đón khách & Check-in hiện trường",
    description: "Cấp quyền event.companion và event.checkin cho CTV trên /tham-gia/, nhắc lịch nhóm Zalo trước giờ G.",
  },
  {
    key: "onsite_hosting",
    phase: "during",
    offsetDays: 0,
    department: "Ban Sự Kiện",
    priority: "urgent",
    title: "Điều phối đón khách, check-in thực tế & ghi nhận sĩ số",
    description: "Đón người đi một mình ngay cửa, điểm danh trên danh sách che PII và chốt số người tham dự thật.",
  },
  {
    key: "media_safeguarding",
    phase: "after",
    offsetDays: 1,
    department: "Ban Hình Ảnh",
    priority: "high",
    title: "Đẩy ảnh Drive gốc, lọc Safeguarding & duyệt album lên web",
    description: "Không đăng cận mặt trẻ vị thành niên hoặc khoảnh khắc xúc động nhạy cảm; nén bản web <= 1280px và duyệt album.",
  },
  {
    key: "journey_recap",
    phase: "after",
    offsetDays: 2,
    department: "Ban Nội Dung",
    priority: "normal",
    title: "Soạn bài tổng kết Hành trình (VN/EN) & gửi duyệt xuất bản",
    description: "Ghi nhận số liệu kiểm chứng tại hiện trường, gắn ảnh đã duyệt và gửi Trưởng ban Nội dung duyệt đăng.",
  },
];

export function normalizeRole(rawRole) {
  const key = String(rawRole || "").trim().toLowerCase();
  return ROLE_ALIAS_MAP[key] || "";
}

export function getRoleMeta(rawRole) {
  const canonical = normalizeRole(rawRole);
  return ROLE_META[canonical] || ROLE_META.media_ctv;
}

export function getDefaultDepartmentForRole(rawRole) {
  return getRoleMeta(rawRole).department || "Ban Sự Kiện";
}

export function getRolePermissions(rawRole, isSoleAdmin = false) {
  const canonical = normalizeRole(rawRole);
  if (!canonical) return [];
  if (canonical === "super_admin") {
    return isSoleAdmin ? ["*"] : [];
  }
  return ROLE_PERMISSIONS[canonical] ? [...ROLE_PERMISSIONS[canonical]] : [];
}

export function roleHasPermission(rawRole, permission, isSoleAdmin = false) {
  const perms = getRolePermissions(rawRole, isSoleAdmin);
  if (perms.includes("*")) return true;
  if (!permission) return false;
  if (Array.isArray(permission)) {
    return permission.some((p) => perms.includes(p));
  }
  return perms.includes(permission);
}

export function canAccessManagerShell(rawRole, isSoleAdmin = false) {
  return roleHasPermission(rawRole, "manager.access", isSoleAdmin);
}

export function canAccessMediaPortalRole(rawRole, isSoleAdmin = false) {
  return roleHasPermission(rawRole, "media.read", isSoleAdmin);
}

export function listRolesCatalog() {
  return [
    ROLE_META.super_admin,
    ROLE_META.event_ops,
    ROLE_META.content_editor,
    ROLE_META.content_ctv,
    ROLE_META.media_manager,
    ROLE_META.media_ctv,
  ].map((meta) => ({
    ...meta,
    permissions: ROLE_PERMISSIONS[meta.code] || [],
  }));
}

const ensuredManagerDbs = new WeakSet();

/**
 * Idempotent schema self-heal for ops_tasks, admin_audit_logs,
 * and posts Maker-Checker columns on drifted D1 instances or partial test DBs.
 */
export async function ensureManagerSchema(db) {
  if (!db || ensuredManagerDbs.has(db)) return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS ops_tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          event_id TEXT NOT NULL DEFAULT '',
          phase TEXT NOT NULL DEFAULT 'before' CHECK(phase IN ('before', 'during', 'after', 'general')),
          department TEXT NOT NULL DEFAULT 'Ban Sự Kiện',
          assignee_type TEXT NOT NULL DEFAULT 'unassigned' CHECK(assignee_type IN ('unassigned', 'staff', 'member')),
          assignee_id TEXT NOT NULL DEFAULT '',
          assignee_name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'review', 'done')),
          priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
          due_at TEXT NOT NULL DEFAULT '',
          zalo_url TEXT NOT NULL DEFAULT '',
          playbook_key TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_by_name TEXT NOT NULL DEFAULT '',
          completed_at TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      )
      .run()
      .catch(() => {});

    await db
      .prepare("CREATE INDEX IF NOT EXISTS idx_ops_tasks_event ON ops_tasks(event_id, phase, status)")
      .run()
      .catch(() => {});
    await db
      .prepare("CREATE INDEX IF NOT EXISTS idx_ops_tasks_assignee ON ops_tasks(assignee_type, assignee_id, status)")
      .run()
      .catch(() => {});
    await db
      .prepare("CREATE INDEX IF NOT EXISTS idx_ops_tasks_due ON ops_tasks(due_at, status)")
      .run()
      .catch(() => {});

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS admin_audit_logs (
          id TEXT PRIMARY KEY,
          actor_id TEXT NOT NULL DEFAULT '',
          actor_email TEXT NOT NULL DEFAULT '',
          actor_name TEXT NOT NULL DEFAULT '',
          actor_role TEXT NOT NULL DEFAULT '',
          action TEXT NOT NULL,
          target_type TEXT NOT NULL DEFAULT '',
          target_id TEXT NOT NULL DEFAULT '',
          summary TEXT NOT NULL DEFAULT '',
          meta_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        )`
      )
      .run()
      .catch(() => {});

    await db
      .prepare("CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON admin_audit_logs(created_at DESC)")
      .run()
      .catch(() => {});

    // Staff invites table (Migration 0027 self-heal)
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS staff_invites (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'content_ctv',
          department TEXT NOT NULL DEFAULT 'Ban Sự Kiện',
          pillar_scope TEXT NOT NULL DEFAULT 'all',
          token_hash TEXT NOT NULL UNIQUE,
          note TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pending',
          invited_by TEXT NOT NULL DEFAULT '',
          invited_by_name TEXT NOT NULL DEFAULT '',
          accepted_user_id TEXT NOT NULL DEFAULT '',
          consent_accepted_at TEXT NOT NULL DEFAULT '',
          accepted_at TEXT NOT NULL DEFAULT '',
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      )
      .run()
      .catch(() => {});

    // Event In-Kind Resources ledger (Migration 0027 self-heal)
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS event_resources (
          id TEXT PRIMARY KEY,
          event_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'space',
          title TEXT NOT NULL,
          quantity TEXT NOT NULL DEFAULT '',
          donor_name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'pledged',
          note TEXT NOT NULL DEFAULT '',
          recorded_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      )
      .run()
      .catch(() => {});

    // Self-heal missing review columns on posts if migration 0026/0027 has not run yet
    const postCols = await db.prepare("PRAGMA table_info(posts)").all().catch(() => ({ results: [] }));
    const colNames = new Set((postCols.results || []).map((c) => c.name));
    if (colNames.size > 0) {
      if (!colNames.has("submitted_by")) {
        await db.prepare("ALTER TABLE posts ADD COLUMN submitted_by TEXT NOT NULL DEFAULT ''").run().catch(() => {});
      }
      if (!colNames.has("submitted_by_id")) {
        await db.prepare("ALTER TABLE posts ADD COLUMN submitted_by_id TEXT NOT NULL DEFAULT ''").run().catch(() => {});
      }
      if (!colNames.has("reviewed_by")) {
        await db.prepare("ALTER TABLE posts ADD COLUMN reviewed_by TEXT NOT NULL DEFAULT ''").run().catch(() => {});
      }
      if (!colNames.has("reviewed_at")) {
        await db.prepare("ALTER TABLE posts ADD COLUMN reviewed_at TEXT NOT NULL DEFAULT ''").run().catch(() => {});
      }
      if (!colNames.has("review_note")) {
        await db.prepare("ALTER TABLE posts ADD COLUMN review_note TEXT NOT NULL DEFAULT ''").run().catch(() => {});
      }
    }

    const userCols = await db.prepare("PRAGMA table_info(admin_users)").all().catch(() => ({ results: [] }));
    const uColNames = new Set((userCols.results || []).map((c) => c.name));
    if (uColNames.size > 0 && !uColNames.has("pillar_scope")) {
      await db.prepare("ALTER TABLE admin_users ADD COLUMN pillar_scope TEXT NOT NULL DEFAULT 'all'").run().catch(() => {});
    }
  } catch {
    // Non-fatal on minimal DB mocks
  }
  ensuredManagerDbs.add(db);
}

/**
 * Append an immutable administrative audit entry. Never throws to avoid breaking primary mutations.
 */
export async function logAudit(
  db,
  actor,
  { action, targetType = "", targetId = "", summary = "", meta = null } = {}
) {
  if (!db || !action) return null;
  try {
    await ensureManagerSchema(db);
    const id = `aud-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const actorId = cleanStr(actor?.id, 80);
    const actorEmail = cleanStr(actor?.email, 160);
    const actorName = cleanStr(actor?.name, 120);
    const actorRole = normalizeRole(actor?.role) || cleanStr(actor?.role, 40);
    const metaJson = meta && typeof meta === "object" ? JSON.stringify(meta).slice(0, 4000) : "{}";
    await db
      .prepare(
        `INSERT INTO admin_audit_logs
         (id, actor_id, actor_email, actor_name, actor_role, action, target_type, target_id, summary, meta_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        actorId,
        actorEmail,
        actorName,
        actorRole,
        cleanStr(action, 80),
        cleanStr(targetType, 40),
        cleanStr(targetId, 120),
        cleanStr(summary, 300),
        metaJson,
        now
      )
      .run();
    return id;
  } catch {
    return null;
  }
}

export function serializeTaskRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || "",
    description: row.description || "",
    eventId: row.event_id || "",
    eventTitle: row.event_title || "",
    eventDate: row.event_date || "",
    eventSlug: row.event_slug || "",
    phase: row.phase || "before",
    department: row.department || "Ban Sự Kiện",
    assigneeType: row.assignee_type || "unassigned",
    assigneeId: row.assignee_id || "",
    assigneeName: row.assignee_name || "",
    status: row.status || "todo",
    priority: row.priority || "normal",
    dueAt: row.due_at || "",
    zaloUrl: row.zalo_url || "",
    playbookKey: row.playbook_key || "",
    createdBy: row.created_by || "",
    createdByName: row.created_by_name || "",
    completedAt: row.completed_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}
