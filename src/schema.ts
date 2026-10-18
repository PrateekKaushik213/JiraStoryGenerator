import { z } from "zod";

export const StorySchema = z.object({
  title: z.string().describe("Short Jira summary line, imperative, under 80 characters"),
  userStory: z.string().describe('"As a <role>, I want <capability>, so that <benefit>."'),
  description: z.string().describe("Context, scope notes and implementation hints for the team"),
  acceptanceCriteria: z
    .array(z.string())
    .describe("Testable criteria, preferably in Given/When/Then form"),
  priority: z.enum(["Highest", "High", "Medium", "Low", "Lowest"]),
  storyPoints: z.number().int().describe("Fibonacci estimate: 1, 2, 3, 5, 8 or 13"),
  labels: z.array(z.string()).describe("Lowercase, hyphenated Jira labels"),
  dependencies: z.array(z.string()).describe("Titles of other stories this one depends on"),
  sourceReference: z
    .string()
    .describe("Section, heading or quote of the requirement document this story comes from"),
});

export const EpicSchema = z.object({
  title: z.string(),
  summary: z.string(),
  stories: z.array(StorySchema),
});

export const BacklogSchema = z.object({
  epics: z.array(EpicSchema),
  assumptions: z.array(z.string()).describe("Assumptions made where the document was unclear"),
  openQuestions: z.array(z.string()).describe("Questions to raise with the product owner"),
});

export type Story = z.infer<typeof StorySchema>;
export type Epic = z.infer<typeof EpicSchema>;
export type Backlog = z.infer<typeof BacklogSchema>;
