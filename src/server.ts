import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { generateBacklog } from "./generator.js";
import { jiraConfig, pushEpics } from "./jira.js";
import { EpicSchema } from "./schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(here, "..", "public")));

app.get("/api/config", (_req, res) => {
  const cfg = jiraConfig();
  res.json({ jiraConfigured: !!cfg, jiraBaseUrl: cfg?.baseUrl ?? null, defaultProjectKey: process.env.JIRA_PROJECT_KEY ?? "" });
});

app.post("/api/generate", upload.single("document"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Upload a requirement document (.pdf, .docx, .md or .txt)." });
    return;
  }
  try {
    const backlog = await generateBacklog(
      { filename: req.file.originalname, mimetype: req.file.mimetype, buffer: req.file.buffer },
      { context: typeof req.body.context === "string" ? req.body.context : undefined },
    );
    res.json(backlog);
  } catch (err) {
    console.error(err);
    let message = (err as Error).message;
    if (err instanceof Anthropic.AuthenticationError) message = "Invalid or missing ANTHROPIC_API_KEY.";
    else if (err instanceof Anthropic.RateLimitError) message = "Claude API rate limit hit. Try again shortly.";
    else if (err instanceof Anthropic.APIError) message = `Claude API error ${err.status}: ${err.message}`;
    res.status(500).json({ error: message });
  }
});

const PushRequest = z.object({ projectKey: z.string().min(1), epics: z.array(EpicSchema) });

app.post("/api/jira/push", async (req, res) => {
  const parsed = PushRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request: " + parsed.error.message });
    return;
  }
  try {
    res.json(await pushEpics(parsed.data.projectKey, parsed.data.epics));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Jira Story Creator running at http://localhost:${port}`));
