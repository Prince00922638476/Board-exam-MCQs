import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("questions/index.json", "utf8"));
if (!Array.isArray(manifest.files) || manifest.files.length !== 4) {
  throw new Error("Question bank manifest must contain all 4 source segments.");
}

const sourceText = manifest.files
  .map((path) => fs.readFileSync(path.replace(/^\.\//, ""), "utf8"))
  .join("\n");
const source = JSON.parse(sourceText);
const baseQuestions = source.questions;

if (!Array.isArray(baseQuestions) || baseQuestions.length !== manifest.questionCount) {
  throw new Error(`Base question count mismatch: expected ${manifest.questionCount}, got ${baseQuestions?.length ?? 0}.`);
}

const ids = new Set();
const counts = {};
function validateQuestion(question, index, label, strictOptions = false) {
  if (!question.id || ids.has(question.id)) throw new Error(`${label} ${index + 1}: missing or duplicate id.`);
  ids.add(question.id);
  const text = question.text || question.question;
  if (!question.subject || !question.chapter || !text) throw new Error(`${label} ${index + 1}: subject, chapter or question missing.`);
  if (!Array.isArray(question.options) || question.options.length !== 4 || question.options.some((option) => !String(option).trim())) {
    throw new Error(`${label} ${index + 1}: exactly four non-empty options are required.`);
  }
  if (strictOptions && new Set(question.options.map((option) => String(option).trim().toLocaleLowerCase("hi"))).size !== 4) {
    throw new Error(`${label} ${index + 1}: repeated options are not allowed in curated additions.`);
  }
  const answer = Number(question.correctIndex ?? question.answer);
  if (!Number.isInteger(answer) || answer < 0 || answer > 3) throw new Error(`${label} ${index + 1}: correctIndex must be 0–3.`);
  counts[question.subject] = (counts[question.subject] || 0) + 1;
}

baseQuestions.forEach((question, index) => validateQuestion(question, index, "Base question"));

const expectedBase = { science: 359, hindi: 930, sst: 199 };
const baseCounts = {};
for (const question of baseQuestions) {
  baseCounts[question.subject] = (baseCounts[question.subject] || 0) + 1;
}
for (const [subject, count] of Object.entries(expectedBase)) {
  if (baseCounts[subject] !== count) throw new Error(`Base count mismatch for ${subject}: expected ${count}, got ${baseCounts[subject] || 0}.`);
}

let supplementalCount = 0;
for (const path of (manifest.supplementalFiles || [])) {
  const supplemental = JSON.parse(fs.readFileSync(path.replace(/^\.\//, ""), "utf8"));
  if (!Array.isArray(supplemental.questions)) throw new Error(`Supplemental file ${path} has no questions array.`);
  supplemental.questions.forEach((question, index) => validateQuestion(question, index, path, true));
  supplementalCount += supplemental.questions.length;
}
if (supplementalCount !== Number(manifest.supplementalCount || 0)) {
  throw new Error(`Supplemental count mismatch: expected ${manifest.supplementalCount || 0}, got ${supplementalCount}.`);
}

console.log(`Validated ${baseQuestions.length + supplementalCount} questions: base Hindi 930, Science 359, SST 199; plus ${supplementalCount} curated supplements.`);
