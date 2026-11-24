import { getSessionMember, jsonResponse, serializePublicMember } from "../../../_lib/security.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const member = env?.DB ? await getSessionMember(env.DB, request) : null;
  const googleEnabled = Boolean(
    String(env?.GOOGLE_CLIENT_ID || "").trim() && String(env?.GOOGLE_CLIENT_SECRET || "").trim()
  );
  return jsonResponse({
    ok: true,
    authenticated: Boolean(member),
    googleEnabled,
    member: member ? serializePublicMember(member) : null,
  });
}
