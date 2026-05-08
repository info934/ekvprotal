import { z } from 'zod';

// Helper for optional empty string to null/undefined
const emptyToNull = (val) => (val === '' ? null : val);

// --- MEMBER SCHEMA ---
export const MemberSchema = z.object({
  name: z.string().min(1, 'Jméno je povinné'),
  email: z.string().email('Neplatný email').optional().or(z.literal('')),
  role_id: z.string().uuid('Vyberte pozici').optional().nullable(),
  hourly_rate: z.coerce.number().nonnegative('Hodinová sazba nesmí být záporná').optional().default(0),
  phone: z.string().optional().nullable(),
  internal_note: z.string().optional().nullable(),
  attendance_enabled: z.boolean().default(true),
});

// --- PROJECT SCHEMA ---
export const ProjectSchema = z.object({
  name: z.string().min(1, 'Název projektu je povinný'),
  code: z.string().min(1, 'Kód projektu je povinný'),
  status: z.enum(['nabidka', 'active', 'ready_for_delivery', 'delivered', 'closed']),
  price: z.coerce.number().positive('Cena musí být kladná'),
  budget_percentage: z.coerce.number().min(0, 'Minimálně 0%').max(100, 'Maximálně 100%'),
  overhead_percentage: z.coerce.number().min(0, 'Minimálně 0%').max(100, 'Maximálně 100%'),
  type: z.string().optional().nullable(),
  stage_id: z.string().uuid().optional().nullable(),
  created_by_member_id: z.string().uuid('Vyberte hlavního projektanta').optional().nullable(),
  completion_date: z.string().optional().nullable(),
  start_date: z.string().optional().nullable(),
  investor_id: z.string().uuid('Investor je povinný'),
  client_id: z.string().uuid('Zadavatel je povinný'),
  is_priority: z.boolean().optional(),
}).refine((data) => {
  if (data.start_date && data.completion_date) {
    return new Date(data.completion_date) >= new Date(data.start_date);
  }
  return true;
}, {
  message: "Datum dokončení musí být po datu zahájení",
  path: ["completion_date"],
});


// --- REALIZATION SCHEMA ---
export const RealizationSchema = z.object({
  name: z.string().min(1, 'Název realizace je povinný'),
  status: z.string().min(1, 'Stav je povinný'),
  type: z.string().optional().nullable(),
  investor_id: z.string().uuid('Vyberte investora').optional().nullable(),
  lead_person_id: z.string().uuid('Vyberte vedoucího').optional().nullable(),
  contract_amount: z.coerce.number().positive('Smluvní částka musí být kladná'),
  budget: z.coerce.number().nonnegative('Rozpočet nesmí být záporný').optional(),
  expected_total_cost: z.coerce.number().nonnegative('Očekávaný náklad nesmí být záporný').optional(),
  actual_costs: z.coerce.number().nonnegative('Aktuální náklady nesmí být záporné').optional(),
  profit_margin_percent: z.coerce.number().min(0).max(100, 'Maximálně 100%').optional().nullable(),
  overhead_percent: z.coerce.number().min(0).max(100, 'Maximálně 100%').optional().nullable(),
  start_date: z.string().optional().nullable(),
  planned_end_date: z.string().optional().nullable(),
  actual_end_date: z.string().optional().nullable(),
  location_address: z.string().optional().nullable(),
}).refine((data) => {
  if (data.start_date && data.planned_end_date) {
    return new Date(data.planned_end_date) >= new Date(data.start_date);
  }
  return true;
}, {
  message: "Plánované dokončení musí být po datu zahájení",
  path: ["planned_end_date"],
});

// --- PAYOUT SCHEMA ---
export const PayoutItemSchema = z.object({
  project_id: z.string().uuid().optional().nullable(),
  realization_id: z.string().uuid().optional().nullable(),
  realizace_id: z.string().uuid().optional().nullable(), // Added for backwards compatibility
  amount: z.coerce.number().positive('Částka musí být kladná'),
}).refine(data => data.project_id || data.realization_id || data.realizace_id, {
  message: "Položka výplaty musí být přiřazena k projektu nebo realizaci",
  path: ["project_id"]
});

export const PayoutSchema = z.object({
  member_id: z.string().uuid('Vyberte zaměstnance'),
  request_date: z.string().min(1, 'Datum žádosti je povinné'),
  reason: z.string().optional().nullable(),
  items: z.array(PayoutItemSchema).min(1, 'Musíte vybrat alespoň jednu položku k vyplacení'),
});

// --- ATTENDANCE SCHEMA ---
export const AttendanceSchema = z.object({
  member_id: z.string().uuid('Vyberte pracovníka'),
  date: z.string().min(1, 'Datum je povinné'),
  description: z.string().optional().nullable(),
  hours: z.coerce.number().positive('Počet hodin musí být kladný').max(24, 'Maximálně 24 hodin denně'),
  project_id: z.string().uuid().optional().nullable(),
  realizace_id: z.string().uuid().optional().nullable(),
}).refine(data => {
  return !!(data.project_id || data.realizace_id);
}, {
  message: "Musíte vybrat projekt nebo realizaci",
  path: ["project_id"],
});

// Helper validation functions
export const validateData = (schema, data) => {
  try {
    return { success: true, data: schema.parse(data) };
  } catch (error) {
    return { success: false, error };
  }
};
