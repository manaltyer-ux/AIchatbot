let currentActiveRequestId = null;
let activeStreamingMessageElement = null;
let accumulatedStreamedTextBuffer = "";
let attachedImageBase64Data = null;

const chatMessageDisplayElement = document.getElementById("chatMessageDisplay");
const userInputFieldElement = document.getElementById("userInputField");
const sendMessageButtonElement = document.getElementById("sendMessageButton");
const imageAttachmentInputElement = document.getElementById("imageAttachmentInput");
const imagePreviewContainerElement = document.getElementById("imagePreviewContainer");
const imagePreviewNameElement = document.getElementById("imagePreviewName");
const removeImageButtonElement = document.getElementById("removeImageButton");

marked.setOptions({
  highlight: function (codeSnippet, languageName) {
    const validLanguageName = hljs.getLanguage(languageName) ? languageName : 'plaintext';
    return hljs.highlight(codeSnippet, { language: validLanguageName }).value;
  },
  breaks: true
});

function handleUserSubmitMessage() {
  const userTextPrompt = userInputFieldElement.value.trim();

  if (!userTextPrompt && !attachedImageBase64Data) {
    return;
  }

  appendUserMessageToDisplay(userTextPrompt, attachedImageBase64Data);

  const newRequestId = sendPromptToServer(userTextPrompt, attachedImageBase64Data);

  if (newRequestId) {
    currentActiveRequestId = newRequestId;
    accumulatedStreamedTextBuffer = "";
    activeStreamingMessageElement = createAiMessageBubbleElement();
    updateAiMessageBubbleText(activeStreamingMessageElement, "Waiting for response...");
  } else {
    const errorBubbleElement = createAiMessageBubbleElement();
    updateAiMessageBubbleText(errorBubbleElement, "Failed to send request. Server unavailable.");
  }

  clearInputControls();
}

function clearInputControls() {
  userInputFieldElement.value = "";
  attachedImageBase64Data = null;
  imagePreviewContainerElement.classList.add("hidden");
  imageAttachmentInputElement.value = "";
}

function appendUserMessageToDisplay(textPrompt, imageBase64) {
  const userBubbleElement = document.createElement("div");
  userBubbleElement.className = "messageBubble userMessage";

  if (textPrompt) {
    const textParagraphElement = document.createElement("p");
    textParagraphElement.innerText = textPrompt;
    userBubbleElement.appendChild(textParagraphElement);
  }

  if (imageBase64) {
    const imageTagElement = document.createElement("img");
    imageTagElement.src = imageBase64;
    imageTagElement.className = "messageImageReference";
    userBubbleElement.appendChild(imageTagElement);
  }

  chatMessageDisplayElement.appendChild(userBubbleElement);
  scrollChatToBottom();
}

function createAiMessageBubbleElement() {
  const aiBubbleElement = document.createElement("div");
  aiBubbleElement.className = "messageBubble aiMessage";
  chatMessageDisplayElement.appendChild(aiBubbleElement);
  scrollChatToBottom();
  return aiBubbleElement;
}

function updateAiMessageBubbleText(bubbleElement, rawMarkdownContent) {
  const parsedHtmlContent = marked.parse(rawMarkdownContent);
  bubbleElement.innerHTML = parsedHtmlContent;
  enhanceCodeBlocksWithCopyButtons(bubbleElement);
  scrollChatToBottom();
}

function enhanceCodeBlocksWithCopyButtons(parentElement) {
  const preElementsList = parentElement.querySelectorAll("pre");

  preElementsList.forEach((preElement) => {
    if (preElement.parentNode.classList.contains("codeBlockContainer")) {
      return;
    }

    const codeElement = preElement.querySelector("code");
    let detectedLanguageName = "code";

    if (codeElement && codeElement.className) {
      const classMatchResult = codeElement.className.match(/language-(\w+)/);
      if (classMatchResult) {
        detectedLanguageName = classMatchResult[1];
      }
    }

    const codeBlockContainerElement = document.createElement("div");
    codeBlockContainerElement.className = "codeBlockContainer";

    const codeBlockHeaderElement = document.createElement("div");
    codeBlockHeaderElement.className = "codeBlockHeader";

    const languageLabelElement = document.createElement("span");
    languageLabelElement.innerText = detectedLanguageName;

    const copyCodeButtonElement = document.createElement("button");
    copyCodeButtonElement.className = "copyCodeButton";
    copyCodeButtonElement.innerText = "Copy";

    copyCodeButtonElement.addEventListener("click", () => {
      const codeToCopyText = codeElement ? codeElement.innerText : preElement.innerText;
      navigator.clipboard.writeText(codeToCopyText).then(() => {
        copyCodeButtonElement.innerText = "Copied!";
        setTimeout(() => {
          copyCodeButtonElement.innerText = "Copy";
        }, 2000);
      });
    });

    codeBlockHeaderElement.appendChild(languageLabelElement);
    codeBlockHeaderElement.appendChild(copyCodeButtonElement);

    preElement.parentNode.insertBefore(codeBlockContainerElement, preElement);
    codeBlockContainerElement.appendChild(codeBlockHeaderElement);
    codeBlockContainerElement.appendChild(preElement);
  });
}

function handleIncomingServerResponsePayload(responsePayload) {
  if (responsePayload.requestId !== currentActiveRequestId) {
    return;
  }

  if (responsePayload.type === "CHUNK") {
    accumulatedStreamedTextBuffer = responsePayload.text;
    if (activeStreamingMessageElement) {
      updateAiMessageBubbleText(activeStreamingMessageElement, accumulatedStreamedTextBuffer);
    }
  } else if (responsePayload.type === "RESPONSE_COMPLETE") {
    accumulatedStreamedTextBuffer = responsePayload.text;
    if (activeStreamingMessageElement) {
      updateAiMessageBubbleText(activeStreamingMessageElement, accumulatedStreamedTextBuffer);
    }
    currentActiveRequestId = null;
    activeStreamingMessageElement = null;
  } else if (responsePayload.type === "IMAGE_RESPONSE") {
    if (activeStreamingMessageElement) {
      const imageTagElement = document.createElement("img");
      imageTagElement.src = responsePayload.imageUrl;
      imageTagElement.className = "messageImageReference";
      activeStreamingMessageElement.innerHTML = "";
      activeStreamingMessageElement.appendChild(imageTagElement);
    }
    currentActiveRequestId = null;
    activeStreamingMessageElement = null;
  } else if (responsePayload.type === "ERROR") {
    if (activeStreamingMessageElement) {
      updateAiMessageBubbleText(activeStreamingMessageElement, "Error: " + responsePayload.text);
    }
    currentActiveRequestId = null;
    activeStreamingMessageElement = null;
  }
}

function scrollChatToBottom() {
  chatMessageDisplayElement.scrollTop = chatMessageDisplayElement.scrollHeight;
}

imageAttachmentInputElement.addEventListener("change", (fileChangeEvent) => {
  const selectedFile = fileChangeEvent.target.files[0];
  if (selectedFile) {
    const fileReaderInstance = new FileReader();
    fileReaderInstance.onload = (readerLoadEvent) => {
      attachedImageBase64Data = readerLoadEvent.target.result;
      imagePreviewNameElement.innerText = selectedFile.name;
      imagePreviewContainerElement.classList.remove("hidden");
    };
    fileReaderInstance.readAsDataURL(selectedFile);
  }
});

removeImageButtonElement.addEventListener("click", () => {
  attachedImageBase64Data = null;
  imageAttachmentInputElement.value = "";
  imagePreviewContainerElement.classList.add("hidden");
});

sendMessageButtonElement.addEventListener("click", handleUserSubmitMessage);

userInputFieldElement.addEventListener("keydown", (keyboardEvent) => {
  if (keyboardEvent.key === "Enter") {
    handleUserSubmitMessage();
  }
});
