const { getPatientSystemPrompt } = require("./providers");

function getAnthropicMessagesEndpoint(baseUrl) {
  const base = (baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
  if (base.endsWith("/v1/messages")) return base;
  if (base.endsWith("/v1")) return `${base}/messages`;
  return `${base}/v1/messages`;
}

function buildVoiceAgentConfiguration(caseData, env = process.env) {
  if (!env.DEEPGRAM_API_KEY) {
    throw new Error(
      "DEEPGRAM_API_KEY is not configured. Add it to the project-root .env.local file.",
    );
  }
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Add it to the project-root .env.local file.",
    );
  }

  return {
    apiKey: env.DEEPGRAM_API_KEY,
    settings: {
      type: "Settings",
      mip_opt_out: true,
      audio: {
        input: { encoding: "linear16", sample_rate: 16000 },
        output: {
          encoding: "linear16",
          sample_rate: 24000,
          container: "none",
        },
      },
      agent: {
        greeting: caseData.patient.opening,
        listen: {
          provider: {
            type: "deepgram",
            version: "v2",
            model: env.DEEPGRAM_STT_MODEL || "flux-general-en",
          },
        },
        think: {
          provider: {
            type: "anthropic",
            model: env.PATIENT_CHAT_MODEL || "claude-haiku-5-5",
          },
          endpoint: {
            url: getAnthropicMessagesEndpoint(env.ANTHROPIC_BASE_URL),
            headers: {
              "x-api-key": env.ANTHROPIC_API_KEY,
            },
          },
          prompt: getPatientSystemPrompt(caseData),
        },
        speak: {
          provider: {
            type: "deepgram",
            version: "v2",
            model: env.DEEPGRAM_TTS_MODEL || "flux-alexis-en",
            speed: 1,
            expressivity: 0,
          },
        },
      },
    },
  };
}

module.exports = { buildVoiceAgentConfiguration };
