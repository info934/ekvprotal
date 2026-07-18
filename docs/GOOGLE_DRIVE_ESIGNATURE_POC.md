# Google Drive eSignature PoC

## Účel

EKVPortal připraví finální PDF protokolu nebo smlouvy a uloží ho do Google Drive. Google Drive následně slouží jako pracovní plocha pro ruční vložení podpisových polí a odeslání žádosti o podpis.

Google neposkytuje veřejné API pro vytvoření a odeslání eSignature žádosti. Proto portál automatizuje přípravu dokumentu a audit, ale samotné umístění polí a odeslání zůstává ruční krok v Google Drive.

## Bezpečnostní hranice

- Funkce je dostupná jen administrátorům.
- OAuth používá scope `drive.file`, takže aplikace vidí pouze soubory, které sama vytvořila nebo které jí uživatel explicitně zpřístupnil.
- Access a refresh tokeny jsou šifrované pomocí AES-256-GCM.
- Client secret, šifrovací klíč ani tokeny nesmí být v Git repozitáři.
- SharePoint zůstává hlavním dokumentovým úložištěm.
- PoC soubory mají prefix `TEST-` a ukládají se do `EKVPortal-eSignature-POC/K podpisu`.

## Supabase secrets

```text
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY
GOOGLE_DRIVE_REDIRECT_URI
GOOGLE_ESIGNATURE_POC_ENABLED=true
```

`GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY` je base64 řetězec přesně 32 náhodných bajtů. Produkční callback:

```text
https://yurysbxxevtuvhrbmloc.supabase.co/functions/v1/google-drive-esign/callback
```

## Workflow

1. Administrátor propojí Google účet v `Nastavení → Úložiště`.
2. V detailu protokolu nebo smlouvy zvolí `Google podpis`.
3. Doplní podepisující osoby a potvrdí přípravu.
4. Portál vygeneruje PDF, spočítá SHA-256 hash, uloží auditní žádost a otevře soubor v Drive.
5. Administrátor vloží podpisová pole a odešle žádost v Google Drive.
6. V portálu potvrdí `Odesláno`.
7. Po dokončení podpisu administrátor připojí/ověří podepsanou verzi a označí žádost jako `Podepsáno`.

## Audit

Stav uchovávají tabulky:

- `document_signature_requests`
- `document_signature_signers`
- `document_signature_events`

Zdrojový PDF hash zajišťuje dohledatelnost verze připravené k podpisu.
