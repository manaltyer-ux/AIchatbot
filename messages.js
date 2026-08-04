(function () {
  const chatBox = document.getElementById("chatBox");
  const emptyChatState = document.getElementById("emptyChatState");
  const messageInput = document.getElementById("messageInput");
  const sendButton = document.getElementById("sendButton");
  const serverDot = document.getElementById("serverDot");
  const serverStatusText = document.getElementById("serverStatusText");
  const imageAttachInput = document.getElementById("imageAttachInput");
  const attachmentPreview = document.getElementById("attachmentPreview");
  const attachmentThumb = document.getElementById("attachmentThumb");
  const removeAttachmentButton = document.getElementById("removeAttachmentButton");

  let activeRequestId = null;
  let activeAiBubble = null;
  
  // STREAMING & TYPEWRITER DIALOGUE STATE
  let targetMarkdown = "";
  let displayedMarkdown = "";
  let typingAnimationId = null;
  let isResponseComplete = false;
  
  let attachedImageDataUrl = null;
  let stallTimer = null;

  if (typeof marked !== "undefined" && marked.setOptions) {
    marked.setOptions({ breaks: true, gfm: true });
  }

  // AUTOMATIC CLIENT-SIDE IMAGE COMPRESSION
  function compressImage(file, maxWidth, maxHeight, quality, callback) {
    const reader = new FileReader();
    reader.onload = function (e) {
      const img = new Image();
      img.onload = function () {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
        callback(compressedDataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function clearEmptyState() {
    if (emptyChatState && emptyChatState.parentNode) emptyChatState.remove();
  }

  function scrollChatToBottom() {
    if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
  }

  function addUserRow(userText, imageDataUrl) {
    clearEmptyState();
    const row = document.createElement("div");
    row.className = "chat-row row-user";

    if (imageDataUrl) {
      const referenceImage = document.createElement("img");
      referenceImage.className = "generated-image";
      referenceImage.src = imageDataUrl;
      referenceImage.alt = "Reference image sent by user";
      referenceImage.style.maxWidth = "220px";
      row.appendChild(referenceImage);
    }

    if (userText) {
      const bubble = document.createElement("div");
      bubble.className = "bubble-user";
      bubble.textContent = userText;
      row.appendChild(bubble);
    }

    chatBox.appendChild(row);
    scrollChatToBottom();
  }

  function addAiBubble() {
    const row = document.createElement("div");
    row.className = "chat-row row-ai";
    const bubble = document.createElement("div");
    bubble.className = "bubble-ai";
    bubble.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
    row.appendChild(bubble);
    chatBox.appendChild(row);
    scrollChatToBottom();
    return bubble;
  }

  function addNoteLine(noteText, isError) {
    clearEmptyState();
    const note = document.createElement("div");
    note.className = isError ? "note-line note-error" : "note-line";
    note.textContent = noteText;
    chatBox.appendChild(note);
    scrollChatToBottom();
  }

  function decorateCodeBlocks(bubbleElement) {
    bubbleElement.querySelectorAll("pre").forEach(function (preElement) {
      if (preElement.parentNode.classList.contains("code-block")) return;

      const codeElement = preElement.querySelector("code");
      const languageName =
        (codeElement && codeElement.className.replace("language-", "").trim()) || "code";

      const wrapper = document.createElement("div");
      wrapper.className = "code-block";

      const headBar = document.createElement("div");
      headBar.className = "code-block-head";

      const languageLabel = document.createElement("span");
      languageLabel.textContent = languageName;

      const copyButton = document.createElement("button");
      copyButton.className = "copy-code-button";
      copyButton.type = "button";
      copyButton.textContent = "Copy";
      copyButton.addEventListener("click", function () {
        navigator.clipboard.writeText(codeElement ? codeElement.innerText : preElement.innerText);
        copyButton.textContent = "Copied";
        setTimeout(function () {
          copyButton.textContent = "Copy";
        }, 1600);
      });

      headBar.appendChild(languageLabel);
      headBar.appendChild(copyButton);

      preElement.parentNode.insertBefore(wrapper, preElement);
      wrapper.appendChild(headBar);
      wrapper.appendChild(preElement);

      if (codeElement && window.hljs) {
        try {
          hljs.highlightElement(codeElement);
        } catch (highlightError) {}
      }
    });
  }

  // RENDER MARKDOWN TEXT TO AI BUBBLE
  function renderMarkdownText(text) {
    if (!activeAiBubble || activeAiBubble.dataset.isImage === "true") return;

    if (typeof marked !== "undefined" && marked.parse) {
      activeAiBubble.innerHTML = marked.parse(text);
    } else {
      activeAiBubble.textContent = text;
    }
    decorateCodeBlocks(activeAiBubble);
    scrollChatToBottom();
  }

  // TYPEWRITER / DIALOG STREAMING ENGINE
  function startTypingLoop() {
    if (typingAnimationId) return;

    function step() {
      if (!activeAiBubble || activeAiBubble.dataset.isImage === "true") {
        typingAnimationId = null;
        return;
      }

      const remainingChars = targetMarkdown.length - displayedMarkdown.length;

      if (remainingChars > 0) {
        // Dynamic speed calculation: smooth character-by-character flow
        let charsToAdd = 1;
        if (remainingChars > 150) charsToAdd = 8;
        else if (remainingChars > 80) charsToAdd = 5;
        else if (remainingChars > 30) charsToAdd = 3;
        else if (remainingChars > 10) charsToAdd = 2;

        // Accelerate smoothly if server signal is already finished
        if (isResponseComplete) {
          charsToAdd = Math.max(charsToAdd, Math.ceil(remainingChars / 5));
        }

        const nextLength = displayedMarkdown.length + charsToAdd;
        displayedMarkdown = targetMarkdown.slice(0, nextLength);

        renderMarkdownText(displayedMarkdown);
        typingAnimationId = requestAnimationFrame(step);
      } else {
        // Stream caught up with target text
        if (isResponseComplete) {
          renderMarkdownText(targetMarkdown);
          typingAnimationId = null;
          finishRequest();
          if (messageInput) messageInput.focus();
        } else {
          // Waiting for more chunks
          typingAnimationId = null;
        }
      }
    }

    typingAnimationId = requestAnimationFrame(step);
  }

  function resetStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(function () {
      if (!activeRequestId) return;
      if (typingAnimationId) cancelAnimationFrame(typingAnimationId);
      if (activeAiBubble) {
        activeAiBubble.textContent = "Error: Request timed out (No response activity for 45s).";
      }
      addNoteLine("Request timed out.", true);
      finishRequest();
    }, 45000);
  }

  function finishRequest() {
    if (stallTimer) clearTimeout(stallTimer);
    if (typingAnimationId) cancelAnimationFrame(typingAnimationId);

    stallTimer = null;
    typingAnimationId = null;
    activeRequestId = null;
    activeAiBubble = null;
    targetMarkdown = "";
    displayedMarkdown = "";
    isResponseComplete = false;

    refreshSendAvailability();
  }

  function refreshSendAvailability() {
    const isBusy = activeRequestId !== null;
    if (sendButton) {
      sendButton.disabled = !window.XaidaConnector || !window.XaidaConnector.isReady() || isBusy;
    }

    const modelSwitchBtn = document.getElementById("modelSwitchButton");
    if (modelSwitchBtn) {
      modelSwitchBtn.disabled = isBusy;
      modelSwitchBtn.style.opacity = isBusy ? "0.5" : "1";
      modelSwitchBtn.style.pointerEvents = isBusy ? "none" : "auto";
    }
  }

  function clearAttachment() {
    attachedImageDataUrl = null;
    imageAttachInput.value = "";
    attachmentPreview.hidden = true;
  }

  function sendCurrentMessage() {
    const userText = messageInput.value.trim();
    if ((!userText && !attachedImageDataUrl) || activeRequestId || !window.XaidaConnector || !window.XaidaConnector.isReady()) return;

    activeRequestId = "req-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6);
    targetMarkdown = "";
    displayedMarkdown = "";
    isResponseComplete = false;

    const selectedModel = window.XaidaConnector.getSelectedModel();
    const promptTextToSend = userText || (selectedModel === "xaida-vision-1.1" ? "Generate an image based on this reference" : "Please analyze this image");

    addUserRow(userText, attachedImageDataUrl);
    activeAiBubble = addAiBubble();

    const wasSent = window.XaidaConnector.sendPrompt({
      text: promptTextToSend,
      imageDataUrl: attachedImageDataUrl,
      requestId: activeRequestId
    });

    if (!wasSent) {
      if (activeAiBubble) activeAiBubble.textContent = "Error: Could not reach the server.";
      finishRequest();
      return;
    }

    messageInput.value = "";
    messageInput.style.height = "auto";
    clearAttachment();
    refreshSendAvailability();
    resetStallTimer();
    messageInput.focus();
  }

  if (window.XaidaConnector) {
    window.XaidaConnector.onStatusChange = function (statusText, statusKind) {
      if (serverStatusText) serverStatusText.textContent = statusText;
      if (serverDot) {
        serverDot.className = "";
        if (statusKind === "online") serverDot.classList.add("dot-online");
        if (statusKind === "offline") serverDot.classList.add("dot-offline");
      }
      refreshSendAvailability();
    };

    window.XaidaConnector.onServerMessage = function (payload) {
      if (!payload || payload.requestId !== activeRequestId) return;

      if (payload.type === "QUEUED" || payload.type === "PROCESSING") {
        resetStallTimer();
        return;
      }

      if (payload.type === "CHUNK") {
        resetStallTimer();
        if (typeof payload.text === "string") {
          targetMarkdown = payload.text;
        } else if (typeof payload.delta === "string") {
          targetMarkdown += payload.delta;
        }
        startTypingLoop();
        return;
      }

      // DIRECTLY DISPLAY GENERATED IMAGES IN CHAT
      if (payload.type === "IMAGE") {
        resetStallTimer();
        if (activeAiBubble) {
          activeAiBubble.dataset.isImage = "true";
          activeAiBubble.innerHTML = "";

          const generatedImage = document.createElement("img");
          generatedImage.className = "generated-image";
          generatedImage.src = payload.imageUrl;
          generatedImage.alt = payload.caption || "Generated Image";

          activeAiBubble.appendChild(generatedImage);

          if (payload.caption) {
            const captionLine = document.createElement("p");
            captionLine.style.marginTop = "8px";
            captionLine.style.fontSize = "13px";
            captionLine.style.color = "#8ba0b2";
            captionLine.textContent = payload.caption;
            activeAiBubble.appendChild(captionLine);
          }

          scrollChatToBottom();
        }
        return;
      }

      if (payload.type === "RESPONSE_COMPLETE") {
        resetStallTimer();
        if (activeAiBubble && activeAiBubble.dataset.isImage === "true") {
          finishRequest();
          if (messageInput) messageInput.focus();
          return;
        }
        if (typeof payload.text === "string" && payload.text.length > 0) {
          targetMarkdown = payload.text;
        }
        isResponseComplete = true;
        startTypingLoop();
        return;
      }

      if (payload.type === "ERROR") {
        if (typingAnimationId) cancelAnimationFrame(typingAnimationId);
        if (activeAiBubble) activeAiBubble.textContent = "Error: " + (payload.text || "Server error.");
        finishRequest();
      }
    };
  }

  if (sendButton) sendButton.addEventListener("click", sendCurrentMessage);

  if (messageInput) {
    messageInput.addEventListener("keydown", function (keyEvent) {
      if (keyEvent.key === "Enter" && !keyEvent.shiftKey) {
        keyEvent.preventDefault();
        sendCurrentMessage();
      }
    });

    messageInput.addEventListener("input", function () {
      messageInput.style.height = "auto";
      messageInput.style.height = Math.min(messageInput.scrollHeight, 150) + "px";
    });
  }

  if (imageAttachInput) {
    imageAttachInput.addEventListener("change", function () {
      const pickedFile = imageAttachInput.files && imageAttachInput.files[0];
      if (!pickedFile) return;

      compressImage(pickedFile, 800, 800, 0.7, function (compressedDataUrl) {
        attachedImageDataUrl = compressedDataUrl;
        attachmentThumb.src = attachedImageDataUrl;
        attachmentPreview.hidden = false;
      });
    });
  }

  if (removeAttachmentButton) removeAttachmentButton.addEventListener("click", clearAttachment);

  window.XaidaMessages = {
    addNoteLine: addNoteLine,
    refreshSendAvailability: refreshSendAvailability,
    isRequestActive: function () {
      return activeRequestId !== null;
    },
    focusInput: function () {
      if (messageInput) messageInput.focus();
    }
  };

  if (window.XaidaConnector) window.XaidaConnector.start();
  if (messageInput) messageInput.focus();
})();
