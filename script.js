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

// ==== UTILS ====
function parseDate(str) {
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
  if (lower.includes("nghiêm trọng")) return "Severe";
  if (lower.includes("đáng kể")) return "Significant";
  // default
  return "Minor";
}
function isOverdue(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return false;
  const today = new Date();
  return d < today;
}

// ==== DATA FETCHING ====
async function fetchCSV(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch ${url}`);
  const text = await resp.text();
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (results) => resolve(results.data),
      error: (err) => reject(err),
    });
  });
}

async function loadData() {
  try {
    [rawData1, rawData2] = await Promise.all([fetchCSV(CSV_URL1), fetchCSV(CSV_URL2)]);
    mergeDatasets();
    initFilters();
    renderAll();
  } catch (e) {
    console.error(e);
    alert("Error loading data. Check console for details.");
  }
}

// ==== MERGE LOGIC ====
function mergeDatasets() {
  const map = new Map(); // key -> merged record
  // First, index sheet1 by PZ Code (or fallback to Employee Name)
  rawData1.forEach((row) => {
    const key = (row["PZ Code"] || row["PZ_Code"] || row["Employee ID"] || row["Employee ID" ] || "").trim();
    if (!key) return;
    const base = {
      caseId: row["Case ID"] || `CASE-${key}`,
      employee: row["Partner Name"] || row["Employee Name"] || row["Employee"] || "(not provided)",
      area: row["Area"] || row["Region"] || "(not provided)",
      department: row["Department"] || "(not provided)",
      designation: row["Designation"] || "(not provided)",
      violation: row["Issue"] || row["Violation"] || "(not provided)",
      severityRaw: row["Violation Issue Categories"] || row["Severity"] || "",
      status: row["Status"] || "Open",
      owner: row["PIC of guidance (RM/ASM)"] || row["Owner"] || "(not provided)",
      lastAction: row["Date"] || row["Last Action Date"] || "",
      nextFollowUp: row["Next Follow‑Up"] || row["Next Follow-Up"] || row["Next Follow Up"] || "",
    };
    base.severity = classifySeverity(base.severityRaw);
    map.set(key, base);
  });
  // Merge sheet2 records, overwriting where appropriate
  rawData2.forEach((row) => {
    const key = (row["PZ Code"] || row["Employee ID"] || row["Employee"] || "").trim();
    if (!key) return;
    const existing = map.get(key) || {};
    // Build merged record, preferring sheet2 values when present
    const merged = {
      caseId: existing.caseId || row["Case ID"] || `CASE-${key}`,
      employee: existing.employee || row["Employee Name"] || row["Partner Name"] || "(not provided)",
      area: existing.area || row["Area"] || "(not provided)",
      department: existing.department || row["Department"] || "(not provided)",
      designation: existing.designation || row["Designation"] || "(not provided)",
      violation: existing.violation || row["Violation"] || "(not provided)",
      severityRaw: existing.severityRaw || row["Severity"] || "",
      status: existing.status || row["Status"] || "Open",
      owner: existing.owner || row["Owner"] || "(not provided)",
      lastAction: existing.lastAction || row["Last Action Date"] || "",
      nextFollowUp: existing.nextFollowUp || row["Next Follow‑Up"] || row["Next Follow-Up"] || "",
    };
    merged.severity = classifySeverity(merged.severityRaw);
    map.set(key, merged);
  });
  // Convert map to array and deduplicate by composite key
  mergedData = Array.from(map.values());
}

// ==== FILTERS ==== 
function initFilters() {
  mergedData.forEach((rec) => {
    if (rec.area) filters.area.add(rec.area);
    if (rec.department) filters.department.add(rec.department);
    if (rec.designation) filters.designation.add(rec.designation);
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
    container.innerHTML = "";
    Array.from(p.set).sort().forEach((val) => {
      const id = `${p.id}-${val.replace(/\s+/g, "_")}`;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = id;
      checkbox.value = val;
      checkbox.addEventListener("change", () => {
        const set = activeFilters[p.id.split("-")[1]]; // area, dept, etc.
        if (checkbox.checked) set.add(val);
        else set.delete(val);
        renderAll();
      });
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = val;
      const wrapper = document.createElement("div");
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
  tbody.innerHTML = "";
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
  // Trend over time (cases per month)
  const byMonth = {};
  data.forEach((r) => {
    const d = parseDate(r.lastAction);
    if (!d) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] || 0) + 1;
  });
  const months = Object.keys(byMonth).sort();
  const counts = months.map((m) => byMonth[m]);
  const trendCtx = document.getElementById("trendChart").getContext("2d");
  new Chart(trendCtx, {
    type: "line",
    data: {
      labels: months,
      datasets: [{ label: "Cases per month", data: counts, borderColor: "var(--color-primary)", backgroundColor: "rgba(33,150,243,0.2)", tension: 0.3 }],
    },
    options: { responsive: true, plugins: { legend: { position: "top" } } },
  });

  // Severity distribution doughnut
  const sevCounts = { Minor: 0, Significant: 0, Severe: 0 };
  data.forEach((r) => (sevCounts[r.severity] = (sevCounts[r.severity] || 0) + 1));
  const sevCtx = document.getElementById("severityChart").getContext("2d");
  new Chart(sevCtx, {
    type: "doughnut",
    data: {
      labels: ["Minor", "Significant", "Severe"],
      datasets: [{ data: [sevCounts.Minor, sevCounts.Significant, sevCounts.Severe], backgroundColor: ["var(--color-success)", "var(--color-warning)", "var(--color-danger)"] }],
    },
    options: { responsive: true },
  });

  // Top Violation categories bar chart
  const violCounts = {};
  data.forEach((r) => {
    const v = r.violation || "(none)";
    violCounts[v] = (violCounts[v] || 0) + 1;
  });
  const topViol = Object.entries(violCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const catCtx = document.getElementById("categoryChart").getContext("2d");
  new Chart(catCtx, {
    type: "bar",
    data: {
      labels: topViol.map((t) => t[0]),
      datasets: [{ label: "Top Violations", data: topViol.map((t) => t[1]), backgroundColor: "var(--color-primary)" }],
    },
    options: { indexAxis: "y", responsive: true },
  });
}

// ==== INIT ==== 
window.addEventListener("DOMContentLoaded", loadData);
