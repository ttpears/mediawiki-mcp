# Tools and examples

[Documentation](README.md) · [Configuration](configuration.md) · [Connection troubleshooting](operations.md#troubleshooting)

Use these tools through a connected MCP client. The JSON examples below are
**tool arguments**, not shell commands or complete JSON-RPC requests. Most users
can ask their assistant in plain language instead.

[First read](#start-with-a-read) · [Editing](#read-and-edit-a-page) · [Tool reference](#tool-reference) · [Pagination](#pagination)

## Start with a read

Ask:

> List my connected wikis, find the backup policy on Main, and summarize it with
> the wiki name and page title.

The corresponding calls are:

1. `list-wikis` with `{}` to check configuration and authentication.
2. `find-page` to locate the page.
3. `get-page` to read the selected result.

For `find-page`:

```json
{
  "query": "backup policy",
  "wiki": "Main",
  "limit": 5
}
```

`find-page` ranks exact titles and redirects before prefix and full-text matches.
If you omit `wiki`, it searches all configured wikis. The exact full-text tool
name is `search-page`, and the prefix tool is `search-page-by-prefix`.

## Read and edit a page

First read the current page with `get-page`:

```json
{
  "title": "Backup policy",
  "wiki": "Main",
  "include_html": false
}
```

Review the source and ask the assistant to show its proposed change. Once the
change is approved, `update-page` can append a section:

```json
{
  "title": "Backup policy",
  "wiki": "Main",
  "append": "\n== Retention ==\nKeep daily backups for 30 days.\n",
  "summary": "Document daily backup retention"
}
```

Every update requires a `summary` and **one edit mode**:

| Mode | Arguments to supply | Best for |
| --- | --- | --- |
| Unified diff | `diff` | Targeted edits while retaining surrounding content |
| One section | `section` and `content` | Replacing a numbered section; `0` is the lead section |
| Append | `append` | Adding content at the end |
| Prepend | `prepend` | Adding content at the beginning |
| Replace page | `content` | A deliberate full-page replacement |

Do not combine edit modes. `latest_timestamp` is not a tool argument; the server
handles its own revision checks. For a unified diff, include hunk headers and
context matching the page you read. For example, if the entire page is:

```text
== Backups ==
Run backups weekly.
```

This `update-page` argument changes only the schedule:

```json
{
  "title": "Backup policy",
  "wiki": "Main",
  "diff": "--- a/Backup_policy\n+++ b/Backup_policy\n@@ -1,2 +1,2 @@\n == Backups ==\n-Run backups weekly.\n+Run backups daily.\n",
  "summary": "Change the documented backup schedule to daily"
}
```

Use wikitext for page content, for example `== Heading ==`, `* item`, and
`[[Page title]]`. Writing also requires the wiki account's rights; in OAuth mode
the user needs the configured write role.

## Which tools are available?

| Tool group | Local stdio / trusted private HTTP | OAuth writer | OAuth reader |
| --- | --- | --- | --- |
| Read tools, including `list-wikis` | Available | Available | Available |
| Page writes and uploads | Registered; wiki rights still apply | Available; wiki rights still apply | Not registered |
| `add-wiki`, `remove-wiki`, `set-wiki` | Available for the current session | Not registered | Not registered |

A client's live `tools/list` response is authoritative. An existing HTTP session
may need reconnection when permissions change. Where no session user is supplied,
write tools also accept an optional `user` for attribution; authenticated session
identity takes precedence.

## Tool reference

Required inputs are listed separately from optional inputs. `wiki` is always
optional where offered. A tool using the default wiki does **not** search every
wiki automatically.

### Locate and read pages

| Tool | Required inputs | Optional inputs | Behavior |
| --- | --- | --- | --- |
| `find-page` | `query` | `wiki`, `limit` | Exact/redirect, prefix, then full-text; all wikis if `wiki` omitted |
| `search-page` | `query` | `wiki`, `limit` | Full-text; all wikis if omitted |
| `search-page-by-prefix` | `query` | `wiki`, `limit` | Title prefix; all wikis if omitted |
| `get-page` | `title` | `wiki`, `include_html` | Source and metadata; default wiki if omitted |
| `get-page-history` | `title` | `wiki`, `limit`, `older_than` | Revision list; `older_than` is a numeric revision ID |
| `get-revision` | `revision_id` | `wiki` | Metadata for one numeric revision ID |

Search limits default to 10. Page history defaults to 20 results.

### Create, edit, and restore pages

| Tool | Required inputs | Optional inputs |
| --- | --- | --- |
| `create-page` | `title`, `content`, `summary` | `wiki`, `user` |
| `update-page` | `title`, `summary` | `diff`, `section`, `content`, `append`, `prepend`, `wiki`, `user` |
| `delete-page` | `title` | `wiki`, `reason`, `user` |
| `undelete-page` | `title` | `wiki`, `reason`, `user` |

`create-page` is for a page that does not already exist. Deleting and restoring
pages require the corresponding administrative rights on the wiki.
An update also needs one of the [edit modes](#read-and-edit-a-page) described above.

### Categories, links, and activity

| Tool | Required inputs | Optional inputs | Scope |
| --- | --- | --- | --- |
| `list-categories` | None | `wiki`, `prefix`, `limit`, `continue_from` | All wikis if omitted |
| `get-category-members` | `category` | `wiki`, `type`, `limit`, `continue_from` | Default wiki |
| `get-page-links` | `title` | `wiki`, `direction`, `limit`, `continue_from` | Default wiki |
| `get-recent-changes` | None | `wiki`, `limit`, `namespace`, `type`, `continue_from` | All wikis if omitted |

Category and link limits default to 50; recent changes default to 20. Accepted
filters are:

- Category member `type`: `page`, `subcat`, or `file`.
- Link `direction`: `from` for outgoing links (default), `to` for backlinks.
- Recent-change `type`: `edit`, `new`, or `log`.

For example, list pages that link to a policy:

```json
{
  "title": "Backup policy",
  "wiki": "Main",
  "direction": "to",
  "limit": 20
}
```

### Files

| Tool | Required inputs | Optional inputs |
| --- | --- | --- |
| `get-file` | `title` | `wiki` |
| `upload-file` | `filename`, `data`, `description` | `wiki`, `comment`, `user` |
| `upload-file-from-url` | `filename`, `url`, `description` | `wiki`, `comment`, `user` |

`data` is a base64-encoded file. `description` is wikitext for the file description.
For URL uploads, the **wiki server** downloads the file, so the URL must be
reachable from that server. `get-file` accepts a title with or without `File:`;
its inline image download is subject to the
[origin and size policy](configuration.md#inline-image-downloads).

### Wiki management

| Tool | Required inputs | Optional inputs | Effect |
| --- | --- | --- | --- |
| `list-wikis` | None | None | Show URLs, default selection, and live authentication status |
| `add-wiki` | `name`, `url` | `username`, `password` | Add a wiki to this session |
| `remove-wiki` | `name` | None | Remove a wiki from this session, not from MediaWiki |
| `set-wiki` | `name` | None | Change this session's default wiki |

Session changes are not saved back to environment variables or config files.
They disappear when the session/process is replaced. OAuth operators configure
wikis through the environment instead of these management tools.

## Pagination

Choose an explicit `wiki` when paging through category, link, or recent-change
results. If the response says more results are available, copy its continuation
token exactly into `continue_from`; treat it as an opaque string.

For page history, use the numeric `older_than` revision ID instead. Search tools
do not take `continue_from`; adjust `query`, `wiki`, or `limit` to narrow results.

## Starter prompts

Clients that expose MCP prompts can offer `search-wikis`, `summarize-page`, and
`recent-activity`. Writers also get `draft-page-edit`. Prompts are templates for
an assistant conversation, not an additional set of API operations.
