const clientUserIdentifier = "user-" + Math.random().toString(36).substring(2, 8);
const clientAuthenticationKey = Math.random().toString(36).substring(2) + Date.now().toString(36);
const clientMqttIdentifier = "xaida-client-" + clientUserIdentifier;

let selectedModelName = "Xaida 2.1";
let mqttConnectorClient = null;
let currentActiveServerId = "";
let serverResponseTopicChannel = "";
let isServerConnectedStatus = false;

const HEARTBEAT_BROADCAST_TOPIC = "ai-chat/servers/heartbeat";
const activeDiscoveredServersMap = {};

function initializeMqttConnection() {
  if (mqttConnectorClient) {
    try {
      mqttConnectorClient.end(true);
    } catch (connectionError) {}
  }

  isServerConnectedStatus = false;
  updateServerStatusIndicator("SCANNING...");

  mqttConnectorClient = mqtt.connect('wss://broker.emqx.io:8084/mqtt', {
    clientId: clientMqttIdentifier,
    clean: true,
    keepalive: 15,
    reconnectPeriod: 2000
  });

  mqttConnectorClient.on('connect', () => {
    isServerConnectedStatus = true;
    mqttConnectorClient.subscribe(HEARTBEAT_BROADCAST_TOPIC);
    automaticallySelectOptimalServer();
  });

  mqttConnectorClient.on('offline', () => {
    isServerConnectedStatus = false;
    updateServerStatusIndicator("OFFLINE");
  });

  mqttConnectorClient.on('message', (incomingTopic, messageBuffer) => {
    try {
      const parsedPayload = JSON.parse(messageBuffer.toString());

      if (incomingTopic === HEARTBEAT_BROADCAST_TOPIC) {
        if (parsedPayload && parsedPayload.serverId && parsedPayload.modelType) {
          activeDiscoveredServersMap[parsedPayload.serverId] = {
            serverId: parsedPayload.serverId,
            modelType: parsedPayload.modelType,
            queueLength: parsedPayload.queueLength,
            lastSeenTimestamp: Date.now()
          };
          automaticallySelectOptimalServer();
        }
        return;
      }

      if (parsedPayload.requestId) {
        handleIncomingServerResponsePayload(parsedPayload);
      }
    } catch (parsingError) {}
  });
}

function automaticallySelectOptimalServer() {
  const currentTimestamp = Date.now();
  const targetModelType = selectedModelName;

  const validAvailableServers = [];

  Object.keys(activeDiscoveredServersMap).forEach((serverIdKey) => {
    const serverInformation = activeDiscoveredServersMap[serverIdKey];
    if (currentTimestamp - serverInformation.lastSeenTimestamp < 10000) {
      if (serverInformation.modelType === targetModelType) {
        validAvailableServers.push(serverInformation);
      }
    } else {
      delete activeDiscoveredServersMap[serverIdKey];
    }
  });

  if (validAvailableServers.length === 0) {
    currentActiveServerId = "";
    updateServerStatusIndicator(`NO ${targetModelType.toUpperCase()} SERVER`);
    return;
  }

  let chosenServerObject = validAvailableServers[0];
  for (let index = 1; index < validAvailableServers.length; index++) {
    if (validAvailableServers[index].queueLength < chosenServerObject.queueLength) {
      chosenServerObject = validAvailableServers[index];
    }
  }

  if (currentActiveServerId !== chosenServerObject.serverId) {
    connectToSpecificServerId(chosenServerObject.serverId);
  }
}

function connectToSpecificServerId(targetServerId) {
  if (serverResponseTopicChannel && mqttConnectorClient && isServerConnectedStatus) {
    mqttConnectorClient.unsubscribe(serverResponseTopicChannel);
  }

  currentActiveServerId = targetServerId;
  serverResponseTopicChannel = `ai-chat/${targetServerId}/response/${clientUserIdentifier}`;

  if (mqttConnectorClient && isServerConnectedStatus) {
    mqttConnectorClient.subscribe(serverResponseTopicChannel, (subscriptionError) => {
      if (!subscriptionError) {
        updateServerStatusIndicator(`ONLINE (${targetServerId.substring(0, 10)})`);
      }
    });
  }
}

function updateServerStatusIndicator(statusTextDisplay) {
  const serverStatusBadgeElement = document.getElementById("serverStatusBadge");
  if (serverStatusBadgeElement) {
    serverStatusBadgeElement.innerText = "SERVER: " + statusTextDisplay;
  }
}

function sendPromptToServer(promptTextContent, attachedImageBase64) {
  if (!promptTextContent && !attachedImageBase64) {
    return null;
  }

  if (!currentActiveServerId || !isServerConnectedStatus) {
    return null;
  }

  const generatedRequestId = "req-" + Date.now() + "-" + Math.random().toString(36).substring(2, 6);
  const targetPromptTopicChannel = `ai-chat/${currentActiveServerId}/prompt`;

  const requestPayloadObject = {
    clientId: clientUserIdentifier,
    authKey: clientAuthenticationKey,
    text: promptTextContent,
    image: attachedImageBase64 || null,
    requestId: generatedRequestId,
    timestamp: Date.now()
  };

  mqttConnectorClient.publish(targetPromptTopicChannel, JSON.stringify(requestPayloadObject), { qos: 1 });
  return generatedRequestId;
}

initializeMqttConnection();
