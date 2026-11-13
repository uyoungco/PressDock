import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LIMITS,
  ProtocolError,
  validateDocument,
  type DocumentKind,
  type Json,
} from "../src/protocol.ts";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../docs/settings-sync/fixtures-v2.json", import.meta.url),
    "utf8",
  ),
) as {
  demo: boolean;
  base: Json;
  cases: {
    name: string;
    kind: DocumentKind;
    input?: Json;
    raw?: string;
    expectedCode: string | null;
    expected?: Json;
    deletedKeys?: string[];
  }[];
};
assert.equal(fixture.demo, true);
for (const c of fixture.cases) {
  test(`protocol shared fixture: ${c.name}`, () => {
    const before = JSON.stringify(fixture.base);
    try {
      const result = validateDocument(
        new TextEncoder().encode(c.raw ?? JSON.stringify(c.input)),
        c.kind,
        fixture.base,
        c.deletedKeys,
      );
      assert.equal(c.expectedCode, null);
      if (c.expected) assert.deepEqual(result, c.expected);
    } catch (error) {
      assert.ok(
        error instanceof ProtocolError,
        `unexpected error in ${c.name}`,
      );
      assert.equal(error.code, c.expectedCode);
      assert.equal(error.message.includes("DEMO-ONLY"), false);
    }
    assert.equal(
      JSON.stringify(fixture.base),
      before,
      "失败或预演均不得修改调用方快照",
    );
  });
}

test("UTF-8 transport boundary is measured before parsing, without truncation", () => {
  const prefix = new TextEncoder().encode(JSON.stringify(fixture.base));
  const exact = new Uint8Array(LIMITS.documentBytes).fill(32);
  exact.set(prefix);
  assert.deepEqual(validateDocument(exact, "snapshot"), fixture.base);
  const over = new Uint8Array(LIMITS.documentBytes + 1).fill(32);
  over.set(prefix);
  assert.throws(
    () => validateDocument(over, "snapshot"),
    (e: unknown) =>
      e instanceof ProtocolError && e.code === "PAYLOAD_TOO_LARGE",
  );
});

test("large Unicode templates and many presets honor config byte and count limits", () => {
  const base = structuredClone(fixture.base) as {
    config: {
      templates: Record<string, Json>[];
      imagePresets: Record<string, Json>[];
    };
  };
  const template = base.config.templates[0];
  (base.config as unknown as Record<string, Json>).defaults = {
    titleTemplateId: null,
    paginationTemplateId: null,
    bodyOrganizationTemplateId: null,
  };
  template.systemPrompt = "中".repeat(20000);
  template.userPrompt = "文".repeat(20000);
  base.config.templates = Array.from({ length: 8 }, (_, i) => ({
    ...template,
    id: `demo-large-${i}`,
  }));
  const encode = () => new TextEncoder().encode(JSON.stringify(base));
  validateDocument(encode(), "snapshot");
  base.config.templates.push({ ...template, id: "demo-large-over" });
  assert.throws(
    () => validateDocument(encode(), "snapshot"),
    (e: unknown) =>
      e instanceof ProtocolError && e.code === "PAYLOAD_TOO_LARGE",
  );
  base.config.templates[8].userPrompt = "x";
  const remaining =
    LIMITS.configBytes -
    new TextEncoder().encode(JSON.stringify(base.config)).length;
  base.config.templates[8].userPrompt =
    "x" + "中".repeat(Math.floor(remaining / 3)) + "a".repeat(remaining % 3);
  assert.equal(
    new TextEncoder().encode(JSON.stringify(base.config)).length,
    LIMITS.configBytes,
  );
  validateDocument(encode(), "snapshot");
  base.config.templates[8].userPrompt += "a";
  assert.throws(
    () => validateDocument(encode(), "snapshot"),
    (e: unknown) =>
      e instanceof ProtocolError && e.code === "PAYLOAD_TOO_LARGE",
  );
  base.config.templates = [];
  (base.config as unknown as Record<string, Json>).defaults = {
    titleTemplateId: null,
    paginationTemplateId: null,
    bodyOrganizationTemplateId: null,
  };
  base.config.imagePresets = Array.from({ length: 2048 }, (_, i) => ({
    channel: `演示${i}`,
    subChannel: "子渠道",
    field: "titlePic",
    size: null,
    maxBytes: null,
    format: "webp",
  }));
  validateDocument(encode(), "snapshot");
  base.config.imagePresets.push({
    ...base.config.imagePresets[0],
    channel: "演示超限",
  });
  assert.throws(
    () => validateDocument(encode(), "snapshot"),
    (e: unknown) =>
      e instanceof ProtocolError && e.code === "VALIDATION_FAILED",
  );
});
