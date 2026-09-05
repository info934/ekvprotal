// Run with a server client only: status must not depend on the caller's RLS view.
export const assertActiveAccount = async (admin: any, userId: string) => {
  const { data, error } = await admin
    .from("user_account_status")
    .select("status")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error("Could not verify account status."), { status: 503 });
  }
  // Older accounts have no status row. Only an explicit active row or no row is allowed.
  if (data && data.status !== "active") {
    throw Object.assign(new Error("Account is disabled."), { status: 403, code: "ACCOUNT_DISABLED" });
  }
};
