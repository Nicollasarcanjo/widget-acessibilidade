import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("/acessibilidade skill includes its audit method and report template", () => {
  const skill = read("SKILL.md");
  const method = read("references/criteria-and-method.md");
  const template = read("references/report-template.md");

  assert.match(skill, /^name: acessibilidade/m);
  assert.match(skill, /WCAG 2\.2 níveis A e AA/);
  assert.match(skill, /não altere o código do produto/i);
  assert.match(method, /Requer revisão manual/);
  assert.match(method, /Meta técnica desta auditoria/);
  assert.match(template, /## Achados/);
  assert.match(template, /## Matriz WCAG 2\.2 A\/AA/);
});

test("repository describes both commands and permits commercial integration", () => {
  const repositoryReadme = fs.readFileSync(path.join(root, "..", "README.md"), "utf8");
  const license = fs.readFileSync(path.join(root, "..", "LICENSE"), "utf8");

  assert.match(repositoryReadme, /`\/widget`/);
  assert.match(repositoryReadme, /`\/acessibilidade`/);
  assert.match(repositoryReadme, /integrados gratuitamente em produtos e serviços monetizados/i);
  assert.match(repositoryReadme, /produtos independentes/);
  assert.match(license, /O uso comercial integrado é permitido sem autorização escrita prévia/);
  assert.match(license, /plano pago ou receita no produto hospedeiro/);
  assert.doesNotMatch(license, /PolyForm Noncommercial/);
  assert.match(license, /Required Notice: Copyright \(c\) 2026 nicollasarcanjo/);
});
