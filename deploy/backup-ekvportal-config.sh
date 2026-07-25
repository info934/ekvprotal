#!/bin/sh
set -eu

APP_DIR="${APP_DIR:-/opt/ekvportal}"
BACKUP_DIR="${BACKUP_DIR:-/opt/backups/ekvportal/config}"
RETENTION="${RETENTION:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK_DIR="${BACKUP_DIR}/${STAMP}"
ARCHIVE="${BACKUP_DIR}/ekvportal-config-${STAMP}.tar.gz"

install -d -m 0700 "${BACKUP_DIR}" "${WORK_DIR}"

cd "${APP_DIR}"
git rev-parse HEAD > "${WORK_DIR}/git-commit.txt"
git status --short > "${WORK_DIR}/git-status.txt"
docker image inspect ekvportal:latest > "${WORK_DIR}/ekvportal-image-inspect.json"
docker inspect ekvportal > "${WORK_DIR}/ekvportal-container-inspect.json"
dpkg-query -W -f='${binary:Package}\t${Version}\n' > "${WORK_DIR}/packages.tsv"

for file in docker-compose.yml Dockerfile .env; do
  if [ -e "${file}" ]; then
    cp -a "${file}" "${WORK_DIR}/"
  fi
done

for path in \
  /etc/nginx/nginx.conf \
  /etc/nginx/sites-available \
  /etc/nginx/sites-enabled \
  /etc/ssh/sshd_config \
  /etc/ssh/sshd_config.d; do
  if [ -e "${path}" ]; then
    cp -a "${path}" "${WORK_DIR}/"
  fi
done

tar -C "${BACKUP_DIR}" -czf "${ARCHIVE}" "${STAMP}"
chmod 0600 "${ARCHIVE}"
sha256sum "${ARCHIVE}" > "${ARCHIVE}.sha256"
chmod 0600 "${ARCHIVE}.sha256"
tar -tzf "${ARCHIVE}" >/dev/null
sha256sum -c "${ARCHIVE}.sha256"
rm -rf "${WORK_DIR}"

find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'ekvportal-config-*.tar.gz' \
  -printf '%T@ %p\n' \
  | sort -nr \
  | awk -v keep="${RETENTION}" 'NR > keep { print $2 }' \
  | while IFS= read -r old_archive; do
      rm -f "${old_archive}" "${old_archive}.sha256"
    done

printf 'Created verified configuration backup: %s\n' "${ARCHIVE}"
