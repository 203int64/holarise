import { getSessionMember, jsonResponse } from "../../../_lib/security.js";

export async function onRequestGet({ request, env }) {
  const member = env?.DB ? await getSessionMember(env.DB, request) : null;
  return jsonResponse({
    ok: true,
    authenticated: Boolean(member),
    member: member || null,
  });
}
