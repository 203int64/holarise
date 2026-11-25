import {
  errorResponse,
  hashPassword,
  jsonResponse,
  readJsonBody,
  requireMember,
  serializePublicMember,
  verifyPassword,
} from "../../_lib/security.js";
import { validateMemberProfileInput } from "../../_lib/validation.js";

export async function onRequestPatch(context) {
  const auth = await requireMember(context);
  if (!auth.ok) return auth.response;

  const parsed = await readJsonBody(context.request, 32 * 1024);
  if (!parsed.ok) return parsed.response;

  const validated = validateMemberProfileInput(parsed.data);
  if (!validated.ok) {
    return errorResponse(400, "VALIDATION_ERROR", "Thông tin cập nhật chưa hợp lệ.", validated.fields);
  }

  const { env } = context;
  const member = auth.member;
  const v = validated.value;

  const fullRow = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(member.id).first();
  if (!fullRow) {
    return errorResponse(404, "NOT_FOUND", "Không tìm thấy hồ sơ thành viên.");
  }

  let nextHash = fullRow.password_hash;
  let nextSalt = fullRow.password_salt;

  if (v.new_password) {
    const okCur = await verifyPassword(v.current_password, fullRow.password_hash, fullRow.password_salt);
    if (!okCur) {
      return errorResponse(400, "INVALID_PASSWORD", "Mật khẩu hiện tại chưa chính xác.", {
        currentPassword: "Mật khẩu hiện tại không đúng.",
      });
    }
    const hashed = await hashPassword(v.new_password);
    nextHash = hashed.hash;
    nextSalt = hashed.salt;
  }

  const nextName = v.name !== undefined ? v.name : fullRow.name;
  const nextOrg = v.organization !== undefined ? v.organization : fullRow.organization;
  const nextPillar = v.pillar_choice !== undefined ? v.pillar_choice : fullRow.pillar_choice;
  const nextAvatarUrl = v.avatar_url !== undefined ? v.avatar_url : fullRow.avatar_url;
  const nextAvatarKey = v.avatar_media_key !== undefined ? v.avatar_media_key : fullRow.avatar_media_key;
  let nextPhoneNorm = fullRow.phone_norm || null;
  let nextPhoneDisplay = fullRow.phone_display || "";

  if (v.phone_norm !== undefined) {
    if (v.phone_norm === null) {
      if (!fullRow.email) {
        return errorResponse(
          400,
          "PHONE_REQUIRED",
          "Tài khoản chưa gắn Email nên không thể xóa số điện thoại.",
          { phone: "Cần giữ số điện thoại để đăng nhập khi chưa có Email." }
        );
      }
      nextPhoneNorm = null;
      nextPhoneDisplay = "";
    } else {
      if (v.phone_norm !== fullRow.phone_norm) {
        const dup = await env.DB.prepare("SELECT id FROM members WHERE phone_norm = ? AND id != ?")
          .bind(v.phone_norm, member.id)
          .first()
          .catch(() => null);
        if (dup) {
          return errorResponse(
            409,
            "DUPLICATE_PHONE",
            "Số điện thoại này đã được gắn với một Thẻ Thành Viên khác.",
            { phone: "Số điện thoại này đã thuộc tài khoản khác." }
          );
        }
      }
      nextPhoneNorm = v.phone_norm;
      nextPhoneDisplay = v.phone_display;
    }
  }

  const oldAvatarKey = fullRow.avatar_media_key || "";
  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE members
     SET name = ?, phone_norm = ?, phone_display = ?, organization = ?, pillar_choice = ?, avatar_url = ?, avatar_media_key = ?,
         password_hash = ?, password_salt = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      nextName,
      nextPhoneNorm,
      nextPhoneDisplay,
      nextOrg,
      nextPillar,
      nextAvatarUrl,
      nextAvatarKey,
      nextHash,
      nextSalt,
      now,
      member.id
    )
    .run();

  if (oldAvatarKey && oldAvatarKey !== nextAvatarKey && env?.MEDIA_KV?.delete) {
    await env.MEDIA_KV.delete(`media:${oldAvatarKey}`).catch(() => null);
  }

  const updated = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(member.id).first();
  return jsonResponse({
    ok: true,
    member: serializePublicMember(updated),
    message: "Đã lưu cập nhật Thẻ Thành Viên của bạn.",
  });
}
