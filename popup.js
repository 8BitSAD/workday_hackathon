const activateButton = document.getElementById("activateButton");

if (activateButton) {
  activateButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "popupActivate" }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Popup activation error:", chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        window.close();
      } else {
        console.warn("Popup activation failed:", response?.error || "unknown_error");
      }
    });
  });
}
