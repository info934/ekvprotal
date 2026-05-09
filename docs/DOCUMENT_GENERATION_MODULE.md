# Document generation module

## Purpose

The module prepares a shared generation layer for commercial documents:

- offers
- orders
- contracts
- future custom CRM/project documents

The first implementation generates printable HTML, DOCX and PDF documents in the browser. The same payload shape is intentionally isolated in `src/lib/documentGenerationService.js` so it can later be sent to a Supabase Edge Function or a background job queue without changing CRM screens.

## Current flow

1. CRM detail loads `crm_commercial_documents` and `crm_commercial_document_items`.
2. User clicks `Generovat` on an offer or order.
3. `buildDocumentGenerationPayload()` normalizes opportunity, document and item data.
4. Optional template content from `order_templates` is filled through `{placeholder}` tokens.
5. `renderCommercialDocumentHtml()` renders either the selected template or the default standalone HTML document.
6. `downloadGeneratedDocumentDocx()` creates a `.docx` file through the `docx` library.
7. `downloadGeneratedDocumentPdf()` creates a `.pdf` file through `jsPDF`.

## Template placeholders

The CRM generator supports placeholders in both `{key}` and `{{key}}` format. Current keys:

- `{document_number}`, `{document_title}`, `{document_type}`, `{document_date}`, `{document_valid_until}`
- `{client_name}`, `{project_name}`, `{project_code}`, `{opportunity_title}`, `{opportunity_value}`
- `{items_table}`, `{subtotal}`, `{discount_total}`, `{tax_total}`, `{total_amount}`, `{total_with_tax}`
- `{notes}`, `{generated_at}`
- legacy aliases: `{supplier_name}`, `{order_number}`, `{order_date}`, `{delivery_date}`, `{realization_name}`, `{admin_name}`

## Planned background flow

1. UI creates a generation request:
   - document type
   - document id
   - output format: `html`, `pdf`, `docx`
   - requested by member
2. A background worker or Edge Function renders the document.
3. Generated file is saved through the configured document storage provider.
4. The generated file is linked back to the CRM document and visible in the document module.

## Suggested database tables

Future migration:

```sql
create table public.document_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id uuid not null,
  output_format text not null default 'pdf',
  status text not null default 'queued',
  requested_by uuid null references public.members(id),
  generated_document_id uuid null references public.documents(id),
  error_message text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);
```

Recommended statuses: `queued`, `running`, `completed`, `failed`.

## Next implementation steps

1. Add Supabase Edge Function `generate-document`.
2. Persist generated files into configured storage.
3. Create `document_generation_jobs` migration and status UI.
4. Add server-side DOCX to PDF conversion for exact parity with Word output.
5. Add dedicated CRM template categories instead of reusing `order_templates`.
