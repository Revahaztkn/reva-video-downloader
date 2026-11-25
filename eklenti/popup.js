const buttons = [...document.querySelectorAll("button[data-quality]")];
const status = document.querySelector("#status");

for (const button of buttons) {
  button.addEventListener("click", async () => {
    buttons.forEach(item => item.disabled = true);
    status.textContent = "İndiriliyor…";
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "toolbar-download",
        quality: Number(button.dataset.quality)
      }, { frameId: 0 });
      status.textContent = response.message;
    } catch {
      status.textContent = "Video sayfasını aç veya açık sekmeyi yenile.";
    } finally {
      buttons.forEach(item => item.disabled = false);
    }
  });
}
