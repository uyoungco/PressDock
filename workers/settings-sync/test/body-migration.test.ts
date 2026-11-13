import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { validateSnapshot } from "../src/protocol.ts";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const oldConfig = () =>
  JSON.parse(read("../../../docs/settings-sync/fixtures-v1.json")).base.config;
function migrate(config: ReturnType<typeof oldConfig>) {
  const db = new DatabaseSync(":memory:");
  db.exec(read("../migrations/0001_settings.sql"));
  db.prepare(
    "UPDATE settings_state SET initialized=1,revision=7,config_json=?",
  ).run(JSON.stringify(config));
  db.exec(read("../migrations/0002_body_organization.sql"));
  const row = db.prepare("SELECT * FROM settings_state").get()!;
  const next = JSON.parse(row.config_json as string);
  validateSnapshot({ schemaVersion: 2, revision: 7, config: next });
  assert.equal(row.revision, 7);
  assert.equal(row.schema_version, 2);
  db.close();
  return next;
}
test("v1 配置升级为 v2，保留旧模板并提供未绑定模型的正文模板", () => {
  const before = oldConfig(),
    after = migrate(before);
  assert.deepEqual(after.templates.slice(0, -1), before.templates);
  assert.equal(after.harvest.aiOrganizeBody, false);
  assert.equal(
    after.defaults.bodyOrganizationTemplateId,
    "builtin-body-organization",
  );
  assert.equal(after.templates.at(-1).modelConfigId, null);
  assert.equal(
    after.templates.at(-1).systemPrompt,
    read("../../../docs/ai-body-organization/prompts/v6.txt"),
  );
});
test("升级不覆盖同 ID 用户模板，达到模板上限时保留全部旧模板", () => {
  const collision = oldConfig();
  collision.templates[0].id = "builtin-body-organization";
  collision.defaults.titleTemplateId = "builtin-body-organization";
  const next = migrate(collision);
  assert.deepEqual(next.templates, collision.templates);
  assert.equal(next.defaults.bodyOrganizationTemplateId, null);
  const full = oldConfig();
  while (full.templates.length < 128)
    full.templates.push({
      ...full.templates[0],
      id: `demo-${full.templates.length}`,
    });
  assert.equal(migrate(full).templates.length, 128);
});
