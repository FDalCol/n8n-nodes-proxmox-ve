# n8n-nodes-proxmox-ve

n8n community nodes for [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment):
manage nodes, VMs, containers, storage, backups, HA and tasks, and start workflows on
Proxmox VE events.

- **Proxmox VE**: action node, usable as an AI agent tool
- **Proxmox VE Trigger**: polling trigger

Requires n8n 2.45.0 or later. Tested with Proxmox VE 9.x; 8.4 support is based on the
official API specification.

## Installation

**From npm:** Settings → Community Nodes → Install → `n8n-nodes-proxmox-ve`.

**Manual (Docker):** replace `n8n` with your container name.

```bash
docker cp n8n-nodes-proxmox-ve-0.2.0.tgz n8n:/tmp/
docker exec -it n8n sh -c "mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes && npm install --legacy-peer-deps /tmp/n8n-nodes-proxmox-ve-0.2.0.tgz"
docker restart n8n
```

## Credentials

| Field | Notes |
|---|---|
| Base URL | e.g. `https://pve.example.com:8006` |
| Authentication | **API Token** (recommended) or Username/Password (no 2FA) |
| Token ID / Secret | `user@realm!tokenid` and its secret |
| Allow Self-Signed Certificate | Skips certificate validation; the connection stays on HTTPS |
| Allow Insecure HTTP | Trusted lab networks only. Off by default |

Use a read-only token for reads and the trigger, and a separate token for writes,
limited to what your workflows need:

```bash
pveum user add n8n@pve
pveum user token add n8n@pve readonly --privsep 1
pveum acl modify / --tokens 'n8n@pve!readonly' --roles PVEAuditor
pveum user token add n8n@pve ops --privsep 1
pveum acl modify /vms --tokens 'n8n@pve!ops' --roles PVEVMUser
```

`PVEAuditor` is not enough for updates (`Sys.Modify`), syslog and journal
(`Sys.Syslog`) and the guest agent (`VM.GuestAgent.*` on 9.x, `VM.Monitor` on 8.x).

> With an administrative token, an AI agent can shut down nodes, delete VMs or run
> commands inside guests. Give agents a read-only token unless writes are needed.

## Operations

| Resource | Operations |
|---|---|
| Node | Get Many, Get Status, Shutdown, Reboot, Wake On LAN, Start/Stop/Suspend All Guests, Services, Updates, Package Versions, Syslog, Journal, Network, Disks, SMART, Certificates, RRD Data |
| VM | Get Many, Get, Status, Config, Pending, Create, Update Config, Delete, Start, Stop, Shutdown, Reboot, Reset, Suspend, Hibernate, Resume, Clone, Migrate, Convert To Template, Resize Disk, Move Disk, RRD Data, Snapshots, Cloud-Init, Next Free VMID |
| Container | Same as VM where available (no Reset, Hibernate, Cloud-Init) |
| Guest Agent | Ping, Info, OS Info, Network Interfaces, Filesystems, Exec, File Read, File Write, FS Freeze/Thaw, Shutdown |
| Storage | Get Many, Status, Content, Upload, Download From URL, Allocate Volume, Delete Volume, RRD Data |
| Backup | Create, Get Many, Delete, Prune (preview unless *Delete Backups* is set), Not Backed Up Guests |
| Backup Job | Get, Get Many, Run Now |
| Cluster | Status, Resources, Log, Options, Version |
| High Availability | Resources, Rules (9.x), Groups (8.x), Status |
| Pool | Get Many, Create, Update, Delete |
| Replication | Get Many, Get, Create, Update, Delete, Run Now |
| Access | Users, Groups, Roles, ACL, Effective Permissions, API Tokens (read-only, never secrets) |
| Task | Get Many, Get Last, Status, Log, Stop, Wait For Completion |
| Custom API Call | Any method on a path below `/api2/json` |

Operations that start a Proxmox task return its UPID and offer **Wait For Completion**,
which fails the node if the task fails. Lists support **Split Into Items**. For
endpoints not covered, use Custom API Call with the
[API Viewer](https://pve.proxmox.com/pve-docs/api-viewer/).

## Trigger

| Event | Fires when |
|---|---|
| Guest State Changed | a VM or container becomes running, stopped or paused |
| Node Status Changed | a node goes online or offline |
| Task Finished | a task ends, optionally only with errors (e.g. a failed backup) |
| Storage Usage Above Threshold | usage reaches the threshold, once until it drops below |
| Updates Available | a node has new upgradable packages |

The first poll stores the current state without emitting events.

```json
{
  "event": "taskFinished",
  "type": "vzdump",
  "node": "pve1",
  "status": "job errors",
  "success": false,
  "upid": "UPID:pve1:0001A2B3:00C4D5E6:6790ABCD:vzdump::root@pam:"
}
```

## Security

- HTTPS by default, never downgraded; redirects are not followed.
- Token secrets, tickets and CSRF tokens never appear in URLs, outputs or errors; the
  password is only sent in the login request.
- Path values are validated; Custom API Call stays inside `/api2/json`.
- Requests time out after 30 s without data (30 min for uploads); responses over 32 MiB
  are aborted.

## Support

If this node saves you time, you can [buy me a coffee](https://buymeacoffee.com/FDalCol).

## License

[MIT](LICENSE). Proxmox is a registered trademark of Proxmox Server Solutions GmbH;
this project is not affiliated with or endorsed by it.
