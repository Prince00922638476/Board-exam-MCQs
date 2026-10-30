import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("questions/index.json", "utf8"));
if (!Array.isArray(manifest.files) || manifest.files.length !== 4) {
  throw new Error("Question bank manifest must contain all 4 source segments.");
}

const sourceText = manifest.files
  .map((path) => fs.readFileSync(path.replace(/^\.\//, ""), "utf8"))
  .join("\n");
const source = JSON.parse(sourceText);
const questions = source.questions;

if (!Array.isArray(questions) || questions.length !== manifest.questionCount) {
  throw new Error(`Question count mismatch: expected ${manifest.questionCount}, got ${questions?.length ?? 0}.`);
}

const ids = new Set();
const counts = {};
for (const [index, question] of questions.entries()) {
  const label = `Question ${index + 1}`;
  if (!question.id || ids.has(question.id)) throw new Error(`${label}: missing or duplicate id.`);
  ids.add(question.id);
  if (!question.subject || !question.chapter || !question.text) throw new Error(`${label}: subject, chapter or text missing.`);
  if (!Array.isArray(question.options) || question.options.length !== 4 || question.options.some((option) => !String(option).trim())) {
    throw new Error(`${label}: exactly four non-empty options are required.`);
  }
  const answer = Number(question.correctIndex);
  if (!Number.isInteger(answer) || answer < 0 || answer > 3) throw new Error(`${label}: correctIndex must be 0–3.`);
  counts[question.subject] = (counts[question.subject] || 0) + 1;
}

const expected = { science: 359, hindi: 930, sst: 199 };
for (const [subject, count] of Object.entries(expected)) {
  if (counts[subject] !== count) throw new Error(`Count mismatch for ${subject}: expected ${count}, got ${counts[subject] || 0}.`);
}

console.log(`Validated ${questions.length} questions: Hindi 930, Science 359, SST 199.`);
