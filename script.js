// ==========================================
// НАЛАШТУВАННЯ GOOGLE DRIVE API
// ==========================================
const CLIENT_ID = '1046799060090-ddfgdlkkf71k1fdesfrhtmbfqu66jo5f.apps.googleusercontent.com'; // <-- ВСТАВ СВІЙ CLIENT ID СЮДИ!
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILE_NAME = 'gurps_character_data.json';
const TOKEN_KEY = 'gurps_drive_token_v1';
const TOKEN_EXPIRES_KEY = 'gurps_drive_token_expires_v1';

let tokenClient;
let accessToken = null;
let driveFileId = null;

const COLLAPSE_KEY = "gurps_character_sheet_collapsed_v1"; // Залишаємо локально лише для UI

const state = {
  fields:{},
  lists:{
    advantages:[{name:"",points:""}],
    disadvantages:[{name:"",points:""}],
    skills:[{name:"",level:"",relative:"",points:""}]
  },
  portrait:""
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let saveTimer;

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g, char => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  })[char]);
}
function number(value,fallback=0){
  const result=Number(value);
  return Number.isFinite(result)?result:fallback;
}
function fieldValue(key,fallback=""){
  const element=document.querySelector(`[data-key="${key}"]`);
  return element?element.value:fallback;
}
function formatNumber(value){
  return Number.isInteger(value)?String(value):value.toFixed(1).replace(/\.0$/,"");
}

function renderList(id){
  const container=document.getElementById(id);
  container.innerHTML="";
  state.lists[id].forEach((item,index)=>{
    const row=document.createElement("div");
    row.className="list-row"+(id==="skills"?" skill":"");
    if(id==="skills"){
      row.innerHTML=`
        <input data-list="${id}" data-index="${index}" data-prop="name" value="${escapeHtml(item.name||"")}" placeholder="Навичка">
        <input data-list="${id}" data-index="${index}" data-prop="level" value="${escapeHtml(item.level||"")}" placeholder="12">
        <input data-list="${id}" data-index="${index}" data-prop="relative" value="${escapeHtml(item.relative||"")}" placeholder="DX+1">
        <input data-list="${id}" data-index="${index}" data-prop="points" type="number" value="${escapeHtml(item.points||"")}" placeholder="0">
        <button class="remove" data-remove="${id}" data-index="${index}" title="Видалити">×</button>`;
    }else{
      const placeholder=id==="advantages"?"Перевага / перк":"Недолік / особливість";
      row.innerHTML=`
        <input data-list="${id}" data-index="${index}" data-prop="name" value="${escapeHtml(item.name||"")}" placeholder="${placeholder}">
        <input data-list="${id}" data-index="${index}" data-prop="points" type="number" value="${escapeHtml(item.points||"")}" placeholder="Очки">
        <button class="remove" data-remove="${id}" data-index="${index}" title="Видалити">×</button>`;
    }
    container.appendChild(row);
  });
}

function calculate(){
  const st=number(fieldValue("st"),10);
  const dx=number(fieldValue("dx"),10);
  const iq=number(fieldValue("iq"),10);
  const ht=number(fieldValue("ht"),10);
  const hp=number(fieldValue("hp"),st);
  const will=number(fieldValue("will"),iq);
  const per=number(fieldValue("per"),iq);
  const fp=number(fieldValue("fp"),ht);

  const basicLift=st*st/5;
  const speed=(dx+ht)/4;
  const move=Math.floor(speed);
  const dodge=move+3;

  $("#basicLift").textContent=formatNumber(basicLift);
  $("#basicSpeed").textContent=speed.toFixed(2);
  $("#basicMove").textContent=move;
  $("#dodge").textContent=dodge;
  $("#dodgeOverride").placeholder="авто: "+dodge;

  const costs={
    st:(st-10)*10,
    dx:(dx-10)*20,
    iq:(iq-10)*20,
    ht:(ht-10)*10,
    hp:(hp-st)*2,
    will:(will-iq)*5,
    per:(per-iq)*5,
    fp:(fp-ht)*3
  };
  Object.entries(costs).forEach(([key,value])=>{
    document.getElementById(key+"Cost").textContent=`[${value}]`;
  });

  const statPoints=Object.values(costs).reduce((a,b)=>a+b,0);
  const advantagePoints=state.lists.advantages.reduce((sum,item)=>sum+number(item.points),0);
  const disadvantagePoints=state.lists.disadvantages.reduce((sum,item)=>sum+number(item.points),0);
  const skillPoints=state.lists.skills.reduce((sum,item)=>sum+number(item.points),0);
  $("#totalPoints").textContent=statPoints+advantagePoints+disadvantagePoints+skillPoints;

  const rows=[
    ["Немає",1,1,0],
    ["Легке",2,.8,1],
    ["Середнє",3,.6,2],
    ["Важке",6,.4,3],
    ["Надтяжке",10,.2,4]
  ];
  $("#encumbranceBody").innerHTML=rows.map(([name,multiplier,moveMultiplier,penalty])=>{
    const rowMove=Math.max(1,Math.floor(move*moveMultiplier));
    const rowDodge=Math.max(1,dodge-penalty);
    return `<tr><td>${name}</td><td>${formatNumber(basicLift*multiplier)}</td><td>${rowMove}</td><td>${rowDodge}</td></tr>`;
  }).join("");
}

function collect(){
  $$("[data-key]").forEach(element=>{
    state.fields[element.dataset.key]=element.value;
  });
}
function apply(){
  Object.entries(state.fields||{}).forEach(([key,value])=>{
    const element=document.querySelector(`[data-key="${key}"]`);
    if(element)element.value=value;
  });
  renderList("advantages");
  renderList("disadvantages");
  renderList("skills");
  setPortrait(state.portrait||"");
  calculate();
}

// ==========================================
// ЛОГІКА GOOGLE DRIVE
// ==========================================

function isTokenValid() {
  const expires = localStorage.getItem(TOKEN_EXPIRES_KEY);
  // Залишаємо запас у 5 хвилин (300000 мс) до реального протухання
  return expires && (Date.now() < Number(expires) - 300000);
}

async function findDriveFile() {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_FILE_NAME}' and trashed=false`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }
  return null;
}

async function loadFromDrive() {
  $("#saveStatus").textContent = "Перевірка Drive...";
  try {
    driveFileId = await findDriveFile();
    if (driveFileId) {
      $("#saveStatus").textContent = "Завантаження...";
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      const imported = await res.json();
      state.fields = imported.fields || {};
      state.lists = imported.lists || state.lists;
      state.portrait = imported.portrait || "";
      apply();
      $("#saveStatus").textContent = "Синхронізовано з Drive";
    } else {
      $("#saveStatus").textContent = "Створено новий аркуш";
      apply(); // Пустий аркуш
    }
  } catch (error) {
    console.error(error);
    $("#saveStatus").textContent = "Помилка завантаження з Drive";
  }
}

async function saveToDrive(showMessage = false) {
  if (!accessToken) return;

  // ПЕРЕВІРКА: Чи живий токен?
  if (!isTokenValid()) {
    $("#saveStatus").textContent = "Сесія вийшла (1 год). Натисніть 'Увійти в Google'!";
    $("#saveStatus").style.color = "#ff6b6b"; // Червоний колір для привернення уваги
    $("#authBtn").style.display = "inline-block";
    $("#saveBtn").style.display = "none";
    return; // Зупиняємо збереження, дані залишаються в інтерфейсі
  }
  
  // Повертаємо стандартний колір, якщо все ок
  $("#saveStatus").style.color = "#d3c293"; 

  if (showMessage) $("#saveStatus").textContent = "Зберігаю в Drive...";
  collect();

  const fileContent = JSON.stringify(state);

  try {
    if (!driveFileId) {
      driveFileId = await findDriveFile();
    }

    if (!driveFileId) {
      // Створюємо новий файл
      const metaRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: DRIVE_FILE_NAME })
      });
      const meta = await metaRes.json();
      driveFileId = meta.id;
    }

    // Оновлюємо вміст файлу
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: fileContent
    });

    $("#saveStatus").textContent = "Збережено в Google Drive";
    setTimeout(() => {
        if($("#saveStatus").textContent === "Збережено в Google Drive") {
             $("#saveStatus").textContent = "Синхронізовано з Drive";
        }
    }, 2000);
  } catch (error) {
    console.error(error);
    $("#saveStatus").textContent = "Помилка збереження в Drive!";
  }
}

function scheduleSave(){
  if (!accessToken) return;
  clearTimeout(saveTimer);
  $("#saveStatus").textContent = "Очікування...";
  // Затримка 3 секунди перед автоматичним відправленням в Drive, щоб не спамити API
  saveTimer = setTimeout(() => saveToDrive(true), 3000);
}

window.onload = function () {
  const savedToken = localStorage.getItem(TOKEN_KEY);
  const tokenExpires = localStorage.getItem(TOKEN_EXPIRES_KEY);

  // Перевіряємо, чи є токен і чи він ще дійсний
  if (savedToken && isTokenValid()) {
    accessToken = savedToken;
    $("#authBtn").style.display = "none";
    $("#logoutBtn").style.display = "inline-block";
    $("#saveBtn").style.display = "inline-block";
    loadFromDrive();
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        accessToken = tokenResponse.access_token;
        
        // Зберігаємо токен у localStorage
        localStorage.setItem(TOKEN_KEY, accessToken);
        // Google видає expires_in у секундах (зазвичай 3599). 
        const expiresInMs = Number(tokenResponse.expires_in) * 1000;
        localStorage.setItem(TOKEN_EXPIRES_KEY, Date.now() + expiresInMs);

        $("#authBtn").style.display = "none";
        $("#logoutBtn").style.display = "inline-block";
        $("#saveBtn").style.display = "inline-block";
        $("#saveStatus").style.color = "#d3c293"; // Скидаємо червоний колір
        
        // Якщо у нас вже є ID файлу, значить ми оновили токен посеред гри
        if (driveFileId) {
          saveToDrive(true); // Одразу зберігаємо те, що не змогли зберегти раніше
        } else {
          loadFromDrive(); // Інакше це перший вхід
        }
      }
    },
  });
  
  apply();
  setupCollapsibles();
};

$("#authBtn").addEventListener("click", () => {
  if(CLIENT_ID === 'CLIENT_ID') {
    alert("Увага! Ти забув вставити свій Client ID у код.");
    return;
  }
  tokenClient.requestAccessToken();
});

$("#logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRES_KEY);
  accessToken = null;
  driveFileId = null;
  
  $("#authBtn").style.display = "inline-block";
  $("#logoutBtn").style.display = "none";
  $("#saveBtn").style.display = "none";
  $("#saveStatus").textContent = "Потрібна авторизація";
  $("#saveStatus").style.color = "#d3c293";
});

// ==========================================
// ПОДІЇ ІНТЕРФЕЙСУ
// ==========================================

function setPortrait(source){
  state.portrait=source||"";
  const image=$("#portraitImg");
  const placeholder=$("#portraitPlaceholder");
  if(source){
    image.src=source;
    image.style.display="block";
    placeholder.style.display="none";
  }else{
    image.removeAttribute("src");
    image.style.display="none";
    placeholder.style.display="grid";
  }
}

document.addEventListener("input",event=>{
  const element=event.target;
  if(element.dataset.key){
    state.fields[element.dataset.key]=element.value;
    calculate();
    scheduleSave();
  }
  if(element.dataset.list){
    const item=state.lists[element.dataset.list][Number(element.dataset.index)];
    item[element.dataset.prop]=element.value;
    calculate();
    scheduleSave();
  }
});

document.addEventListener("click",event=>{
  const add=event.target.dataset.add;
  if(add){
    state.lists[add].push(add==="skills"
      ? {name:"",level:"",relative:"",points:""}
      : {name:"",points:""});
    renderList(add);
    scheduleSave();
  }

  const remove=event.target.dataset.remove;
  if(remove){
    const index=Number(event.target.dataset.index);
    state.lists[remove].splice(index,1);
    if(!state.lists[remove].length){
      state.lists[remove].push(remove==="skills"
        ? {name:"",level:"",relative:"",points:""}
        : {name:"",points:""});
    }
    renderList(remove);
    calculate();
    scheduleSave();
  }
});

$("#portraitInput").addEventListener("change",event=>{
  const file=event.target.files[0];
  if(!file)return;
  if(file.size>4*1024*1024){
    alert("Використовуйте зображення розміром до 4 МБ.");
    return;
  }
  const reader=new FileReader();
  reader.onload=()=>{
    setPortrait(reader.result);
    saveToDrive(true);
  };
  reader.readAsDataURL(file);
});
$("#removePortrait").addEventListener("click",()=>{
  setPortrait("");
  saveToDrive(true);
});
$("#saveBtn").addEventListener("click",()=>saveToDrive(true));
$("#printBtn").addEventListener("click",()=>window.print());

$("#exportBtn").addEventListener("click",()=>{
  collect();
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const anchor=document.createElement("a");
  anchor.href=URL.createObjectURL(blob);
  anchor.download=(fieldValue("name")||"gurps-character").replace(/[^\p{L}\p{N}_-]+/gu,"_")+".json";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
});

$("#importFile").addEventListener("change",event=>{
  const file=event.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const imported=JSON.parse(reader.result);
      state.fields=imported.fields||{};
      state.lists=imported.lists||state.lists;
      state.portrait=imported.portrait||"";
      apply();
      saveToDrive(true);
    }catch(error){
      alert("Не вдалося прочитати JSON-файл.");
    }
  };
  reader.readAsText(file);
});

$("#clearBtn").addEventListener("click",()=>{
  if(!confirm("Очистити весь аркуш персонажа? Дані будуть скинуті."))return;
  // Очищуємо стан у пам'яті
  state.fields = {};
  state.lists = {
    advantages:[{name:"",points:""}],
    disadvantages:[{name:"",points:""}],
    skills:[{name:"",level:"",relative:"",points:""}]
  };
  state.portrait = "";
  apply();
  saveToDrive(true); // Перезаписуємо пустим у Drive
});

function getCollapsedState(){
  try{
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}");
  }catch(error){
    return {};
  }
}
function saveCollapsedState(map){
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(map));
}
function setupCollapsibles(){
  const collapsed = getCollapsedState();

  document.querySelectorAll(".block").forEach((block, index)=>{
    const id = block.dataset.blockId || ("block_" + index);
    block.dataset.blockId = id;

    const title = block.querySelector(".block-title");
    if(!title || title.querySelector(".collapse-btn")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "collapse-btn";
    btn.setAttribute("aria-label", "Згорнути або розгорнути блок");
    btn.textContent = "−";

    const sync = () => {
      const isCollapsed = block.classList.contains("collapsed");
      btn.textContent = isCollapsed ? "+" : "−";
      btn.setAttribute("aria-expanded", String(!isCollapsed));
    };

    if(collapsed[id]) block.classList.add("collapsed");
    sync();

    btn.addEventListener("click", (event)=>{
      event.preventDefault();
      event.stopPropagation();
      block.classList.toggle("collapsed");
      collapsed[id] = block.classList.contains("collapsed");
      saveCollapsedState(collapsed);
      sync();
    });

    title.appendChild(btn);
  });

  const journal = document.getElementById("journalDetails");
  if(journal && Object.prototype.hasOwnProperty.call(collapsed, "journalDetails")){
    journal.open = !collapsed["journalDetails"];
  }
  if(journal){
    journal.addEventListener("toggle", ()=>{
      const current = getCollapsedState();
      current["journalDetails"] = !journal.open;
      saveCollapsedState(current);
    });
  }
}
