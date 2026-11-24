import { getSessionMember, jsonResponse, serializePublicMember } from "../../../_lib/security.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const member = env?.DB ? await getSessionMember(env.DB, request) : null;
  return jsonResponse({
    ok: true,
    authenticated: Boolean(member),
    member: member ? serializePublicMember(member) : null,
  });
}
