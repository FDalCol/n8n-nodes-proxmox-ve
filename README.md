# n8n-nodes-proxmox-ve

n8n community nodes for [Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment): manage nodes, VMs, containers, the QEMU guest agent, storage, backups, cluster, HA, pools, replication and tasks, call any API endpoint, and start workflows on Proxmox VE events.

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
# read-only (reads and trigger)
pveum user token add n8n@pve readonly --privsep 1
pveum acl modify / --tokens 'n8n@pve!readonly' --roles PVEAuditor
# writes: grant only what the workflows need, on the narrowest path
pveum user token add n8n@pve ops --privsep 1
pveum acl modify /vms --tokens 'n8n@pve!ops' --roles PVEVMUser
```

Some reads need more than `PVEAuditor`: *Get Updates* / the *Updates Available* trigger need `Sys.Modify` on `/nodes/<node>`, *Syslog* / *Journal* need `Sys.Syslog`, guest agent commands need `VM.GuestAgent.*` (9.x) or `VM.Monitor` (8.x).

> **Warning:** with an administrative token, an AI agent using this node can shut down nodes, delete VMs or backups, change HA or run commands inside guests. Give agents a read-only token unless writes are really needed.

## Resources and operations

| Resource | Operations |
|---|---|
| Node | Get Many, Get Status, Shutdown, Reboot, Wake On LAN, Start/Stop/Suspend All Guests, Services (list, state, start, stop, restart, reload), Refresh Package Index, Get Updates, Get Package Versions, Get Syslog, Get Journal, Get Network Interface(s), Get Disks, Get Disk SMART, Get Certificates, Get RRD Data |
| VM (QEMU) | Get Many, Get (config + status), Get Status, Get Config, Get Pending, Create, Update Config, Delete, Start, Stop, Shutdown, Reboot, Reset, Suspend, Hibernate, Resume, Clone, Migrate, Convert To Template, Resize Disk, Move Disk, Get RRD Data, Snapshots (list, create, get config, update, rollback, delete), Cloud-Init (get, dump, update, regenerate), Get Next Free VMID |
| Container (LXC) | Same as VM where the API provides it (no Reset, Hibernate, Cloud-Init); Move Volume |
| Guest Agent | Ping, Get Info, Get OS Info, Get Network Interfaces, Get Filesystems, Exec (waits via exec-status), Get Exec Status, File Read, File Write, FS Freeze / Thaw / Status, Shutdown |
| Storage | Get Many, Get Status, Get Content, Upload (n8n binary), Download From URL (with checksum), Allocate Volume, Delete Volume, Get RRD Data |
| Backup | Create (vzdump), Get Many, Delete, Prune (preview by default, deletes only with *Delete Backups*), Get Not Backed Up Guests |
| Backup Job | Get, Get Many, Run Now (runs the scheduled job immediately on its online nodes) |
| Cluster | Get Status, Get Resources, Get Log, Get Options, Get Version |
| High Availability | Resources (list, get, add, update, remove), Rules (9.x), Groups (8.x), Status, Manager Status |
| Pool | Get Many, Create, Update, Delete |
| Replication | Get Many, Get, Create, Update, Delete, Run Now |
| Access (read-only) | Get Users, Get Groups, Get Roles, Get Permissions (ACL), Get Effective Permissions, Get API Tokens (never secrets) |
| Task | Get Many (recent tasks, newest first; filters: node, type e.g. `vzdump`, VMID, user, errors only, running only, time range, limit), Get Last (most recent matching task), Get Status, Get Log, Stop, Wait For Completion |
| Custom API Call | Any method on a path below `/api2/json` |

Common behaviour:

- Operations that start a Proxmox VE task return the UPID (field `upid`; also available from *Task → Get Many / Get Last*). **Wait For Completion** polls the task (interval ≥ 1 s, timeout ≤ 24 h, enforced also for expressions) and returns `status` and `exitstatus`; a failed task fails the node with the last log lines.
- Lists are arrays; **Split Into Items** (default on) returns one item per entry.
- Proxmox errors become `NodeOperationError` with the message and the invalid parameters. `continueOnFail` returns `{ error }` with `pairedItem`.
- Nodes, VMs, containers and storages can be picked from lists loaded from Proxmox VE or entered by ID.
- Destructive operations (shutdown/reboot, stop, delete, rollback, prune with deletion, HA, guest exec/file write, task stop, custom calls) carry explicit descriptions so AI agents only use them on explicit request.

For anything not covered, **Custom API Call** sends any method to a path below `/api2/json`; see the [API Viewer](https://pve.proxmox.com/pve-docs/api-viewer/) for endpoints and parameters.

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
- Request timeout 30 s (30 min for uploads): n8n closes the connection when the server sends nothing for that long, before or after the headers. Responses larger than 32 MiB are aborted and the connection is closed. No timers are left pending. All wait loops are bounded (≤ 24 h) and stop when the execution is cancelled.
- Token ID/secret, password, ticket and CSRF token are only sent in headers or the login body, never in URLs. Token secret, ticket and CSRF token are redacted from outputs and errors (also with `continueOnFail`); the password is redacted from login errors (Proxmox VE never returns it, and redacting it everywhere would let a workflow test password guesses). Fields named like `password`/`secret` (e.g. cloud-init `cipassword`) and API token values are masked; the Exec command line and File Write content never appear in errors.
- Every value placed in an API path is validated or percent-encoded; `.`/`..` parts (also encoded, or as `..;`) are rejected. Parameter names `__proto__`, `constructor` and `prototype` are rejected.
- Custom API Call rejects absolute URLs, path traversal (also double-encoded or overlong UTF-8), `;` and paths outside `/api2/json`.
- **Upload** keeps the whole file in memory while it is sent; the node enforces no size limit (it is bounded by the memory available to n8n and the free space on the storage). **Download From URL** is performed by the Proxmox VE node itself, not by n8n: it can reach any address the node can reach, and the size is bounded only by the storage; use a checksum.
- List limits (log lines, journal, cluster log, tasks) have maximums also when set by expressions; the trigger state is bounded in entries and size.

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
