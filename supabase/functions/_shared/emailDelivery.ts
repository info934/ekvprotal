import { fetchWithTimeout } from "./fetch.ts";

type DeliveryInput = {
  admin: any;
  resendApiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  attachments?: { filename: string; content: string }[];
  idempotencyKey: string;
  workflowType: string;
  entityType: string;
  entityId?: string | null;
  eventType: string;
  requestedBy?: string | null;
  metadata?: Record<string, unknown>;
};

export const sendTrackedEmail = async (input: DeliveryInput) => {
  const recipients = [...new Set(input.to.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (recipients.length === 0) throw Object.assign(new Error("No email recipient configured."), { status: 400 });

  const key = `${input.idempotencyKey}:${recipients.join(",")}`;
  const { data: existing, error: lookupError } = await input.admin
    .from("workflow_email_deliveries")
    .select("id, status, provider_message_id, sent_at, attempts")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (lookupError) throw Object.assign(new Error("Could not verify email delivery history."), { status: 503 });

  if (existing?.status === "sent") {
    return { success: true, duplicate: true, emailId: existing.provider_message_id, recipients, sentAt: existing.sent_at };
  }

  const pendingError = () => Object.assign(new Error(
    "Doručení e-mailu zatím není potvrzené. Před dalším odesláním ověřte stav u poskytovatele.",
  ), { status: 409, deliveryStatus: "pending" });
  // Pending may mean another request is sending, a timeout after acceptance, or a
  // successful provider response whose final DB write failed. Never blindly resend.
  if (existing && existing.status !== "failed") throw pendingError();

  const attempt = {
    idempotency_key: key,
    workflow_type: input.workflowType,
    entity_type: input.entityType,
    entity_id: input.entityId || null,
    event_type: input.eventType,
    recipient: recipients.join(","),
    status: "pending",
    error_message: null,
    requested_by: input.requestedBy || null,
    metadata: input.metadata || {},
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    // Claim the retry atomically: exactly one caller can transition failed -> pending.
    const { data: claimed, error: claimError } = await input.admin.from("workflow_email_deliveries")
      .update({ ...attempt, attempts: (existing.attempts || 1) + 1 })
      .eq("id", existing.id).eq("status", "failed").select("id").maybeSingle();
    if (claimError) throw Object.assign(new Error("Could not record email delivery attempt."), { status: 503 });
    if (!claimed) throw pendingError();
  } else {
    const { error: insertError } = await input.admin.from("workflow_email_deliveries").insert(attempt);
    if (insertError?.code === "23505") throw pendingError();
    if (insertError) throw Object.assign(new Error("Could not record email delivery attempt."), { status: 503 });
  }

  const recordOutcome = async (values: Record<string, unknown>) => {
    try {
      const { data, error } = await input.admin.from("workflow_email_deliveries")
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq("idempotency_key", key).eq("status", "pending").select("id").maybeSingle();
      if (error || !data) {
        console.error("Could not persist email outcome", error?.code || "missing delivery row");
        return false;
      }
      return true;
    } catch {
      console.error("Could not persist email outcome: network failure");
      return false;
    }
  };

  let response: Response;
  let data: any;
  try {
    response = await fetchWithTimeout("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.resendApiKey}`,
        "Idempotency-Key": key,
      },
      body: JSON.stringify({ from: input.from, to: recipients, subject: input.subject, html: input.html,
        ...(input.attachments?.length ? { attachments: input.attachments } : {}) }),
    });
    // fetchWithTimeout bounds response headers; bound body consumption as well.
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      data = await Promise.race([
        response.json(),
        new Promise((_, reject) => {
          bodyTimer = setTimeout(() => reject(new Error("Email response body timed out.")), 20_000);
        }),
      ]);
    } finally {
      clearTimeout(bodyTimer);
    }
  } catch {
    await recordOutcome({ error_message: "Provider response unavailable; delivery may have succeeded. Reconciliation required." });
    throw pendingError();
  }

  if (!response.ok) {
    const message = String(data?.message || data?.error || `Resend API error ${response.status}`);
    // Server/network/concurrency failures do not prove that no email was accepted.
    const rejected = response.status >= 400 && response.status < 500
      && ![408, 409].includes(response.status);
    await recordOutcome({ status: rejected ? "failed" : "pending", error_message: message });
    if (!rejected) throw pendingError();
    throw Object.assign(new Error(message), { status: 502 });
  }

  if (!data?.id) {
    await recordOutcome({ error_message: "Provider accepted the request without a message ID. Reconciliation required." });
    throw pendingError();
  }

  const sentAt = new Date().toISOString();
  const recorded = await recordOutcome({ status: "sent", provider_message_id: data.id, error_message: null, sent_at: sentAt });

  // Provider acceptance is success even if evidence persistence fails. The pending
  // claim still blocks a duplicate; tell the caller/admin that evidence needs repair.
  return { success: true, duplicate: false, emailId: data.id, recipients, sentAt, recorded,
    ...(recorded ? {} : { warning: "E-mail byl přijat poskytovatelem, ale potvrzení se nepodařilo uložit." }) };
};
