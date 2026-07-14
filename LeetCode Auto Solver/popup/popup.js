// Popup handler for LeetCode Gemini Auto Solver

document.addEventListener("DOMContentLoaded", () => {
  const apiKeyInput = document.getElementById("api-key");
  const toggleKeyBtn = document.getElementById("toggle-key");
  const modelSelect = document.getElementById("model-select");
  const langSelect = document.getElementById("lang-select");
  const autoSubmitCheckbox = document.getElementById("auto-submit");
  const solveBtn = document.getElementById("solve-btn");
  const clearLogsBtn = document.getElementById("clear-logs");
  const logTerminal = document.getElementById("log-terminal");

  // Eye icon paths for visibility toggling
  const eyeOpenSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  const eyeClosedSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

  // 1. Load configuration settings from Chrome Sync storage
  chrome.storage.sync.get({
    apiKey: "",
    model: "gemini-3.5-flash",
    language: "auto",
    autoSubmit: false
  }, (items) => {
    apiKeyInput.value = items.apiKey;
    modelSelect.value = items.model;
    langSelect.value = items.language;
    autoSubmitCheckbox.checked = items.autoSubmit;
  });

  // 2. Load active execution status and logs from background service worker
  chrome.runtime.sendMessage({ action: "GET_STATUS" }, (response) => {
    if (response) {
      setSolvingState(response.isSolving);
      if (response.logs && response.logs.length > 0) {
        logTerminal.innerHTML = "";
        response.logs.forEach(appendLog);
      }
    }
  });

  // 3. Save options automatically upon changes
  const saveOptions = () => {
    chrome.storage.sync.set({
      apiKey: apiKeyInput.value.trim(),
      model: modelSelect.value,
      language: langSelect.value,
      autoSubmit: autoSubmitCheckbox.checked
    });
  };

  apiKeyInput.addEventListener("input", saveOptions);
  modelSelect.addEventListener("change", saveOptions);
  langSelect.addEventListener("change", saveOptions);
  autoSubmitCheckbox.addEventListener("change", saveOptions);

  // 4. API Key visibility toggler
  toggleKeyBtn.addEventListener("click", () => {
    if (apiKeyInput.type === "password") {
      apiKeyInput.type = "text";
      toggleKeyBtn.innerHTML = eyeClosedSvg;
    } else {
      apiKeyInput.type = "password";
      toggleKeyBtn.innerHTML = eyeOpenSvg;
    }
  });

  // 5. Trigger problem solving
  solveBtn.addEventListener("click", () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      appendLog({
        timestamp: new Date().toLocaleTimeString(),
        type: "error",
        message: "Error: Gemini API Key is required. Please get a free API Key at: https://aistudio.google.com/app/apikey"
      });
      return;
    }

    setSolvingState(true);
    chrome.runtime.sendMessage({ action: "START_SOLVE" }, (response) => {
      if (response && response.status === "already_solving") {
        appendLog({
          timestamp: new Date().toLocaleTimeString(),
          type: "warning",
          message: "A solve process is already running."
        });
      }
    });
  });

  // 6. Clear logs
  clearLogsBtn.addEventListener("click", () => {
    logTerminal.innerHTML = `<div class="log-line system">Terminal logs cleared.</div>`;
  });

  // 7. Listen for messages from background script
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "LOG_UPDATE") {
      if (logTerminal.querySelector(".system") && logTerminal.children.length === 1) {
        logTerminal.innerHTML = ""; // clear initial message on first real log
      }
      appendLog(request.log);
      setSolvingState(request.isSolving);
    } else if (request.action === "LOG_CLEAR") {
      logTerminal.innerHTML = "";
      setSolvingState(request.isSolving);
    } else if (request.action === "SOLVE_FINISHED") {
      setSolvingState(request.isSolving);
    }
  });

  // Helper to adjust button layout for running state
  function setSolvingState(solving) {
    const btnText = solveBtn.querySelector(".btn-text");
    const btnLoader = solveBtn.querySelector(".btn-loader");
    
    if (solving) {
      solveBtn.disabled = true;
      btnText.textContent = "Solving...";
      btnLoader.classList.remove("hidden");
    } else {
      solveBtn.disabled = false;
      btnText.textContent = "Solve with Gemini";
      btnLoader.classList.add("hidden");
    }
  }

  // Helper to append a single styled log to terminal
  function appendLog(log) {
    const line = document.createElement("div");
    line.className = `log-line ${log.type}`;
    
    const timeSpan = document.createElement("span");
    timeSpan.className = "log-time";
    timeSpan.textContent = `[${log.timestamp}]`;
    
    const textSpan = document.createElement("span");
    textSpan.textContent = log.message;
    
    line.appendChild(timeSpan);
    line.appendChild(textSpan);
    logTerminal.appendChild(line);
    
    // Auto-scroll to the bottom of terminal
    logTerminal.scrollTop = logTerminal.scrollHeight;
  }
});
