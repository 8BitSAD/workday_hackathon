// content.js
// One Thing Mode - Injects into every page
// Handles DOM manipulation, button detection, overlay UI, and storage

// STATE MANAGEMENT

let isActive = false;
let originalPageClone = null;
let currentOverlay = null;
let currentButtonClone = null;
let currentButtonClones = [];
let currentExitButton = null;
let currentDomain = window.location.hostname;
let currentPrimarySelector = null;
let activeToast = null;
let observer = null; // MutationObserver for SPA navigation

// UTILITY FUNCTIONS

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

// BUTTON DETECTION & SCORING

function getClickableElements() {
  const selector = [
    'button',
    'a[href]',
    '[role="button"]',
    'input[type="submit"]',
    'input[type="button"]',
    'input[type="image"]',
    '[onclick]',
    '[data-action]',
    '[data-testid]',
    '[aria-label]',
    '[id*="checkout" i]',
    '[class*="checkout" i]',
    '[name*="checkout" i]',
    '[id*="buy" i]',
    '[class*="buy" i]',
    '[name*="buy" i]',
    '.a-button',
    '.a-button-primary'
  ].join(', ');

  const seen = new Set();
  const result = [];

  for (const element of document.querySelectorAll(selector)) {
    if (seen.has(element)) continue;
    seen.add(element);

    if (!isElementInteractable(element)) continue;
    result.push(element);
  }

  return result;
}

function isElementInteractable(element) {
  if (!element || !element.isConnected) return false;
  if (element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true') return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;

  const rect = element.getBoundingClientRect();
  if (rect.width < 16 || rect.height < 16) return false;

  return true;
}

function buildElementSignals(element) {
  const textParts = [
    element.innerText,
    element.textContent,
    element.value,
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('alt')
  ].filter(Boolean);

  const attrParts = [
    element.id,
    element.className,
    element.getAttribute('name'),
    element.getAttribute('data-action'),
    element.getAttribute('data-testid'),
    element.getAttribute('href')
  ].filter(Boolean);

  const form = element.closest('form');
  if (form) {
    attrParts.push(form.getAttribute('action') || '');
    attrParts.push(form.getAttribute('id') || '');
    attrParts.push(form.getAttribute('name') || '');
  }

  return {
    text: textParts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase(),
    attrs: attrParts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase()
  };
}

function calculateScore(element) {
  if (!isElementInteractable(element)) return Number.NEGATIVE_INFINITY;

  let score = 0;
  const { text, attrs } = buildElementSignals(element);
  const combined = `${text} ${attrs}`;

  // Strong intent words should dominate generic navigation/search actions.
  const highIntentActions = [
    'proceed to checkout',
    'continue to checkout',
    'checkout',
    'place your order',
    'place order',
    'buy now',
    'complete purchase',
    'pay now',
    'order now',
    'view deal',
    'go to cart',
    'proceed to payment',
    'continue to payment',
    'buy it now',
    'place bid',
    'confirm bid',
    'book now',
    'reserve now',
    'check available',
    'reserve this',
    'Help',
    'Support',
    'Contact Us',
    'Customer Service',
    'Get Help'
  ];

  for (const phrase of highIntentActions) {
    if (combined.includes(phrase)) score += 50;
  }

  const primaryActions = [
    'buy', 'pay', 'submit', 'save', 'continue', 'next', 'send',
    'confirm', 'book', 'reserve', 'purchase', 'order', 'proceed',
    'login', 'sign in', 'signin', 'register', 'create account', 'start', 'begin',
    'add to cart', 'add to bag', 'cart', 'bid', 'checkout now', 'complete order',
    'apply', 'accept', 'agree', 'proceed to shipping', 'place order now',
    'availability', 'select date', 'check prices', 'view rates', 'compare',
    'finalize', 'complete', 'finish', 'help', 'get help', 'contact us', 'Customer Service', 'Support', 'search'
  ];

  for (const word of primaryActions) {
    if (combined.includes(word)) score += 18;
  }

  // Generic actions often create false positives on ecommerce pages.
  const weakActions = ['go', 'filter', 'sort'];
  for (const word of weakActions) {
    if (combined.includes(word)) score += 2;
  }

  const negativeActions = [
    'cancel', 'delete', 'remove', 'clear', 'reset',
    'back', 'previous', 'close', 'dismiss', 'decline',
    'sign out', 'logout', 'learn more'
  ];

  for (const word of negativeActions) {
    if (combined.includes(word)) score -= 25;
  }

  // Amazon/eBay/Booking patterns in id, class, name, and form metadata.
  const checkoutSignals = [
    'checkout',
    'proceedtoretailcheckout',
    'buy-box',
    'placeorder',
    'submitorder',
    'a-button-primary',
    'add-to-cart',
    'addtocart',
    'buy now',
    'bid now',
    'placebid',
    'book',
    'reserve',
    'booking',
    'confirm-order',
    'cartsubmit',
    'purchase-button',
    'checkout-btn',
    'ebay',
    'amazon',
    'primary-action',
    'Get Help',
    'Contact Us',
    'Customer Service',
    'Support'
  ];
  for (const signal of checkoutSignals) {
    if (attrs.includes(signal)) score += 35;
  }

  const href = (element.getAttribute('href') || '').toLowerCase();
  if (href.includes('checkout') || href.includes('buy') || href.includes('payment')) {
    score += 20;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width > 90) score += 4;
  if (rect.height > 30) score += 3;
  if (rect.width > 150) score += 3;

  if (element.classList.contains('primary')) score += 15;
  if (element.classList.contains('btn-primary')) score += 15;
  if (element.classList.contains('button-primary')) score += 15;
  if (element.getAttribute('data-primary') === 'true') score += 15;

  if (element.tagName.toLowerCase() === 'button') score += 4;
  if (element.type === 'submit') score += 12;
  if ((element.getAttribute('aria-label') || '').toLowerCase().includes('submit')) score += 8;

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
  
  // Return elements with score >= 8 (high quality only) and limited to 'limit'
  // This filters out random low-scoring buttons
  return scored.filter(c => c.score >= 8).slice(0, limit);
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

// STORAGE (Domain-level mappings)

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

// FIND PRIMARY BUTTON (Saved selector + fallback)

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
  const candidates = getTopCandidates(3);
  if (candidates.length > 0 && candidates[0].score > 0) {
    console.log("Heuristic found button with score:", candidates[0].score);
    return candidates[0].element;
  }
  
  // Step 3: No clear primary action
  return null;
}

// ACTIVATE MODE (Highlight in place, 25% bigger, centered in same location)

async function activateMode() {
  if (isActive) {
    console.log("Mode already active");
    return { success: true };
  }

  const candidates = getTopCandidates(4);
  if (candidates.length === 0) {
    console.log("No candidate buttons found");
    return { error: "no_primary_action" };
  }

  // Store original state
  currentPrimarySelector = generateSelector(candidates[0].element);
  originalPageClone = document.body.cloneNode(true);

  currentButtonClones = [];
  
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
  
  // Clone and highlight the top candidates.
  const clonePositions = [];
  candidates.forEach((candidate, index) => {
    const target = candidate.element;
    const originalRect = target.getBoundingClientRect();

    const clone = target.cloneNode(true);

    const originalWidth = originalRect.width;
    const originalHeight = originalRect.height;
    const scale = 1.0;
    const newWidth = originalWidth * scale;
    const newHeight = originalHeight * scale;

    // Convert viewport coords to document coords so highlights scroll with page
    let leftPos = originalRect.left + window.scrollX;
    let topPos = originalRect.top + window.scrollY;

    // Check if this position overlaps with any previous clones
    // If so, offset it to avoid jamming
    const minDistance = 60; // minimum pixel distance between highlights
    for (const prevPos of clonePositions) {
      const distX = Math.abs(leftPos - prevPos.left);
      const distY = Math.abs(topPos - prevPos.top);
      
      if (distX < minDistance && distY < minDistance) {
        // Too close, offset this clone
        topPos += minDistance + 10;
      }
    }

    clonePositions.push({ left: leftPos, top: topPos });

    clone.style.cssText = `
      position: absolute;
      left: ${leftPos}px;
      top: ${topPos}px;
      width: ${newWidth}px;
      height: ${newHeight}px;
      z-index: ${10000 + index};
      cursor: pointer;
      box-shadow: 0 0 0 3px #22c55e, 0 0 0 7px rgba(34,197,94,0.35);
      border-radius: 6px;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: visible;
    `;

    clone.title = `Top action ${index + 1} (score ${candidate.score})`;

    clone.addEventListener('click', () => {
      target.click();
      setTimeout(() => {
        deactivateMode();
      }, 100);
    });

    currentButtonClones.push(clone);
  });

  currentButtonClone = currentButtonClones[0] || null;
  
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
  currentButtonClones.forEach(clone => document.body.appendChild(clone));
  document.body.appendChild(currentExitButton);
  
  isActive = true;
  
  // Notify background script
  chrome.runtime.sendMessage({ type: "modeActivated" }).catch(e => console.log("Background not ready"));
  
  showToast(`One Thing Mode active. Showing top ${currentButtonClones.length} actions.`);
  
  return { success: true };
}

// DEACTIVATE MODE

function deactivateMode() {
  if (!isActive) {
    return { success: true };
  }
  
  // Remove all injected elements
  if (currentOverlay && currentOverlay.parentNode) currentOverlay.remove();
  if (currentButtonClone && currentButtonClone.parentNode) currentButtonClone.remove();
  for (const clone of currentButtonClones) {
    if (clone && clone.parentNode) clone.remove();
  }
  if (currentExitButton && currentExitButton.parentNode) currentExitButton.remove();
  
  currentOverlay = null;
  currentButtonClone = null;
  currentButtonClones = [];
  currentExitButton = null;
  originalPageClone = null;
  isActive = false;
  
  // Notify background script
  chrome.runtime.sendMessage({ type: "modeDeactivated" }).catch(e => console.log("Background not ready"));
  
  showToast("One Thing Mode exited.");
  
  return { success: true };
}

// MESSAGE HANDLERS (for background.js communication)

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

// SPA NAVIGATION HANDLER (Detect URL changes)

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