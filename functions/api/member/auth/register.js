import {
  buildMemberSessionCookie,
  checkRateLimit,
  createMemberSession,
  ensureMemberSchema,
  errorResponse,
  generateSequentialMemberCode,
  getClientIpHash,
  hashPassword,
  jsonResponse,
  readJsonBody,
  serializePublicMember,
  verifyCsrfOrigin,
} from "../../../_lib/security.js";
import { verifyTurnstileToken } from "../../../_lib/turnstile.js";
import { validateMemberRegisterInput } from "../../../_lib/validation.js";
import { createEventRegistrationForMember } from "../../registrations.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env?.DB) {
    return errorResponse(503, "DB_UNAVAILABLE", "Hệ thống đang bảo trì. Vui lòng thử lại sau ít phút.");
  }
  if (!verifyCsrfOrigin(request)) {
    return errorResponse(403, "CSRF_BLOCKED", "Nguồn yêu cầu không hợp lệ.");
  }

  const parsed = await readJsonBody(request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const validated = validateMemberRegisterInput(parsed.data);
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Vui lòng kiểm tra lại thông tin tạo thẻ.", validated.fields);
  }
  if (validated.honeypot) {
    return jsonResponse({ ok: true }, 200);
  }

  const tsToken =
    parsed.data?.["cf-turnstile-response"] ?? parsed.data?.turnstileToken ?? "";
  const tsCheck = await verifyTurnstileToken(request, env, tsToken, "member_register");
  if (!tsCheck.ok) {
    return errorResponse(
      403,
      tsCheck.code || "TURNSTILE_FAILED",
      "Xác minh chống bot chưa thành công. Vui lòng tải lại trang và thử lại."
    );
  }

  const ipHash = await getClientIpHash(request);
  const rl = await checkRateLimit(env.DB, `mbr_reg:${ipHash}`, 8, 15 * 60 * 1000);
  if (!rl.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Bạn đã gửi nhiều yêu cầu liên tiếp. Vui lòng đợi ít phút rồi thử lại.",
      null,
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  const v = validated.value;
  const idInfo = v.identifier;

  await ensureMemberSchema(env.DB);

  // Check duplicate Email or Phone
  const existing =
    idInfo.kind === "email"
      ? await env.DB.prepare("SELECT id FROM members WHERE email = ?").bind(idInfo.email).first()
      : await env.DB.prepare("SELECT id FROM members WHERE phone_norm = ?").bind(idInfo.phoneNorm).first();

  if (existing) {
    return errorResponse(
      409,
      "DUPLICATE_MEMBER",
      idInfo.kind === "email"
        ? "Email này đã có Thẻ Thành Viên Hola. Vui lòng chuyển sang tab Đăng nhập."
        : "Số điện thoại này đã có Thẻ Thành Viên Hola. Vui lòng chuyển sang tab Đăng nhập.",
      { identifier: "Tài khoản đã tồn tại — mời bạn bấm sang Đăng nhập." }
    );
  }

  const { hash, salt } = await hashPassword(v.password);
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const memberId = `mbr-${crypto.randomUUID()}`;

  let memberCode = "";
  let inserted = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    memberCode = await generateSequentialMemberCode(env.DB, nowDate, attempt);
    try {
      await env.DB.prepare(
        `INSERT INTO members
         (id, member_code, email, phone_norm, phone_display, name, organization, pillar_choice,
          avatar_url, avatar_media_key, password_hash, password_salt, is_active, created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, 1, ?, ?, ?)`
      )
        .bind(
          memberId,
          memberCode,
          idInfo.email,
          idInfo.phoneNorm,
          idInfo.phoneDisplay,
          v.name,
          v.organization,
          v.pillar_choice,
          hash,
          salt,
          now,
          now,
          now
        )
        .run();
      inserted = true;
      break;
    } catch (err) {
      const msg = String(err?.message || "");
      if (msg.includes("members.email") || msg.includes("members.phone_norm")) {
        return errorResponse(409, "DUPLICATE_MEMBER", "Tài khoản này đã tồn tại. Vui lòng chuyển sang Đăng nhập.");
      }
      if (!msg.includes("member_code")) {
        throw err;
      }
    }
  }

  if (!inserted) {
    return errorResponse(500, "CODE_GENERATION_FAILED", "Không thể cấp mã Thẻ Thành Viên lúc này. Vui lòng thử lại.");
  }

  const memberRow = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(memberId).first();
  const { rawToken } = await createMemberSession(env.DB, memberId);

  let autoRegistration = null;
  if (v.auto_register_event) {
    autoRegistration = await createEventRegistrationForMember(context, memberRow, v.auto_register_event, ipHash);
  }

  return jsonResponse(
    {
      ok: true,
      member: serializePublicMember(memberRow),
      autoRegistration,
      message: `Chào mừng ${memberRow.name}! Thẻ Thành Viên ${memberRow.member_code} đã sẵn sàng.`,
    },
    201,
    {
      "Set-Cookie": buildMemberSessionCookie(rawToken, request, false),
    }
  );
}
