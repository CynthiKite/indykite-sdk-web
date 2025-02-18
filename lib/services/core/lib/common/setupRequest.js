const {
  setCv,
  setThreadId,
  setAuthFlowStartPoint,
  getPendingResponse,
  setPendingResponse,
} = require("../storage");
const { getCodeVerifierAndChallenge } = require("../../utils/crypto");

// Locals
const { getOidcOriginalParams } = require("../storage");
const IDSDKConfig = require("../config");
const { flowTypes } = require("../../constants");
const { getValidAccessToken } = require("../refresh");
const { addAuthorizationTokenToHeaders, sendRequest } = require("../../utils/helpers");

/**
 * @param {{
 *   token?: string;
 *   args?: Record<string, string>;
 * }} [config]
 * @returns
 */
const setupRequest = async (config = {}) => {
  if (!config.args) {
    config.args = { flow: flowTypes.login };
  }

  const { codeVerifier, codeChallenge } = getCodeVerifierAndChallenge();

  setAuthFlowStartPoint(location.href);

  // Try to get access token from SDK store
  let token;
  if (config.args.flow === flowTypes.login) {
    try {
      token = await getValidAccessToken();
    } catch (err) {
      console.debug(
        "No access token found. Setup request will continue without including access token in headers.",
      );
    }
  }

  try {
    const url = IDSDKConfig.getBaseAuthUrl();

    // This is required if we are in linking flow and in previous step the page was redirected to the callback page
    // and now we need to continue with the last response.
    const pendingResponse = getPendingResponse();
    const pendingResponseObject = pendingResponse && { data: pendingResponse };
    if (pendingResponse) {
      setPendingResponse(null);
    }

    const data = {
      cc: codeChallenge,
    };
    const tenantId = IDSDKConfig.getTenantId();
    if (tenantId) {
      data["~tenant"] = tenantId;
    }
    if (config.args) {
      data["~arg"] = config.args;
    }
    if (config.token || config.otpToken) {
      data["~token"] = config.token || config.otpToken;
    }

    const oidcParams = getOidcOriginalParams();
    if (oidcParams && oidcParams.login_challenge) {
      data["~token"] = oidcParams.login_challenge;
    }

    // If there is token from SDK store - include in auth headers
    const requestConfig =
      token && config.args.flow !== flowTypes.register
        ? {
            headers: addAuthorizationTokenToHeaders(token),
          }
        : undefined;

    const response =
      pendingResponseObject ||
      (await sendRequest(
        url,
        "POST",
        data,
        Object.assign(
          {
            actionName: "setup",
          },
          requestConfig,
        ),
      ));

    if (!response || !response.data) {
      console.warn("No data resposne from server.");
      throw "No data resposne from server.";
    }

    if (response.data["@type"] === "fail") {
      return response.data;
    }

    if (
      config.args.flow === flowTypes.login &&
      response.data["@type"] === "success" &&
      response.data.verifier
    ) {
      // Valid token was found during oidc flow so login phase can be skipped.
      return response.data;
    }

    if (!response.data["~thread"] || !response.data["~thread"].thid) {
      console.error("No thread information received from server.");
      throw "No thread information received from server.";
    }

    setThreadId(response.data["~thread"].thid);
    if (!pendingResponse) {
      setCv(codeVerifier);
    }

    if (response.data["@type"] === "logical") {
      const actions =
        Array.isArray(response.data.opts) &&
        response.data.opts.find((opt) => opt["@type"] === "action");
      actions && actions["@id"] && sessionStorage.setItem("@indykite/actionsId", actions["@id"]);
    }

    return response.data;
  } catch (err) {
    console.error(err.name, `IKUISDK Failed with ${config.args.flow} flow pre-request.`);
    throw err;
  }
};

module.exports = setupRequest;
