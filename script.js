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

// Global Chart instances to avoid "Canvas is already in use" errors
let trendChartInstance = null;
let severityChartInstance = null;
let categoryChartInstance = null;

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
    { id: "filter-area", label: "Area", set: filters.area },
    { id: "filter-dept", label: "Department", set: filters.department },
    { id: "filter-designation", label: "Designation", set: filters.designation },
    { id: "filter-severity", label: "Severity", set: filters.severity },
    { id: "filter-status", label: "Status", set: filters.status },
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
        const filterKey = p.id.split("-")[1]; // area, dept, etc.
        const set = activeFilters[filterKey];
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
  // Destroy previous Chart instances to prevent canvas re-use conflicts
  if (trendChartInstance) trendChartInstance.destroy();
  if (severityChartInstance) severityChartInstance.destroy();
  if (categoryChartInstance) categoryChartInstance.destroy();

  // 1. Trend over time (cases per month)
  const byMonth = {};
  data.forEach((r) => {
    const d = parseDate(r.lastAction);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] || 0) + 1;
  });
  const months = Object.keys(byMonth).sort();
  const counts = months.map((m) => byMonth[m]);
  
  const trendCtx = document.getElementById("trendChart");
  if (trendCtx) {
    trendChartInstance = new Chart(trendCtx.getContext("2d"), {
      type: "line",
      data: {
        labels: months,
        datasets: [{ 
          label: "Cases per month", 
          data: counts, 
          borderColor: "#2196f3", 
          backgroundColor: "rgba(33,150,243,0.1)", 
          tension: 0.3,
          fill: true
        }],
      },
      options: { 
        responsive: true, 
        maintainAspectRatio: false,
        plugins: { legend: { display: false } } 
      },
    });
  }

  // 2. Severity distribution doughnut
  const sevCounts = { Minor: 0, Significant: 0, Severe: 0 };
  data.forEach((r) => (sevCounts[r.severity] = (sevCounts[r.severity] || 0) + 1));
  
  const sevCtx = document.getElementById("severityChart");
  if (sevCtx) {
    severityChartInstance = new Chart(sevCtx.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: ["Minor", "Significant", "Severe"],
        datasets: [{ 
          data: [sevCounts.Minor, sevCounts.Significant, sevCounts.Severe], 
          backgroundColor: ["#4caf50", "#ff9800", "#f44336"],
          borderWidth: 0
        }],
      },
      options: { 
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "right" } } 
      },
    });
  }

  // 3. Top Violation categories bar chart
  const violCounts = {};
  data.forEach((r) => {
    const v = r.violation || "(none)";
    violCounts[v] = (violCounts[v] || 0) + 1;
  });
  const topViol = Object.entries(violCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  
  const catCtx = document.getElementById("categoryChart");
  if (catCtx) {
    categoryChartInstance = new Chart(catCtx.getContext("2d"), {
      type: "bar",
      data: {
        labels: topViol.map((t) => t[0]),
        datasets: [{ 
          label: "Top Violations", 
          data: topViol.map((t) => t[1]), 
          backgroundColor: "#2196f3" 
        }],
      },
      options: { 
        indexAxis: "y", 
        responsive: true, 
        maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      },
    });
  }
}

// ==== INIT ====
window.addEventListener("DOMContentLoaded", loadData);
