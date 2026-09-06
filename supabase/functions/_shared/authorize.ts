import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertActiveAccount } from "./accountStatus.ts";

export type FunctionActor = {
  userId: string | null;
  memberId: string | null;
  role: string;
  isServiceRole: boolean;
};

export const authorizeFunctionRequest = async (
  req: Request,
  options: { adminOnly?: boolean; module?: string; level?: "read" | "edit" | "admin" } = {},
): Promise<FunctionActor> => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!supabaseUrl || !serviceRoleKey || !token) {
    throw Object.assign(new Error("Authentication required."), { status: 401 });
  }

  if (token === serviceRoleKey) {
    return { userId: null, memberId: null, role: "service_role", isServiceRole: true };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user) {
    throw Object.assign(new Error("Invalid session."), { status: 401 });
  }

  await assertActiveAccount(admin, user.id);

  const { data: member, error: memberError } = await admin
    .from("members")
    .select("id, user_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (memberError) {
    throw Object.assign(new Error("Could not verify user identity."), { status: 503 });
  }
  if (!member) {
    throw Object.assign(new Error("Employee identity is required."), { status: 403 });
  }
  const role = String(member?.user_role || "");
  const actor = { userId: user.id, memberId: member?.id || null, role, isServiceRole: false };

  if (role === "admin") return actor;
  if (options.adminOnly) {
    throw Object.assign(new Error("Administrator permission required."), { status: 403 });
  }

  if (options.module) {
    const [roleResult, overrideResult] = await Promise.all([
      admin
        .from("role_permissions")
        .select("can_read, can_edit, can_admin")
        .eq("role", role)
        .eq("module", options.module)
        .maybeSingle(),
      admin
        .from("member_permission_overrides")
        .select("access_level, expires_at")
        .eq("member_id", member.id)
        .eq("module", options.module)
        .maybeSingle(),
    ]);
    if (roleResult.error || overrideResult.error) {
      throw Object.assign(new Error("Could not verify permissions."), { status: 503 });
    }
    const override = overrideResult.data;
    const overrideActive = override && (!override.expires_at || new Date(override.expires_at).getTime() > Date.now());
    const overrideRanks: Record<string, number> = { none: 0, read: 1, edit: 2, admin: 3 };
    const rank = overrideActive
      ? (overrideRanks[String(override.access_level)] ?? 0)
      : roleResult.data?.can_admin
        ? 3
        : roleResult.data?.can_edit
          ? 2
          : roleResult.data?.can_read
            ? 1
            : 0;
    const required = options.level === "admin" ? 3 : options.level === "edit" ? 2 : 1;
    const allowed = rank >= required;
    if (!allowed) throw Object.assign(new Error("Permission denied."), { status: 403 });
  }

  return actor;
};
