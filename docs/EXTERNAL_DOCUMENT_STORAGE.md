# External document storage

## Goal

The portal can keep the current Supabase Storage behavior and later switch project and realization documents to SharePoint or Google Drive from Settings.

Secrets and OAuth tokens must stay server-side in Supabase Edge Functions. The frontend stores only non-secret routing metadata such as provider, site ID, drive ID, root folder ID, and folder templates.

## Data model

- `document_storage_connections`: configured providers and default storage selection.
- `document_storage_folders`: folder mapping for a project or realization.
- `documents.storage_*`: optional external file metadata while keeping the existing `file_path` for Supabase Storage.
- `realizace_costs.invoice_storage_*`: optional external invoice metadata for realization costs.

## Folder structure

Default project folders:

- `00_Admin`
- `01_Smlouvy`
- `02_Dokumentace`
- `03_Predani`
- `04_Fakturace`

Default realization folders:

- `00_Admin`
- `01_Objednavky`
- `02_Naklady`
- `03_Fotodokumentace`
- `04_Predani`
- `05_Fakturace`

## Edge Function contract

Function: `document-storage`

Actions:

- `ensureFolder`: create or return the remote folder for `project` or `realizace`.
- `uploadFile`: upload a file to the mapped folder and return file IDs and web URL.
- `downloadUrl`: return a temporary download URL or direct web URL.

Expected request fields:

- `action`
- `provider`: `sharepoint` or `google_drive`
- `connectionId`
- `entityType`: `project` or `realizace`
- `entityId`
- `folderPath`
- upload only: `fileName`, `contentType`, `fileBase64`

Expected upload response:

```json
{
  "success": true,
  "fileId": "remote-file-id",
  "parentId": "remote-folder-id",
  "webUrl": "https://...",
  "metadata": {}
}
```

## Provider setup

SharePoint:

- Create an Azure app registration for Microsoft Graph.
- Grant least-privilege file access to the selected SharePoint site or drive.
- Store client ID, tenant ID, client secret, and refresh/token handling in Edge Function secrets.
- Save only site/drive/root identifiers in Settings -> Uloziste dokumentu.

Google Drive:

- Create a Google Cloud OAuth client or service account depending on ownership model.
- Grant access only to the selected Shared Drive or root folder.
- Store client credentials and token handling in Edge Function secrets.
- Save only drive/root identifiers in Settings -> Uloziste dokumentu.

## Next implementation step

Implement provider clients inside `supabase/functions/document-storage/index.ts`:

- Microsoft Graph: folder lookup/create and file upload session.
- Google Drive API: folder lookup/create and multipart/resumable upload.
- Store remote folder mappings in `document_storage_folders`.
