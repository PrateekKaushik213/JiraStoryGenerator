# Jira Story Creator

Upload a requirements document (PDF, Word, Markdown or text). Claude drafts epics and user stories with acceptance criteria, priorities, estimates and labels. You review and edit them in the browser, then push them to Jira Cloud or export them as CSV/JSON.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values
npm start              # http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key from https://platform.claude.com |
| `JIRA_BASE_URL` | e.g. `https://your-site.atlassian.net` |
| `JIRA_EMAIL` / `JIRA_API_TOKEN` | Jira account email and [API token](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_PROJECT_KEY` | Default project key shown in the UI |
| `JIRA_STORY_POINTS_FIELD` | Optional. Story points custom field ID (e.g. `customfield_10016`) |

The Jira variables are optional. Without them you can still generate and export.

## How it works

- `src/generator.ts` sends the document to `claude-opus-5-5`. PDFs go as native document blocks, `.docx` is converted to text with mammoth, and other files are read as text. Structured outputs force the response to match the Zod schema in `src/schema.ts`.
- `src/jira.ts` creates each epic, then its stories with `parent` set to the epic, using the Jira Cloud REST API v3. Descriptions are sent in Atlassian Document Format.
- `public/` is a dependency-free UI for reviewing and editing the backlog, exporting CSV (in the format Jira's CSV importer expects) or JSON, and pushing to Jira.

Try it with `samples/library-app-requirements.md`.
