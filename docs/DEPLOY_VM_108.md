# Deploy EKVPortal na VM 108

Target:

- VM: `192.168.1.180`
- OS: Debian 12
- App: staticky buildovana React/Vite aplikace
- Databaze: zustava online Supabase
- Doporučený běh: Docker Compose + Nginx reverse proxy

## 1. DNS

Nastav DNS zaznam:

```text
portal.ekvproject.cz A 192.168.1.180
```

Pokud zatim domena neni pripravena, aplikace muze bezet primo na:

```text
http://192.168.1.180:8080
```

## 2. Priprava serveru

Na VM jako `root`:

```bash
apt update
apt install -y git ca-certificates curl nginx
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker nginx
```

## 3. Stazeni aplikace

```bash
mkdir -p /opt/ekvportal
cd /opt/ekvportal
git clone https://github.com/info934/ekvprotal.git .
git checkout baseline-freeze-crm-documents
```

## 4. Environment

Vytvor soubor `/opt/ekvportal/.env`:

```bash
APP_PORT=8080
VITE_SUPABASE_URL=https://yurysbxxevtuvhrbmloc.supabase.co
VITE_SUPABASE_ANON_KEY=SEM_VLOZ_SUPABASE_ANON_KEY
```

Poznamka: `VITE_SUPABASE_ANON_KEY` je public anon key pro frontend, ne service-role key.

## 5. Spusteni pres Docker Compose

```bash
cd /opt/ekvportal
docker compose up -d --build
docker compose ps
```

Ověření:

```bash
curl -I http://127.0.0.1:8080
```

## 6. Nginx reverse proxy

Pouzij konfiguraci z repozitare:

```bash
cp /opt/ekvportal/deploy/vm108-nginx-site.conf /etc/nginx/sites-available/ekvportal
ln -sf /etc/nginx/sites-available/ekvportal /etc/nginx/sites-enabled/ekvportal
nginx -t
systemctl reload nginx
```

Pak otevri:

```text
http://portal.ekvproject.cz
```

## 7. HTTPS

Az bude DNS nasmerovane na VM:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d portal.ekvproject.cz
```

## 8. Aktualizace aplikace

```bash
cd /opt/ekvportal
git pull
docker compose up -d --build
docker image prune -f
```

## 9. Kontrolni prikazy

```bash
docker compose ps
docker compose logs -f --tail=100
systemctl status nginx --no-pager
nginx -t
```

## 10. Poznamky k Supabase

Protoze databaze zustava online v Supabase, na VM neni potreba Postgres. Je ale nutne v Supabase Auth nastavit produkcni URL:

- Site URL: `https://portal.ekvproject.cz`
- Redirect URLs:
  - `https://portal.ekvproject.cz/*`
  - pripadne docasne `http://192.168.1.180:8080/*`

