let backlog = null;
let config = { jiraConfigured: false, jiraBaseUrl: null, defaultProjectKey: "" };

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
};

fetch("/api/config")
  .then((r) => r.json())
  .then((c) => {
    config = c;
    $("#project-key").value = c.defaultProjectKey;
    if (!c.jiraConfigured) {
      $("#push-btn").disabled = true;
      $("#push-btn").title = "Set the JIRA_* variables in .env to enable pushing";
    }
  });

$("#generate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#generate-btn");
  const status = $("#status");
  btn.disabled = true;
  status.className = "status";
  status.textContent = "Reading the document and drafting stories. Large documents can take a few minutes.";
  try {
    const res = await fetch("/api/generate", { method: "POST", body: new FormData(e.target) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    backlog = data;
    status.textContent = "";
    render();
  } catch (err) {
    status.className = "status error";
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

// Inputs write straight back into the backlog object so exports and pushes use the edited values.
function bind(input, obj, key, transform = (v) => v) {
  input.addEventListener("input", () => {
    obj[key] = transform(input.value);
    renderSummary();
  });
  return input;
}
const lines = (v) => v.split("\n").map((s) => s.trim()).filter(Boolean);
const csvList = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
const autoRows = (text) => Math.min(10, Math.max(2, text.split("\n").length + 1));

function renderSummary() {
  const stories = backlog.epics.flatMap((e) => e.stories);
  const points = stories.reduce((n, s) => n + (Number(s.storyPoints) || 0), 0);
  $("#summary").textContent = `${backlog.epics.length} epics · ${stories.length} stories · ${points} points`;
}

function renderNotes() {
  const notes = $("#notes");
  notes.replaceChildren();
  for (const [key, title] of [["assumptions", "Assumptions"], ["openQuestions", "Open questions"]]) {
    if (!backlog[key]?.length) continue;
    notes.append(
      el("div", { className: "card notes" },
        el("h3", { textContent: title }),
        el("ul", {}, ...backlog[key].map((t) => el("li", { textContent: t })))),
    );
  }
}

function storyCard(epic, story) {
  const priority = el("select");
  for (const p of ["Highest", "High", "Medium", "Low", "Lowest"]) {
    priority.append(el("option", { value: p, textContent: p, selected: p === story.priority }));
  }
  const remove = el("button", { type: "button", className: "link", textContent: "Remove", title: "Remove story" });
  remove.onclick = () => {
    epic.stories.splice(epic.stories.indexOf(story), 1);
    render();
  };
  const ac = story.acceptanceCriteria.join("\n");

  return el("div", { className: "story" },
    el("div", { className: "story-head" },
      bind(el("input", { className: "story-title", value: story.title }), story, "title"),
      remove),
    el("div", { className: "meta" },
      el("label", {}, "Priority", bind(priority, story, "priority")),
      el("label", {}, "Points", bind(el("input", { type: "number", min: 0, value: story.storyPoints, style: "width:60px" }), story, "storyPoints", Number)),
      el("label", {}, "Labels", bind(el("input", { value: story.labels.join(", ") }), story, "labels", csvList)),
      story.sourceReference ? el("span", { textContent: `Source: ${story.sourceReference}` }) : null),
    el("div", { className: "label", textContent: "User story" }),
    bind(el("textarea", { value: story.userStory, rows: 2 }), story, "userStory"),
    el("div", { className: "label", textContent: "Description" }),
    bind(el("textarea", { value: story.description, rows: autoRows(story.description) }), story, "description"),
    el("div", { className: "label", textContent: "Acceptance criteria (one per line)" }),
    bind(el("textarea", { value: ac, rows: autoRows(ac) }), story, "acceptanceCriteria", lines),
  );
}

function render() {
  $("#results").hidden = false;
  renderSummary();
  renderNotes();
  $("#push-status").replaceChildren();
  $("#epics").replaceChildren(
    ...backlog.epics.map((epic) =>
      el("section", { className: "card epic" },
        el("h2", {}, bind(el("input", { value: epic.title }), epic, "title")),
        bind(el("textarea", { className: "epic-summary", value: epic.summary, rows: 2 }), epic, "summary"),
        ...epic.stories.map((story) => storyCard(epic, story)),
      ),
    ),
  );
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  el("a", { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

$("#export-json").onclick = () => download("backlog.json", JSON.stringify(backlog, null, 2), "application/json");

// Columns line up with Jira's CSV importer; "Issue Id" + "Parent" link stories to their epic.
$("#export-csv").onclick = () => {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Issue Id", "Parent", "Issue Type", "Summary", "Description", "Priority", "Story Points", "Labels"]];
  let id = 1;
  for (const epic of backlog.epics) {
    const epicId = id++;
    rows.push([epicId, "", "Epic", epic.title, epic.summary, "", "", ""]);
    for (const s of epic.stories) {
      const description = [
        s.userStory, "", s.description, "",
        "Acceptance criteria:", ...s.acceptanceCriteria.map((c) => `* ${c}`),
        s.sourceReference ? `\nSource: ${s.sourceReference}` : "",
      ].join("\n");
      rows.push([id++, epicId, "Story", s.title, description, s.priority, s.storyPoints, s.labels.join(" ")]);
    }
  }
  download("backlog.csv", rows.map((r) => r.map(q).join(",")).join("\r\n"), "text/csv");
};

$("#push-btn").onclick = async () => {
  const projectKey = $("#project-key").value.trim();
  const status = $("#push-status");
  if (!projectKey) {
    status.className = "status error";
    status.textContent = "Enter a Jira project key.";
    return;
  }
  const count = backlog.epics.reduce((n, e) => n + 1 + e.stories.length, 0);
  if (!confirm(`Create ${count} issues in Jira project ${projectKey}?`)) return;

  const btn = $("#push-btn");
  btn.disabled = true;
  status.className = "status";
  status.textContent = "Creating issues in Jira…";
  try {
    const res = await fetch("/api/jira/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectKey, epics: backlog.epics }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    const item = (r) => r.key
      ? el("li", { className: "ok" }, el("a", { href: `${config.jiraBaseUrl}/browse/${r.key}`, target: "_blank", textContent: r.key }), ` ${r.title}`)
      : el("li", { className: "err", textContent: `${r.title}: ${r.error}` });
    status.replaceChildren(
      el("ul", { className: "push-results" },
        ...data.flatMap((r) => [item(r.epic), el("ul", {}, ...r.stories.map(item))])),
    );
  } catch (err) {
    status.className = "status error";
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
};
