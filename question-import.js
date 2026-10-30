(() => {
  "use strict";
  let pdfjsPromise = null;

  async function getPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs")
        .then((lib) => {
          lib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
          return lib;
        });
    }
    return pdfjsPromise;
  }

  function hash(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function inferSubject(fileName, text) {
    const sample = (fileName + " " + text.slice(0, 1800)).toLowerCase();
    if (/science|vigyan|विज्ञान|रसायन|जीव प्रक्रम/.test(sample)) return "विज्ञान";
    if (/math|गणित|mathematics/.test(sample)) return "गणित";
    if (/social|sst|सामाजिक|इतिहास|भूगोल|नागरिकशास्त्र/.test(sample)) return "सामाजिक विज्ञान";
    if (/hindi|हिंदी|हिन्दी/.test(sample)) return "हिंदी";
    if (/english|अंग्रेज़ी|अंग्रेजी/.test(sample)) return "अंग्रेज़ी";
    if (/art|drawing|painting|कला|चित्रकला/.test(sample)) return "कला / चित्रकला";
    return "अपलोड सामग्री";
  }

  function answerIndex(letter, labels) {
    const normalized = String(letter || "").toUpperCase();
    const aliases = { "A":"A", "B":"B", "C":"C", "D":"D", "क":"क", "ख":"ख", "ग":"ग", "घ":"घ" };
    return labels.indexOf(aliases[normalized] || normalized);
  }

  async function extract(file) {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      throw new Error("यह PDF फ़ाइल नहीं है।");
    }
    const pdfjs = await getPdfJs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const lines = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let line = "";
      let lastY = null;
      for (const item of content.items) {
        if (!item.str) continue;
        const y = item.transform && item.transform.length > 5 ? item.transform[5] : lastY;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 3 && line.trim()) {
          lines.push(line.trim());
          line = "";
        }
        line += (line ? " " : "") + item.str;
        lastY = y;
        if (item.hasEOL) {
          if (line.trim()) lines.push(line.trim());
          line = "";
          lastY = null;
        }
      }
      if (line.trim()) lines.push(line.trim());
      lines.push("");
    }

    const fullText = lines.join("\n").replace(/\u00a0/g, " ");
    const keyStart = fullText.search(/answer\s*key|उत्तर\s*(?:कुंजी|माला)|उत्तरमाला/i);
    const keyText = keyStart >= 0 ? fullText.slice(keyStart) : "";
    const key = new Map();
    const keyPattern = /(?:^|[\s,|])(\d{1,3})\s*[-.)=:]?\s*([A-Dकखगघ])(?=$|[\s,|])/gim;
    for (const match of keyText.matchAll(keyPattern)) {
      key.set(Number(match[1]), match[2].toUpperCase());
    }

    const blocks = [];
    let current = null;
    let inAnswerKey = false;
    for (const line of lines) {
      if (/answer\s*key|उत्तर\s*(?:कुंजी|माला)|उत्तरमाला/i.test(line)) inAnswerKey = true;
      if (inAnswerKey) continue;
      const start = line.match(/^\s*(?:प्रश्न\s*)?(\d{1,3})\s*[).:-]\s*(.+)\s*$/i);
      if (start && start[2].trim().length > 3) {
        current = { number: Number(start[1]), lines: [start[2].trim()] };
        blocks.push(current);
      } else if (current && line.trim()) {
        current.lines.push(line.trim());
      }
    }

    const subject = inferSubject(file.name, fullText);
    const chapter = file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "PDF से प्राप्त प्रश्न";
    const questions = [];
    let unresolvedAnswers = 0;

    for (const block of blocks) {
      const raw = block.lines.join(" ").replace(/\s+/g, " ").trim();
      const markerPattern = /(?:\(([A-Dकखगघ])\)|\[([A-Dकखगघ])\]|(?:^|\s)([A-Dकखगघ])[).:-])\s*/gi;
      const markers = [...raw.matchAll(markerPattern)];
      if (markers.length !== 4) continue;
      const labels = markers.map((m) => (m[1] || m[2] || m[3]).toUpperCase());
      if (new Set(labels).size !== 4) continue;

      const question = raw.slice(0, markers[0].index).trim();
      const options = markers.map((marker, index) => {
        const start = marker.index + marker[0].length;
        const end = index < 3 ? markers[index + 1].index : raw.length;
        return raw.slice(start, end).trim().replace(/[;|]+$/, "");
      });
      let answerLetter = key.get(block.number);
      if (!answerLetter) {
        const inline = raw.match(/(?:answer|ans|उत्तर)\s*[:：-]\s*([A-Dकखगघ])/i);
        if (inline) answerLetter = inline[1].toUpperCase();
      }
      if (question.length < 8 || options.some((o) => !o) || new Set(options.map((o) => o.toLowerCase())).size !== 4) continue;
      const answer = answerLetter ? answerIndex(answerLetter, labels) : -1;
      if (answer < 0) {
        unresolvedAnswers++;
        continue;
      }
      questions.push({
        id: "pdf-" + hash(file.name + "|" + block.number + "|" + question),
        subject,
        chapter,
        question,
        options,
        answer,
        explanation: "",
        difficulty: "medium",
        source: "अपलोड की गई PDF: " + file.name,
        sourceType: "uploaded-pdf"
      });
    }
    return { questions, pages: pdf.numPages, detectedBlocks: blocks.length, answerKeyEntries: key.size, unresolvedAnswers };
  }

  window.BoardMCQImporter = { extract };
})();