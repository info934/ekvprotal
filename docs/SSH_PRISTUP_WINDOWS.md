# SSH klíč pro přístup z Windows

Klíč se vytváří na počítači, ze kterého se budeš připojovat. Otevři PowerShell a spusť:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
ssh-keygen -t ed25519 -a 100 -C "EKV portal" -f "$env:USERPROFILE\.ssh\ekvportal_ed25519"
```

Pokud už soubor s tímto názvem existuje, nepřepisuj ho; použij existující klíč nebo jiný název. Na dotaz `Enter passphrase` zadej heslo chránící soukromý klíč a zopakuj ho. Při psaní se heslo nezobrazuje.

Vzniknou dva soubory:

- `ekvportal_ed25519` – soukromý klíč, zůstává v tomto počítači. Neposílej jej do chatu ani na server.
- `ekvportal_ed25519.pub` – veřejný klíč, který se přidává k účtu na serveru.

Veřejný klíč zobrazíš takto:

```powershell
Get-Content "$env:USERPROFILE\.ssh\ekvportal_ed25519.pub"
```

Celý zobrazený řádek začínající `ssh-ed25519` přidá správce do `~/.ssh/authorized_keys` cílového účtu na linuxovém serveru; stávající klíče zachová. První přidání vyžaduje existující přístup heslem nebo přes konzoli serveru, například v Proxmoxu. Samotné vytvoření klíče ještě přístup na server nezajistí.

Po přidání veřejného klíče a ověření otisku serveru se připojíš:

```powershell
ssh -i "$env:USERPROFILE\.ssh\ekvportal_ed25519" UZIVATEL@SERVER
```

`UZIVATEL@SERVER` nahraď ověřeným cílem. Dokumentace portálu uvádí produkci `root@192.168.1.180`, zatímco vývojový připojovací skript míří na `root@192.168.1.193`; před nasazením je potřeba určit správný server. Supabase Cloud má samostatné přihlášení a tento SSH klíč nepoužívá.

Zdroj pro generování a ochranu klíčů na Windows: [Microsoft – OpenSSH key management](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_keymanagement).
