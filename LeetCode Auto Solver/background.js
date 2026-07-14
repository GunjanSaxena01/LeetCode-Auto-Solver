// Background service worker for LeetCode Gemini Auto Solver

let statusLogs = [];
let isSolving = false;

// Log helper to store and broadcast status updates
function addLog(type, message) {
  const log = { timestamp: new Date().toLocaleTimeString(), type, message };
  statusLogs.push(log);
  console.log(`[${type.toUpperCase()}] ${message}`);
  // Attempt to broadcast to popup if it is open
  chrome.runtime.sendMessage({ action: "LOG_UPDATE", log, isSolving }).catch(() => {
    // Ignore error when popup is closed
  });
}

// Clear all logs
function clearLogs() {
  statusLogs = [];
  isSolving = true;
  chrome.runtime.sendMessage({ action: "LOG_CLEAR", isSolving }).catch(() => {});
}

// Sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retrieve settings from chrome.storage.sync
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({
      apiKey: '',
      model: 'gemini-3.5-flash',
      language: 'auto',
      autoSubmit: false
    }, (items) => {
      resolve(items);
    });
  });
}

// Listen for messages from the popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_SOLVE") {
    if (isSolving) {
      sendResponse({ status: "already_solving" });
      return true;
    }
    startSolveProcess();
    sendResponse({ status: "started" });
  } else if (request.action === "GET_STATUS") {
    sendResponse({ logs: statusLogs, isSolving });
  }
  return true;
});

// Listen for the keyboard shortcut command
chrome.commands.onCommand.addListener((command) => {
  if (command === "solve-problem") {
    if (isSolving) {
      console.log("Solve command ignored: already solving a problem.");
      return;
    }
    startSolveProcess();
  }
});

// Master Orchestration Flow
async function startSolveProcess() {
  clearLogs();
  addLog("info", "Starting solver pipeline...");

  try {
    // 1. Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error("No active tab found. Please make sure you are on LeetCode.");
    }

    const url = tab.url || "";
    if (!url.includes("leetcode.com/problems/")) {
      throw new Error("Active tab is not a LeetCode problem page (url must contain leetcode.com/problems/).");
    }

    addLog("info", `Target tab identified: ${tab.title}`);

    // Notify content script to display overlay
    chrome.tabs.sendMessage(tab.id, { action: "SHOW_OVERLAY", message: "Starting..." }).catch(() => {});

    // 2. Request problem details from content script
    addLog("info", "Extracting problem details (title, slug, content)...");
    chrome.tabs.sendMessage(tab.id, { action: "SHOW_OVERLAY", message: "Extracting problem..." }).catch(() => {});
    
    let problemData;
    try {
      problemData = await chrome.tabs.sendMessage(tab.id, { action: "EXTRACT_PROBLEM" });
    } catch (e) {
      throw new Error("Failed to communicate with content script. Try reloading the LeetCode page.");
    }

    if (!problemData || !problemData.title) {
      throw new Error("Failed to extract problem details. Selector mismatch or network error.");
    }

    addLog("info", `Extracted Title: "${problemData.title}"`);
    addLog("info", `Extracted Slug: "${problemData.slug}"`);

    // 3. Query current editor language and starter code from Monaco in MAIN world
    addLog("info", "Detecting editor language and template from Monaco Editor...");
    let detectedLang = null;
    let editorCode = null;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: async () => {
          try {
            const getOrWaitMainEditor = async (timeout = 3000) => {
              const start = Date.now();
              const programmingLangs = new Set([
                "cpp", "java", "python", "python3", "c", "csharp", "javascript", "typescript",
                "go", "ruby", "scala", "rust", "php", "kotlin", "swift", "erlang", "elixir",
                "dart", "mysql", "mssql", "oraclesql", "postgresql", "sql"
              ]);

              while (Date.now() - start < timeout) {
                if (typeof window.monaco !== "undefined" && window.monaco.editor) {
                  const editors = window.monaco.editor.getEditors();
                  if (editors && editors.length > 0) {
                    for (const editor of editors) {
                      const model = editor.getModel();
                      if (!model) continue;
                      
                      const lang = model.getLanguageId()?.toLowerCase();
                      if (programmingLangs.has(lang)) {
                        const node = editor.getDomNode();
                        if (node && node.offsetWidth > 0 && node.offsetHeight > 0) {
                          let isConsole = false;
                          let parent = node;
                          while (parent && parent !== document.body) {
                            if (parent.classList && (
                              parent.classList.contains("console-wrapper") || 
                              parent.getAttribute("data-track-load") === "console_editor" ||
                              parent.id === "console"
                            )) {
                              isConsole = true;
                              break;
                            }
                            parent = parent.parentElement;
                          }
                          if (!isConsole) return editor;
                        }
                      }
                    }
                  }
                }
                await new Promise(r => setTimeout(r, 150));
              }
              
              if (typeof window.monaco !== "undefined" && window.monaco.editor) {
                const editors = window.monaco.editor.getEditors();
                if (editors && editors.length > 0) {
                  for (const editor of editors) {
                    const node = editor.getDomNode();
                    if (node && node.offsetWidth > 0 && node.offsetHeight > 0) {
                      return editor;
                    }
                  }
                  return editors[0];
                }
              }
              return null;
            };

            const editor = await getOrWaitMainEditor(2000);
            let detectedLang = null;
            let code = null;

            if (editor) {
              const model = editor.getModel();
              if (model) {
                detectedLang = model.getLanguageId ? model.getLanguageId() : null;
                code = model.getValue();
              }
            }

            // Fallback checking DOM for language
            if (!detectedLang) {
              const langBtn = document.querySelector('button[id^="headlessui-listbox-button"]') ||
                              document.querySelector('button[aria-haspopup="listbox"]') ||
                              document.querySelector('button[id*="language"]');
              if (langBtn) {
                detectedLang = langBtn.textContent.trim().toLowerCase();
              } else {
                // Scan all buttons for known languages
                const knownLanguages = [
                  "c++", "java", "python", "python3", "c", "c#", "javascript", "typescript",
                  "go", "ruby", "scala", "rust", "php", "kotlin", "swift", "erlang", "elixir",
                  "dart", "mysql", "mssql", "oraclesql", "postgresql", "sql"
                ];
                const buttons = Array.from(document.querySelectorAll("button"));
                for (const btn of buttons) {
                  const txt = btn.textContent.trim().toLowerCase();
                  if (knownLanguages.includes(txt)) {
                    detectedLang = txt;
                    break;
                  }
                }
              }
            }
            return { language: detectedLang, code: code };
          } catch (e) {
            console.error(e);
            return { error: e.toString() };
          }
        }
      });
      const res = results?.[0]?.result;
      if (res) {
        detectedLang = res.language;
        editorCode = res.code;
      }
    } catch (e) {
      console.warn("Script injection for language/code extraction failed: ", e);
    }

    // 4. Resolve settings and target language
    const settings = await getSettings();
    if (!settings.apiKey) {
      throw new Error("Gemini API Key is missing. Please open the extension popup and save your API Key.");
    }

    // Language Normalizer
    function normalizeLanguageName(lang) {
      if (!lang) return "python3";
      const l = lang.toLowerCase().trim();
      if (l.includes("c++") || l === "cpp") return "cpp";
      if (l.includes("python3")) return "python3";
      if (l.includes("python")) return "python3"; // Default to python3 for safety
      if (l.includes("java") && !l.includes("script")) return "java";
      if (l.includes("javascript") || l === "js") return "javascript";
      if (l.includes("typescript") || l === "ts") return "typescript";
      if (l.includes("csharp") || l === "c#") return "csharp";
      if (l.includes("golang") || l === "go") return "go";
      if (l.includes("rust")) return "rust";
      if (l.includes("swift")) return "swift";
      if (l.includes("kotlin")) return "kotlin";
      if (l.includes("scala")) return "scala";
      if (l.includes("ruby")) return "ruby";
      if (l.includes("php")) return "php";
      if (l.includes("erlang")) return "erlang";
      if (l.includes("elixir")) return "elixir";
      if (l.includes("dart")) return "dart";
      if (l.includes("mysql")) return "mysql";
      if (l.includes("mssql") || l.includes("sql server")) return "mssql";
      if (l.includes("oracle")) return "oraclesql";
      if (l.includes("postgres")) return "postgresql";
      if (l === "c" || l === "clang") return "c";
      return l;
    }

    const languageDisplayNames = {
      "cpp": "C++",
      "java": "Java",
      "python": "Python 3",
      "python3": "Python 3",
      "c": "C",
      "javascript": "JavaScript",
      "typescript": "TypeScript",
      "csharp": "C#",
      "go": "Go",
      "rust": "Rust",
      "swift": "Swift",
      "kotlin": "Kotlin",
      "scala": "Scala",
      "ruby": "Ruby",
      "php": "PHP",
      "erlang": "Erlang",
      "elixir": "Elixir",
      "dart": "Dart",
      "mysql": "MySQL",
      "mssql": "MS SQL Server",
      "oraclesql": "Oracle SQL",
      "postgresql": "PostgreSQL"
    };

    let targetLanguage = settings.language;
    if (targetLanguage === "auto") {
      if (detectedLang) {
        targetLanguage = normalizeLanguageName(detectedLang);
        addLog("info", `Auto-detected language in editor: "${targetLanguage}"`);
      } else {
        targetLanguage = "python3";
        addLog("warning", `Could not auto-detect language. Falling back to default: "python3"`);
      }
    } else {
      targetLanguage = normalizeLanguageName(targetLanguage);
      addLog("info", `Using configured target language: "${targetLanguage}"`);
    }

    const friendlyLanguage = languageDisplayNames[targetLanguage] || targetLanguage;

    // 5. Call Gemini API
    addLog("info", `Preparing request for Gemini model: "${settings.model}"...`);
    chrome.tabs.sendMessage(tab.id, { action: "SHOW_OVERLAY", message: "Generating code with Gemini..." }).catch(() => {});

    let languageGuideline = "";
    if (targetLanguage === "cpp") {
      languageGuideline = "C++ guidelines: Ensure you write standard C++17/C++20. Do not define a main() function. Use public: for members to be accessed. Ensure library headers (#include <vector>, <string>, <unordered_map>, <algorithm>, etc.) are included.";
    } else if (targetLanguage === "java") {
      languageGuideline = "Java guidelines: Keep the class name as Solution. Ensure all helper methods/classes are inside the Solution class or defined package-private/public appropriately (NEVER public helper classes). Ensure java.util.* imports are present if using collections.";
    } else if (targetLanguage === "python" || targetLanguage === "python3") {
      languageGuideline = "Python guidelines: Maintain correct indentation. Do not redefine TreeNode or ListNode classes. Use standard typing notation.";
    } else if (targetLanguage === "go") {
      languageGuideline = "Go guidelines: Do NOT include package main or package declaration unless absolutely required by template, but typically only the func(s) should be completed. Ensure all imports (like 'fmt', 'sort', 'math') are strictly used; do NOT include unused imports as Go will fail compilation.";
    } else if (targetLanguage === "rust") {
      languageGuideline = "Rust guidelines: Keep the 'impl Solution' block and its signature exactly. Do not write a main function. Make sure to use standard Rust library types and imports if needed, but do not use external crates not supported by LeetCode.";
    } else if (targetLanguage === "c") {
      languageGuideline = "C guidelines: Ensure you write standard C. Do not define a main() function. Use standard library functions where necessary.";
    } else if (targetLanguage === "csharp") {
      languageGuideline = "C# guidelines: Keep the Solution class and its method signature exactly as provided. Include 'using System;' or other namespaces if needed.";
    } else if (["mysql", "mssql", "oraclesql", "postgresql", "sql"].includes(targetLanguage)) {
      languageGuideline = "SQL guidelines: Write a single SQL query matching the schema and expectations. Do not write markdown comments or surrounding code; only the SQL query itself inside the code block.";
    }

    const systemPrompt = `You are an expert competitive programmer.
You must solve the LeetCode problem using the exact template/signature provided by the user.

Rules:
1. Wrap your entire code in a single markdown code block, i.e., \`\`\`[language] ... \`\`\`.
2. Do NOT write any other text, explanation, or markdown outside the code block.
3. Maintain the exact class name, function name, and parameter types from the template.
4. Include all necessary library imports and helper structures needed for the code to compile and run.
5. Do NOT redefine pre-defined types, structures, or classes (such as TreeNode, ListNode, Node, Point, etc.) that LeetCode already provides in the environment. Only write code that uses them without re-declaring them.
6. Make sure the code is highly optimal, syntactically correct, and compiles immediately.
${languageGuideline}`;
    
    let starterCodeSection = "";
    if (editorCode) {
      starterCodeSection = `
Here is the starter code template from the editor in ${friendlyLanguage}:
\`\`\`${targetLanguage}
${editorCode}
\`\`\`

You MUST use this template as the base. Do not change the class name, function name, or parameter types. Complete the implementation, and return the entire completed file/class structure in your response.
`;
    }

    const userPrompt = `
Problem Title: ${problemData.title}
Problem URL: https://leetcode.com/problems/${problemData.slug}/

Problem Description:
${problemData.content}
${starterCodeSection}

Write a clean, optimal solution for the problem above in ${friendlyLanguage}.
Ensure that you complete the starter code template exactly, preserving classes, functions, and types. Include all necessary imports.
    `.trim();

    addLog("info", "Fetching solution from Gemini API (Google AI Studio)...");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent?key=${settings.apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: userPrompt }]
        }],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192
        }
      })
    });

    if (!response.ok) {
      let errMsg = `HTTP Status ${response.status}`;
      try {
        const errorJson = await response.json();
        errMsg = errorJson.error?.message || errMsg;
      } catch (_) {}
      throw new Error(`Gemini API Error: ${errMsg}`);
    }

    const data = await response.json();
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!generatedText) {
      throw new Error("Empty response received from Gemini API. Check your model selection or try again.");
    }

    // 6. Extract code block
    addLog("info", "Parsing solution code block...");
    const parsedCode = extractCodeBlock(generatedText);
    if (!parsedCode) {
      throw new Error("Failed to find a valid code block in Gemini response.");
    }
    
    let finalCode = parsedCode;

    // Helper to inject Python imports automatically
    function addPythonImports(code) {
      let imports = [];
      const typingImports = [];
      const typingTypes = ["List", "Optional", "Dict", "Set", "Tuple", "Any", "Union"];
      for (const t of typingTypes) {
        const regex = new RegExp(`\\b${t}\\b`);
        if (regex.test(code)) {
          typingImports.push(t);
        }
      }
      if (typingImports.length > 0 && !code.includes("from typing import")) {
        imports.push(`from typing import ${typingImports.join(", ")}`);
      }
      
      const collectionsImports = [];
      const collectionsTypes = ["defaultdict", "deque", "Counter", "OrderedDict"];
      for (const c of collectionsTypes) {
        const regex = new RegExp(`\\b${c}\\b`);
        if (regex.test(code)) {
          collectionsImports.push(c);
        }
      }
      if (collectionsImports.length > 0 && !code.includes("from collections import")) {
        imports.push(`from collections import ${collectionsImports.join(", ")}`);
      }
      
      if (/\bheapq\b/.test(code) && !code.includes("import heapq")) {
        imports.push("import heapq");
      }
      if (/\bbisect\b/.test(code) && !code.includes("import bisect") && !code.includes("from bisect import")) {
        imports.push("import bisect");
      }
      if (/\bmath\b/.test(code) && !code.includes("import math")) {
        imports.push("import math");
      }
      if (/\bsys\b/.test(code) && !code.includes("import sys")) {
        imports.push("import sys");
      }
      
      if (imports.length > 0) {
        return imports.join("\n") + "\n" + code;
      }
      return code;
    }

    if (targetLanguage === "python" || targetLanguage === "python3") {
      finalCode = addPythonImports(finalCode);
    } else if (targetLanguage === "java") {
      if (!finalCode.includes("import java.util.")) {
        finalCode = "import java.util.*;\n" + finalCode;
      }
    }

    // 7. Inject code into Monaco editor in MAIN world
    addLog("info", "Injecting solution into Monaco Editor...");
    chrome.tabs.sendMessage(tab.id, { action: "SHOW_OVERLAY", message: "Injecting code..." }).catch(() => {});

    const injectResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async (codeToInject) => {
        try {
          const getOrWaitMainEditor = async (timeout = 3000) => {
            const start = Date.now();
            const programmingLangs = new Set([
              "cpp", "java", "python", "python3", "c", "csharp", "javascript", "typescript",
              "go", "ruby", "scala", "rust", "php", "kotlin", "swift", "erlang", "elixir",
              "dart", "mysql", "mssql", "oraclesql", "postgresql", "sql"
            ]);

            while (Date.now() - start < timeout) {
              if (typeof window.monaco !== "undefined" && window.monaco.editor) {
                const editors = window.monaco.editor.getEditors();
                if (editors && editors.length > 0) {
                  for (const editor of editors) {
                    const model = editor.getModel();
                    if (!model) continue;
                    
                    const lang = model.getLanguageId()?.toLowerCase();
                    if (programmingLangs.has(lang)) {
                      const node = editor.getDomNode();
                      if (node && node.offsetWidth > 0 && node.offsetHeight > 0) {
                        let isConsole = false;
                        let parent = node;
                        while (parent && parent !== document.body) {
                          if (parent.classList && (
                            parent.classList.contains("console-wrapper") || 
                            parent.getAttribute("data-track-load") === "console_editor" ||
                            parent.id === "console"
                          )) {
                            isConsole = true;
                            break;
                          }
                          parent = parent.parentElement;
                        }
                        if (!isConsole) return editor;
                      }
                    }
                  }
                }
              }
              await new Promise(r => setTimeout(r, 150));
            }
            
            if (typeof window.monaco !== "undefined" && window.monaco.editor) {
              const editors = window.monaco.editor.getEditors();
              if (editors && editors.length > 0) {
                for (const editor of editors) {
                  const node = editor.getDomNode();
                  if (node && node.offsetWidth > 0 && node.offsetHeight > 0) {
                    return editor;
                  }
                }
                return editors[0];
              }
            }
            return null;
          };

          const editor = await getOrWaitMainEditor(3000);
          if (editor) {
            const model = editor.getModel();
            if (model) {
              // pushEditOperations preserves undo/redo stack
              model.pushEditOperations(
                [],
                [{
                  range: model.getFullModelRange(),
                  text: codeToInject,
                  forceMoveMarkers: true
                }],
                () => null
              );
              return { success: true, method: "getEditors" };
            }
          }
          const models = window.monaco?.editor?.getModels();
          if (models && models.length > 0) {
            models[0].setValue(codeToInject);
            return { success: true, method: "getModels" };
          }
          return { success: false, error: "No active Monaco editor or models found" };
        } catch (e) {
          return { success: false, error: e.toString() };
        }
      },
      args: [finalCode]
    });

    const pasteResult = injectResults?.[0]?.result;
    if (!pasteResult || !pasteResult.success) {
      throw new Error(`Editor Injection Failed: ${pasteResult?.error || "Unknown Monaco error"}`);
    }

    addLog("success", `Solution injected successfully! (via ${pasteResult.method})`);
    chrome.tabs.sendMessage(tab.id, { action: "SHOW_OVERLAY", message: "Code Injected Successfully!" }).catch(() => {});

    // 8. Auto-submit handling
    if (settings.autoSubmit) {
      addLog("info", "Auto-submit enabled. Waiting 2.5 seconds to simulate human timing...");
      chrome.tabs.sendMessage(tab.id, { action: "SHOW_OVERLAY", message: "Submitting in 2s..." }).catch(() => {});
      await sleep(2500);

      addLog("info", "Submitting solution...");
      chrome.tabs.sendMessage(tab.id, { action: "SHOW_OVERLAY", message: "Submitting..." }).catch(() => {});
      const submitResponse = await chrome.tabs.sendMessage(tab.id, { action: "SUBMIT_SOLUTION" });
      
      if (submitResponse && submitResponse.success) {
        addLog("success", "Submission triggered successfully on LeetCode!");
        chrome.tabs.sendMessage(tab.id, { action: "SHOW_OVERLAY", message: "Submitted!", duration: 3000 }).catch(() => {});
      } else {
        throw new Error(submitResponse?.error || "Failed to trigger submission click");
      }
    } else {
      // Hide the overlay after a short delay
      await sleep(1500);
      chrome.tabs.sendMessage(tab.id, { action: "HIDE_OVERLAY" }).catch(() => {});
    }

    addLog("success", "All done! Problem solved successfully.");
  } catch (error) {
    addLog("error", error.message);
    // Find active tab to show error overlay
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { 
          action: "SHOW_OVERLAY", 
          message: `Error: ${error.message}`, 
          isError: true,
          duration: 5000 
        }).catch(() => {});
      }
    } catch (_) {}
  } finally {
    isSolving = false;
    chrome.runtime.sendMessage({ action: "SOLVE_FINISHED", isSolving }).catch(() => {});
  }
}

// Regex matching to extract the inner code block
function extractCodeBlock(text) {
  // Try to find markdown code block first
  const match = text.match(/```(?:[a-zA-Z0-9+#-]+)?\n?([\s\S]*?)```/);
  if (match) {
    return match[1].trim();
  }
  
  // If no markdown code block found, but there are triple backticks somewhere, clean it up
  if (text.includes("```")) {
    const parts = text.split("```");
    if (parts.length >= 3) {
      return parts[1].trim();
    }
  }
  
  return text.trim();
}

  