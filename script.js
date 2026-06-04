// script.js - Disciplinary Dashboard
// Fetches two public Google Sheets CSVs, merges them, classifies severity, and renders UI.

// ==== CONFIGURATION ====
const SHEET1_ID = "1V7YMuBQcQIGe8YCBbZV8b6yDLaUYq2TS0wU9nbt5Axw"; // Performance Logbook
const SHEET1_GID = "140231664";
const SHEET2_ID = "1W3kj7LbPKG-ZODhJFPsTNb4cJzxB04Gz7i8wdncif_c"; // Violation Log
const SHEET2_GID = "341393831";
const CSV_URL1 = `https://docs.google.com/spreadsheets/d/${SHEET1_ID}/export?format=csv&id=${SHEET1_ID}&gid=${SHEET1_GID}`;
const CSV_URL2 = `https://docs.google.com/spreadsheets/d/${SHEET2_ID}/export?format=csv&id=${SHEET2_ID}&gid=${SHEET2_GID}`;

// ==== GLOBAL STATE ====
let rawData1 = [];
let rawData2 = [];
let normalizedData1 = [];
let normalizedData2 = [];
let mergedData = [];
let filters = {
  area: new Set(),
  department: new Set(),
  designation: new Set(),
  severity: new Set(),
  status: new Set(),
};
let activeFilters = {
  area: new Set(),
  department: new Set(),
  designation: new Set(),
  severity: new Set(),
  status: new Set(),
};

// No global Chart.js instances needed since we render SVG charts directly.

// ==== UTILS ====
function parseDate(str) {
  if (!str) return null;
  // Accepts many formats, fallback to Date.
  const d = new Date(str);
  return isNaN(d) ? null : d;
}
function formatDate(d) {
  if (!d) return "N/A";
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}
function classifySeverity(text) {
  const lower = (text || "").toLowerCase();
  if (lower.includes("nghiêm trọng") || lower.includes("severe")) return "Severe";
  if (lower.includes("đáng kể") || lower.includes("significant")) return "Significant";
  // default
  return "Minor";
}
function isOverdue(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return false;
  const today = new Date();
  return d < today;
}

// Helper to look up values in an object using substring-based matches for keys
function getRowValue(row, possibleKeys) {
  if (!row) return "";
  const keys = Object.keys(row);
  for (const k of keys) {
    const kClean = k.toLowerCase().replace(/\s+/g, "").replace(/[\n\r]/g, "");
    for (const pk of possibleKeys) {
      const pkClean = pk.toLowerCase().replace(/\s+/g, "").replace(/[\n\r]/g, "");
      if (kClean.includes(pkClean) || pkClean.includes(kClean)) {
        return row[k];
      }
    }
  }
  return "";
}

// Clean raw Google Sheet CSV exports by trimming leading rows until headers are found
function cleanAndFindHeaderCSV(text) {
  const lines = text.split(/\r?\n/);
  let headerIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (
      lower.includes("pz code") || 
      lower.includes("pzcode") || 
      lower.includes("mã nhân viên") || 
      lower.includes("ngày phát hiện") || 
      lower.includes("partner name") || 
      lower.includes("tên partner")
    ) {
      headerIndex = i;
      break;
    }
  }
  return lines.slice(headerIndex).join("\n");
}

// ==== DATA FETCHING ====
async function fetchCSV(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}`);
  const text = await resp.text();
  const cleanedText = cleanAndFindHeaderCSV(text);
  return new Promise((resolve, reject) => {
    Papa.parse(cleanedText, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => resolve(results.data),
      error: (err) => reject(err),
    });
  });
}

// Normalizes a raw CSV row into a structured record format
function normalizeRow(row) {
  const employeeId = (
    getRowValue(row, ["pzcode", "mãnhânviên", "employeeid"]) || ""
  ).trim();
  
  const lastActionStr = getRowValue(row, ["ngàyvi phạm", "ngàypháthiện", "date", "lastaction", "submitteddate"]) || "";
  const nextFollowUpStr = getRowValue(row, ["nextfollowup", "ngàytiếptheo", "hànhđộngtiếptheo", "followingaction", "actiontorecovery"]) || "";
  
  return {
    employeeId,
    caseId: getRowValue(row, ["caseid", "mãvụ"]) || (employeeId ? `CASE-${employeeId}` : ""),
    employee: getRowValue(row, ["partnername", "tênpartner", "employeename", "namesofpartner", "nameofpartner", "partner_name", "employee"]) || "(not provided)",
    area: getRowValue(row, ["area", "region", "khuvực"]) || "(not provided)",
    department: getRowValue(row, ["department", "cơsở", "store"]) || "(not provided)",
    designation: getRowValue(row, ["designation", "vịtrí", "role", "function"]) || "(not provided)",
    violation: getRowValue(row, ["issue", "violation", "lỗivi phạm", "details", "type", "diễngiải"]) || "(not provided)",
    severityRaw: getRowValue(row, ["violationissuecategories", "severity", "levelofviolation", "mứcđộvi phạm"]) || "",
    status: getRowValue(row, ["status", "trạngthái"]) || "Open",
    owner: getRowValue(row, ["pic", "owner", "ngườiphụtrách"]) || "(not provided)",
    lastAction: lastActionStr,
    nextFollowUp: nextFollowUpStr,
  };
}

async function loadData() {
  try {
    [rawData1, rawData2] = await Promise.all([fetchCSV(CSV_URL1), fetchCSV(CSV_URL2)]);
    
    // Normalize datasets to handle disparate names & layout styles
    normalizedData1 = rawData1.map(normalizeRow).filter(r => r.employeeId);
    normalizedData2 = rawData2.map(normalizeRow).filter(r => r.employeeId);

    mergeDatasets();
    initFilters();
    renderAll();
  } catch (e) {
    console.error("Error loading or processing dashboard data:", e);
    alert("Error loading data. Check console for details.");
  }
}

// ==== MERGE LOGIC ====
function mergeDatasets() {
  const map = new Map(); // key (employeeId) -> merged record

  // Add sheet 1 records
  normalizedData1.forEach((rec) => {
    rec.severity = classifySeverity(rec.severityRaw);
    map.set(rec.employeeId, rec);
  });

  // Merge sheet 2 records (preferring Sheet 2 values for overlap)
  normalizedData2.forEach((rec) => {
    rec.severity = classifySeverity(rec.severityRaw);
    const existing = map.get(rec.employeeId) || {};
    
    const merged = {
      employeeId: rec.employeeId,
      caseId: existing.caseId || rec.caseId,
      employee: rec.employee !== "(not provided)" ? rec.employee : (existing.employee || rec.employee),
      area: rec.area !== "(not provided)" ? rec.area : (existing.area || rec.area),
      department: rec.department !== "(not provided)" ? rec.department : (existing.department || rec.department),
      designation: rec.designation !== "(not provided)" ? rec.designation : (existing.designation || rec.designation),
      violation: rec.violation !== "(not provided)" ? rec.violation : (existing.violation || rec.violation),
      severityRaw: rec.severityRaw || existing.severityRaw || "",
      severity: rec.severity || existing.severity || "Minor",
      status: rec.status || existing.status || "Open",
      owner: rec.owner !== "(not provided)" ? rec.owner : (existing.owner || rec.owner),
      lastAction: rec.lastAction || existing.lastAction || "",
      nextFollowUp: rec.nextFollowUp || existing.nextFollowUp || "",
    };

    map.set(rec.employeeId, merged);
  });

  mergedData = Array.from(map.values());
}

// ==== FILTERS ====
function initFilters() {
  // Clear any existing filters
  filters.area.clear();
  filters.department.clear();
  filters.designation.clear();
  filters.severity.clear();
  filters.status.clear();

  mergedData.forEach((rec) => {
    if (rec.area && rec.area !== "(not provided)") filters.area.add(rec.area);
    if (rec.department && rec.department !== "(not provided)") filters.department.add(rec.department);
    if (rec.designation && rec.designation !== "(not provided)") filters.designation.add(rec.designation);
    if (rec.severity) filters.severity.add(rec.severity);
    if (rec.status) filters.status.add(rec.status);
  });
  renderFilterPanel();
}

function renderFilterPanel() {
  const panels = [
    { id: "filter-area", key: "area", label: "Area", set: filters.area },
    { id: "filter-dept", key: "department", label: "Department", set: filters.department },
    { id: "filter-designation", key: "designation", label: "Designation", set: filters.designation },
    { id: "filter-severity", key: "severity", label: "Severity", set: filters.severity },
    { id: "filter-status", key: "status", label: "Status", set: filters.status },
  ];
  
  panels.forEach((p) => {
    const container = document.getElementById(p.id);
    if (!container) return;
    container.innerHTML = `<h3>${p.label}</h3>`;
    
    Array.from(p.set).sort().forEach((val) => {
      const id = `${p.id}-${val.replace(/\s+/g, "_")}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = id;
      checkbox.value = val;
      
      checkbox.addEventListener("change", () => {
        const set = activeFilters[p.key];
        if (checkbox.checked) set.add(val);
        else set.delete(val);
        renderAll();
      });
      
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = val;
      
      const wrapper = document.createElement("div");
      wrapper.className = "filter-item";
      wrapper.appendChild(checkbox);
      wrapper.appendChild(label);
      container.appendChild(wrapper);
    });
  });
}

function applyFilters(data) {
  return data.filter((rec) => {
    if (activeFilters.area.size && !activeFilters.area.has(rec.area)) return false;
    if (activeFilters.department.size && !activeFilters.department.has(rec.department)) return false;
    if (activeFilters.designation.size && !activeFilters.designation.has(rec.designation)) return false;
    if (activeFilters.severity.size && !activeFilters.severity.has(rec.severity)) return false;
    if (activeFilters.status.size && !activeFilters.status.has(rec.status)) return false;
    return true;
  });
}

// ==== RENDERING ====
function renderAll() {
  const filtered = applyFilters(mergedData);
  renderKPIs(filtered);
  renderTable(filtered);
  renderCharts(filtered);
}

function renderKPIs(data) {
  const total = data.length;
  const overdue = data.filter((r) => isOverdue(r.nextFollowUp)).length;
  const bySeverity = { Minor: 0, Significant: 0, Severe: 0 };
  data.forEach((r) => (bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1));
  
  const kpiContainer = document.getElementById("kpi-cards");
  if (!kpiContainer) return;
  kpiContainer.innerHTML = "";
  
  const cards = [
    { label: "Total Open Cases", value: total },
    { label: "Overdue Follow‑Ups", value: overdue },
    { label: "Minor", value: bySeverity.Minor },
    { label: "Significant", value: bySeverity.Significant },
    { label: "Severe", value: bySeverity.Severe },
  ];
  
  cards.forEach((c) => {
    const div = document.createElement("div");
    div.className = "kpi-card";
    div.innerHTML = `<div class="label">${c.label}</div><div class="value">${c.value}</div>`;
    kpiContainer.appendChild(div);
  });
}

function renderTable(data) {
  const tbody = document.querySelector("#cases-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;">No matching cases found.</td></tr>`;
    return;
  }

  data.forEach((rec) => {
    const tr = document.createElement("tr");
    if (isOverdue(rec.nextFollowUp)) tr.classList.add("overdue");
    
    const severityClass = {
      Minor: "severity-minor",
      Significant: "severity-significant",
      Severe: "severity-severe",
    }[rec.severity] || "";
    
    tr.innerHTML = `
      <td>${rec.caseId}</td>
      <td>${rec.employee}</td>
      <td>${rec.violation}</td>
      <td><span class="severity-badge ${severityClass}">${rec.severity}</span></td>
      <td>${rec.status}</td>
      <td>${rec.owner}</td>
      <td>${formatDate(parseDate(rec.lastAction))}</td>
      <td>${formatDate(parseDate(rec.nextFollowUp))}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderCharts(data) {
  renderTrendChart(data);
  renderSeverityChart(data);
  renderCategoryChart(data);
}

function renderTrendChart(data) {
  const container = document.getElementById("trendChartContainer");
  if (!container) return;
  container.innerHTML = "";
  
  const byMonth = {};
  data.forEach((r) => {
    const d = parseDate(r.lastAction);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] || 0) + 1;
  });
  const months = Object.keys(byMonth).sort();
  const counts = months.map((m) => byMonth[m]);
  
  if (months.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--color-muted);padding-top:80px;">No data</div>`;
    return;
  }
  
  const width = 350;
  const height = 150;
  const padLeft = 30;
  const padRight = 10;
  const padTop = 15;
  const padBottom = 20;
  
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  
  const maxVal = Math.max(...counts, 1);
  const minVal = 0;
  const valRange = maxVal - minVal;
  
  const points = [];
  months.forEach((m, idx) => {
    const x = padLeft + (idx / Math.max(months.length - 1, 1)) * chartW;
    const y = padTop + chartH - ((counts[idx] - minVal) / valRange) * chartH;
    points.push({ x, y, val: counts[idx], label: m });
  });
  
  const pathD = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaD = pathD + ` L ${points[points.length-1].x.toFixed(1)} ${(padTop + chartH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padTop + chartH).toFixed(1)} Z`;
  
  let xLabels = "";
  let yGrid = "";
  let pointsHTML = "";
  
  for (let i = 0; i <= 2; i++) {
    const val = Math.round(minVal + (i / 2) * valRange);
    const y = padTop + chartH - (i / 2) * chartH;
    yGrid += `
      <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="2 2" />
      <text x="${padLeft - 5}" y="${y + 4}" fill="var(--color-muted)" font-size="9" text-anchor="end">${val}</text>
    `;
  }
  
  months.forEach((m, idx) => {
    if (idx === 0 || idx === months.length - 1 || (months.length > 5 && idx === Math.floor(months.length / 2))) {
      const p = points[idx];
      const dateParts = m.split("-");
      const displayLabel = dateParts.length === 2 ? `${dateParts[1]}/${dateParts[0].slice(2)}` : m;
      xLabels += `<text x="${p.x}" y="${height - 4}" fill="var(--color-muted)" font-size="9" text-anchor="middle">${displayLabel}</text>`;
    }
    
    const p = points[idx];
    pointsHTML += `
      <circle cx="${p.x}" cy="${p.y}" r="3.5" fill="var(--color-primary)" class="chart-dot">
        <title>${p.label}: ${p.val} cases</title>
      </circle>
    `;
  });
  
  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="svg-line-chart">
      <defs>
        <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--color-primary)" stop-opacity="0.2" />
          <stop offset="100%" stop-color="var(--color-primary)" stop-opacity="0.0" />
        </linearGradient>
      </defs>
      ${yGrid}
      <path d="${areaD}" fill="url(#areaGradient)" />
      <path d="${pathD}" fill="none" stroke="var(--color-primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      ${pointsHTML}
      ${xLabels}
    </svg>
  `;
}

function renderSeverityChart(data) {
  const container = document.getElementById("severityChartContainer");
  if (!container) return;
  container.innerHTML = "";
  
  const sevCounts = { Minor: 0, Significant: 0, Severe: 0 };
  data.forEach((r) => (sevCounts[r.severity] = (sevCounts[r.severity] || 0) + 1));
  
  const total = sevCounts.Minor + sevCounts.Significant + sevCounts.Severe;
  if (total === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--color-muted);padding-top:80px;">No data</div>`;
    return;
  }
  
  const minorPct = (sevCounts.Minor / total) * 100;
  const sigPct = (sevCounts.Significant / total) * 100;
  const sevPct = (sevCounts.Severe / total) * 100;
  
  const R = 40;
  const C = 2 * Math.PI * R;
  let currentOffset = 0;
  
  const makeSegment = (pct, color, label) => {
    if (pct === 0) return "";
    const strokeLength = (pct / 100) * C;
    const strokeOffset = C - strokeLength + currentOffset;
    currentOffset += strokeLength;
    return `<circle cx="50" cy="50" r="${R}" 
      fill="transparent" 
      stroke="${color}" 
      stroke-width="12" 
      stroke-dasharray="${strokeLength} ${C - strokeLength}" 
      stroke-dashoffset="${strokeOffset}" 
      transform="rotate(-90 50 50)"
      class="doughnut-segment">
      <title>${label}: ${pct.toFixed(1)}%</title>
    </circle>`;
  };
  
  const minorSeg = makeSegment(minorPct, "var(--color-success)", "Minor");
  const sigSeg = makeSegment(sigPct, "var(--color-warning)", "Significant");
  const sevSeg = makeSegment(sevPct, "var(--color-danger)", "Severe");
  
  container.innerHTML = `
    <div class="doughnut-wrapper">
      <svg viewBox="0 0 100 100" class="svg-doughnut">
        ${minorSeg}
        ${sigSeg}
        ${sevSeg}
        <circle cx="50" cy="50" r="28" fill="var(--color-bg)" />
      </svg>
      <div class="doughnut-legend">
        <div class="legend-item"><span class="dot" style="background:var(--color-success)"></span>Minor: ${sevCounts.Minor}</div>
        <div class="legend-item"><span class="dot" style="background:var(--color-warning)"></span>Significant: ${sevCounts.Significant}</div>
        <div class="legend-item"><span class="dot" style="background:var(--color-danger)"></span>Severe: ${sevCounts.Severe}</div>
      </div>
    </div>
  `;
}

function renderCategoryChart(data) {
  const container = document.getElementById("categoryChartContainer");
  if (!container) return;
  container.innerHTML = "";
  
  const violCounts = {};
  data.forEach((r) => {
    const v = r.violation || "(none)";
    violCounts[v] = (violCounts[v] || 0) + 1;
  });
  const topViol = Object.entries(violCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  
  if (topViol.length === 0) {
    container.innerHTML = `<div style="text-align:center;color:var(--color-muted);padding-top:80px;">No data</div>`;
    return;
  }
  
  const maxVal = Math.max(...topViol.map(t => t[1]));
  
  topViol.forEach(([label, value]) => {
    const pct = maxVal > 0 ? (value / maxVal) * 100 : 0;
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label" title="${label}">${label}</div>
      <div class="bar-wrapper">
        <div class="bar-fill" style="width: ${pct}%"></div>
      </div>
      <div class="bar-value">${value}</div>
    `;
    container.appendChild(row);
  });
}

// ==== INIT ====
window.addEventListener("DOMContentLoaded", loadData);
