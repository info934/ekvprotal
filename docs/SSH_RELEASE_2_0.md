# Přenos EKV Portal 2.0 přes SSH

Balíček vytváří `node tools/package-ssh-release.mjs` do `output/releases/`. Obsahuje aktuální pracovní soubory včetně necommitnutých změn, potřebný `vendor`, databázové migrace a Edge funkce. Neobsahuje skutečné `.env`, SSH klíče, databázové seedy, `.git`, nainstalované závislosti ani předchozí buildy. `RELEASE-MANIFEST.json` eviduje SHA-256 každého souboru; vedle archivu je kontrolní součet celého balíčku.

Dokumentovaný produkční server je `root@192.168.1.180`, `/opt/ekvportal`, `https://portal.ekvproject.cz`. Soubor `connect-ekvportal.bat` naopak míří na vývojový stroj `192.168.1.193` a `/root/ekvportal`; nejde o totožný cíl. Před přenosem vybrat skutečný cíl a ověřit SSH host key důvěryhodnou cestou. Hesla ani obsah soukromých klíčů nepatří do chatu či tohoto dokumentu.

## Přenos a ověření

Přes SCP přenést archiv a jeho `.sha256` do samostatného adresáře serveru. Po přenosu ve stejném adresáři použít `sha256sum -c JMENO_ARCHIVU.tar.gz.sha256`. Rozbalit do nového adresáře vydání, nikoli přes stávající `/opt/ekvportal`. Původní `.env`, checkout, kontejner i přesnou image zatím zachovat.

Pro nový build použít serverový soubor s konfigurací pomocí `docker compose --env-file /opt/ekvportal/.env build ekvportal` ze složky nového vydání; předtím určit samostatný image tag, aby nedošlo k přepsání značky produkčního obrazu. Do frontendové konfigurace smí jen veřejný Supabase anon/publishable klíč, nikdy `service_role`. Build je nutný s reálnou konfigurací: lokální úspěšná kompilace sama její dostupnost nedokazuje.

## Zapnutí nové verze

Celý portál 2.0 vyžaduje změny uvedené v [backendovém postupu](EKVPORTAL_2_0_BACKEND_ROLLOUT.md): ověřená historie migrací, pět nových migrací a společná revize jedenácti Edge funkcí. Docker Compose tyto kroky neprovádí. Předchozí práce na samotném rozložení detailů další migraci nepřidala, ale neruší závislosti ostatních změn.

Samostatný databázový ZIP vytváří `python tools/package-supabase-release.py`. Obsahuje kompletní migrační historii, aktuální zdroje Edge funkcí a [návod pro Supabase](SUPABASE_MIGRACE_2_0.md). V tomto ZIPu jsou kontroly v `checks/`; ve zdrojovém SSH balíčku jsou stejné soubory v `supabase/checks/`. Přizpůsobit tedy cestu argumentu `psql -f` použitému balíčku.

Nejprve ověřit backend a samostatně sestavený kandidát. Uchovat předchozí image pod konkrétním rollback tagem. Teprve potom přepnout běžící službu a zkontrolovat přihlášení, oprávnění, zaměstnaneckou kartu, CRM, docházku a finance. HTTP 200 na portu 8080 potvrzuje pouze dostupnost HTML. Nepoužívat `docker image prune`, `db reset` ani přepis starou zálohou jako běžný návrat.

Aktuální stav připojení a vydání evidovat odděleně; samotný připravený balíček není potvrzení přenosu ani nasazení.
