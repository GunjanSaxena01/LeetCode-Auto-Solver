// Content script for LeetCode Gemini Auto Solver

let overlayEl = null;
let overlayTimeout = null;

// Display a beautiful status overlay on the LeetCode page
function showOverlay(message, isError = false, duration = 0) {
  if (!overlayEl) {
    overlayEl = document.createElement("div");
    overlayEl.id = "leetcode-gemini-solver-overlay";
    overlayEl.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: rgba(18, 18, 24, 0.85);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 14px 20px;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
      z-index: 999999;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: opacity 0.3s ease, transform 0.3s ease;
      opacity: 0;
      transform: translateY(-20px);
    `;
    document.body.appendChild(overlayEl);
  }

  clearTimeout(overlayTimeout);

  let iconHtml = "";
  if (isError) {
    overlayEl.style.border = "1px solid rgba(239, 68, 68, 0.4)";
    overlayEl.style.background = "rgba(30, 10, 10, 0.9)";
    iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
  } else if (message.includes("Success") || message.includes("Submitted")) {
    overlayEl.style.border = "1px solid rgba(16, 185, 129, 0.4)";
    overlayEl.style.background = "rgba(10, 30, 20, 0.9)";
    iconHtml = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  } else {
    overlayEl.style.border = "1px solid rgba(255, 255, 255, 0.1)";
    overlayEl.style.background = "rgba(18, 18, 24, 0.85)";
    iconHtml = `
      <svg class="gemini-spinner" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="animation: gemini-spin 1s linear infinite;">
        <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.1)"></circle>
        <path d="M12 2a10 10 0 0 1 10 10" stroke="#a78bfa"></path>
      </svg>
      <style>
        @keyframes gemini-spin {
          to { transform: rotate(360deg); }
        }
      </style>
    `;
  }

  overlayEl.innerHTML = `${iconHtml}<span style="letter-spacing: 0.2px;">${message}</span>`;
  
  overlayEl.style.display = "flex";
  // Force a browser reflow
  overlayEl.offsetHeight;
  overlayEl.style.opacity = "1";
  overlayEl.style.transform = "translateY(0)";

  if (duration > 0) {
    overlayTimeout = setTimeout(() => {
      hideOverlay();
    }, duration);
  }
}

function hideOverlay() {
  if (overlayEl) {
    overlayEl.style.opacity = "0";
    overlayEl.style.transform = "translateY(-20px)";
    overlayTimeout = setTimeout(() => {
      overlayEl.style.display = "none";
    }, 300);
  }
}

// Helper to get cookie value by name
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

// Retrieve problem details from LeetCode
async function extractProblemDetails() {
  const match = window.location.pathname.match(/\/problems\/([^/]+)/);
  const titleSlug = match ? match[1] : null;

  if (!titleSlug) {
    return extractFromDOM();
  }

  try {
    const csrfToken = getCookie("csrftoken");
    const response = await fetch("https://leetcode.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken ? { "x-csrftoken": csrfToken } : {})
      },
      body: JSON.stringify({
        query: `
          query questionContent($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
              questionId
              questionFrontendId
              title
              titleSlug
              content
              difficulty
            }
          }
        `,
        variables: { titleSlug }
      })
    });

    if (!response.ok) {
      throw new Error(`GraphQL fetch status ${response.status}`);
    }

    const resJson = await response.json();
    const q = resJson?.data?.question;
    if (q && q.title && q.content) {
      return {
        title: `${q.questionFrontendId ? q.questionFrontendId + '. ' : ''}${q.title}`,
        slug: q.titleSlug,
        content: q.content,
        difficulty: q.difficulty
      };
    }
  } catch (error) {
    console.warn("GraphQL problem extraction failed, falling back to DOM scraping: ", error);
  }

  return extractFromDOM();
}

// Scrape elements from LeetCode DOM directly if API/GraphQL fails
function extractFromDOM() {
  const contentDiv = document.querySelector('[data-track-load="description_content"]') || 
                     document.querySelector('.elfjS') || 
                     document.querySelector('.question-content__JfgR') ||
                     document.querySelector('#question-detail-container');
                      
  const titleEl = document.querySelector('div[class*="text-title-large"] a') || 
                  document.querySelector('[data-cy="question-title"]') || 
                  document.querySelector('.css-v375ix');
                  
  const title = titleEl ? titleEl.textContent.trim() : document.title.replace(" - LeetCode", "");
  const content = contentDiv ? contentDiv.innerHTML : "";
  
  // Extract slug from URL as fallback
  const match = window.location.pathname.match(/\/problems\/([^/]+)/);
  const slug = match ? match[1] : "";

  return { title, slug, content };
}

// Locate and click LeetCode Submit button programmatically
function clickSubmitButton() {
  const selectors = [
    'button[data-value="submit"]',
    'button[data-key="submit"]',
    'button[data-track-load="console_submit"]',
    'button[data-e2e-locator="console-submit-button"]',
    'button[data-cy="submit-code-btn"]',
    'button[class*="submit"]',
    '.submit__2oRY',
    'button.submit-btn'
  ];
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn) {
      const clickEvent = new MouseEvent("click", {
        view: window,
        bubbles: true,
        cancelable: true
      });
      btn.dispatchEvent(clickEvent);
      return { success: true };
    }
  }

  // Fallback to checking text values on buttons
  const buttons = Array.from(document.querySelectorAll("button"));
  const textSubmitBtn = buttons.find((btn) => btn.textContent.trim().toLowerCase() === "submit");
  if (textSubmitBtn) {
    textSubmitBtn.click();
    return { success: true };
  }

  return { success: false, error: "Submit button not found on the page." };
}

// Message Router
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "EXTRACT_PROBLEM") {
    extractProblemDetails()
      .then((data) => sendResponse(data))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // Keep message channel open for async response
  } else if (request.action === "SUBMIT_SOLUTION") {
    const res = clickSubmitButton();
    sendResponse(res);
  } else if (request.action === "SHOW_OVERLAY") {
    showOverlay(request.message, request.isError || false, request.duration || 0);
    sendResponse({ success: true });
  } else if (request.action === "HIDE_OVERLAY") {
    hideOverlay();
    sendResponse({ success: true });
  }
  return true;
});
