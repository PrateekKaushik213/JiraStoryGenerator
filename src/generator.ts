import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import mammoth from "mammoth";
import { BacklogSchema, type Backlog } from "./schema.js";

const client = new Anthropic();

const MODEL = "claude-opus-5-5";

const SYSTEM_PROMPT = `You are a senior agile business analyst. You turn requirement documents into a Jira backlog that a development team can pick up directly.

Group related work into epics, and split each epic into stories that are independent, small enough to finish in one sprint, and testable (INVEST). Each story needs a user story sentence, concrete acceptance criteria, and a reference to the part of the document it comes from.

Cover every functional and non-functional requirement in the document; don't add features the document does not ask for. Where the document is ambiguous, make a reasonable assumption and record it in "assumptions", and put anything the team must clarify in "openQuestions".`;

export interface GenerateOptions {
  context?: string;
}

export interface UploadedDocument {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

// PDFs go to Claude as native document blocks (it reads layout and tables);
// Word files are converted to text first; everything else is read as text.
async function toContentBlocks(doc: UploadedDocument): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const name = doc.filename.toLowerCase();

  if (doc.mimetype === "application/pdf" || name.endsWith(".pdf")) {
    return [
      {
        type: "document",
        title: doc.filename,
        source: { type: "base64", media_type: "application/pdf", data: doc.buffer.toString("base64") },
      },
    ];
  }

  let text: string;
  if (name.endsWith(".docx")) {
    text = (await mammoth.extractRawText({ buffer: doc.buffer })).value;
  } else {
    text = doc.buffer.toString("utf8");
  }

  if (!text.trim()) {
    throw new Error(`No readable text found in ${doc.filename}`);
  }
  return [
    {
      type: "document",
      title: doc.filename,
      source: { type: "text", media_type: "text/plain", data: text },
    },
  ];
}

export async function generateBacklog(doc: UploadedDocument, options: GenerateOptions = {}): Promise<Backlog> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = await toContentBlocks(doc);

  let instruction = "Create the Jira backlog for this requirement document.";
  if (options.context?.trim()) {
    instruction += `\n\nAdditional context from the team:\n${options.context.trim()}`;
  }
  content.push({ type: "text", text: instruction });

  // Streaming because documents and backlogs can both be long.
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "high", format: betaZodOutputFormat(BacklogSchema) },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("Claude declined to process this document.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("The backlog was too large to generate in one pass. Try splitting the document.");
  }
  if (!message.parsed_output) {
    throw new Error("Claude returned output that did not match the backlog schema.");
  }
  return message.parsed_output;
}
