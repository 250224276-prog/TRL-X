const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_SYSTEM_PROMPT = '你是 TRL-X 的 AI 跑山助手，擅长越野跑赛事计划、补给、装备、配速策略和风险检查。回答要清晰、实用、中文为主；涉及安全风险时提醒用户保守决策。';
const REQUEST_TIMEOUT_MS = 60000;
const MAX_RACE_CONTEXT_CHARS = 6000;

function sanitizeMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .filter(item => item && (item.role === 'user' || item.role === 'assistant') && item.content)
    .slice(-12)
    .map(item => ({
      role: item.role,
      content: String(item.content).slice(0, 4000)
    }));
}

function sanitizeModelName(model) {
  return String(model || '').trim().slice(0, 100);
}

function sanitizeSystemPrompt(prompt) {
  return String(prompt || '').trim().slice(0, 4000);
}

function sanitizeRaceContextText(text) {
  return String(text || '').trim().slice(0, MAX_RACE_CONTEXT_CHARS);
}

function buildCompletionsUrl(baseUrl) {
  const normalizedBase = new URL(baseUrl || DEFAULT_BASE_URL);
  const basePath = normalizedBase.pathname.replace(/\/$/, '');
  normalizedBase.pathname = `${basePath && basePath !== '/' ? basePath : ''}/chat/completions`;
  normalizedBase.search = '';
  normalizedBase.hash = '';
  return normalizedBase;
}

function requestDeepSeek(payload, apiKey, baseUrl) {
  return new Promise((resolve, reject) => {
    const url = buildCompletionsUrl(baseUrl);
    const body = JSON.stringify(payload);

    const req = https.request({
      method: 'POST',
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let raw = '';

      res.on('data', chunk => {
        raw += chunk.toString('utf8');
      });

      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          reject(new Error(`DeepSeek 返回解析失败：${raw.slice(0, 120)}`));
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const message = parsed.error?.message || parsed.message || `DeepSeek 请求失败：${res.statusCode}`;
          reject(new Error(message));
          return;
        }

        resolve(parsed);
      });
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('DeepSeek 请求超时'));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.main = async (event = {}) => {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: '云函数未配置 DEEPSEEK_API_KEY'
    };
  }

  const messages = sanitizeMessages(event.messages);
  if (!messages.length) {
    return {
      success: false,
      error: '消息不能为空'
    };
  }

  try {
    const model = sanitizeModelName(process.env.DEEPSEEK_MODEL || event.model) || DEFAULT_MODEL;
    const systemPrompt = sanitizeSystemPrompt(process.env.DEEPSEEK_SYSTEM_PROMPT || event.systemPrompt) || DEFAULT_SYSTEM_PROMPT;
    const raceContextText = sanitizeRaceContextText(event.raceContextText);
    const requestMessages = [
      {
        role: 'system',
        content: systemPrompt
      }
    ];

    if (raceContextText) {
      requestMessages.push({
        role: 'system',
        content: raceContextText
      });
    }

    const response = await requestDeepSeek({
      model,
      messages: requestMessages.concat(messages),
      temperature: 0.7,
      max_tokens: 1600,
      stream: false
    }, apiKey, process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL);

    return {
      success: true,
      reply: response.choices?.[0]?.message?.content || '',
      usage: response.usage || null,
      model: response.model || null
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'DeepSeek 请求失败'
    };
  }
};
