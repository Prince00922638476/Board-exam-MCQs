(() => {
  "use strict";
  const DB_NAME = "boardmcq-local";
  const DB_VERSION = 2;
  const SUBJECTS = [
    {name:"विज्ञान",icon:"⚗",key:"science"},
    {name:"गणित",icon:"∑",key:"math"},
    {name:"सामाजिक विज्ञान",icon:"◎",key:"sst"},
    {name:"हिंदी",icon:"अ",key:"hindi"},
    {name:"अंग्रेज़ी",icon:"A",key:"english"},
    {name:"संस्कृत",icon:"श्री",key:"sanskrit"}
  ];
  const MODES = {
    chapter:"अध्यायवार अभ्यास", subject:"विषयवार अभ्यास", mixed:"मिश्रित अभ्यास",
    board:"बोर्ड परीक्षा अभ्यास", hard:"कठिन प्रश्न", wrong:"गलत प्रश्न दोहराएँ"
  };
  const root = document.getElementById("appRoot");
  const modalRoot = document.getElementById("modalRoot");
  const toastEl = document.getElementById("toast");
  let db, bank = [], history = [], documents = [], view = "home", selectedMode = "mixed", session = null, tick = null, toastTimer = null, deferredInstall = null;

  const $ = (selector, parent=document) => parent.querySelector(selector);
  const $$ = (selector, parent=document) => [...parent.querySelectorAll(selector)];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const formatTime = seconds => {
    const s = Math.max(0, Math.floor(seconds || 0));
    return Math.floor(s/60).toString().padStart(2,"0")+":"+Math.floor(s%60).toString().padStart(2,"0");
  };
  function notify(message) {
    toastEl.textContent = message; toastEl.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }
  function openDB() {
    return new Promise((resolve,reject) => {
      const request = indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded = () => {
        const d = request.result;
        if (!d.objectStoreNames.contains("questions")) d.createObjectStore("questions",{keyPath:"id"});
        if (!d.objectStoreNames.contains("results")) d.createObjectStore("results",{keyPath:"id"});
        if (!d.objectStoreNames.contains("documents")) d.createObjectStore("documents",{keyPath:"id"});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function storeAction(store,mode,value) {
    return new Promise((resolve,reject) => {
      const tx = db.transaction(store, mode === "getAll" ? "readonly" : "readwrite");
      const os = tx.objectStore(store);
      let req;
      if (mode === "getAll") req = os.getAll();
      else if (mode === "put") req = os.put(value);
      else if (mode === "bulkPut") {
        if (!Array.isArray(value)) { tx.abort(); reject(new Error("सही सूची नहीं मिली।")); return; }
        for (const item of value) os.put(item);
      }
      else if (mode === "clear") req = os.clear();
      else if (mode === "delete") req = os.delete(value);
      tx.oncomplete = () => resolve(req && mode === "getAll" ? req.result : true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("डेटा सहेजा नहीं जा सका"));
    });
  }
  async function refreshData() {
    bank = await storeAction("questions","getAll");
    history = await storeAction("results","getAll");
    documents = await storeAction("documents","getAll");
    documents.sort((a,b)=>b.addedAt-a.addedAt);
    history.sort((a,b) => b.createdAt-a.createdAt);
  }
  function questionCounts() {
    return bank.reduce((acc,q) => { acc[q.subject]=(acc[q.subject]||0)+1; return acc; },{});
  }
  function renderHome() {
    const counts = questionCounts();
    $("#heroQuestionCount").textContent = bank.length.toLocaleString("hi-IN");
    $("#heroSubjectCount").textContent = Object.keys(counts).length+" विषय";
    $("#heroProgress").style.width = bank.length ? "100%" : "0%";
    $("#bankStatus").textContent = bank.length ? bank.length+" प्रश्न उपलब्ध" : "प्रश्न बैंक में अभी प्रश्न नहीं हैं";
    const cards = Object.keys(counts).sort((a,b)=>a.localeCompare(b,"hi")).map(n => {
      const subject = SUBJECTS.find(s=>s.name===n);
      return `<button class="subject-card available" data-subject="${esc(n)}">
        <span class="subject-icon">${subject?subject.icon:"✦"}</span><span><h3>${esc(n)}</h3><p>${counts[n]} प्रश्न उपलब्ध</p></span><span class="subject-arrow">›</span>
      </button>`;
    }).join("");
    $("#subjectGrid").innerHTML = cards || '<div class="panel empty-state"><h3>प्रश्न बैंक तैयार हो रहा है</h3><p>प्रश्न उपलब्ध होते ही यहाँ दिखाई देंगे।</p></div>';
  }
  function navActive() {
    $$(".nav-link").forEach(b => b.classList.toggle("active", b.dataset.view===view));
  }
  function renderHomeView() {
    root.innerHTML = `
      <section class="hero"><div class="hero-copy"><span class="eyebrow"><span class="status-dot"></span> आपकी बोर्ड तैयारी, एक जगह</span>
      <h1>अभ्यास से <span>आत्मविश्वास</span> तक।</h1><p>कक्षा 10 के प्रश्न हल करें, अपनी गति समझें और कमजोर अध्यायों पर दोबारा अभ्यास करें।</p>
      <div class="hero-actions"><button class="btn btn-primary" data-action="open-setup">अभ्यास शुरू करें <span>→</span></button><button class="btn btn-secondary" data-view="data">प्रश्न जोड़ें</button></div></div>
      <div class="hero-card"><div class="hero-card-top"><span class="mini-icon">✓</span><span>आपकी तैयारी</span></div><strong id="heroQuestionCount">0</strong><span class="muted">उपलब्ध प्रश्न</span><div class="progress-track"><span id="heroProgress"></span></div><div class="hero-card-foot"><span id="heroSubjectCount">0 विषय</span><span>कक्षा 10</span></div></div></section>
      <section class="section-heading"><div><span class="eyebrow">विषय चुनें</span><h2>अपना अगला अभ्यास चुनें</h2></div><span class="subtle" id="bankStatus"></span></section>
      <section id="subjectGrid" class="subject-grid"></section>
      <section class="quick-panel"><div><span class="eyebrow">अभ्यास के तरीके</span><h2>अपनी तैयारी के अनुसार</h2><p>हर अभ्यास के बाद सही, गलत और बिना उत्तर वाले प्रश्न देख सकेंगे।</p></div>
      <div class="mode-chips"><button class="mode-chip" data-mode="chapter">अध्यायवार</button><button class="mode-chip" data-mode="subject">विषयवार</button><button class="mode-chip" data-mode="mixed">मिश्रित अभ्यास</button><button class="mode-chip" data-mode="board">बोर्ड परीक्षा</button><button class="mode-chip" data-mode="hard">कठिन प्रश्न</button><button class="mode-chip" data-mode="wrong">गलत प्रश्न दोहराएँ</button></div></section>
      <footer class="site-footer"><span>BoardMCQ · कक्षा 10 बोर्ड परीक्षा अभ्यास</span><span>आपकी प्रगति इसी डिवाइस में सुरक्षित रहती है।</span></footer>`;
    renderHome();
  }
  function renderWrong() {
    const wrong = new Set(history.flatMap(h => h.details.filter(d=>d.selected!==null && d.selected!==d.answer).map(d=>d.questionId)));
    const qs = bank.filter(q=>wrong.has(q.id));
    root.innerHTML = `<div class="page-head"><div><span class="eyebrow">दोबारा अभ्यास</span><h1>गलत प्रश्न</h1><p>पिछले अभ्यासों में गलत हुए प्रश्न यहाँ मिलेंगे।</p></div><button class="btn btn-primary btn-small" data-action="start-wrong" ${qs.length?"":"disabled"}>अभ्यास शुरू करें →</button></div>
      <div class="panel ${qs.length?"":"empty-state"}">${qs.length?`<h3 style="margin:0 0 5px">${qs.length} प्रश्न दोहराने के लिए तैयार</h3><p class="muted">यह सूची आपके इसी डिवाइस पर सहेजे गए परिणामों से बनती है।</p>`:`<div class="empty-icon">↻</div><h3>अभी दोहराने के लिए प्रश्न नहीं हैं</h3><p>अभ्यास पूरा करने के बाद गलत उत्तर वाले प्रश्न अपने-आप यहाँ दिखाई देंगे।</p><button class="btn btn-secondary btn-small" data-view="home">होम पर जाएँ</button>`}</div>`;
  }
  function renderHistory() {
    root.innerHTML = `<div class="page-head"><div><span class="eyebrow">आपकी प्रगति</span><h1>परीक्षा परिणाम</h1><p>आपके हाल के अभ्यास इसी डिवाइस पर सुरक्षित हैं।</p></div></div>
    ${history.length?`<div class="review-list">${history.map(h=>`<article class="review-item"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><strong>${esc(h.modeLabel)}</strong><strong class="answer-${h.correct>=h.wrong?"good":"bad"}">${h.correct}/${h.total} सही</strong></div><p>${esc(h.subjectLabel||"मिश्रित अभ्यास")} · ${new Date(h.createdAt).toLocaleString("hi-IN")} · ${formatTime(h.elapsed)} · ${h.percent}% अंक</p><button class="btn btn-outline btn-small" data-result-id="${esc(h.id)}">विस्तार देखें</button></article>`).join("")}</div>`:`<div class="panel empty-state"><div class="empty-icon">▤</div><h3>अभी कोई परिणाम नहीं है</h3><p>पहला अभ्यास पूरा करने के बाद आपका परिणाम यहाँ दिखेगा।</p><button class="btn btn-primary btn-small" data-action="open-setup">अभ्यास शुरू करें</button></div>`}`;
  }
  function renderData() {
    const counts=questionCounts();
    const rows=documents.map(d=>`<article class="review-item"><strong>${esc(d.name)}</strong><p>${esc(d.type||"फ़ाइल")} · ${(d.size/1024).toFixed(1)} KB · ${new Date(d.addedAt).toLocaleString("hi-IN")}</p><div class="data-actions">${/^(application\/pdf|image\/|text\/|application\/json)/i.test(d.type||"")?`<button class="btn btn-outline btn-small" data-doc-open="${esc(d.id)}">फ़ाइल देखें</button>`:""}<button class="btn btn-outline btn-small" data-doc-download="${esc(d.id)}">डाउनलोड</button><button class="btn btn-danger btn-small" data-doc-delete="${esc(d.id)}">हटाएँ</button></div></article>`).join("");
    root.innerHTML=`<div class="page-head"><div><span class="eyebrow">प्रश्न प्रबंधन</span><h1>प्रश्न बैंक और फ़ाइलें</h1><p>प्रश्न जोड़ें, निर्यात करें और PDF सहित फ़ाइलें सुरक्षित रखें।</p></div></div>
    <div class="data-summary"><div class="data-stat"><strong>${bank.length}</strong><span>कुल प्रश्न</span></div><div class="data-stat"><strong>${Object.keys(counts).length}</strong><span>विषय</span></div><div class="data-stat"><strong>${documents.length}</strong><span>फ़ाइलें</span></div></div>
    <section class="panel"><h3 style="font-size:14px;margin:0 0 5px">प्रश्न बैंक</h3><p class="muted">JSON प्रश्न जोड़ें या अपने प्रश्न और परिणाम डाउनलोड करें।</p>
    <div class="data-actions"><button class="btn btn-primary btn-small" data-action="import">JSON प्रश्न जोड़ें</button><button class="btn btn-outline btn-small" data-action="export-bank" ${bank.length?"":"disabled"}>प्रश्न बैंक निर्यात करें</button><button class="btn btn-outline btn-small" data-action="export-results" ${history.length?"":"disabled"}>परिणाम निर्यात करें</button><button class="btn btn-danger btn-small" data-action="clear-bank" ${bank.length?"":"disabled"}>प्रश्न बैंक मिटाएँ</button></div>
    <div class="notice">${bank.length?bank.length+" प्रश्न इसी ब्राउज़र में सुरक्षित हैं।":"प्रश्न बैंक अभी खाली है।"} ${history.length?history.length+" परिणाम सुरक्षित हैं।":""}</div>
    <div class="notice">फ़ाइलें अभी इसी डिवाइस में सेव होती हैं। दूसरे लोगों को दिखाने के लिए साझा ऑनलाइन संग्रह जोड़ना बाकी है।</div></section>
    <section class="panel" style="margin-top:14px"><h3 style="font-size:14px;margin:0 0 5px">अपनी फ़ाइलें अपलोड करें</h3><p class="muted">PDF, चित्र और अन्य फ़ाइलें चुनें। अपलोड के बाद वे नीचे सूची में दिखेंगी।</p><input id="fileUploadInput" type="file" multiple hidden><div class="data-actions"><button class="btn btn-primary btn-small" data-action="upload-files">फ़ाइलें अपलोड करें</button></div><div class="review-list">${rows||'<p class="muted">अभी कोई फ़ाइल अपलोड नहीं हुई है।</p>'}</div></section>
    <div class="data-actions"><a class="btn btn-outline btn-small" href="./question-format.json" download>JSON नमूना प्रारूप</a><a class="btn btn-outline btn-small" href="./README.md" target="_blank" rel="noopener">निर्देश देखें</a></div>`;
    $("#fileUploadInput").addEventListener("change",async e=>{const fs=[...e.target.files];try{for(const f of fs){const id="file-"+(crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random());await storeAction("documents","put",{id,name:f.name,type:f.type,size:f.size,addedAt:Date.now(),blob:f});}await refreshData();renderData();notify(fs.length+" फ़ाइलें सेव हो गईं।");}catch(err){notify("फ़ाइल सेव नहीं हुई: "+(err.message||"स्टोरेज की जगह जाँचें।"));}});
  }
  function setView(next) {
    view=next; navActive();
    if (next==="home") renderHomeView();
    else if (next==="wrong") renderWrong();
    else if (next==="history") renderHistory();
    else if (next==="data") renderData();
    root.focus({preventScroll:true});
  }
  function currentFilter(mode,subject,chapter) {
    let qs=[...bank];
    if(subject) qs=qs.filter(q=>q.subject===subject);
    if(chapter) qs=qs.filter(q=>q.chapter===chapter);
    if(mode==="hard") qs=qs.filter(q=>q.difficulty==="hard");
    if(mode==="wrong") {
      const wrong=new Set(history.flatMap(h=>h.details.filter(d=>d.selected!==null&&d.selected!==d.answer).map(d=>d.questionId)));
      qs=qs.filter(q=>wrong.has(q.id));
    }
    return qs;
  }
  function openSetup(mode="mixed",subject="") {
    selectedMode=mode;
    const subjects=[...new Set(bank.map(q=>q.subject))].sort((a,b)=>a.localeCompare(b,"hi"));
    const chapters=[...new Set(bank.filter(q=>!subject||q.subject===subject).map(q=>q.chapter))].sort((a,b)=>a.localeCompare(b,"hi"));
    const defaultCount=mode==="board"?100:20;
    const defaultTime=mode==="board"?10800:1800;
    modalRoot.innerHTML=`<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="setupTitle"><div class="modal-head"><h2 id="setupTitle">अभ्यास तैयार करें</h2><button class="icon-btn" data-action="close-modal" aria-label="बंद करें">×</button></div>
    <div class="form-grid"><div class="field full"><label for="modeSelect">अभ्यास का प्रकार</label><select id="modeSelect">${Object.entries(MODES).map(([k,v])=>`<option value="${k}" ${k===mode?"selected":""}>${v}</option>`).join("")}</select></div>
    <div class="field"><label for="subjectSelect">विषय</label><select id="subjectSelect"><option value="">सभी विषय</option>${subjects.map(s=>`<option value="${esc(s)}" ${s===subject?"selected":""}>${esc(s)}</option>`).join("")}</select></div>
    <div class="field"><label for="chapterSelect">अध्याय</label><select id="chapterSelect"><option value="">सभी अध्याय</option>${chapters.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></div>
    <div class="field"><label for="countSelect">प्रश्नों की संख्या</label><select id="countSelect">${[10,20,25,50,100,0].map(n=>`<option value="${n}" ${n===defaultCount?"selected":""}>${n?n+" प्रश्न":"सभी प्रश्न"}</option>`).join("")}</select></div>
    <div class="field"><label for="timeSelect">कुल समय</label><select id="timeSelect">${[[900,"15 मिनट"],[1800,"30 मिनट"],[2700,"45 मिनट"],[3600,"60 मिनट"],[5400,"90 मिनट"],[10800,"180 मिनट"]].map(([v,l])=>`<option value="${v}" ${v===defaultTime?"selected":""}>${l}</option>`).join("")}</select></div>
    </div><p class="field-help" id="setupHelp" style="margin-top:12px">${mode==="chapter"?"अध्यायवार अभ्यास के लिए विषय और अध्याय चुनना आवश्यक है।":"प्रश्नों का क्रम अभ्यास के समय बदल सकता है। समय पूरा होने पर परीक्षा अपने-आप जमा होगी।"}</p>
    <div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">रद्द करें</button><button class="btn btn-primary" data-action="begin-quiz">अभ्यास शुरू करें →</button></div></section></div>`;
    const subjectEl=$("#subjectSelect"), chapterEl=$("#chapterSelect"), modeEl=$("#modeSelect");
    const updateChapters=()=>{
      const previous=chapterEl.value;
      const ch=[...new Set(bank.filter(q=>!subjectEl.value||q.subject===subjectEl.value).map(q=>q.chapter))].sort((a,b)=>a.localeCompare(b,"hi"));
      chapterEl.innerHTML='<option value="">सभी अध्याय</option>'+ch.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
      if(ch.includes(previous))chapterEl.value=previous;
    };
    subjectEl.addEventListener("change",updateChapters);
    modeEl.addEventListener("change",()=>{
      const board=modeEl.value==="board";
      $("#countSelect").value=board?"100":"20";
      $("#timeSelect").value=board?"10800":"1800";
      $("#setupHelp").textContent=modeEl.value==="chapter"?"अध्यायवार अभ्यास के लिए विषय और अध्याय चुनना आवश्यक है।":"प्रश्नों का क्रम अभ्यास के समय बदल सकता है। समय पूरा होने पर परीक्षा अपने-आप जमा होगी।";
    });
  }
  function startQuiz(mode,subject,chapter,count,duration,overrideQuestions) {
    let candidates=overrideQuestions||currentFilter(mode,subject,chapter);
    if (!candidates.length) { notify("इस चयन में अभी प्रश्न उपलब्ध नहीं हैं।"); return; }
    candidates=[...candidates].sort(()=>Math.random()-.5);
    const chosen=count?candidates.slice(0,count):candidates;
    const startedAt=Date.now();
    session={id:"attempt-"+startedAt,mode,modeLabel:MODES[mode]||"अभ्यास",subjectLabel:subject||"सभी विषय",items:chosen,answers:{},seconds:{},review:[],cursor:0,totalSeconds:duration,remaining:duration,deadlineAt:startedAt+duration*1000,startedAt,questionStartedAt:startedAt,elapsed:0,finished:false};
    modalRoot.innerHTML="";
    renderQuiz(); startClock();
  }
  function startClock() {
    clearInterval(tick);
    tick=setInterval(()=>{
      if(!session||session.finished)return;
      session.remaining=Math.max(0,Math.ceil((session.deadlineAt-Date.now())/1000));
      session.elapsed=Math.min(session.totalSeconds,Math.floor((Date.now()-session.startedAt)/1000));
      const t=$("#quizTimer");
      if(t){t.textContent=formatTime(session.remaining);t.classList.toggle("warning",session.remaining<=300);}
      if(session.remaining<=0) finishQuiz(true);
    },1000);
  }
  function renderQuiz() {
    view="quiz"; navActive();
    const q=session.items[session.cursor], selected=session.answers[q.id];
    const answered=Object.keys(session.answers).length, marked=session.review.includes(q.id);
    root.innerHTML=`<div class="quiz-top"><div class="quiz-title"><strong>${esc(session.modeLabel)}</strong><span>प्रश्न ${session.cursor+1} / ${session.items.length} · ${esc(q.subject)} · ${esc(q.chapter)}</span></div><div class="timer-pill" id="quizTimer">${formatTime(session.remaining)}</div></div>
      <div class="quiz-progress"><span style="width:${((session.cursor+1)/session.items.length)*100}%"></span></div>
      <div class="quiz-layout"><section class="panel question-panel"><div class="question-meta"><span class="tag blue">${esc(q.subject)}</span><span class="tag">${esc(q.chapter)}</span><span class="tag">${esc(q.difficulty||"सामान्य")}</span></div>
      <h2 class="question-text">${esc(q.question)}</h2><div class="options">${q.options.map((o,i)=>`<button class="option ${selected===i?"selected":""}" data-option="${i}"><span class="option-key">${"ABCD"[i]}</span><span>${esc(o)}</span></button>`).join("")}</div>
      <div class="quiz-controls"><div class="left"><button class="btn btn-outline btn-small" data-action="prev" ${session.cursor===0?"disabled":""}>← पिछला</button><button class="btn btn-outline btn-small" data-action="mark">${marked?"चिह्न हटाएँ":"बाद में देखें"}</button></div><div class="right"><button class="btn btn-primary btn-small" data-action="next">${session.cursor===session.items.length-1?"जमा करें":"अगला →"}</button></div></div></section>
      <aside class="panel question-side"><h3>प्रश्न सूची <span class="muted">(${answered} उत्तर दिए)</span></h3><div class="question-grid">${session.items.map((item,i)=>`<button class="q-number ${i===session.cursor?"current":""} ${session.answers[item.id]!==undefined?"answered":""} ${session.review.includes(item.id)?"review":""}" data-jump="${i}">${i+1}</button>`).join("")}</div>
      <div class="legend"><span><i></i> उत्तर दिया</span><span><i class="l-review"></i> बाद में देखने के लिए</span><span><i style="background:#fff;border-color:#dce4ef"></i> बिना उत्तर</span></div>
      <button class="btn btn-outline btn-small" style="width:100%;margin-top:18px" data-action="finish">परीक्षा जमा करें</button></aside></div>`;
  }
  function moveQuestion(next) {
    if (!session) return;
    const now=Date.now(),activeId=session.items[session.cursor].id;
    session.seconds[activeId]=(session.seconds[activeId]||0)+Math.max(0,Math.round((now-session.questionStartedAt)/1000));
    if(next>=session.items.length){finishQuiz(false);return;}
    session.cursor=Math.max(0,Math.min(session.items.length-1,next));
    session.questionStartedAt=now;
    renderQuiz();
  }
  async function finishQuiz(auto=false) {
    if(!session||session.finished)return;
    if(!auto) {
      const unanswered=session.items.filter(q=>session.answers[q.id]===undefined).length;
      if(!confirm(`क्या आप अभ्यास जमा करना चाहते हैं?\nबिना उत्तर: ${unanswered}`))return;
    }
    const finishedAt=Date.now(),activeId=session.items[session.cursor].id;
    session.seconds[activeId]=(session.seconds[activeId]||0)+Math.max(0,Math.round((finishedAt-session.questionStartedAt)/1000));
    session.elapsed=Math.min(session.totalSeconds,Math.floor((finishedAt-session.startedAt)/1000));
    session.finished=true;clearInterval(tick);
    const details=session.items.map(q=>({questionId:q.id,question:q.question,subject:q.subject,chapter:q.chapter,options:q.options,answer:q.answer,selected:session.answers[q.id]??null,explanation:q.explanation||"",seconds:session.seconds[q.id]||0,source:q.source||"",difficulty:q.difficulty||""}));
    const correct=details.filter(d=>d.selected===d.answer).length;
    const wrong=details.filter(d=>d.selected!==null&&d.selected!==d.answer).length;
    const unanswered=details.length-correct-wrong;
    const record={id:session.id,createdAt:Date.now(),mode:session.mode,modeLabel:session.modeLabel,subjectLabel:session.subjectLabel,total:details.length,correct,wrong,unanswered,percent:Math.round(correct/details.length*100),elapsed:session.elapsed,details};
    try {
      await storeAction("results","put",record);
      await refreshData();
    } catch(err) {
      console.error("परिणाम सहेजने में समस्या:",err);
      notify("परिणाम दिखाया जा रहा है, लेकिन डिवाइस में सहेजा नहीं जा सका।");
    }
    renderResult(record,auto);session=null;view="result";navActive();
  }
  function renderResult(r,auto) {
    const slow=r.details.filter(d=>d.seconds>=45).sort((a,b)=>b.seconds-a.seconds);
    const weak={};r.details.filter(d=>d.selected!==d.answer).forEach(d=>weak[d.chapter]=(weak[d.chapter]||0)+1);
    const weakRows=Object.entries(weak).sort((a,b)=>b[1]-a[1]).slice(0,5);
    root.innerHTML=`<div class="page-head"><div><span class="eyebrow">अभ्यास पूरा हुआ</span><h1>आपका परिणाम</h1><p>${auto?"समय पूरा होने पर परीक्षा अपने-आप जमा हुई।":"अभ्यास सफलतापूर्वक जमा हुआ।"}</p></div><button class="btn btn-outline btn-small" data-view="home">होम पर जाएँ</button></div>
      <section class="result-hero"><div class="score-circle"><strong>${r.percent}%</strong><span>प्राप्त अंक</span></div><h2>${r.percent>=80?"बहुत अच्छा अभ्यास!":r.percent>=50?"अच्छी कोशिश, अभ्यास जारी रखें।":"गलत प्रश्न दोहराएँ और फिर प्रयास करें।"}</h2><p>${esc(r.modeLabel)} · ${formatTime(r.elapsed)} में पूरा</p></section>
      <div class="result-stats"><div class="result-stat"><strong class="answer-good">${r.correct}</strong><span>सही उत्तर</span></div><div class="result-stat"><strong class="answer-bad">${r.wrong}</strong><span>गलत उत्तर</span></div><div class="result-stat"><strong>${r.unanswered}</strong><span>बिना उत्तर</span></div><div class="result-stat"><strong>${formatTime(r.elapsed)}</strong><span>कुल समय</span></div></div>
      <section class="panel"><h3 style="margin:0;font-size:14px">अगली बार किस पर ध्यान दें?</h3><div class="review-list">${weakRows.length?weakRows.map(([c,n])=>`<div class="review-item"><strong>${esc(c)}</strong><p>${n} प्रश्नों में दोबारा अभ्यास की ज़रूरत है।</p></div>`).join(""):'<p class="muted">इस अभ्यास में सभी प्रश्न सही हैं। बहुत बढ़िया!</p>'}</div>
      <h3 style="font-size:14px;margin:19px 0 7px">धीमे हल किए गए प्रश्न (45 सेकंड या अधिक)</h3><div class="review-list">${slow.length?slow.slice(0,5).map(d=>`<div class="review-item"><strong>${esc(d.question)}</strong><p>${formatTime(d.seconds)} · ${esc(d.chapter)}</p></div>`).join(""):'<p class="muted">ऐसा कोई प्रश्न नहीं मिला।</p>'}</div>
      <h3 style="font-size:14px;margin:19px 0 7px">उत्तर समीक्षा</h3><div class="review-list">${r.details.map((d,i)=>`<div class="review-item"><strong>${i+1}. ${esc(d.question)}</strong><p>आपका उत्तर: <span class="${d.selected===d.answer?"answer-good":"answer-bad"}">${d.selected===null?"नहीं दिया":esc("ABCD"[d.selected]+". "+d.options[d.selected])}</span><br>सही उत्तर: <span class="answer-good">${esc("ABCD"[d.answer]+". "+d.options[d.answer])}</span>${d.explanation?"<br>व्याख्या: "+esc(d.explanation):""}</p></div>`).join("")}</div></section>`;
  }
  function normalizeQuestion(raw,index) {
    if(!raw||typeof raw!=="object")throw new Error("प्रश्न "+(index+1)+" सही वस्तु नहीं है।");
    const subject=String(raw.subject||"").trim(),chapter=String(raw.chapter||"").trim(),question=String(raw.question||raw.text||"").trim();
    if(!subject||!chapter||!question)throw new Error("प्रश्न "+(index+1)+": विषय, अध्याय और प्रश्न आवश्यक हैं।");
    if(!Array.isArray(raw.options)||raw.options.length!==4||raw.options.some(x=>String(x).trim()===""))throw new Error("प्रश्न "+(index+1)+": ठीक चार खाली न होने वाले विकल्प दें।");
    let answer=raw.answer;
    if(typeof answer==="string"&&/^[A-D]$/i.test(answer.trim()))answer="ABCD".indexOf(answer.trim().toUpperCase());
    answer=Number(answer);
    if(!Number.isInteger(answer)||answer<0||answer>3)throw new Error("प्रश्न "+(index+1)+": सही उत्तर 0–3 या A–D में दें।");
    const id=String(raw.id||("q-"+simpleHash(subject+"|"+chapter+"|"+question))).trim();
    return {id,subject,chapter,question,options:raw.options.map(x=>String(x).trim()),answer,explanation:String(raw.explanation||""),difficulty:["easy","medium","hard"].includes(raw.difficulty)?raw.difficulty:"medium",source:String(raw.source||""),sourceType:String(raw.sourceType||"practice"),year:raw.year||null};
  }
  function simpleHash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16)}
  async function importJSON(file) {
    const text=await file.text();let data;
    try{data=JSON.parse(text)}catch{throw new Error("JSON फ़ाइल पढ़ी नहीं जा सकी।")}
    const raws=Array.isArray(data)?data:data.questions;
    if(!Array.isArray(raws)||!raws.length)throw new Error("फ़ाइल में questions नाम की प्रश्न सूची नहीं मिली।");
    const ids=new Set(), normalized=raws.map(normalizeQuestion);
    for(const q of normalized){if(ids.has(q.id))throw new Error("फ़ाइल में एक ही पहचान दो बार है: "+q.id);ids.add(q.id);}
    await storeAction("questions","bulkPut",normalized);
    await refreshData();notify(normalized.length+" प्रश्न सफलतापूर्वक जोड़े गए।");setView("home");
  }
  function downloadFile(name,content,type="application/json") {
    try { const blob=content instanceof Blob?content:new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);notify("डाउनलोड शुरू हो गया है।");
    } catch(err){notify("डाउनलोड नहीं हो सका: "+(err.message||"फिर प्रयास करें।"));}
  }
  function openSavedFile(id,download=false){
    const f=documents.find(x=>x.id===id);if(!f){notify("फ़ाइल नहीं मिली।");return;}
    if(download){downloadFile(f.name,f.blob,f.type||"application/octet-stream");return;}
    const url=URL.createObjectURL(f.blob),a=document.createElement("a");
    a.href=url;a.target="_blank";a.rel="noopener";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),5*60*1000);
  }
  function openImport() {
    modalRoot.innerHTML=`<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>प्रश्न बैंक आयात करें</h2><button class="icon-btn" data-action="close-modal">×</button></div><div class="field"><label for="jsonFile">JSON फ़ाइल चुनें</label><input id="jsonFile" type="file" accept=".json,application/json"><span class="field-help">फ़ाइल में questions की सूची होनी चाहिए। हर प्रश्न में subject, chapter, question, चार options और answer आवश्यक हैं।</span></div><div class="notice">आयात से पहले सभी प्रश्नों की जाँच की जाएगी। गलत प्रारूप वाली फ़ाइल से प्रश्न नहीं जोड़े जाएँगे।</div><div id="importError" class="field-help" style="color:var(--red);margin-top:10px"></div><div class="modal-actions"><button class="btn btn-secondary" data-action="close-modal">रद्द करें</button><button class="btn btn-primary" data-action="confirm-import">आयात करें</button></div></section></div>`;
  }
  async function showResult(id) {
    const r=history.find(x=>x.id===id);if(r)renderResult(r,false);
    view="result";navActive();
  }
  root.addEventListener("click",async e=>{
    const viewBtn=e.target.closest("[data-view]");
    if(viewBtn){setView(viewBtn.dataset.view);return;}
    const subjectBtn=e.target.closest("[data-subject]");
    if(subjectBtn){openSetup("subject",subjectBtn.dataset.subject);return;}
    const modeBtn=e.target.closest("[data-mode]");
    if(modeBtn){openSetup(modeBtn.dataset.mode);return;}
    const option=e.target.closest("[data-option]");
    if(option&&session){const q=session.items[session.cursor];session.answers[q.id]=Number(option.dataset.option);renderQuiz();return;}
    const jump=e.target.closest("[data-jump]");
    if(jump&&session){moveQuestion(Number(jump.dataset.jump));return;}
    const res=e.target.closest("[data-result-id]");
    if(res){showResult(res.dataset.resultId);return;}
    const fOpen=e.target.closest("[data-doc-open]");if(fOpen){openSavedFile(fOpen.dataset.docOpen);return;}
    const fDown=e.target.closest("[data-doc-download]");if(fDown){openSavedFile(fDown.dataset.docDownload,true);return;}
    const fDel=e.target.closest("[data-doc-delete]");if(fDel){if(confirm("क्या यह फ़ाइल हटानी है?")){await storeAction("documents","delete",fDel.dataset.docDelete);await refreshData();renderData();notify("फ़ाइल हटा दी गई।");}return;}
    const b=e.target.closest("[data-action]");if(!b)return;
    switch(b.dataset.action){
      case "open-setup":openSetup();break;
      case "close-modal":modalRoot.innerHTML="";break;
      case "begin-quiz":{
        const mode=$("#modeSelect").value,subject=$("#subjectSelect").value,chapter=$("#chapterSelect").value;
        const count=Number($("#countSelect").value),duration=Number($("#timeSelect").value);
        if(mode==="chapter"&&(!subject||!chapter)){notify("अध्यायवार अभ्यास के लिए विषय और अध्याय चुनें।");break;}
        if(mode==="subject"&&!subject){notify("विषयवार अभ्यास के लिए विषय चुनें।");break;}
        const qs=currentFilter(mode,subject,chapter);
        if(!qs.length){notify("इस चयन के लिए प्रश्न उपलब्ध नहीं हैं।");break;}
        startQuiz(mode,subject,chapter,count,duration);break;
      }
      case "import":openImport();break;
      case "upload-files":$("#fileUploadInput")?.click();break;
      case "confirm-import":{
        const file=$("#jsonFile")?.files?.[0];if(!file){$("#importError").textContent="पहले JSON फ़ाइल चुनें।";break;}
        try{await importJSON(file);modalRoot.innerHTML="";}catch(err){$("#importError").textContent=err.message;};break;
      }
      case "export-bank":downloadFile("boardmcq-question-bank.json",JSON.stringify({version:1,questions:bank},null,2));break;
      case "export-results":downloadFile("boardmcq-results.json",JSON.stringify(history,null,2));break;
      case "clear-bank":
        if(confirm("क्या आप इस डिवाइस से पूरा प्रश्न बैंक मिटाना चाहते हैं? परिणाम सुरक्षित रहेंगे।")){await storeAction("questions","clear");await refreshData();renderData();notify("प्रश्न बैंक मिटा दिया गया।");}break;
      case "start-wrong":{
        const wrongIds=new Set(history.flatMap(h=>h.details.filter(d=>d.selected!==null&&d.selected!==d.answer).map(d=>d.questionId)));
        const qs=bank.filter(q=>wrongIds.has(q.id));if(qs.length)startQuiz("wrong","","",0,1800,qs);else notify("अभी गलत प्रश्न उपलब्ध नहीं हैं।");break;
      }
      case "prev":moveQuestion(session.cursor-1);break;
      case "next":moveQuestion(session.cursor+1);break;
      case "mark":{
        const id=session.items[session.cursor].id;
        session.review=session.review.includes(id)?session.review.filter(x=>x!==id):[...session.review,id];
        renderQuiz();break;
      }
      case "finish":finishQuiz(false);break;
    }
  });
  modalRoot.addEventListener("click",e=>{if(e.target.matches("[data-close-modal]"))modalRoot.innerHTML="";});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&modalRoot.innerHTML)modalRoot.innerHTML="";});
  document.querySelector(".top-nav").addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(b)setView(b.dataset.view);});
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("#installBtn").classList.remove("hidden");});
  $("#installBtn").addEventListener("click",async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("#installBtn").classList.add("hidden");});
  async function init(){
    try{db=await openDB();await refreshData();renderHomeView();navActive();}
    catch(err){root.innerHTML='<section class="panel empty-state"><h3>स्थानीय संग्रहण उपलब्ध नहीं है</h3><p>कृपया इस साइट को आधुनिक ब्राउज़र में खोलें और निजी ब्राउज़िंग बंद रखें।</p></section>';console.error(err);}
    if("serviceWorker" in navigator && location.protocol.startsWith("http"))navigator.serviceWorker.register("./sw.js").catch(err=>console.warn("SW:",err));
  }
  init();
})();