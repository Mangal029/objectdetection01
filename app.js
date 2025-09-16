// Database setup
let db;
const DB_NAME = "ObjectCounterDB";
const DB_VERSION = 1;
const STORE_NAME = "detectionSessions";

// Initialize database
function initDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = event => {
      console.error("Database error:", event.target.error);
      reject(event.target.error);
    };

    request.onupgradeneeded = event => {
      db = event.target.result;

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { 
          keyPath: "id", 
          autoIncrement: true 
        });

        // Create indexes for querying
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("duration", "duration", { unique: false });
      }
    };

    request.onsuccess = event => {
      db = event.target.result;
      console.log("Database initialized successfully");
      resolve(db);
    };
  });
}

// Save detection session to database
function saveDetectionSession(counts, duration) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject("Database not initialized");
      return;
    }

    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const sessionData = {
      timestamp: new Date().toISOString(),
      duration: Math.round(duration),
      counts: counts,
      people: counts.person || 0,
      cars: counts.car || 0,
      trucks: counts.truck || 0,
      buses: counts.bus || 0,
      total: Object.values(counts).reduce((sum, count) => sum + (count||0), 0)
    };

    const request = store.add(sessionData);

    request.onsuccess = () => {
      console.log("Session saved to database");
      resolve(request.result);
    };

    request.onerror = event => {
      console.error("Error saving session:", event.target.error);
      reject(event.target.error);
    };
  });
}

// Get all detection sessions from database
function getAllSessions() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject("Database not initialized");
      return;
    }

    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = event => {
      reject(event.target.error);
    };
  });
}

// Clear all history from database
function clearHistory() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject("Database not initialized");
      return;
    }

    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = event => {
      reject(event.target.error);
    };
  });
}

// Export database to CSV
function exportToCSV(sessions) {
  let csv = "Timestamp,Duration (s),People,Cars,Trucks,Buses,Total Objects\n";

  sessions.forEach(session => {
    const date = new Date(session.timestamp);
    const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

    csv += `${formattedDate},${session.duration},${session.people},${session.cars},${session.trucks},${session.buses},${session.total}\n`;
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "object_counter_history.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// Main application code
async function sleep(ms) { 
  return new Promise(r => setTimeout(r, ms)); 
}

let model = null;
let running = false;
let stream = null;
let sessionStartTime = null;
let historyChart = null;
let fullHistoryChart = null;

window.addEventListener('load', async () => {
  // Initialize database
  try {
    await initDatabase();
    console.log("Database ready");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    alert("Warning: Could not initialize local database. History features will not work.");
  }

  // Elements
  const videoEl = document.getElementById('video');
  const imageEl = document.getElementById('image');
  const overlay = document.getElementById('overlay');
  const ctx = overlay.getContext('2d');

  const startBtn = document.getElementById('startBtn');
  const viewHistoryBtn = document.getElementById('viewHistoryBtn');
  const startDetectBtn = document.getElementById('startDetectBtn');
  const stopBtn = document.getElementById('stopBtn');
  const backBtn = document.getElementById('backBtn');
  const modeSelect = document.getElementById('modeSelect');
  const cameraSelect = document.getElementById('cameraSelect');
  const fileInput = document.getElementById('fileInput');
  const confSlider = document.getElementById('confSlider');
  const confLabel = document.getElementById('confLabel');
  const exportBtn = document.getElementById('exportBtn');
  const exportHistoryBtn = document.getElementById('exportHistoryBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  const countPersonEl = document.getElementById('countPerson');
  const countCarEl = document.getElementById('countCar');
  const countTruckEl = document.getElementById('countTruck');
  const countBusEl = document.getElementById('countBus');
  const chkBoxes = Array.from(document.querySelectorAll('.countCheckbox'));

  const historyTableBody = document.getElementById('historyTableBody');
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  // Tab functionality
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabId = button.getAttribute('data-tab');

      // Update active button
      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');

      // Update active content
      tabContents.forEach(content => content.classList.remove('active'));
      document.getElementById(tabId + 'Tab').classList.add('active');

      if (tabId === 'chart') {
        renderFullHistoryChart();
      }
    });
  });

  // Show detection section
  startBtn.addEventListener('click', async () => {
    document.getElementById('landingPage').classList.add('d-none');
    document.getElementById('detectionSection').classList.remove('d-none');
    await loadModel();
    await enumerateCameras();
  });

  viewHistoryBtn.addEventListener('click', async () => {
    document.getElementById('landingPage').classList.add('d-none');
    document.getElementById('historySection').classList.remove('d-none');
    await populateHistoryTable();
    renderFullHistoryChart();
  });

  backBtn.addEventListener('click', () => {
    document.getElementById('historySection').classList.add('d-none');
    document.getElementById('detectionSection').classList.add('d-none');
    document.getElementById('landingPage').classList.remove('d-none');
    stopDetection();
  });

  confSlider.addEventListener('input', () => {
    confLabel.textContent = confSlider.value;
  });

  modeSelect.addEventListener('change', () => {
    if (modeSelect.value === 'upload') {
      fileInput.classList.remove('d-none');
      cameraSelect.classList.add('d-none');
    } else {
      fileInput.classList.add('d-none');
      cameraSelect.classList.remove('d-none');
    }
  });

  fileInput.addEventListener('change', (e) => {
    stopDetection();
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('video')) {
      videoEl.src = url;
      videoEl.classList.remove('d-none');
      imageEl.classList.add('d-none');
    } else {
      imageEl.src = url;
      imageEl.classList.remove('d-none');
      videoEl.classList.add('d-none');
      imageEl.onload = () => {
        overlay.width = imageEl.naturalWidth;
        overlay.height = imageEl.naturalHeight;
        runDetectionOnImage();
      };
    }
  });

  startDetectBtn.addEventListener('click', startDetection);
  stopBtn.addEventListener('click', stopDetection);
  exportBtn.addEventListener('click', async () => {
    const sessions = await getAllSessions().catch(()=>[]);
    exportToCSV(sessions || []);
  });
  exportHistoryBtn.addEventListener('click', async () => {
    const sessions = await getAllSessions().catch(()=>[]);
    exportToCSV(sessions || []);
  });
  clearHistoryBtn.addEventListener('click', async () => {
    if (!confirm('Clear all saved detection history?')) return;
    await clearHistory();
    await populateHistoryTable();
    renderFullHistoryChart();
  });

  cameraSelect.addEventListener('change', async () => {
    stopDetection();
    if (cameraSelect.value) {
      await startCamera(cameraSelect.value);
    }
  });

  // Load model
  async function loadModel() {
    if (model) return;
    try {
      model = await cocoSsd.load();
      console.log('Model loaded');
    } catch (err) {
      console.error('Failed to load model', err);
      alert('Model failed to load. Check your internet connection.');
    }
  }

  async function enumerateCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      cameraSelect.innerHTML = '';
      videoDevices.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || 'Camera ' + (i+1);
        cameraSelect.appendChild(opt);
      });
      if (videoDevices.length) {
        cameraSelect.classList.remove('d-none');
        await startCamera(videoDevices[0].deviceId);
      } else {
        cameraSelect.classList.add('d-none');
      }
    } catch (err) {
      console.warn('Could not enumerate cameras', err);
    }
  }

  async function startCamera(deviceId) {
    stopDetection();
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId } : true,
        audio: false
      });
      videoEl.srcObject = stream;
      videoEl.classList.remove('d-none');
      imageEl.classList.add('d-none');
      await videoEl.play();
      overlay.width = videoEl.videoWidth || 640;
      overlay.height = videoEl.videoHeight || 480;
    } catch (err) {
      console.error('Camera start failed', err);
      alert('Unable to access camera.');
    }
  }

  // Detection loop
  async function startDetection() {
    if (!model) {
      await loadModel();
    }
    running = true;
    startDetectBtn.disabled = true;
    stopBtn.disabled = false;
    sessionStartTime = Date.now();
    // reset counters
    updateCountsDisplay({person:0, car:0, truck:0, bus:0});
    if (modeSelect.value === 'webcam') {
      if (!stream) {
        await startCamera();
      }
      requestAnimationFrame(detectFrame);
    } else {
      // If image is loaded, detection was triggered on image load
      if (imageEl && imageEl.complete && !imageEl.classList.contains('d-none')) {
        await runDetectionOnImage();
      } else if (videoEl && !videoEl.classList.contains('d-none')) {
        videoEl.play();
        requestAnimationFrame(detectFrame);
      }
    }
  }

  async function stopDetection() {
    if (!running) return;
    running = false;
    startDetectBtn.disabled = false;
    stopBtn.disabled = true;
    const durationSec = (Date.now() - sessionStartTime)/1000;
    // gather final counts shown on UI
    const counts = {
      person: parseInt(countPersonEl.textContent)||0,
      car: parseInt(countCarEl.textContent)||0,
      truck: parseInt(countTruckEl.textContent)||0,
      bus: parseInt(countBusEl.textContent)||0
    };
    try {
      await saveDetectionSession(counts, durationSec);
    } catch (err) {
      console.warn('Could not save session:', err);
    }
    populateHistoryTable();
    renderHistoryChart();
  }

  async function detectFrame() {
    if (!running) return;
    try {
      const input = !videoEl.classList.contains('d-none') ? videoEl : imageEl;
      if (!input) return;
      const predictions = await model.detect(input);
      drawPredictions(predictions);
    } catch (err) {
      console.error('Detection error', err);
    }
    requestAnimationFrame(detectFrame);
  }

  function drawPredictions(predictions) {
    // clear
    ctx.clearRect(0,0,overlay.width, overlay.height);
    // scale if needed
    const scaleX = overlay.width / (videoEl.videoWidth || imageEl.naturalWidth || overlay.width);
    const scaleY = overlay.height / (videoEl.videoHeight || imageEl.naturalHeight || overlay.height);
    const selected = new Set(chkBoxes.filter(c=>c.checked).map(c=>c.value));
    const counts = {person:0, car:0, truck:0, bus:0};
    const confThresh = parseFloat(confSlider.value) || 0.5;

    predictions.forEach(p => {
      if (p.score < confThresh) return;
      const cls = p.class;
      if (!selected.has(cls)) return;
      // count classes we track
      if (cls === 'person') counts.person++;
      if (cls === 'car') counts.car++;
      if (cls === 'truck') counts.truck++;
      if (cls === 'bus') counts.bus++;
      // draw box
      const [x,y,w,h] = p.bbox;
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2;
      ctx.strokeRect(x*scaleX, y*scaleY, w*scaleX, h*scaleY);
      ctx.font = '16px Arial';
      ctx.fillStyle = '#00ff88';
      const text = `${p.class} ${(p.score*100).toFixed(1)}%`;
      ctx.fillText(text, x*scaleX + 4, y*scaleY > 10 ? y*scaleY - 6 : y*scaleY + 12);
    });

    updateCountsDisplay(counts);
  }

  function updateCountsDisplay(counts) {
    countPersonEl.textContent = counts.person || 0;
    countCarEl.textContent = counts.car || 0;
    countTruckEl.textContent = counts.truck || 0;
    countBusEl.textContent = counts.bus || 0;
  }

  async function runDetectionOnImage() {
    if (!imageEl.src) return;
    overlay.width = imageEl.naturalWidth;
    overlay.height = imageEl.naturalHeight;
    const preds = await model.detect(imageEl);
    drawPredictions(preds);
  }

  // History & charts
  async function populateHistoryTable() {
    const sessions = await getAllSessions().catch(()=>[]);
    historyTableBody.innerHTML = '';
    sessions.sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp));
    sessions.forEach(s => {
      const tr = document.createElement('tr');
      const d = new Date(s.timestamp);
      tr.innerHTML = `<td>${d.toLocaleString()}</td>
                      <td>${s.duration}</td>
                      <td>${s.people}</td>
                      <td>${s.cars}</td>
                      <td>${s.trucks}</td>
                      <td>${s.buses}</td>
                      <td>${s.total}</td>`;
      historyTableBody.appendChild(tr);
    });
  }

  async function renderHistoryChart() {
    const sessions = await getAllSessions().catch(()=>[]);
    const recent = sessions.slice(-10);
    const labels = recent.map(s => new Date(s.timestamp).toLocaleTimeString());
    const people = recent.map(s=>s.people);
    const cars = recent.map(s=>s.cars);
    const trucks = recent.map(s=>s.trucks);
    const buses = recent.map(s=>s.buses);

    if (historyChart) historyChart.destroy();
    const ctxH = document.getElementById('historyChart').getContext('2d');
    historyChart = new Chart(ctxH, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'People', data: people },
          { label: 'Cars', data: cars },
          { label: 'Trucks', data: trucks },
          { label: 'Buses', data: buses }
        ]
      },
      options: { responsive:true, maintainAspectRatio:false }
    });
  }

  async function renderFullHistoryChart() {
    const sessions = await getAllSessions().catch(()=>[]);
    const labels = sessions.map(s => new Date(s.timestamp).toLocaleString());
    const people = sessions.map(s=>s.people);
    const cars = sessions.map(s=>s.cars);
    const trucks = sessions.map(s=>s.trucks);
    const buses = sessions.map(s=>s.buses);

    const ctxF = document.getElementById('fullHistoryChart').getContext('2d');
    if (fullHistoryChart) fullHistoryChart.destroy();
    fullHistoryChart = new Chart(ctxF, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'People', data: people, fill:false },
          { label: 'Cars', data: cars, fill:false },
          { label: 'Trucks', data: trucks, fill:false },
          { label: 'Buses', data: buses, fill:false }
        ]
      },
      options: { responsive:true, maintainAspectRatio:false }
    });
  }

});
