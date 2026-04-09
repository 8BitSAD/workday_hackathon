// content.js
// One Thing Mode - Injects into every page
// Handles DOM manipulation, button detection, overlay UI, and storage

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

let isActive = false;
let originalPageClone = null;
let currentOverlay = null;
let currentButtonClone = null;
let currentExitButton = null;
let currentDomain = window.location.hostname;
let currentPrimarySelector = null;
let activeToast = null;
let observer = null; // MutationObserver for SPA navigation

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function showToast(message, duration = 3000) {
  // Remove existing toast if present
  if (activeToast) {
    activeToast.remove();
  }
  
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #333;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    z-index: 10002;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    animation: slideIn 0.3s ease;
    pointer-events: none;
  `;
  
  // Add animation keyframes if not already present
  if (!document.querySelector('#one-thing-toast-styles')) {
    const style = document.createElement('style');
    style.id = 'one-thing-toast-styles';
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(toast);
  activeToast = toast;
  
  setTimeout(() => {
    if (activeToast === toast) {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => {
        if (toast.parentNode) toast.remove();
        if (activeToast === toast) activeToast = null;
      }, 300);
    }
  }, duration);
}

function getDomainFromUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch (e) {
    return window.location.hostname.replace(/^www\./, '');
  }
}

// ============================================================================
// BUTTON DETECTION & SCORING
// ============================================================================

function getClickableElements() {
  return Array.from(document.querySelectorAll(
    'button, a, [role="button"], input[type="submit"], input[type="button"], .btn, [onclick]'
  ));
}

function calculateScore(element) {
  let score = 0;
  const text = (element.innerText || element.value || '').toLowerCase();
  const ariaLabel = element.getAttribute('aria-label') || '';
  const combined = text + ' ' + ariaLabel;
  
  // Primary action keywords (weight: +10)
  const primaryActions = [
    'buy', 'pay', 'submit', 'save', 'continue', 'next', 'send', 
    'checkout', 'confirm', 'place order', 'book', 'reserve', 
    'purchase', 'order', 'proceed', 'login', 'sign in', 'signin',
    'register', 'create account', 'start', 'begin', 'go', 'search'
  ];
  
  for (let word of primaryActions) {
    if (combined.includes(word)) {
      score += 10;
      // Bonus if exact match (not just substring)
      if (combined === word) score += 5;
    }
  }
  
  // Negative indicators (definitely NOT primary: -20)
  const negativeActions = [
    'cancel', 'delete', 'remove', 'clear', 'reset', 
    'back', 'previous', 'close', 'dismiss', 'decline'
  ];
  
  for (let word of negativeActions) {
    if (combined.includes(word)) score -= 20;
  }
  
  // Visual prominence signals
  const rect = element.getBoundingClientRect();
  if (rect.width > 100) score += 2;
  if (rect.height > 30) score += 1;
  
  // Check for primary button classes/attributes
  if (element.classList.contains('primary')) score += 15;
  if (element.classList.contains('btn-primary')) score += 15;
  if (element.classList.contains('button-primary')) score += 15;
  if (element.getAttribute('data-primary') === 'true') score += 15;
  
  // Check for common submit button indicators
  if (element.type === 'submit') score += 10;
  if (element.getAttribute('aria-label')?.toLowerCase().includes('submit')) score += 10;
  
  return score;
}

function getTopCandidates(limit = 5) {
  const clickables = getClickableElements();
  const scored = clickables.map(el => ({
    element: el,
    score: calculateScore(el),
    text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().substring(0, 50)
  }));
  
  scored.sort((a, b) => b.score - a.score);
  
  // Return elements with score > 0, limited to 'limit'
  return scored.filter(c => c.score > 0).slice(0, limit);
}

function generateSelector(element) {
  // Generate a simple but specific CSS selector for the element
  if (element.id) {
    return `#${element.id}`;
  }
  
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ').filter(c => c).join('.');
    if (classes) {
      return `${element.tagName.toLowerCase()}.${classes}`;
    }
  }
  
  // Fallback: use position in parent
  const parent = element.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(element);
    return `${element.tagName.toLowerCase()}:nth-child(${index + 1})`;
  }
  
  return element.tagName.toLowerCase();
}

// ============================================================================
// STORAGE (Domain-level mappings)
// ============================================================================

async function loadSavedSelector(domain) {
  return new Promise((resolve) => {
    chrome.storage.local.get([domain], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Storage error:", chrome.runtime.lastError);
        resolve(null);
      } else {
        resolve(result[domain] || null);
      }
    });
  });
}

async function saveSelector(domain, selector) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [domain]: selector }, () => {
      if (chrome.runtime.lastError) {
        console.error("Storage error:", chrome.runtime.lastError);
        resolve(false);
      } else {
        console.log(`Saved selector "${selector}" for domain ${domain}`);
        resolve(true);
      }
    });
  });
}

// ============================================================================
// FIND PRIMARY BUTTON (Saved selector + fallback)
// ============================================================================

async function findPrimaryButton() {
  // Step 1: Check saved mapping for this domain
  const savedSelector = await loadSavedSelector(currentDomain);
  if (savedSelector) {
    const element = document.querySelector(savedSelector);
    if (element && element.isConnected) {
      console.log("Using saved selector:", savedSelector);
      return element;
    } else {
      console.log("Saved selector not found on page, will re-detect");
    }
  }
  
  // Step 2: Run heuristic scoring
  const candidates = getTopCandidates(1);
  if (candidates.length > 0 && candidates[0].score > 0) {
    console.log("Heuristic found button with score:", candidates[0].score);
    return candidates[0].element;
  }
  
  // Step 3: No clear primary action
  return null;
}

// ============================================================================
// TEACH ME UI (Show top 5 candidates for user to select)
// ============================================================================

function showTeachMeUI() {
  const candidates = getTopCandidates(5);
  
  if (candidates.length === 0) {
    showToast("No clickable elements found on this page.");
    deactivateMode();
    return;
  }
  
  // Create teaching overlay
  const teachingOverlay = document.createElement('div');
  teachingOverlay.id = 'one-thing-teaching-overlay';
  teachingOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.85);
    z-index: 10000;
    display: flex;
    justify-content: center;
    align-items: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  const card = document.createElement('div');
  card.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  `;
  
  card.innerHTML = `
    <h2 style="margin: 0 0 8px 0; font-size: 20px;">Choose your primary action</h2>
    <p style="margin: 0 0 20px 0; color: #666; font-size: 14px;">
      We couldn't automatically detect what you want to do on this page. 
      Click on the action you use most often.
    </p>
    <div id="one-thing-candidates-list" style="display: flex; flex-direction: column; gap: 10px;"></div>
    <button id="one-thing-teaching-cancel" style="
      margin-top: 20px;
      padding: 8px 16px;
      background: #f0f0f0;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      width: 100%;
      font-size: 14px;
    ">Cancel</button>
  `;
  
  teachingOverlay.appendChild(card);
  document.body.appendChild(teachingOverlay);
  
  const candidatesList = document.getElementById('one-thing-candidates-list');
  
  candidates.forEach((candidate, index) => {
    const btn = document.createElement('button');
    btn.textContent = candidate.text || `Button ${index + 1}`;
    btn.style.cssText = `
      padding: 12px;
      background: #007bff;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      text-align: left;
      transition: background 0.2s;
    `;
    btn.onmouseover = () => btn.style.background = '#0056b3';
    btn.onmouseout = () => btn.style.background = '#007bff';
    
    btn.onclick = async () => {
      // User selected this button
      const selector = generateSelector(candidate.element);
      await saveSelector(currentDomain, selector);
      teachingOverlay.remove();
      showToast(`Saved! "${candidate.text}" will now be your primary action on ${currentDomain}`);
      // Reactivate with the newly saved button
      await activateMode();
    };
    
    candidatesList.appendChild(btn);
  });
  
  const cancelBtn = document.getElementById('one-thing-teaching-cancel');
  cancelBtn.onclick = () => {
    teachingOverlay.remove();
    deactivateMode();
  };
}

// ============================================================================
// ACTIVATE MODE (Highlight in place, 25% bigger, centered in same location)
// ============================================================================

async function activateMode() {
  if (isActive) {
    console.log("Mode already active");
    return { success: true };
  }
  
  const primaryButton = await findPrimaryButton();
  
  if (!primaryButton) {
    console.log("No primary button found");
    return { error: "no_primary_action" };
  }
  
  // Store original state
  currentPrimarySelector = generateSelector(primaryButton);
  originalPageClone = document.body.cloneNode(true);
  
  // Get original position of the button
  const originalRect = primaryButton.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  
  // Create overlay that hides everything except the target area
  currentOverlay = document.createElement('div');
  currentOverlay.id = 'one-thing-overlay';
  currentOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.85);
    z-index: 9999;
    pointer-events: auto;
  `;
  
  // Clone the button
  currentButtonClone = primaryButton.cloneNode(true);
  
  // Make it 25% bigger
  const originalWidth = originalRect.width;
  const originalHeight = originalRect.height;
  const newWidth = originalWidth * 1.25;
  const newHeight = originalHeight * 1.25;
  
  // Calculate centered position (same location, but centered because button is larger)
  const leftPos = originalRect.left + scrollX - (newWidth - originalWidth) / 2;
  const topPos = originalRect.top + scrollY - (newHeight - originalHeight) / 2;
  
  currentButtonClone.style.cssText = `
    position: absolute;
    left: ${leftPos}px;
    top: ${topPos}px;
    width: ${newWidth}px;
    height: ${newHeight}px;
    z-index: 10000;
    cursor: pointer;
    box-shadow: 0 0 0 4px #007bff, 0 0 0 8px rgba(0,123,255,0.3);
    border-radius: 4px;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  
  // Add click handler to exit mode after normal click
  currentButtonClone.addEventListener('click', async (e) => {
    // Allow the original click to happen on the real button
    // But first, temporarily remove overlay so click goes through
    if (currentOverlay && currentOverlay.parentNode) {
      currentOverlay.style.pointerEvents = 'none';
    }
    
    // Trigger the original button's click
    primaryButton.click();
    
    // Exit mode after a tiny delay to let the page respond
    setTimeout(() => {
      deactivateMode();
    }, 100);
  });
  
  // Create exit button
  currentExitButton = document.createElement('button');
  currentExitButton.textContent = 'Exit One Thing Mode (Ctrl+Shift+X / ⌘+Shift+X)';
  currentExitButton.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    background: #dc3545;
    color: white;
    border: none;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    cursor: pointer;
    z-index: 10001;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    transition: background 0.2s;
  `;
  currentExitButton.onmouseover = () => currentExitButton.style.background = '#c82333';
  currentExitButton.onmouseout = () => currentExitButton.style.background = '#dc3545';
  currentExitButton.onclick = () => deactivateMode();
  
  // Assemble everything
  document.body.appendChild(currentOverlay);
  document.body.appendChild(currentButtonClone);
  document.body.appendChild(currentExitButton);
  
  isActive = true;
  
  // Notify background script
  chrome.runtime.sendMessage({ type: "modeActivated" }).catch(e => console.log("Background not ready"));
  
  showToast("One Thing Mode active. Click the button to complete your task.");
  
  return { success: true };
}

// ============================================================================
// DEACTIVATE MODE
// ============================================================================

function deactivateMode() {
  if (!isActive) {
    return { success: true };
  }
  
  // Remove all injected elements
  if (currentOverlay && currentOverlay.parentNode) currentOverlay.remove();
  if (currentButtonClone && currentButtonClone.parentNode) currentButtonClone.remove();
  if (currentExitButton && currentExitButton.parentNode) currentExitButton.remove();
  
  currentOverlay = null;
  currentButtonClone = null;
  currentExitButton = null;
  originalPageClone = null;
  isActive = false;
  
  // Notify background script
  chrome.runtime.sendMessage({ type: "modeDeactivated" }).catch(e => console.log("Background not ready"));
  
  showToast("One Thing Mode exited.");
  
  return { success: true };
}

// ============================================================================
// MESSAGE HANDLERS (for background.js communication)
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content script received message:", message);
  
  if (message.type === "ping") {
    sendResponse({ status: "ready" });
  }
  
  else if (message.type === "activate") {
    activateMode().then(result => {
      sendResponse(result);
    }).catch(error => {
      console.error("Activation error:", error);
      sendResponse({ error: error.message });
    });
    return true; // Keep channel open for async response
  }
  
  else if (message.type === "deactivate") {
    const result = deactivateMode();
    sendResponse(result);
  }
  
  else if (message.type === "showNotification") {
    showToast(message.message, message.duration || 3000);
    sendResponse({ success: true });
  }
  
  else if (message.type === "getActiveState") {
    sendResponse({ active: isActive });
  }
  
  return true;
});

// ============================================================================
// SPA NAVIGATION HANDLER (Detect URL changes)
// ============================================================================

let lastUrl = location.href;

function checkForUrlChange() {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    console.log("URL changed, deactivating mode");
    lastUrl = currentUrl;
    if (isActive) {
      deactivateMode();
    }
  }
}

// Set up interval to check for SPA navigation
setInterval(checkForUrlChange, 500);

// Also listen for popstate (back/forward)
window.addEventListener('popstate', () => {
  if (isActive) deactivateMode();
});

console.log("One Thing Mode content script loaded for domain:", currentDomain);