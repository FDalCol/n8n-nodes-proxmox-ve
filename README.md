# n8n-nodes-proxmox-ve

n8n community nodes for [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment): manage nodes, VMs, containers, the QEMU guest agent, storage, backups, cluster, HA, pools, replication, firewall and tasks, read any GET endpoint of the API, and start workflows on Proxmox VE events.

- **Proxmox VE** node (`usableAsTool`: works as a tool for AI agents)
- **Proxmox VE Trigger** node (polling)
- No runtime dependencies

## Installation

Requires **n8n 2.45.0 or later**.

**Community Nodes (recommended):** in n8n open *Settings → Community Nodes → Install* and enter `n8n-nodes-proxmox-ve`.

**Manual install in Docker:**

```bash
npm pack                                   # or download the .tgz from npm
docker cp n8n-nodes-proxmox-ve-0.1.0.tgz n8n:/tmp/
docker exec -it n8n sh -c "mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes && npm install --legacy-peer-deps /tmp/n8n-nodes-proxmox-ve-0.1.0.tgz"
docker restart n8n
```

## Credentials

Credential type **Proxmox VE API**:

| Field | Notes |
|---|---|
| Base URL | `https://pve.example.com:8006`. HTTPS only, no credentials, query or fragment. Trailing slashes are removed. |
| Authentication | **API Token** (default) or **Username/Password** |
| Token ID / Secret | `user@realm!tokenid` and the token secret. Sent as `Authorization: PVEAPIToken=…` |
| Username / Password | `user@realm`. The node logs in once per execution (`POST /access/ticket`, credentials in the body) and keeps ticket and CSRF token in memory only. Two-factor logins are not supported: use a token. |
| Allow Self-Signed Certificate | Accepts self-signed/invalid certificates. The connection always stays on HTTPS. |
| Allow Insecure HTTP | Only for a trusted lab network. Off by default. |

The credential test calls `GET /version` (token) or performs the login (username/password).

### Creating tokens with least privilege

Use one **read-only token** for reads and the trigger, and a **separate token** for write operations, both with privilege separation:

```bash
pveum user add n8n@pve --comment "n8n automation"
# read-only (reads, API Read, trigger)
pveum user token add n8n@pve readonly --privsep 1
pveum acl modify / --tokens 'n8n@pve!readonly' --roles PVEAuditor
# writes: grant only what the workflows need, on the narrowest path
pveum user token add n8n@pve ops --privsep 1
pveum acl modify /vms --tokens 'n8n@pve!ops' --roles PVEVMUser
```

Some reads need more than `PVEAuditor`: *Get Updates* / the *Updates Available* trigger need `Sys.Modify` on `/nodes/<node>`, *Syslog* / *Journal* need `Sys.Syslog`, guest agent commands need `VM.GuestAgent.*` (9.x) or `VM.Monitor` (8.x).

> **Warning:** with an administrative token, an AI agent using this node can shut down nodes, delete VMs, change firewall rules or run commands inside guests. Give agents a read-only token unless writes are really needed.

## Resources and operations

| Resource | Operations |
|---|---|
| Node | Get Many, Get Status, Shutdown, Reboot, Wake On LAN, Start/Stop/Suspend All Guests, Services (list, state, start, stop, restart, reload), Refresh Package Index, Get Updates, Get Package Versions, Get Syslog, Get Journal, Get Network Interface(s), Get Disks, Get Disk SMART, Get Certificates, Get RRD Data |
| VM (QEMU) | Get Many, Get (config + status), Get Status, Get Config, Get Pending, Create, Update Config, Delete, Start, Stop, Shutdown, Reboot, Reset, Suspend, Hibernate, Resume, Clone, Migrate, Convert To Template, Resize Disk, Move Disk, Get RRD Data, Snapshots (list, create, get config, update, rollback, delete), Cloud-Init (get, dump, update, regenerate), Get Next Free VMID |
| Container (LXC) | Same as VM where the API provides it (no Reset, Hibernate, Cloud-Init); Move Volume |
| Guest Agent | Ping, Get Info, Get OS Info, Get Network Interfaces, Get Filesystems, Exec (waits via exec-status), Get Exec Status, File Read, File Write, FS Freeze / Thaw / Status, Shutdown |
| Storage | Get Many, Get Status, Get Content, Upload (n8n binary), Download From URL (with checksum), Allocate Volume, Delete Volume, Get RRD Data |
| Backup | Create (vzdump), Restore (VM or container, `force` off by default), Get Many, Delete, Prune (preview by default, deletes only with *Delete Backups*), Backup Jobs (list, get, create, update, delete, run now), Get Not Backed Up Guests |
| Cluster | Get Status, Get Resources, Get Tasks, Get Log, Get Options, Get Version, Get Backup Info (included volumes of a backup job) |
| High Availability | Resources (list, get, add, update, remove), Rules (9.x), Groups (8.x), Status, Manager Status |
| Pool | Get Many, Create, Update, Delete |
| Replication | Get Many, Get, Create, Update, Delete, Run Now |
| Firewall | Rules, Aliases, IP Sets (and entries), Options — read and write at cluster, node (rules/options only), VM and container level |
| Access (read-only) | Get Users, Get Groups, Get Roles, Get Permissions (ACL), Get Effective Permissions, Get API Tokens (never secrets) |
| Task | Get Status, Get Log, Stop, Wait For Completion |
| API Read | Any GET endpoint (see below) |
| Custom API Call | Any method on a path below `/api2/json` |

Common behaviour:

- Operations that start a Proxmox VE task return the UPID. **Wait For Completion** polls the task (interval ≥ 1 s, timeout ≤ 24 h, enforced also for expressions) and returns `status` and `exitstatus`; a failed task fails the node with the last log lines.
- Lists are arrays; **Split Into Items** (default on) returns one item per entry.
- Proxmox errors become `NodeOperationError` with the message and the invalid parameters. `continueOnFail` returns `{ error }` with `pairedItem`.
- Nodes, VMs, containers and storages can be picked from lists loaded from Proxmox VE or entered by ID.
- Destructive operations (shutdown/reboot, stop, delete, rollback, restore, firewall, HA, guest exec/file write, custom calls) carry explicit descriptions so AI agents only use them on explicit request.

## API Read

Read-only access to every GET endpoint of the Proxmox VE API (337 endpoints, generated at build time from the official API schema: paths, parameter names, types and required flags only). Pick an endpoint from the searchable list, fill the `{path}` parameters and optional query parameters; unknown parameters are rejected. Only GET is ever sent. See the [API Viewer](https://pve.proxmox.com/pve-docs/api-viewer/) for documentation of each endpoint.

Regenerate the catalog: `npm run generate:api -- --download`.

## Trigger

**Proxmox VE Trigger** polls the API. The first poll stores the current state without emitting; in test mode it returns a real sample.

| Event | Fires when | Filters |
|---|---|---|
| Guest State Changed | a VM/container becomes running, stopped or paused | VMIDs, type, states |
| Node Status Changed | a node goes online/offline | nodes, states |
| Task Finished | a task ends (e.g. a failed `vzdump` backup) | task types, result OK/error, nodes |
| Storage Usage Above Threshold | usage ≥ threshold %, once until it drops below | nodes, storages |
| Updates Available | new upgradable packages on a node | nodes |

Example output (*Task Finished*, result *Error*, type `vzdump`):

```json
{
  "event": "taskFinished",
  "upid": "UPID:pve1:0001A2B3:00C4D5E6:6790ABCD:vzdump::root@pam:",
  "type": "vzdump",
  "node": "pve1",
  "user": "root@pam",
  "status": "job errors",
  "success": false,
  "starttime": 1737600000,
  "endtime": 1737600420
}
```

## Security

- HTTPS only (HTTP only when explicitly enabled), never downgraded; redirects are never followed.
- 30 s timeout per request (30 min for uploads); responses larger than 32 MiB are aborted; all wait loops are bounded (≤ 24 h).
- Token secret, password, ticket and CSRF token are only sent in headers or the login body, never in URLs, and are redacted from outputs and errors (also with `continueOnFail`).
- Custom API Call rejects absolute URLs, path traversal (also encoded) and paths outside `/api2/json`.
- Uploads are held in memory while being sent.

## Compatibility

- **Proxmox VE 9.x**: verified (implemented against the official API schema of September 2026, PVE 9.2).
- **Proxmox VE 8.4**: support is based on the official API specification (`pve-docs` 8.4.2), not on tests against a live 8.4 cluster.

Differences: HA rules exist only in 9.x (8.x uses HA groups, deprecated in 9.x); options marked *(9.x)* are not available on 8.x; guest agent privileges differ (see above).

**Minimum n8n version: 2.45.0** (tests run against `n8n-workflow` 2.45.0, the version shipped with n8n 2.45.0; a test checks that every `n8n-workflow` export used by the node exists in that version).

## Development

```bash
npm install --ignore-scripts   # a dev-only transitive dependency needs native build tools otherwise
npm run build && npm run lint && npm test
```

## Support

If this node saves you time, you can [buy me a coffee](https://buymeacoffee.com/FDalCol).

## License

[MIT](LICENSE) © FDalCol. Proxmox is a registered trademark of Proxmox Server Solutions GmbH; this project is not affiliated with or endorsed by Proxmox Server Solutions GmbH.
