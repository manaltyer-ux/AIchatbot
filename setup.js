(function () {
  const chatPage = document.getElementById("chatPage");
  const modelPage = document.getElementById("modelPage");
  const modelSwitchButton = document.getElementById("modelSwitchButton");
  const activeModelLabel = document.getElementById("activeModelLabel");
  const closeModelPageButton = document.getElementById("closeModelPageButton");
  const modelCards = Array.prototype.slice.call(document.querySelectorAll(".model-card"));

  const modelDisplayNames = {
    "xaida-1.3": "Xaida 1.3",
    "xaida-2.1": "Xaida 2.1"
  };

  function showPage(pageElement) {
    chatPage.classList.remove("page-visible");
    modelPage.classList.remove("page-visible");
    pageElement.classList.add("page-visible");
  }

  function highlightSelectedCard(selectedModel) {
    modelCards.forEach(function (card) {
      card.classList.toggle("card-active", card.dataset.model === selectedModel);
    });
  }

  function applySelectedModel(selectedModel) {
    activeModelLabel.textContent = modelDisplayNames[selectedModel] || selectedModel;
    highlightSelectedCard(selectedModel);
    window.XaidaConnector.setSelectedModel(selectedModel);
  }

  modelSwitchButton.addEventListener("click", function () {
    if (window.XaidaMessages && window.XaidaMessages.isRequestActive()) {
      return; 
    }
    showPage(modelPage);
  });

  closeModelPageButton.addEventListener("click", function () {
    showPage(chatPage);
    window.XaidaMessages.focusInput();
  });

  modelCards.forEach(function (card) {
    card.addEventListener("click", function () {
      if (window.XaidaMessages && window.XaidaMessages.isRequestActive()) {
        return; 
      }
      const chosenModel = card.dataset.model;
      if (card.dataset.available === "false") {
        showPage(chatPage);
        window.XaidaMessages.addNoteLine(
          (modelDisplayNames[chosenModel] || chosenModel) + " is not available yet. Coming soon!",
          true
        );
        return;
      }
      applySelectedModel(chosenModel);
      showPage(chatPage);
      window.XaidaMessages.focusInput();
    });
  });

  const startupModel = window.XaidaConnector.getSelectedModel();
  activeModelLabel.textContent = modelDisplayNames[startupModel] || startupModel;
  highlightSelectedCard(startupModel);
})();
