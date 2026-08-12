import { fetchWithTimeout } from "./fetch.ts";

type DeliveryInput = {
  admin: any;
  resendApiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
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
  const { data: existing } = await input.admin
    .from("workflow_email_deliveries")
    .select("id, status, provider_message_id, sent_at")
    .eq("idempotency_key", key)
    .maybeSingle();

  if (existing?.status === "sent") {
    return { success: true, duplicate: true, emailId: existing.provider_message_id, recipients, sentAt: existing.sent_at };
  }

  const attempt = {
    idempotency_key: key,
    workflow_type: input.workflowType,
    entity_type: input.entityType,
    entity_id: input.entityId || null,
    event_type: input.eventType,
    recipient: recipients.join(","),
    status: "pending",
    requested_by: input.requestedBy || null,
    metadata: input.metadata || {},
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    await input.admin.from("workflow_email_deliveries").update(attempt).eq("id", existing.id);
    await input.admin.rpc("increment_workflow_email_attempt", { p_delivery_id: existing.id });
  } else {
    await input.admin.from("workflow_email_deliveries").insert(attempt);
  }

  const response = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.resendApiKey}`,
      "Idempotency-Key": key,
    },
    body: JSON.stringify({ from: input.from, to: recipients, subject: input.subject, html: input.html }),
  });
  const data = await response.json();

  if (!response.ok) {
    const message = data?.message || data?.error || `Resend API error ${response.status}`;
    await input.admin.from("workflow_email_deliveries")
      .update({ status: "failed", error_message: message, updated_at: new Date().toISOString() })
      .eq("idempotency_key", key);
    throw Object.assign(new Error(message), { status: 502 });
  }

  const sentAt = new Date().toISOString();
  await input.admin.from("workflow_email_deliveries")
    .update({ status: "sent", provider_message_id: data?.id || null, error_message: null, sent_at: sentAt, updated_at: sentAt })
    .eq("idempotency_key", key);

  return { success: true, duplicate: false, emailId: data?.id, recipients, sentAt };
};
