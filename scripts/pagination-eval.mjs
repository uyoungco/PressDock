import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const hash = (value) => createHash("sha256").update(value).digest("hex");

export function allowedBoundaries(blocks) {
  let quoteDepth = 0;
  let cumulative = 0;
  const total = blocks.reduce((sum, b) => sum + b.chars, 0);
  return blocks.flatMap((block, i) => {
    cumulative += block.chars;
    for (const character of block.text ?? "") {
      if (character === "“") quoteDepth++;
      else if (character === "”") quoteDepth = Math.max(0, quoteDepth - 1);
    }
    const valid =
      i < blocks.length - 1 &&
      !block.keep_with_next &&
      !["heading", "source"].includes(block.type) &&
      blocks[i + 1]?.type !== "caption" &&
      cumulative >= 100 &&
      total - cumulative >= 100 &&
      quoteDepth === 0;
    return valid ? [block.id] : [];
  });
}

export function baselinePlan(blocks, bindings = {}) {
  const bound = new Set(bindings.bind_after ?? []);
  const preferred = new Set(bindings.prefer_after ?? []);
  const allowed = new Set(
    allowedBoundaries(blocks).filter((id) => !bound.has(id)),
  );
  const prefix = [0];
  blocks.forEach((b) => prefix.push(prefix.at(-1) + b.chars));
  const ends = [
    0,
    ...blocks.flatMap((b, i) => (allowed.has(b.id) ? [i + 1] : [])),
    blocks.length,
  ];
  const cost = new Array(ends.length).fill(Infinity);
  const parent = new Array(ends.length).fill(-1);
  cost[0] = 0;
  for (let end = 1; end < ends.length; end++) {
    for (let start = 0; start < end; start++) {
      const from = ends[start];
      const to = ends[end];
      const pageBlocks = blocks.slice(from, to);
      if (!pageBlocks.some((b) => b.type === "text" || b.type === "caption"))
        continue;
      const length = prefix[to] - prefix[from];
      const exceptional = length < 100 || length > 400;
      const paragraphCut =
        to < blocks.length && blocks[to - 1].paragraph === blocks[to].paragraph;
      const score =
        cost[start] +
        (length - 240) ** 2 +
        (exceptional ? 1_000_000 : 0) +
        (paragraphCut ? 500 : 0) -
        (preferred.has(blocks[to - 1].id) ? 1000 : 0);
      if (score < cost[end]) {
        cost[end] = score;
        parent[end] = start;
      }
    }
  }
  const breaks = [];
  for (
    let cursor = ends.length - 1;
    parent[cursor] > 0;
    cursor = parent[cursor]
  )
    breaks.unshift(blocks[ends[parent[cursor]] - 1].id);
  return { break_after: breaks };
}

export function evaluate(fixture, result) {
  const blocks = fixture.blocks;
  const issues = [];
  const ids = result?.break_after;
  if (
    !result ||
    Object.keys(result).length !== 1 ||
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== "string")
  )
    return { valid: false, issues: ["schema"], pages: [] };
  const indices = ids.map((id) => blocks.findIndex((b) => b.id === id));
  if (
    indices.some(
      (i, n) => i < 0 || i === blocks.length - 1 || (n && i <= indices[n - 1]),
    )
  )
    return { valid: false, issues: ["invalid_boundaries"], pages: [] };
  let quoteDepth = 0;
  const forbidden = new Set(fixture.forbid ?? []);
  blocks.forEach((block, i) => {
    for (const character of block.text ?? "") {
      if (character === "“") quoteDepth++;
      else if (character === "”") quoteDepth = Math.max(0, quoteDepth - 1);
    }
    if (
      block.keep_with_next ||
      block.type === "heading" ||
      block.type === "source" ||
      blocks[i + 1]?.type === "caption" ||
      quoteDepth > 0
    )
      forbidden.add(block.id);
  });
  for (const id of ids)
    if (forbidden.has(id)) issues.push(`bound_content:${id}`);
  if (
    fixture.expectedBreaks &&
    JSON.stringify(ids) !== JSON.stringify(fixture.expectedBreaks)
  )
    issues.push("expected_single_page");
  const pages = [];
  let start = 0;
  for (const end of [...indices.map((i) => i + 1), blocks.length]) {
    const pageBlocks = blocks.slice(start, end);
    const characters = pageBlocks.reduce((sum, b) => sum + b.chars, 0);
    const body = pageBlocks.filter((b) => b.type === "text");
    pages.push({
      from: blocks[start]?.id,
      to: blocks[end - 1]?.id,
      characters,
      images: pageBlocks.filter((b) => b.type === "image").length,
      bodyBlocks: body.length,
    });
    if (!body.length && !pageBlocks.some((b) => b.type === "caption"))
      issues.push(`no_body:${start}`);
    if (characters < 80 && blocks.reduce((sum, b) => sum + b.chars, 0) >= 100)
      issues.push(`short_page:${start}`);
    if (characters > 400) {
      let left = 0;
      const splittable = pageBlocks.slice(0, -1).some((b) => {
        left += b.chars;
        return !forbidden.has(b.id) && left >= 100 && characters - left >= 100;
      });
      if (splittable) issues.push(`long_page:${start}`);
    }
    start = end;
  }
  if (pages.length > 1 && pages.at(-1).characters < 100)
    issues.push("short_tail");
  return { valid: true, issues, pages };
}

/** 显式调用才请求真实模型；密钥由调用方在运行内存中传入，永不写入结果。 */
export async function runSuite({
  apiKey,
  fixturePath,
  promptPath,
  outputDir,
  splits,
  runLabel,
  concurrency = 2,
  thinkingType = "disabled",
  reasoningEffort,
  maxTokens = thinkingType === "enabled" ? 16384 : 4096,
  outputMode = "breaks",
}) {
  if (!apiKey) throw new Error("缺少 API 密钥");
  const prompt = await readFile(promptPath, "utf8");
  const allFixtures = JSON.parse(await readFile(fixturePath, "utf8"));
  const fixtures = allFixtures.filter(
    (f) => !splits || splits.includes(f.split),
  );
  if (!fixtures.length || fixtures.length > 32)
    throw new Error("每轮需选择 1～32 个用例");
  const results = new Array(fixtures.length);
  let cursor = 0;
  async function worker() {
    while (cursor < fixtures.length) {
      const index = cursor++;
      const fixture = fixtures[index];
      let cumulative = 0;
      const inputBlocks = fixture.blocks.map((block) => ({
        ...block,
        end_chars: (cumulative += block.chars),
      }));
      let payload = {
        title: fixture.title,
        total_chars: cumulative,
        suggested_page_count:
          cumulative <= 280 ? 1 : Math.max(1, Math.round(cumulative / 240)),
        blocks: inputBlocks,
      };
      const allowed = allowedBoundaries(fixture.blocks);
      payload.allowed_break_after = allowed;
      payload.required_break_count = Math.min(
        Math.max(0, payload.suggested_page_count - 1),
        allowed.length,
      );
      const baseline = baselinePlan(fixture.blocks);
      payload.baseline_break_after = baseline.break_after;
      payload.baseline_pages = evaluate(fixture, baseline).pages;
      if (outputMode === "bindings")
        payload = { title: fixture.title, blocks: fixture.blocks };
      const started = performance.now();
      let usage;
      let responseModel;
      let rejectedBindings;
      try {
        const response = await fetch(
          "https://api.deepseek.com/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "deepseek-flash",
              messages: [
                { role: "system", content: prompt },
                { role: "user", content: JSON.stringify(payload) },
              ],
              thinking: { type: thinkingType },
              response_format: { type: "json_object" },
              temperature: 0,
              ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
              max_tokens: maxTokens,
              stream: false,
            }),
            signal: AbortSignal.timeout(60000),
            redirect: "error",
          },
        );
        // 不记录请求头、密钥或远端原始错误文本。
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const data = await response.json();
        usage = data.usage;
        responseModel = data.model;
        const choice = data.choices?.[0];
        if (choice?.finish_reason !== "stop")
          throw new Error(`finish_${choice?.finish_reason ?? "missing"}`);
        const modelOutput = JSON.parse(choice.message.content);
        let output = modelOutput;
        if (outputMode === "bindings") {
          rejectedBindings = Object.fromEntries(
            ["bind_after", "prefer_after"].map((key) => [
              key,
              Array.isArray(modelOutput[key])
                ? modelOutput[key].filter((id) => /^B\d+$/.test(id))
                : null,
            ]),
          );
          const validIds = new Set(fixture.blocks.map((b) => b.id));
          const all = [];
          const keys = Object.keys(modelOutput).sort();
          let validBindings =
            JSON.stringify(keys) === '["bind_after","prefer_after"]';
          for (const key of ["bind_after", "prefer_after"]) {
            const ids = modelOutput[key];
            if (!Array.isArray(ids)) {
              validBindings = false;
              continue;
            }
            let previous = -1;
            for (const id of ids) {
              const position = fixture.blocks.findIndex((b) => b.id === id);
              if (!validIds.has(id) || position <= previous)
                validBindings = false;
              previous = position;
              all.push(id);
            }
          }
          if (new Set(all).size !== all.length) validBindings = false;
          if (!validBindings) throw new Error("BindingSchemaError");
          output = baselinePlan(fixture.blocks, modelOutput);
        }
        results[index] = {
          id: fixture.id,
          split: fixture.split,
          kind: fixture.kind,
          inputHash: hash(JSON.stringify(payload)),
          model: data.model,
          output,
          ...(outputMode === "bindings" ? { semanticOutput: modelOutput } : {}),
          ...evaluate(fixture, output),
          usage: data.usage,
          elapsedMs: Math.round(performance.now() - started),
        };
      } catch (error) {
        const safeError = /^(HTTP_\d+|finish_[a-z_]+|BindingSchemaError)$/.test(
          error.message,
        )
          ? error.message
          : error.name;
        results[index] = {
          id: fixture.id,
          split: fixture.split,
          kind: fixture.kind,
          valid: false,
          issues: [safeError],
          pages: [],
          usage,
          model: responseModel,
          ...(rejectedBindings ? { rejectedBindings } : {}),
          elapsedMs: Math.round(performance.now() - started),
        };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, fixtures.length) }, worker),
  );
  const summary = {
    runLabel,
    at: new Date().toISOString(),
    promptHash: hash(prompt),
    thinkingType,
    reasoningEffort,
    maxTokens,
    outputMode,
    cases: results.length,
    valid: results.filter((r) => r.valid).length,
    clean: results.filter((r) => r.valid && !r.issues.length).length,
    issues: Object.fromEntries(
      [
        ...new Set(
          results.flatMap((r) => r.issues.map((i) => i.split(":")[0])),
        ),
      ].map((name) => [
        name,
        results.filter((r) => r.issues.some((i) => i.split(":")[0] === name))
          .length,
      ]),
    ),
    promptTokens: results.reduce(
      (sum, r) => sum + (r.usage?.prompt_tokens ?? 0),
      0,
    ),
    completionTokens: results.reduce(
      (sum, r) => sum + (r.usage?.completion_tokens ?? 0),
      0,
    ),
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, `${runLabel}.json`),
    JSON.stringify({ summary, results }, null, 2),
  );
  return { summary, results };
}

if (
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2);
  const option = (name) => args[args.indexOf(name) + 1];
  if (!args.includes("--fixtures") || !args.includes("--prompt")) {
    console.log(
      "用法：node scripts/pagination-eval.mjs --fixtures <JSON> --prompt <TXT> --output <目录> [--splits dev,edge] [--thinking enabled|disabled]；密钥只从 DEEPSEEK_API_KEY 读取。",
    );
  } else {
    try {
      const outputMode = args.includes("--mode")
        ? option("--mode")
        : "bindings";
      if (!["breaks", "bindings"].includes(outputMode))
        throw new Error("--mode 只能为 breaks 或 bindings");
      const thinkingType = args.includes("--thinking")
        ? option("--thinking")
        : "disabled";
      if (!["enabled", "disabled"].includes(thinkingType))
        throw new Error("--thinking 只能为 enabled 或 disabled");
      const result = await runSuite({
        apiKey: process.env.DEEPSEEK_API_KEY,
        fixturePath: path.resolve(option("--fixtures")),
        promptPath: path.resolve(option("--prompt")),
        outputDir: path.resolve(
          args.includes("--output")
            ? option("--output")
            : ".tools/pagination-eval",
        ),
        splits: args.includes("--splits")
          ? option("--splits").split(",")
          : undefined,
        runLabel: `evaluation-${Date.now()}`,
        thinkingType,
        outputMode,
      });
      console.log(JSON.stringify(result.summary, null, 2));
      if (result.summary.clean !== result.summary.cases) process.exitCode = 1;
    } catch {
      console.error("评估未完成；请检查参数、输入文件和运行时密钥。");
      process.exitCode = 1;
    }
  }
}
