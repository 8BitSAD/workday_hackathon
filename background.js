// background.js
// Service worker for One Thing Mode extension
// Handles toolbar icon clicks, keyboard shortcuts, and context menu

// Track which tab has One Thing Mode active
// This is a Map: tabId -> boolean (true = active)
// We use this to enable toggle behavior
let activeTabs = new Map();

// Initialize extension when installed or updated
chrome.runtime.onInstalled.addListener(() => {
  // Create context menu item
  chrome.contextMenus.create({
    id: "simplify-page",
    title: "Simplify page to one action",
    contexts: ["page"]
  });
  
  console.log("One Thing Mode extension installed. Context menu created.");
});

// Listen for toolbar icon clicks
chrome.action.onClicked.addListener(async (tab) => {
  console.log("Toolbar icon clicked for tab:", tab.id);
  await handleActivation(tab);
});

// Listen for keyboard commands
chrome.commands.onCommand.addListener(async (command, tab) => {
  console.log("Command received:", command, "for tab:", tab?.id);
  
  if (command === "activate-one-thing") {
    if (tab && tab.id) {
      await handleActivation(tab);
    } else {
      console.warn("No active tab found for keyboard shortcut");
    }
  } else if (command === "exit-one-thing") {
    if (tab && tab.id) {
      await deactivateMode(tab.id);
    }
  }
});

// Listen for context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "simplify-page" && tab) {
    console.log("Context menu clicked for tab:", tab.id);
    await handleActivation(tab);
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "popupActivate") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs && tabs[0];

      if (!tab || !tab.id) {
        sendResponse({ success: false, error: "no_active_tab" });
        return;
      }

      try {
        await handleActivation(tab);
        sendResponse({ success: true });
      } catch (error) {
        console.error("Popup activation failed:", error);
        sendResponse({ success: false, error: "activation_failed" });
      }
    });

    return true;
  }

  if (message.type === "modeActivated" && sender.tab?.id) {
    // Content script successfully activated mode on this tab
    activeTabs.set(sender.tab.id, true);
    sendResponse({ success: true });
  } else if (message.type === "modeDeactivated" && sender.tab?.id) {
    // Content script deactivated mode on this tab
    activeTabs.set(sender.tab.id, false);
    sendResponse({ success: true });
  } else if (message.type === "getActiveState" && sender.tab?.id) {
    // Content script asking if mode is already active
    sendResponse({ active: activeTabs.get(sender.tab.id) === true });
  }
  
  return true; // Keep message channel open for async response
});

// Handle tab closure - cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabs.has(tabId)) {
    activeTabs.delete(tabId);
    console.log("Cleaned up active state for closed tab:", tabId);
  }
});

// Core function: Handle activation toggle
async function handleActivation(tab) {
  // Check if this is a Chrome internal page or other restricted URL
  if (!isValidUrl(tab.url)) {
    showPopupMessage("One Thing Mode only works on regular webpages", tab.id);
    return;
  }
  
  // Check if mode is already active on this tab
  const isActive = activeTabs.get(tab.id) === true;
  
  if (isActive) {
    // Toggle behavior: deactivate
    await deactivateMode(tab.id);
  } else {
    // Activate mode
    await activateMode(tab.id);
  }
}

// Activate One Thing Mode on a specific tab
async function activateMode(tabId) {
  try {
    // First, ensure content script is ready by sending a ping
    const isReady = await pingContentScript(tabId);
    
    if (!isReady) {
      console.error("Content script not ready in tab:", tabId);
      showPopupMessage("Error: Page is still loading. Please wait and try again.", tabId);
      return;
    }
    
    // Send activation message to content script
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "activate",
      action: "activate"
    });
    
    if (response && response.success) {
      // activeTabs will be updated by content script's modeActivated message
      console.log("Successfully activated One Thing Mode in tab:", tabId);
    } else if (response && response.error === "no_primary_action") {
      // Content script couldn't find a primary action
      showPopupMessage("Could not identify a primary action on this page. Try using the 'Teach me' feature.", tabId);
    } else {
      console.error("Activation failed:", response);
      showPopupMessage("Failed to activate One Thing Mode. Please refresh the page and try again.", tabId);
    }
  } catch (error) {
    console.error("Error activating mode:", error);
    showPopupMessage("Error activating One Thing Mode. Check console for details.", tabId);
  }
}

// Deactivate One Thing Mode on a specific tab
async function deactivateMode(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "deactivate",
      action: "deactivate"
    });
    
    if (response && response.success) {
      // activeTabs will be updated by content script's modeDeactivated message
      console.log("Successfully deactivated One Thing Mode in tab:", tabId);
    } else {
      console.error("Deactivation failed:", response);
      // Even if message fails, clean up our local state
      activeTabs.set(tabId, false);
    }
  } catch (error) {
    console.error("Error deactivating mode:", error);
    // If tab is closed or content script unavailable, just clean up
    activeTabs.set(tabId, false);
  }
}

// Ping content script to check if it's ready
async function pingContentScript(tabId, maxAttempts = 3, delayMs = 200) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        type: "ping",
        action: "ping"
      });
      
      if (response && response.status === "ready") {
        return true;
      }
    } catch (error) {
      // Content script not ready yet
      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  return false;
}

// Check if URL is valid for content script injection
function isValidUrl(url) {
  if (!url) return false;
  
  // Block Chrome internal pages and other restricted schemes
  const invalidProtocols = [
    "chrome://",
    "chrome-extension://",
    "edge://",
    "about:",
    "data:",
    "javascript:",
    "view-source:",
    "file://"  // file protocol often has restrictions
  ];
  
  for (const protocol of invalidProtocols) {
    if (url.startsWith(protocol)) {
      return false;
    }
  }
  
  return true;
}

// Show popup message to user
function showPopupMessage(message, tabId) {
  // Chrome doesn't have a built-in popup API that works from background script
  // We have two options:
  
  // Option 1: Use chrome.notifications (requires "notifications" permission)
  // We don't have that permission per your spec, so skipping.
  
  // Option 2: Send message to content script to show an in-page notification
  // This is cleaner and doesn't require extra permissions
  chrome.tabs.sendMessage(tabId, {
    type: "showNotification",
    message: message,
    duration: 3000
  }).catch((error) => {
    // If content script isn't ready, fallback to console
    console.warn("Could not send notification to page:", error);
    console.warn("Original message:", message);
  });
}