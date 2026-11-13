// 离线读取显式指定的本机评测目录；输出仅包含指标与指纹，不包含业务正文。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { JSDOM } from "jsdom";

const root = process.argv[2];
const originalCmsPath = process.argv[3];
if (!root || !originalCmsPath)
  throw new Error("请指定本机评测目录和截图文章详情 JSON 路径");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalize = (value) =>
  value
    .replaceAll("[!--empirenews.page--]", "")
    .replace(/\s|\u200b|\u2060|\ufeff/gu, "");
const metrics = (html) => {
  const doc = new JSDOM(html).window.document;
  const text = normalize(doc.body.textContent);
  const paragraphs = [...doc.querySelectorAll("p")]
    .map((p) => normalize(p.textContent))
    .filter(Boolean);
  const lengths = paragraphs.map((p) => [...p].length);
  const images = [...doc.querySelectorAll("img")].map((e) =>
    [...e.attributes].map((a) => [a.name, a.value]).sort(),
  );
  const result = {
    text,
    bag: [...text].sort().join(""),
    chars: [...text].length,
    paragraphs: lengths.length,
    maxParagraph: Math.max(0, ...lengths),
    longParagraphs: lengths.filter((n) => n > 160).length,
    shortParagraphs: lengths.filter((n) => n < 40).length,
    images,
    paragraphLengths: lengths,
  };
  doc.defaultView.close();
  return result;
};
const fixtures = read("fixtures.json");
const cleaned = read("cleaned-rust.json");
const cms = [
  ...JSON.parse(fs.readFileSync(originalCmsPath, "utf8")).records,
  ...read("cms-historical.json"),
  ...read("cms-holdout.json"),
  ...read("cms-final-holdout.json"),
];
const rows = [];
for (const f of fixtures.filter((f) => !f.demo)) {
  const original = cleaned.find((c) => c.id === f.id);
  const result = read(
    `${f.split === "holdout" ? "v6-holdout" : "v6"}/${f.id}-0.json`,
  );
  const a = metrics(original.cleaned),
    b = metrics(f.html),
    c = metrics(cms.find((c) => c.id === f.id).response.data.NewsText),
    out = metrics(result.rendered ?? f.html);
  const chosen = f.input.actions.filter((a) =>
    result.report.plan?.actions.includes(a.id),
  );
  const summarize = (x) => ({
    chars: x.chars,
    images: x.images.length,
    paragraphs: x.paragraphs,
    maxParagraph: x.maxParagraph,
    longParagraphs: x.longParagraphs,
    shortParagraphs: x.shortParagraphs,
  });
  rows.push({
    id: f.id,
    split: f.split,
    sourceUrl:
      original.source.url ??
      cms.find((c) => c.id === f.id).response.data.SourceUrl,
    inputSha256: hash(f.html),
    outputSha256: hash(result.rendered ?? f.html),
    original: summarize(a),
    formatted: summarize(b),
    cms: summarize(c),
    organized: summarize(out),
    sourceToFormattedTextEqual: a.text === b.text,
    cmsTextEqual: b.text === c.text,
    cmsTextBagEqual: b.bag === c.bag,
    textEqual: b.text === out.text,
    imagesEqual: JSON.stringify(b.images) === JSON.stringify(out.images),
    candidateCount: f.input.actions.length,
    selected: chosen.map((a) => a.id),
    splitCandidates: chosen.filter((a) => a.kind === "split").length,
    joinCandidates: chosen.filter((a) => a.kind === "join").length,
    valid: result.report.valid,
    requestMade: result.report.requestMade,
    changed: result.report.changed,
  });
}
const rounds = [];
for (const dir of fs
  .readdirSync(root)
  .filter((s) => /^v[1-6](?:-|$)/.test(s))) {
  if (!fs.existsSync(path.join(root, dir, "results.json"))) continue;
  const reports = read(`${dir}/results.json`);
  const requests = reports.filter((r) => r.requestMade !== false);
  const durations = requests.map((r) => r.elapsedMs).sort((a, b) => a - b);
  rounds.push({
    name: dir,
    workflows: reports.length,
    requests: requests.length,
    valid: reports.filter((r) => r.valid).length,
    skipped: reports.length - requests.length,
    changed: reports.filter((r) => r.changed).length,
    failures: reports
      .filter((r) => !r.valid)
      .map((r) => ({
        id: r.id,
        repeat: r.repeat,
        error: r.error ?? "LEGACY_VALIDATION_REJECTED",
      })),
    inputTokens: requests.reduce(
      (s, r) => s + (r.usage?.input_tokens ?? r.usage?.prompt_tokens ?? 0),
      0,
    ),
    outputTokens: requests.reduce(
      (s, r) => s + (r.usage?.output_tokens ?? r.usage?.completion_tokens ?? 0),
      0,
    ),
    medianMs: durations[Math.floor(durations.length / 2)] ?? null,
    maxMs: durations.at(-1) ?? null,
  });
}
const report = {
  generatedAt: new Date().toISOString(),
  model: "deepseek-flash",
  protocol: "responses",
  promptVersion: 6,
  promptSha256: hash(
    fs.readFileSync("docs/ai-body-organization/prompts/v6.txt"),
  ),
  contractVersion: 2,
  counts: {
    realSamples: rows.length,
    development: rows.filter((r) => r.split === "development").length,
    holdout: rows.filter((r) => r.split === "holdout").length,
    inputImages: rows.reduce((n, r) => n + r.formatted.images, 0),
  },
  samples: rows,
  rounds,
};
const output = "docs/ai-body-organization/evaluation-summary.json";
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      output,
      counts: report.counts,
      rounds,
      quality: rows.map(
        ({
          id,
          split,
          formatted,
          organized,
          selected,
          textEqual,
          imagesEqual,
        }) => ({
          id,
          split,
          beforeMax: formatted.maxParagraph,
          afterMax: organized.maxParagraph,
          beforeLong: formatted.longParagraphs,
          afterLong: organized.longParagraphs,
          actions: selected.length,
          textEqual,
          imagesEqual,
        }),
      ),
    },
    null,
    2,
  ),
);
