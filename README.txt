AI Real-Time Object Counter with Database
========================================

Files:
- index.html : Main UI
- style.css  : Styles
- app.js     : JavaScript logic (model, detection, IndexedDB storage)
- README.txt : This file
- assets/    : Empty folder for future assets

How to run locally:
1. Extract the zip.
2. Serve the folder with a static server. Example (python):
   python3 -m http.server 8000
3. Open http://localhost:8000 in Chrome/Edge/Firefox.
4. Click "Start Detection" then "Start" to begin webcam detection.
5. Use "Stop" to end a session and save counts locally (IndexedDB).

Notes:
- The app uses TensorFlow.js and coco-ssd from CDN; internet required for initial load.
- IndexedDB stores detection sessions in your browser only.
