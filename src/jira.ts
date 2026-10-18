import type { Epic, Story } from "./schema.js";

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  storyPointsField?: string;
}

export interface PushResult {
  epic: { title: string; key?: string; error?: string };
  stories: { title: string; key?: string; error?: string }[];
}

export function jiraConfig(): JiraConfig | null {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_STORY_POINTS_FIELD } = process.env;
  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) return null;
  return {
    baseUrl: JIRA_BASE_URL.replace(/\/+$/, ""),
    email: JIRA_EMAIL,
    apiToken: JIRA_API_TOKEN,
    storyPointsField: JIRA_STORY_POINTS_FIELD || undefined,
  };
}

async function jiraRequest<T>(cfg: JiraConfig, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${cfg.email}:${cfg.apiToken}`).toString("base64"),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

// Jira Cloud's v3 API takes descriptions in Atlassian Document Format.
const paragraph = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const heading = (text: string) => ({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text }] });
const bulletList = (items: string[]) => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [paragraph(item)] })),
});

function storyDescription(story: Story) {
  const content: object[] = [paragraph(story.userStory), paragraph(story.description)];
  if (story.acceptanceCriteria.length) {
    content.push(heading("Acceptance criteria"), bulletList(story.acceptanceCriteria));
  }
  if (story.dependencies.length) {
    content.push(heading("Dependencies"), bulletList(story.dependencies));
  }
  if (story.sourceReference) {
    content.push(heading("Source"), paragraph(story.sourceReference));
  }
  return { type: "doc", version: 1, content };
}

export async function pushEpics(projectKey: string, epics: Epic[]): Promise<PushResult[]> {
  const cfg = jiraConfig();
  if (!cfg) throw new Error("Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN in .env.");

  const results: PushResult[] = [];
  for (const epic of epics) {
    const result: PushResult = { epic: { title: epic.title }, stories: [] };
    results.push(result);

    let epicKey: string | undefined;
    try {
      const created = await jiraRequest<{ key: string }>(cfg, "/rest/api/3/issue", {
        fields: {
          project: { key: projectKey },
          issuetype: { name: "Epic" },
          summary: epic.title,
          description: { type: "doc", version: 1, content: [paragraph(epic.summary)] },
        },
      });
      epicKey = created.key;
      result.epic.key = epicKey;
    } catch (err) {
      result.epic.error = (err as Error).message;
    }

    for (const story of epic.stories) {
      const fields: Record<string, unknown> = {
        project: { key: projectKey },
        issuetype: { name: "Story" },
        summary: story.title,
        description: storyDescription(story),
        priority: { name: story.priority },
        labels: story.labels.map((l) => l.replace(/\s+/g, "-")),
      };
      if (epicKey) fields.parent = { key: epicKey };
      if (cfg.storyPointsField) fields[cfg.storyPointsField] = story.storyPoints;

      try {
        const created = await jiraRequest<{ key: string }>(cfg, "/rest/api/3/issue", { fields });
        result.stories.push({ title: story.title, key: created.key });
      } catch (err) {
        result.stories.push({ title: story.title, error: (err as Error).message });
      }
    }
  }
  return results;
}
