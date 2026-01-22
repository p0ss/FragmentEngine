// api/routes/llm.js
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const { MCPClient } = require('../utils/mcp-client');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// Initialize Bedrock client - uses IAM instance role automatically
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'ap-southeast-2'
});

// GET /api/llm/models
router.get('/models', async (req, res) => {
  try {
    const models = [];
    const status = {
      litellm: { available: false, error: null },
      ollama: { available: false, error: null, url: null },
      openai: { available: false, error: null }
    };
    
    const enableLiteLLM = process.env.ENABLE_LITELLM === 'true';
    const liteUrl = process.env.LITELLM_URL;
    const liteKey = process.env.LITELLM_API_KEY;

    if (enableLiteLLM && liteUrl) {
      // Fetch models from LiteLLM (OpenAI-compatible /v1/models)
      try {
        const resp = await fetch(`${liteUrl.replace(/\/$/, '')}/v1/models`, {
          headers: liteKey ? { Authorization: `Bearer ${liteKey}` } : {},
          timeout: 5000
        });
        if (resp.ok) {
          const data = await resp.json();
          const list = Array.isArray(data.data) ? data.data : [];
          list.forEach(m => {
            const id = m.id || m.name;
            if (id) models.push({ 
              value: id, 
              label: `LiteLLM • ${id}`, 
              provider: 'litellm',
              status: 'available'
            });
          });
          status.litellm.available = true;
        } else {
          status.litellm.error = `HTTP ${resp.status}: ${resp.statusText}`;
        }
      } catch (error) {
        status.litellm.error = error.message;
      }
    } else {
      // Try Ollama
      const ollamaUrl = process.env.OLLAMA_URL || 'http://172.17.0.1:11434';
      status.ollama.url = ollamaUrl;
      
      try {
        const resp = await fetch(`${ollamaUrl}/api/tags`, { timeout: 3000 });
        if (resp.ok) {
          const data = await resp.json();
          (data.models || []).forEach(m => {
            const name = m.name;
            if (name) models.push({ 
              value: `ollama:${name}`, 
              label: `Ollama • ${name}`, 
              provider: 'ollama',
              status: 'available'
            });
          });
          status.ollama.available = true;
        } else {
          status.ollama.error = `HTTP ${resp.status}: ${resp.statusText}`;
        }
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          status.ollama.error = 'Connection refused - Ollama not running or unreachable';
        } else if (error.code === 'ETIMEDOUT' || error.name === 'AbortError') {
          status.ollama.error = 'Connection timeout - Ollama may be starting';
        } else {
          status.ollama.error = error.message;
        }
      }

      // Optional: add OpenAI defaults if API key present
      if (process.env.OPENAI_API_KEY) {
        ['gpt-4o-mini', 'gpt-4o'].forEach(n => models.push({
          value: `openai:${n}`,
          label: `OpenAI • ${n}`,
          provider: 'openai',
          status: 'available'
        }));
        status.openai.available = true;
      } else {
        status.openai.error = 'API key not configured';
      }

      // AWS Bedrock models (uses IAM role - no API key needed)
      const enableBedrock = process.env.ENABLE_BEDROCK !== 'false';
      if (enableBedrock) {
        // Default models - can be customized via BEDROCK_MODELS env var
        // Format: "modelId:Label,modelId2:Label2"
        const defaultModels = [
          // Claude 3.5 Sonnet v2 is currently the best available Claude model
          { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Claude 3.5 Sonnet v2' },
          { id: 'mistral.mistral-large-2402-v1:0', label: 'Mistral Large' },
          { id: 'nvidia-nemotron-super-49b-nim', label: 'NVIDIA Nemotron 49B' },
          // Older Claude models
          { id: 'anthropic.claude-3-sonnet-20240229-v1:0', label: 'Claude 3 Sonnet' },
          { id: 'anthropic.claude-3-haiku-20240307-v1:0', label: 'Claude 3 Haiku' },
        ];

        const customModels = process.env.BEDROCK_MODELS;
        const bedrockModels = customModels
          ? customModels.split(',').map(m => {
              const [id, label] = m.split(':').map(s => s.trim());
              return { id, label: label || id };
            })
          : defaultModels;

        bedrockModels.forEach(m => models.push({
          value: `bedrock:${m.id}`,
          label: `Bedrock • ${m.label}`,
          provider: 'bedrock',
          status: 'available'
        }));
        status.bedrock = { available: true, error: null };
      }
    }

    // Fallback if no models at all
    if (models.length === 0) {
      models.push({
        value: 'none',
        label: 'No models available - check configuration',
        provider: 'none',
        status: 'error'
      });
    }

    return res.json({
      models,
      status
    });
  } catch (error) {
    console.error('Models list error:', error);
    return res.status(500).json({ error: 'Failed to list models', details: error.message });
  }
});

// POST /api/llm/chat
// Body: { prompt: string, model: string }
// model format examples:
//  - "ollama:llama3:8b"
//  - "ollama:gemma:27b"
//  - "openai:gpt-4o-mini"
router.post('/chat', async (req, res) => {
  try {
    const { prompt, model } = req.body || {};
    if (!prompt || !model) {
      return res.status(400).json({ error: 'prompt and model are required' });
    }

    // If LiteLLM is enabled and configured, use it for all requests
    const enableLiteLLM = process.env.ENABLE_LITELLM === 'true';
    const liteUrl = process.env.LITELLM_URL;
    const liteKey = process.env.LITELLM_API_KEY;
    if (enableLiteLLM && liteUrl) {
      const url = `${liteUrl.replace(/\/$/, '')}/v1/chat/completions`;
      // Map provider:model to LiteLLM router model_name if needed
      let routedModel = model;
      if (model.includes(':') && !model.includes('/')) {
        const [prov, ...rest] = model.split(':');
        routedModel = `${prov}/${rest.join(':')}`; // e.g., ollama/gemma3:27b
      }
      const payload = {
        model: routedModel,
        messages: [
          { role: 'system', content: 'You are a helpful Australian government services assistant.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      };
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(liteKey ? { Authorization: `Bearer ${liteKey}` } : {})
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const text = await resp.text();
        let errorMsg = `LiteLLM error (${resp.status}): ${text}`;
        if (resp.status === 404) {
          errorMsg = `Model "${routedModel}" not found in LiteLLM. Check your LiteLLM configuration.`;
        } else if (resp.status === 401 || resp.status === 403) {
          errorMsg = 'LiteLLM authentication failed. Check LITELLM_API_KEY.';
        }
        return res.status(resp.status).json({ 
          error: errorMsg,
          provider: 'litellm',
          model: routedModel,
          url: url
        });
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      return res.json({ response: content });
    }

    // Otherwise fall back to provider parsing
    const [provider, ...rest] = String(model).split(':');
    const providerModel = rest.join(':');

    if (!provider || !providerModel) {
      return res.status(400).json({ error: 'Invalid model format. Use provider:model, e.g., ollama:llama3:8b' });
    }

    if (provider === 'ollama') {
      const OLLAMA_URL = process.env.OLLAMA_URL || 'http://172.17.0.1:11434';
      try {
        const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: providerModel, prompt, stream: false }),
          timeout: 60000 // 60 second timeout for generation
        });
        if (!resp.ok) {
          const text = await resp.text();
          let errorMsg = `Ollama error (${resp.status}): ${text}`;
          
          try {
            const errorJson = JSON.parse(text);
            if (errorJson.error) {
              if (errorJson.error.includes('not found') || errorJson.error.includes('model')) {
                errorMsg = `Model "${providerModel}" not found. Try: ollama pull ${providerModel}`;
              } else {
                errorMsg = `Ollama: ${errorJson.error}`;
              }
            }
          } catch {}
          
          return res.status(resp.status).json({ 
            error: errorMsg,
            provider: 'ollama',
            model: providerModel,
            url: OLLAMA_URL,
            suggestion: resp.status === 404 ? `Run: ollama pull ${providerModel}` : null
          });
        }
        const data = await resp.json();
        return res.json({ response: data.response });
      } catch (error) {
        let errorMsg = 'Ollama connection failed';
        let suggestion = null;
        
        if (error.code === 'ECONNREFUSED') {
          errorMsg = `Cannot connect to Ollama at ${OLLAMA_URL}`;
          suggestion = 'Start Ollama with: ollama serve';
        } else if (error.code === 'ETIMEDOUT' || error.name === 'AbortError') {
          errorMsg = 'Ollama request timed out - model may be loading or generating';
          suggestion = 'Wait for model to finish loading, or try a smaller model';
        } else {
          errorMsg = `Ollama error: ${error.message}`;
        }
        
        return res.status(503).json({
          error: errorMsg,
          provider: 'ollama',
          model: providerModel,
          url: OLLAMA_URL,
          suggestion: suggestion
        });
      }
    }

    if (provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({
          error: 'OpenAI API key not configured',
          provider: 'openai',
          suggestion: 'Set OPENAI_API_KEY environment variable'
        });
      }

      try {
        const url = 'https://api.openai.com/v1/chat/completions';
        const payload = {
          model: providerModel,
          messages: [
            { role: 'system', content: 'You are a helpful Australian government services assistant.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7
        };
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) {
          const text = await resp.text();
          let errorMsg = `OpenAI error (${resp.status}): ${text}`;
          let suggestion = null;

          if (resp.status === 401) {
            errorMsg = 'OpenAI authentication failed. Check your API key.';
            suggestion = 'Verify OPENAI_API_KEY is correct';
          } else if (resp.status === 404) {
            errorMsg = `Model "${providerModel}" not available in OpenAI API.`;
            suggestion = 'Try: gpt-4o-mini, gpt-4o, or gpt-3.5-turbo';
          } else if (resp.status === 429) {
            errorMsg = 'OpenAI rate limit exceeded.';
            suggestion = 'Wait a moment before trying again';
          }

          return res.status(resp.status).json({
            error: errorMsg,
            provider: 'openai',
            model: providerModel,
            suggestion: suggestion
          });
        }
        const data = await resp.json();
        const content = data.choices?.[0]?.message?.content || '';
        return res.json({ response: content });
      } catch (error) {
        return res.status(500).json({
          error: `OpenAI request failed: ${error.message}`,
          provider: 'openai',
          model: providerModel
        });
      }
    }

    if (provider === 'bedrock') {
      try {
        let payload;
        let parseResponse;
        const systemPrompt = 'You are a helpful Australian government services assistant.';

        // Different payload formats for different model providers
        if (providerModel.includes('anthropic')) {
          // Anthropic Claude models
          payload = {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 4096,
            system: systemPrompt,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7
          };
          parseResponse = (body) => body.content?.[0]?.text || '';
        } else if (providerModel.includes('mistral')) {
          // Mistral models
          payload = {
            prompt: `<s>[INST] ${systemPrompt}\n\n${prompt} [/INST]`,
            max_tokens: 4096,
            temperature: 0.7
          };
          parseResponse = (body) => body.outputs?.[0]?.text || '';
        } else if (providerModel.includes('meta') || providerModel.includes('llama')) {
          // Meta Llama models
          payload = {
            prompt: `<s>[INST] <<SYS>>\n${systemPrompt}\n<</SYS>>\n\n${prompt} [/INST]`,
            max_gen_len: 4096,
            temperature: 0.7
          };
          parseResponse = (body) => body.generation || '';
        } else {
          // Default/generic format (works for some models)
          payload = {
            inputText: `${systemPrompt}\n\nUser: ${prompt}\n\nAssistant:`,
            textGenerationConfig: {
              maxTokenCount: 4096,
              temperature: 0.7
            }
          };
          parseResponse = (body) => body.results?.[0]?.outputText || body.generation || JSON.stringify(body);
        }

        const command = new InvokeModelCommand({
          modelId: providerModel,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(payload)
        });

        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const content = parseResponse(responseBody);
        return res.json({ response: content });
      } catch (error) {
        let errorMsg = `Bedrock error: ${error.message}`;
        let suggestion = null;

        if (error.name === 'AccessDeniedException') {
          errorMsg = 'Bedrock access denied. Check IAM permissions.';
          suggestion = 'Ensure the instance role has bedrock:InvokeModel permission';
        } else if (error.name === 'ValidationException') {
          errorMsg = `Invalid model or request: ${error.message}`;
          suggestion = 'Check model ID is correct and available in your region';
        } else if (error.name === 'ResourceNotFoundException') {
          errorMsg = `Model "${providerModel}" not found in Bedrock.`;
          suggestion = 'Enable the model in AWS Bedrock console for your region';
        }

        return res.status(500).json({
          error: errorMsg,
          provider: 'bedrock',
          model: providerModel,
          suggestion: suggestion
        });
      }
    }

    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  } catch (error) {
    console.error('LLM proxy error:', error);
    return res.status(500).json({ error: 'LLM request failed', details: error.message });
  }
});

// POST /api/llm/chat-with-context
// Enhanced chat endpoint that uses MCP to search for relevant government service context
router.post('/chat-with-context', async (req, res) => {
  try {
    const { prompt, model, search_options = {}, user_profile = null } = req.body || {};
    if (!prompt || !model) {
      return res.status(400).json({ error: 'prompt and model are required' });
    }

    // Helper: map user profile to MCP search filters
    const deriveSearchFiltersFromProfile = (p) => {
      const out = {};
      if (!p || typeof p !== 'object') return out;
      // State mapping
      if (p.residency_state && !['National', 'All states', 'All States'].includes(p.residency_state)) {
        out.state = p.residency_state;
      }
      // Life event mapping (use first provided if any)
      if (Array.isArray(p.current_life_events) && p.current_life_events.length > 0) {
        out.life_event = p.current_life_events[0];
      }
      // Provider or category could be mapped in future if present in profile
      return out;
    };

    // Use MCP to get relevant context
    const mcpClient = new MCPClient();
    let context = '';
    let searchResults = null;

    try {
      // Search for relevant government services
      const mappedFilters = deriveSearchFiltersFromProfile(user_profile);
      const finalSearchOptions = { ...(search_options || {}) };
      for (const [k, v] of Object.entries(mappedFilters)) {
        if (finalSearchOptions[k] === undefined || finalSearchOptions[k] === null || finalSearchOptions[k] === '') {
          finalSearchOptions[k] = v;
        }
      }

      const searchResponse = await mcpClient.searchGovernmentServices(prompt, {
        per_page: 5,
        sort_by: 'srrs_score:desc,popularity_sort:asc',
        ...finalSearchOptions,
      });

      if (searchResponse && searchResponse.results && searchResponse.results.length > 0) {
        searchResults = searchResponse.results;
        context = searchResponse.results
          .map(result => 
            `Title: ${result.title}\n` +
            `Provider: ${result.provider}\n` +
            `Category: ${result.category}\n` +
            `Content: ${result.content}\n` +
            `URL: ${result.url}`
          )
          .join('\n\n---\n\n');
      }
    } catch (mcpError) {
      console.warn('MCP search failed, continuing without context:', mcpError.message);
      context = 'Unable to retrieve specific government service information.';
    } finally {
      mcpClient.disconnect();
    }

    // Build enhanced prompt with context (include optional user profile)
    const userProfileBlock = user_profile ? `\n\nUser Profile Context (you MAY reference and discuss these details to tailor advice):\n${JSON.stringify(user_profile, null, 2)}\n` : '';
    const systemPrompt = `You are a helpful Australian government services assistant. Use the following search results to answer the user's question. If the search results don't contain relevant information, provide general guidance and suggest where they might find more information.${userProfileBlock}

Government Services Context:
${context || "No specific results found for this query."}

Remember to:
- Be helpful and concise
- Reference specific services or providers when mentioned in the search results
- Suggest visiting official government websites for the most up-to-date information
- If discussing eligibility or requirements, note that these can vary and users should check official sources
- If a user profile is provided, you MAY discuss how profile attributes (e.g., state, employment, children, disability, life events) affect relevance, eligibility, timing, and next steps; do not invent facts and do not infer details beyond what is provided.
- Include relevant URLs from the context when helpful`;

    const fullPrompt = `${systemPrompt}\n\nUser: ${prompt}\n\nAssistant:`;

    // Route through the existing chat logic
    const chatRequest = {
      body: {
        prompt: fullPrompt,
        model: model
      }
    };

    // Create a mock request/response cycle to reuse existing logic
    let llmResponse = null;
    let llmError = null;

    const mockRes = {
      status: (code) => ({
        json: (data) => {
          if (code >= 400) {
            llmError = data;
          } else {
            llmResponse = data;
          }
          return mockRes;
        }
      }),
      json: (data) => {
        llmResponse = data;
        return mockRes;
      }
    };

    // Use existing chat logic
    await handleChatRequest(chatRequest, mockRes);

    if (llmError) {
      return res.status(500).json({
        ...llmError,
        context_search: searchResults ? 'successful' : 'failed'
      });
    }

    // Return enhanced response with context metadata
    return res.json({
      ...llmResponse,
      context: {
        search_performed: true,
        results_found: searchResults ? searchResults.length : 0,
        sources: searchResults ? searchResults.map(r => ({ 
          title: r.title, 
          provider: r.provider,
          url: r.url 
        })) : []
      }
    });

  } catch (error) {
    console.error('Enhanced chat error:', error);
    return res.status(500).json({ 
      error: 'Enhanced chat request failed', 
      details: error.message 
    });
  }
});

// Helper function to extract the chat logic
async function handleChatRequest(req, res) {
  const { prompt, model } = req.body || {};
  
  // If LiteLLM is enabled and configured, use it for all requests
  const enableLiteLLM = process.env.ENABLE_LITELLM === 'true';
  const liteUrl = process.env.LITELLM_URL;
  const liteKey = process.env.LITELLM_API_KEY;
  if (enableLiteLLM && liteUrl) {
    const url = `${liteUrl.replace(/\/$/, '')}/v1/chat/completions`;
    // Map provider:model to LiteLLM router model_name if needed
    let routedModel = model;
    if (model.includes(':') && !model.includes('/')) {
      const [prov, ...rest] = model.split(':');
      routedModel = `${prov}/${rest.join(':')}`; // e.g., ollama/gemma3:27b
    }
    const payload = {
      model: routedModel,
      messages: [
        { role: 'system', content: 'You are a helpful Australian government services assistant.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(liteKey ? { Authorization: `Bearer ${liteKey}` } : {})
      },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const text = await resp.text();
      let errorMsg = `LiteLLM error (${resp.status}): ${text}`;
      if (resp.status === 404) {
        errorMsg = `Model "${routedModel}" not found in LiteLLM. Check your LiteLLM configuration.`;
      } else if (resp.status === 401 || resp.status === 403) {
        errorMsg = 'LiteLLM authentication failed. Check LITELLM_API_KEY.';
      }
      return res.status(resp.status).json({ 
        error: errorMsg,
        provider: 'litellm',
        model: routedModel,
        url: url
      });
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    return res.json({ response: content });
  }

  // Otherwise fall back to provider parsing
  const [provider, ...rest] = String(model).split(':');
  const providerModel = rest.join(':');

  if (!provider || !providerModel) {
    return res.status(400).json({ error: 'Invalid model format. Use provider:model, e.g., ollama:llama3:8b' });
  }

  if (provider === 'ollama') {
    const OLLAMA_URL = process.env.OLLAMA_URL || 'http://172.17.0.1:11434';
    try {
      const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: providerModel, prompt, stream: false }),
        timeout: 60000 // 60 second timeout for generation
      });
      if (!resp.ok) {
        const text = await resp.text();
        let errorMsg = `Ollama error (${resp.status}): ${text}`;
        
        try {
          const errorJson = JSON.parse(text);
          if (errorJson.error) {
            if (errorJson.error.includes('not found') || errorJson.error.includes('model')) {
              errorMsg = `Model "${providerModel}" not found. Try: ollama pull ${providerModel}`;
            } else {
              errorMsg = `Ollama: ${errorJson.error}`;
            }
          }
        } catch {}
        
        return res.status(resp.status).json({ 
          error: errorMsg,
          provider: 'ollama',
          model: providerModel,
          url: OLLAMA_URL,
          suggestion: resp.status === 404 ? `Run: ollama pull ${providerModel}` : null
        });
      }
      const data = await resp.json();
      return res.json({ response: data.response });
    } catch (error) {
      let errorMsg = 'Ollama connection failed';
      let suggestion = null;
      
      if (error.code === 'ECONNREFUSED') {
        errorMsg = `Cannot connect to Ollama at ${OLLAMA_URL}`;
        suggestion = 'Start Ollama with: ollama serve';
      } else if (error.code === 'ETIMEDOUT' || error.name === 'AbortError') {
        errorMsg = 'Ollama request timed out - model may be loading or generating';
        suggestion = 'Wait for model to finish loading, or try a smaller model';
      } else {
        errorMsg = `Ollama error: ${error.message}`;
      }
      
      return res.status(503).json({
        error: errorMsg,
        provider: 'ollama',
        model: providerModel,
        url: OLLAMA_URL,
        suggestion: suggestion
      });
    }
  }

  if (provider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ 
        error: 'OpenAI API key not configured',
        provider: 'openai',
        suggestion: 'Set OPENAI_API_KEY environment variable'
      });
    }

    try {
      const url = 'https://api.openai.com/v1/chat/completions';
      const payload = {
        model: providerModel,
        messages: [
          { role: 'system', content: 'You are a helpful Australian government services assistant.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      };
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const text = await resp.text();
        let errorMsg = `OpenAI error (${resp.status}): ${text}`;
        let suggestion = null;
        
        if (resp.status === 401) {
          errorMsg = 'OpenAI authentication failed. Check your API key.';
          suggestion = 'Verify OPENAI_API_KEY is correct';
        } else if (resp.status === 404) {
          errorMsg = `Model "${providerModel}" not available in OpenAI API.`;
          suggestion = 'Try: gpt-4o-mini, gpt-4o, or gpt-3.5-turbo';
        } else if (resp.status === 429) {
          errorMsg = 'OpenAI rate limit exceeded.';
          suggestion = 'Wait a moment before trying again';
        }
        
        return res.status(resp.status).json({ 
          error: errorMsg,
          provider: 'openai',
          model: providerModel,
          suggestion: suggestion
        });
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      return res.json({ response: content });
    } catch (error) {
      return res.status(500).json({
        error: `OpenAI request failed: ${error.message}`,
        provider: 'openai',
        model: providerModel
      });
    }
  }

  if (provider === 'bedrock') {
    try {
      let payload;
      let parseResponse;
      const systemPrompt = 'You are a helpful Australian government services assistant.';

      // Different payload formats for different model providers
      if (providerModel.includes('anthropic')) {
        payload = {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7
        };
        parseResponse = (body) => body.content?.[0]?.text || '';
      } else if (providerModel.includes('mistral')) {
        payload = {
          prompt: `<s>[INST] ${systemPrompt}\n\n${prompt} [/INST]`,
          max_tokens: 4096,
          temperature: 0.7
        };
        parseResponse = (body) => body.outputs?.[0]?.text || '';
      } else if (providerModel.includes('meta') || providerModel.includes('llama')) {
        payload = {
          prompt: `<s>[INST] <<SYS>>\n${systemPrompt}\n<</SYS>>\n\n${prompt} [/INST]`,
          max_gen_len: 4096,
          temperature: 0.7
        };
        parseResponse = (body) => body.generation || '';
      } else {
        payload = {
          inputText: `${systemPrompt}\n\nUser: ${prompt}\n\nAssistant:`,
          textGenerationConfig: {
            maxTokenCount: 4096,
            temperature: 0.7
          }
        };
        parseResponse = (body) => body.results?.[0]?.outputText || body.generation || JSON.stringify(body);
      }

      const command = new InvokeModelCommand({
        modelId: providerModel,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload)
      });

      const response = await bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const content = parseResponse(responseBody);
      return res.json({ response: content });
    } catch (error) {
      let errorMsg = `Bedrock error: ${error.message}`;
      let suggestion = null;

      if (error.name === 'AccessDeniedException') {
        errorMsg = 'Bedrock access denied. Check IAM permissions.';
        suggestion = 'Ensure the instance role has bedrock:InvokeModel permission';
      } else if (error.name === 'ValidationException') {
        errorMsg = `Invalid model or request: ${error.message}`;
        suggestion = 'Check model ID is correct and available in your region';
      } else if (error.name === 'ResourceNotFoundException') {
        errorMsg = `Model "${providerModel}" not found in Bedrock.`;
        suggestion = 'Enable the model in AWS Bedrock console for your region';
      }

      return res.status(500).json({
        error: errorMsg,
        provider: 'bedrock',
        model: providerModel,
        suggestion: suggestion
      });
    }
  }

  return res.status(400).json({ error: `Unsupported provider: ${provider}` });
}

module.exports = router;
