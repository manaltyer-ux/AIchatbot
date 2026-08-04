(function () {
  const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";
  const HEARTBEAT_TOPIC = "xaida/servers/heartbeat";
  const DEACTIVATE_TOPIC = "xaida/servers/deactivate";
  const PING_TOPIC = "xaida/servers/ping";
  const SERVER_TIMEOUT_MS = 12000; 

  function createWorkerInterval(fn, ms) {
    try {
      const blob = new Blob([`self.onmessage=function(){setInterval(function(){postMessage(0);},${ms});};`], { type: 'text/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));
      worker.onmessage = fn;
      worker.postMessage(0);
      return worker;
    } catch (e) {
      return setInterval(fn, ms);
    }
  }

  let storedUserId = localStorage.getItem("xaida_user_id");
  if (!storedUserId) {
    storedUserId = "usr-" + Math.random().toString(36).substring(2, 8);
    localStorage.setItem("xaida_user_id", storedUserId);
  }

  let storedAuthKey = localStorage.getItem("xaida_auth_key");
  if (!storedAuthKey) {
    storedAuthKey = Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem("xaida_auth_key", storedAuthKey);
  }

  const tabId = Math.random().toString(36).substring(2, 6);
  const logicalClientId = storedUserId + "-" + tabId;

  const discoveredServers = {};

  let relayClient = null;
  let relayIsConnected = false;
  let selectedModel = localStorage.getItem("xaida_selected_model") || "xaida-2.1";
  let currentServer = "";
  let currentResponseTopic = "";
  let relayRestartTimer = null;

  const XaidaConnector = {
    clientId: logicalClientId,
    authKey: storedAuthKey,
    onServerMessage: null,
    onStatusChange: null,

    getSelectedModel: function () {
      return selectedModel;
    },

    getCurrentServer: function () {
      return currentServer;
    },

    isReady: function () {
      return relayIsConnected && currentServer !== "" && Boolean(discoveredServers[currentServer]);
    },

    start: function () {
      startRelay();
    },

    setSelectedModel: function (modelId) {
      if (selectedModel === modelId) return;
      selectedModel = modelId;
      localStorage.setItem("xaida_selected_model", modelId);
      leaveCurrentServer();
      reportStatus("Looking for " + modelId + " server...", "waiting");
      pickBestServer();
    },

    sendPrompt: function (promptPayload) {
     
      if (!XaidaConnector.isReady()) {
        reportStatus("No active server connected", "offline");
        return false;
      }

      const serverInfo = discoveredServers[currentServer];
      if (!serverInfo || (Date.now() - serverInfo.lastSeen > SERVER_TIMEOUT_MS)) {
        removeServer(currentServer);
        if (window.XaidaMessages && window.XaidaMessages.addNoteLine) {
          window.XaidaMessages.addNoteLine("Server went offline. Searching for available server...", true);
        }
        return false;
      }

      const payloadString = JSON.stringify({
        clientId: logicalClientId,
        authKey: storedAuthKey,
        modelId: selectedModel,
        text: promptPayload.text,
        imageDataUrl: promptPayload.imageDataUrl || null,
        requestId: promptPayload.requestId,
        sentAt: Date.now()
      });

      if (payloadString.length > 250000) {
        if (window.XaidaMessages && window.XaidaMessages.addNoteLine) {
          window.XaidaMessages.addNoteLine("Image payload is too large. Please select a smaller photo.", true);
        }
        return false;
      }

      relayClient.publish("xaida/" + currentServer + "/prompt", payloadString, { qos: 0 });
      return true;
    },

    announceDisconnect: function () {
      if (!relayClient || !relayIsConnected) return;
      Object.keys(discoveredServers).forEach(function (serverId) {
        relayClient.publish(
          "xaida/" + serverId + "/disconnect",
          JSON.stringify({ clientId: logicalClientId, authKey: storedAuthKey }),
          { qos: 0 }
        );
      });
    }
  };

  function reportStatus(statusText, statusKind) {
    if (typeof XaidaConnector.onStatusChange === "function") {
      XaidaConnector.onStatusChange(statusText, statusKind);
    }
  }

  function leaveCurrentServer() {
    if (currentResponseTopic && relayClient && relayIsConnected) {
      try {
        relayClient.unsubscribe(currentResponseTopic);
      } catch (unsubscribeError) {}
    }
    currentServer = "";
    currentResponseTopic = "";
  }

  function removeServer(serverId) {
    if (discoveredServers[serverId]) {
      delete discoveredServers[serverId];
    }
    if (currentServer === serverId) {
      leaveCurrentServer();
      reportStatus("Server offline. Finding new server...", "waiting");
      pickBestServer();
    }
  }

  function joinServer(serverId) {
    leaveCurrentServer();
    currentServer = serverId;
    currentResponseTopic = "xaida/" + serverId + "/response/" + logicalClientId;
    relayClient.subscribe(currentResponseTopic, function (subscribeError) {
      if (!subscribeError) {
        reportStatus("Server " + serverId, "online");
      } else {
        removeServer(serverId);
      }
    });
  }

  function pickBestServer() {
    const now = Date.now();

    Object.keys(discoveredServers).forEach(function (serverId) {
      if (now - discoveredServers[serverId].lastSeen > SERVER_TIMEOUT_MS) {
        delete discoveredServers[serverId];
      }
    });

    if (currentServer && !discoveredServers[currentServer]) {
      leaveCurrentServer();
    }

    const healthyServers = [];
    Object.keys(discoveredServers).forEach(function (serverId) {
      const serverInfo = discoveredServers[serverId];
      if (serverInfo.modelId === selectedModel) {
        healthyServers.push({ serverId: serverId, queueLength: serverInfo.queueLength });
      }
    });

    if (healthyServers.length === 0) {
      if (!currentServer) {
        reportStatus("No " + selectedModel + " server online", "offline");
      }
      return;
    }

    // 4. Find server with smallest queue
    const smallestQueue = Math.min.apply(
      null,
      healthyServers.map(function (entry) {
        return entry.queueLength;
      })
    );
    const candidates = healthyServers.filter(function (entry) {
      return entry.queueLength === smallestQueue;
    });

    if (currentServer && discoveredServers[currentServer]) {
      const isCurrentCandidate = candidates.some(function (entry) {
        return entry.serverId === currentServer;
      });
      if (isCurrentCandidate) return;
    }

    joinServer(candidates[Math.floor(Math.random() * candidates.length)].serverId);
  }

  function startRelay() {
    if (typeof mqtt === "undefined") {
      reportStatus("MQTT library missing", "offline");
      return;
    }

    if (relayClient) {
      try {
        relayClient.end(true);
      } catch (endError) {}
      relayClient = null;
    }

    relayIsConnected = false;
    reportStatus("Connecting", "waiting");

    relayClient = mqtt.connect(BROKER_URL, {
      clientId: "xaida-client-" + logicalClientId,
      clean: true,
      keepalive: 30,
      reconnectPeriod: 2000,
      connectTimeout: 8000
    });

    relayClient.on("connect", function () {
      relayIsConnected = true;
      if (relayRestartTimer) {
        clearTimeout(relayRestartTimer);
        relayRestartTimer = null;
      }
      reportStatus("Scanning servers", "waiting");

      relayClient.subscribe(HEARTBEAT_TOPIC);
      relayClient.subscribe(DEACTIVATE_TOPIC);

      relayClient.publish(PING_TOPIC, "PING", { qos: 0 });
    });

    relayClient.on("reconnect", function () {
      reportStatus("Reconnecting", "waiting");
      if (!relayRestartTimer) {
        relayRestartTimer = setTimeout(function () {
          relayRestartTimer = null;
          startRelay();
        }, 10000);
      }
    });

    relayClient.on("offline", function () {
      relayIsConnected = false;
      reportStatus("Relay offline", "offline");
    });

    relayClient.on("message", function (topic, rawMessage) {
      let payload = null;
      try {
        payload = JSON.parse(rawMessage.toString());
      } catch (parseError) {
        return;
      }

      if (topic === HEARTBEAT_TOPIC) {
        if (!payload.serverId) return;

        if (payload.status === "offline" || payload.active === false || payload.deactivated === true) {
          removeServer(payload.serverId);
          return;
        }

        if (!payload.modelId) return;

        discoveredServers[payload.serverId] = {
          modelId: payload.modelId,
          queueLength: payload.queueLength || 0,
          lastSeen: Date.now()
        };
        pickBestServer();
        return;
      }

      if (topic === DEACTIVATE_TOPIC) {
        if (payload.serverId) {
          removeServer(payload.serverId);
        }
        return;
      }

      // Handle server responses
      if (topic === currentResponseTopic && typeof XaidaConnector.onServerMessage === "function") {
        XaidaConnector.onServerMessage(payload);
      }
    });
  }

  createWorkerInterval(pickBestServer, 2000);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (!relayClient || !relayClient.connected) startRelay();
    else {
      relayClient.publish(PING_TOPIC, "PING", { qos: 0 });
      pickBestServer();
    }
  });

  window.addEventListener("online", function () {
    startRelay();
  });

  window.addEventListener("pagehide", function () {
    XaidaConnector.announceDisconnect();
  });

  window.addEventListener("beforeunload", function () {
    XaidaConnector.announceDisconnect();
  });

  window.XaidaConnector = XaidaConnector;
})();
