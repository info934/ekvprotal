# Proxmox Backup For VM 108

The guest VM cannot create a Proxmox snapshot by itself. Install the following
job on the Proxmox host after selecting the actual backup storage:

```bash
vzdump 108 \
  --mode snapshot \
  --compress zstd \
  --storage <backup-storage> \
  --prune-backups 'keep-daily=7,keep-weekly=4,keep-monthly=6' \
  --notes-template '{{guestname}}-{{vmid}}'
```

Recommended schedule on the Proxmox host: daily at 01:30, before the guest
configuration backup at 02:15.

Verification is not complete until a backup is listed and a test restore has
booted on an isolated network. The guest-side configuration archive complements
the VM backup; it does not replace it.
