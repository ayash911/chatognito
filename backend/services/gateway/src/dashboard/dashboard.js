import { io } from 'socket.io-client';

const socket = io({ query: { type: 'dashboard' } });
const healthGrid = document.getElementById('healthGrid');
const logContainer = document.getElementById('logContainer');
const logTarget = document.getElementById('logTarget');
const clearLogsBtn = document.getElementById('clearLogs');

let services = [];
let selectedService = null;
let logs = [];

async function fetchHealth() {
  try {
    const response = await fetch('/gateway/status?force=true');
    const data = await response.json();
    services = data;
    renderHealth();
  } catch (err) {
    console.error('Failed to fetch health:', err);
  }
}

function renderHealth() {
  healthGrid.innerHTML = '';
  services.forEach((svc) => {
    const div = document.createElement('div');
    div.style.marginBottom = '10px';
    div.style.cursor = 'pointer';
    div.style.fontWeight = selectedService === svc.name ? 'bold' : 'normal';
    div.onclick = () => selectService(svc.name);
    div.innerHTML = `[${svc.status.toUpperCase()}] ${svc.name} (${svc.latency || '--'}ms)`;
    healthGrid.appendChild(div);
  });
}

function selectService(name) {
  if (selectedService === name) {
    selectedService = null;
    logTarget.innerText = 'All Traffic';
  } else {
    selectedService = name;
    logTarget.innerText = name + ' Logs';
  }
  renderHealth();
  renderLogs();
}

function addLog(log) {
  logs.unshift(log);
  if (logs.length > 50) logs.pop();
  renderLogs();
}

function renderLogs() {
  logContainer.innerHTML = '';
  const filteredLogs = selectedService ? logs.filter((l) => l.service === selectedService) : logs;
  if (filteredLogs.length === 0) {
    logContainer.innerHTML = '<li>No logs for this view</li>';
    return;
  }
  filteredLogs.forEach((log) => {
    const entry = document.createElement('li');
    const time = new Date(log.timestamp).toLocaleTimeString();

    let detailsHtml = '';
    if (log.query)
      detailsHtml += `<strong>Query Params:</strong>\n${JSON.stringify(log.query, null, 2)}\n\n`;
    if (log.data)
      detailsHtml += `<strong>Request Body:</strong>\n${JSON.stringify(log.data, null, 2)}\n\n`;
    if (log.response)
      detailsHtml += `<strong>Response:</strong>\n${JSON.stringify(log.response, null, 2)}\n\n`;

    entry.innerHTML = `
      <details>
        <summary style="cursor:pointer; outline:none;">
          <strong>[${time}] ${log.method} ${log.path}</strong> - Status: ${log.status} | Latency: ${log.latency}ms | Service: ${log.service}
        </summary>
        ${detailsHtml ? `<pre style="margin-top:5px; border-left:3px solid #ccc; padding-left:10px;">${detailsHtml}</pre>` : '<div style="margin-top:5px; color:#888;">No details</div>'}
      </details>
    `;
    logContainer.appendChild(entry);
  });
}

socket.on('dashboard:log', (log) => {
  addLog(log);
});

clearLogsBtn.onclick = () => {
  logs = [];
  renderLogs();
};

let healthIntervalId;
function startHealthPolling(ms) {
  if (healthIntervalId) clearInterval(healthIntervalId);
  healthIntervalId = setInterval(fetchHealth, ms);
}

document.getElementById('updateInterval').onclick = () => {
  const ms = parseInt(document.getElementById('healthInterval').value, 10);
  if (ms >= 1000) {
    startHealthPolling(ms);
  }
};

// Initial load
fetchHealth();
startHealthPolling(30000);
