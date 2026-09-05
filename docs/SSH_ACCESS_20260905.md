# Ověřený SSH přístup a přenos portálu – 5. 9. 2026

Přihlášení přes terminál na uživatelem potvrzený Proxmox `root@192.168.1.11` proběhlo úspěšně. Proxmox potvrdil běžící VM **108**, název **web-app**, IP **192.168.1.180**. Přenos a nastavení přístupu proběhly bez použití webové konzole.

## Provedené změny

- Na VM 108 byl do `/root/.ssh/authorized_keys` přidán veřejný klíč `EKV Portal deployment key`.
- Původní klíč `codex-faktura-v2` zůstal zachován. Před změnou vznikla kopie `/root/.ssh/authorized_keys.before-ekvportal-20260905T115002Z`.
- Otisk nového klientského klíče: `SHA256:DOPHHgU1A2DZnF0P6YXGr4u8uZGK5ypBro/vXVtGZWM` (Ed25519).
- Soukromý klíč zůstal na místním počítači v `C:\Users\IngJanKopačka\.ssh\ekvportal_ed25519`; na server se neposílal.
- Hostitelský veřejný klíč VM byl přečten přes QEMU Guest Agent na autentizovaném Proxmoxu a uložen do místního `output/ssh-vm108-known-hosts`. Přímé SSH přihlášení použilo `StrictHostKeyChecking=yes` a tento ověřený záznam.
- Přímé přihlášení klíčem vrátilo `web-app`, `root` a `EKV_SSH_ACCESS_OK`. Adresář aplikace `/opt/ekvportal` existuje.

## Přenesené vydání

Archiv `ekvportal-2.0-20260905T114315Z.tar.gz` i jeho kontrolní součet byly přeneseny přes SCP do `/opt/ekvportal-releases/`. SHA-256 na serveru souhlasí s lokálním:

```text
55d4e90e04c9de61f10fb0d0c7acb1a58cf53c7fc9f768852df364104dbe5aeb
```

Ověřený archiv byl rozbalen do samostatného adresáře:

```text
/opt/ekvportal-releases/ekvportal-2.0-20260905T114315Z
```

Obsahuje aktuální zdrojové soubory včetně necommitnutých úprav, migrace, Edge funkce a `RELEASE-MANIFEST.json`. Produkční `.env` zůstal v `/opt/ekvportal/.env`; není součástí přeneseného archivu.

## Stav produkce

Původní kontejner `ekvportal` zůstává spuštěný a `healthy`, port je `127.0.0.1:8080`, lokální HTTP kontrola vrací `200`. Jeho image ID při ověření:

```text
sha256:cd55c4c9fa98c6b9145ff4fbe650419bd4a9507e0dacc64e68473539a528596d
```

Nové vydání nebylo sestaveno ani aktivováno. Další postup je ověřit a nasadit pět připravených migrací Supabase podle [aktuálního návodu](SUPABASE_MIGRACE_2_0.md), znovu nasadit jedenáct závislých Edge funkcí, sestavit kandidátní image s produkční konfigurací a po kontrole přepnout frontend. Původní image a konfiguraci zachovat pro návrat. Úspěšný přenos zdrojů není potvrzením produkčního nasazení nové aplikace.

Hesla ani přístupové tokeny tento protokol neobsahuje. Proxmox SSH host key byl při prvním připojení uložen standardním režimem `accept-new` pro uživatelem potvrzenou adresu; klíč VM byl následně ověřen proti údajům získaným z Proxmoxu.
