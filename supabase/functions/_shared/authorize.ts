import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  const { data: member } = await admin
    .from("members")
    .select("id, user_role")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const role = String(member?.user_role || "");
  const actor = { userId: user.id, memberId: member?.id || null, role, isServiceRole: false };

  if (role === "admin") return actor;
  if (options.adminOnly) {
    throw Object.assign(new Error("Administrator permission required."), { status: 403 });
  }

  if (options.module) {
    const { data: permission } = await admin
      .from("role_permissions")
      .select("can_read, can_edit, can_admin")
      .eq("role", role)
      .eq("module", options.module)
      .maybeSingle();
    const allowed = options.level === "admin"
      ? permission?.can_admin
      : options.level === "edit"
        ? permission?.can_edit || permission?.can_admin
        : permission?.can_read || permission?.can_edit || permission?.can_admin;
    if (!allowed) throw Object.assign(new Error("Permission denied."), { status: 403 });
  }

  return actor;
};
