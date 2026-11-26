# Connecting an AI bot or automation

A bot works in the CRM with an API key instead of a browser sign-in.

## 1. Make a key

Settings → **חיבור בוט** → name the key, pick whose access it carries ("פועל בשם"),
read-only or read and write, and an optional expiry. The key (`crmye_…`) is shown
once; the server keeps only its SHA-256.

What a key can and can't do:

- It sees and does exactly what its account may: a worker's key sees only that
  worker's cases; payments and the activity log need a manager's key.
- A read-only key can only read. No key can delete anything, or reach accounts,
  passwords, team members, settings changes or the keys themselves.
- Cancelling the key, or deactivating its account, cuts it off on the next request.
- Every request is listed under "מה הבוט עשה לאחרונה" for 60 days; changes also land
  in the normal activity log. Limit: 1,200 requests per key per 10 minutes.

## 2. Point the bot at the CRM

Every request carries the header:

    Authorization: Bearer crmye_…

**Tools that speak MCP** (Model Context Protocol): Streamable HTTP at

    https://casepoint.ghsystems.work/api/mcp

Stateless JSON: each POST gets a JSON answer, with no server-sent events stream.
The tools are `get_setup` (call first), `search_clients`, `get_client`, `list_cases`,
`get_case`, `list_tasks`, `read_document`, `list_payments`, `recent_activity`, and,
with write access, `create_client`, `update_client`, `create_case`, `update_case`,
`set_checklist_item`, `add_checklist_item`, `upload_document`, `send_documents`,
`create_task`, `update_task`, `add_payment`. Each tool calls the same API the
screens use, so the checks are identical. The tools live in `lib/mcp-tools.ts`.

Claude Code:

    claude mcp add --transport http crm https://casepoint.ghsystems.work/api/mcp --header "Authorization: Bearer crmye_…"

n8n: an "MCP Client Tool" node with that URL and Bearer authentication.

**Tools that take an OpenAPI description** (GPT Actions, Make, Zapier, n8n's HTTP node):

    https://casepoint.ghsystems.work/api/openapi.json

Authentication: API key, type Bearer.

Plain HTTP works too:

    curl -H "Authorization: Bearer crmye_…" https://casepoint.ghsystems.work/api/cases

## Notes

- `send_documents` really emails or WhatsApps the client.
- Uploads through MCP travel as base64; nginx accepts 30 MB per request, so a
  single file of up to about 22 MB.
- Where it lives: keys in `lib/api-keys.ts` (store) and `lib/api-access.ts` (which
  paths a key may use, checked in `middleware.ts`), and the session in
  `lib/viewer.ts` (`getViewer` accepts a key). Tables come from
  `migrations/005_api_keys.sql`.
