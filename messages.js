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
  let streamedMarkdown = "";
  let renderIsPending = false;
  let attachedImageDataUrl = null;
  let stallTimer = null;

  if (typeof marked !== "undefined" && marked.setOptions) {
    marked.setOptions({ breaks: true, gfm: true });
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

    const bubble = document.createElement("div");
    bubble.className = "bubble-user";
    bubble.textContent = userText;
    row.appendChild(bubble);

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
        (codeElement && codeElement.className.replace("language-", "").trim()) || "text";

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

  function renderStreamedMarkdown() {
    renderIsPending = false;
    if (!activeAiBubble || activeAiBubble.dataset.hasImage === "true") return; // Do not overwrite image bubbles!
    
    if (typeof marked !== "undefined" && marked.parse) {
      activeAiBubble.innerHTML = marked.parse(streamedMarkdown);
    } else {
      activeAiBubble.textContent = streamedMarkdown;
    }
    decorateCodeBlocks(activeAiBubble);
    scrollChatToBottom();
  }

  function scheduleStreamRender() {
    if (renderIsPending) return;
    renderIsPending = true;
    requestAnimationFrame(renderStreamedMarkdown);
  }

  function resetStallTimer() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(function () {
      if (!activeRequestId) return;
      addNoteLine("Request stalled, no activity for 60s", true);
      finishRequest();
    }, 60000);
  }

  function finishRequest() {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
    activeRequestId = null;
    activeAiBubble = null;
    streamedMarkdown = "";
    refreshSendAvailability();
  }

  function refreshSendAvailability() {
    if (!sendButton) return;
    sendButton.disabled = !window.XaidaConnector || !window.XaidaConnector.isReady() || activeRequestId !== null;
  }

  function clearAttachment() {
    attachedImageDataUrl = null;
    imageAttachInput.value = "";
    attachmentPreview.hidden = true;
  }

  function sendCurrentMessage() {
    const userText = messageInput.value.trim();
    if (!userText || activeRequestId || !window.XaidaConnector || !window.XaidaConnector.isReady()) return;

    activeRequestId = "req-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6);
    streamedMarkdown = "";

    addUserRow(userText, attachedImageDataUrl);
    activeAiBubble = addAiBubble();

    const wasSent = window.XaidaConnector.sendPrompt({
      text: userText,
      imageDataUrl: attachedImageDataUrl,
      requestId: activeRequestId
    });

    if (!wasSent) {
      activeAiBubble.textContent = "Could not reach the server.";
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
        if (typeof payload.delta === "string") streamedMarkdown += payload.delta;
        else if (typeof payload.text === "string") streamedMarkdown = payload.text;
        scheduleStreamRender();
        return;
      }

      if (payload.type === "IMAGE") {
        resetStallTimer();
        if (activeAiBubble) {
          activeAiBubble.dataset.hasImage = "true"; // Protect bubble from markdown overwrites
          activeAiBubble.innerHTML = "";
          const generatedImage = document.createElement("img");
          generatedImage.className = "generated-image";
          generatedImage.src = payload.imageUrl;
          generatedImage.alt = payload.caption || "Image generated by Xaida Vision 1.1";
          activeAiBubble.appendChild(generatedImage);
          if (payload.caption) {
            const captionLine = document.createElement("p");
            captionLine.style.marginTop = "8px";
            captionLine.textContent = payload.caption;
            activeAiBubble.appendChild(captionLine);
          }
          scrollChatToBottom();
        }
        return;
      }

      if (payload.type === "RESPONSE_COMPLETE") {
        if (activeAiBubble && activeAiBubble.dataset.hasImage === "true") {
          finishRequest();
          if (messageInput) messageInput.focus();
          return;
        }
        if (typeof payload.text === "string" && payload.text.length > streamedMarkdown.length) {
          streamedMarkdown = payload.text;
        }
        renderStreamedMarkdown();
        finishRequest();
        if (messageInput) messageInput.focus();
        return;
      }

      if (payload.type === "ERROR") {
        if (activeAiBubble) activeAiBubble.textContent = payload.text || "Server error.";
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
      const fileReader = new FileReader();
      fileReader.onload = function () {
        attachedImageDataUrl = String(fileReader.result);
        attachmentThumb.src = attachedImageDataUrl;
        attachmentPreview.hidden = false;
      };
      fileReader.readAsDataURL(pickedFile);
    });
  }

  if (removeAttachmentButton) removeAttachmentButton.addEventListener("click", clearAttachment);

  window.XaidaMessages = {
    addNoteLine: addNoteLine,
    refreshSendAvailability: refreshSendAvailability,
    focusInput: function () {
      if (messageInput) messageInput.focus();
    }
  };

  if (window.XaidaConnector) window.XaidaConnector.start();
  if (messageInput) messageInput.focus();
})();
