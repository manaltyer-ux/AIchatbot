const chatPageElement = document.getElementById("chatPage");
const selectorPageElement = document.getElementById("selectorPage");

const openModelSelectorButtonElement = document.getElementById("openModelSelectorButton");
const selectXaida21CardElement = document.getElementById("selectXaida21Card");
const selectXaidaVisionCardElement = document.getElementById("selectXaidaVisionCard");
const currentModelDisplayElement = document.getElementById("currentModelDisplay");

function navigateToPage(targetPageIdentifier) {
  if (targetPageIdentifier === "selector") {
    chatPageElement.classList.remove("active");
    selectorPageElement.classList.add("active");
  } else {
    selectorPageElement.classList.remove("active");
    chatPageElement.classList.add("active");
  }
}

function applyThemeForSelectedModel(modelName) {
  selectedModelName = modelName;
  currentModelDisplayElement.innerText = modelName;

  if (modelName === "Xaida Vision 1.1") {
    document.body.className = "xaida-vision-theme";
  } else {
    document.body.className = "xaida-21-theme";
  }

  automaticallySelectOptimalServer();
}

openModelSelectorButtonElement.addEventListener("click", () => {
  navigateToPage("selector");
});

selectXaida21CardElement.addEventListener("click", () => {
  applyThemeForSelectedModel("Xaida 2.1");
  navigateToPage("chat");
});

selectXaidaVisionCardElement.addEventListener("click", () => {
  applyThemeForSelectedModel("Xaida Vision 1.1");
  navigateToPage("chat");
});
