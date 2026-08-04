(function () {
  const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";
  const HEARTBEAT_TOPIC = "xaida/servers/heartbeat";

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
      return relayIsConnected && currentServer !== "";
    },

    start: function () {
      startRelay();
    },

    setSelectedModel: function (modelId) {
      if (selectedModel === modelId) return;
      selectedModel = modelId;
      localStorage.setItem("xaida_selected_model", modelId);
      leaveCurrentServer();
      reportStatus("Looking for a " + modelId + " server", "waiting");
      pickBestServer();
    },

    sendPrompt: function (promptPayload) {
      if (!XaidaConnector.isReady()) return false;
      relayClient.publish(
        "xaida/" + currentServer + "/prompt",
        JSON.stringify({
          clientId: logicalClientId,
          authKey: storedAuthKey,
          modelId: selectedModel,
          text: promptPayload.text,
          imageDataUrl: promptPayload.imageDataUrl || null,
          requestId: promptPayload.requestId,
          sentAt: Date.now()
        }),
        { qos: 0 }
      );
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

  function joinServer(serverId) {
    leaveCurrentServer();
    currentServer = serverId;
    currentResponseTopic = "xaida/" + serverId + "/response/" + logicalClientId;
    relayClient.subscribe(currentResponseTopic, function (subscribeError) {
      if (!subscribeError) {
        reportStatus("Server " + serverId, "online");
      }
    });
  }

  function pickBestServer() {
    const now = Date.now();
    const healthyServers = [];

    Object.keys(discoveredServers).forEach(function (serverId) {
      const serverInfo = discoveredServers[serverId];
      if (now - serverInfo.lastSeen > 10000) {
        delete discoveredServers[serverId];
        return;
      }
      if (serverInfo.modelId === selectedModel) {
        healthyServers.push({ serverId: serverId, queueLength: serverInfo.queueLength });
      }
    });

    if (currentServer && !discoveredServers[currentServer]) {
      leaveCurrentServer();
      reportStatus("No server online", "offline");
    }

    if (healthyServers.length === 0) {
      if (!currentServer) reportStatus("No " + selectedModel + " server", "offline");
      return;
    }

    const smallestQueue = Math.min.apply(
      null,
      healthyServers.map(function (entry) {
        return entry.queueLength;
      })
    );
    const candidates = healthyServers.filter(function (entry) {
      return entry.queueLength === smallestQueue;
    });

    const alreadyGood = candidates.some(function (entry) {
      return entry.serverId === currentServer;
    });
    if (alreadyGood) return;

    joinServer(candidates[Math.floor(Math.random() * candidates.length)].serverId);
  }

  function startRelay() {
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
      keepalive: 15,
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
        if (!payload.serverId || !payload.modelId) return;
        discoveredServers[payload.serverId] = {
          modelId: payload.modelId,
          queueLength: payload.queueLength || 0,
          lastSeen: Date.now()
        };
        pickBestServer();
        return;
      }

      if (topic === currentResponseTopic && typeof XaidaConnector.onServerMessage === "function") {
        XaidaConnector.onServerMessage(payload);
      }
    });
  }

  setInterval(pickBestServer, 3000);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (!relayClient || !relayClient.connected) startRelay();
    else pickBestServer();
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
