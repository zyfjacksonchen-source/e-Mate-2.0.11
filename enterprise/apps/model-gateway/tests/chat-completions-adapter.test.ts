import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chatCompletionsToResponsesStream,
  responsesToChatCompletionsRequest,
} from '../src/chat-completions-adapter.ts';

const functionTool = {
  type: 'function',
  name: 'shell_command',
  description: 'Run a command.',
  strict: false,
  parameters: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
  },
};

const customTool = {
  type: 'custom',
  name: 'apply_patch',
  description: 'Apply a patch.',
  format: { type: 'grammar', syntax: 'lark', definition: 'start: /.+/' },
};

function request(input: unknown[], tools: unknown[] = [functionTool, customTool]) {
  return responsesToChatCompletionsRequest(
    {
      model: 'deepseek',
      instructions: 'You are 小芯.',
      input,
      tools,
      tool_choice: 'auto',
      parallel_tool_calls: true,
      reasoning: { effort: 'high' },
      include: ['reasoning.encrypted_content'],
      store: false,
      stream: true,
    },
    'provider-model',
    4096,
    false
  );
}

function chatSse(chunks: unknown[]): Response {
  return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('maps pinned Responses messages and function/custom tool history to Chat Completions', () => {
  const adapted = request([
    { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix it.' }] },
    {
      type: 'function_call',
      call_id: 'call-1',
      name: 'shell_command',
      arguments: '{"command":"pwd"}',
    },
    { type: 'custom_tool_call', call_id: 'call-2', name: 'apply_patch', input: '*** Begin Patch' },
    { type: 'function_call_output', call_id: 'call-1', output: 'ok' },
    { type: 'custom_tool_call_output', call_id: 'call-2', output: 'done' },
  ]);
  const body = JSON.parse(adapted.body) as {
    messages: Array<Record<string, unknown>>;
    tools: Array<{ function: { name: string; parameters: unknown } }>;
    stream_options: unknown;
  };
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.deepEqual(
    body.tools.map((tool) => tool.function.name),
    ['shell_command', 'apply_patch']
  );
  assert.equal(body.messages[0]?.role, 'system');
  const toolCalls = body.messages[2]?.tool_calls;
  assert(Array.isArray(toolCalls));
  assert.equal(toolCalls.length, 2);
  assert.deepEqual(
    body.messages.slice(3).map(({ role, tool_call_id }) => [role, tool_call_id]),
    [
      ['tool', 'call-1'],
      ['tool', 'call-2'],
    ]
  );
});

test('rejects unsupported tools and orphan outputs before contacting a provider', () => {
  assert.throws(
    () =>
      request(
        [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
        [{ type: 'web_search' }]
      ),
    /tool|Unsupported/
  );
  assert.throws(() => request([{ type: 'function_call_output', call_id: 'missing', output: 'no' }]), /Orphan/);
});

test('rejects duplicate function and custom tool outputs', () => {
  for (const [call, output] of [
    [
      { type: 'function_call', call_id: 'call-duplicate', name: 'shell_command', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call-duplicate', output: 'done' },
    ],
    [
      { type: 'custom_tool_call', call_id: 'call-duplicate', name: 'apply_patch', input: 'patch' },
      { type: 'custom_tool_call_output', call_id: 'call-duplicate', output: 'done' },
    ],
  ] as const) {
    assert.throws(() => request([call, output, output]), /Orphan/);
  }
  assert.throws(
    () => request([{ type: 'function_call', call_id: 'call-without-output', name: 'shell_command', arguments: '{}' }]),
    /Missing tool output/
  );
});

test('validates current Codex request controls instead of silently forwarding them', () => {
  assert.doesNotThrow(() =>
    responsesToChatCompletionsRequest(
      {
        model: 'deepseek',
        input: [
          {
            type: 'reasoning',
            id: 'rs-1',
            summary: [{ type: 'summary_text', text: 'Earlier work' }],
            content: null,
            encrypted_content: 'opaque',
          },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue.' }] },
        ],
        reasoning: { effort: 'high', summary: 'auto', context: 'current_turn' },
        include: ['reasoning.encrypted_content'],
        client_metadata: {
          'x-codex-installation-id': 'installation-1',
          session_id: 'session-1',
          'x-codex-turn-metadata': '{"request_kind":"turn"}',
        },
        prompt_cache_key: 'session-1',
        max_output_tokens: 32,
        service_tier: 'fast',
        store: false,
        stream: true,
      },
      'provider-model',
      4096,
      false
    )
  );
  const bounded = responsesToChatCompletionsRequest(
    {
      model: 'deepseek',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
      max_output_tokens: 32,
      store: false,
      stream: true,
    },
    'provider-model',
    4096,
    false
  );
  assert.equal((JSON.parse(bounded.body) as { max_tokens: number }).max_tokens, 32);
  assert.throws(
    () =>
      responsesToChatCompletionsRequest(
        {
          model: 'deepseek',
          input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
          max_output_tokens: 0,
          store: false,
          stream: true,
        },
        'provider-model',
        4096,
        false
      ),
    /maximum output tokens/
  );
  assert.throws(
    () =>
      responsesToChatCompletionsRequest(
        {
          model: 'deepseek',
          input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
          reasoning: { effort: 'high', hidden: true },
          store: false,
          stream: true,
        },
        'provider-model',
        4096,
        false
      ),
    /reasoning controls/
  );
  assert.throws(
    () =>
      responsesToChatCompletionsRequest(
        {
          model: 'deepseek',
          input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
          stream_options: { reasoning_summary_delivery: 'sequential_cutoff' },
          store: false,
          stream: true,
        },
        'provider-model',
        4096,
        false
      ),
    /Unsupported stream options/
  );
});

test('maps Codex text controls exactly and rejects unknown controls', () => {
  const adapted = responsesToChatCompletionsRequest(
    {
      model: 'deepseek',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Return JSON.' }] }],
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'answer',
          strict: true,
          schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
        },
      },
      store: false,
      stream: true,
    },
    'provider-model',
    4096,
    false
  );
  const body = JSON.parse(adapted.body) as Record<string, unknown>;
  assert.deepEqual(body.response_format, {
    type: 'json_schema',
    json_schema: {
      name: 'answer',
      strict: true,
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    },
  });
  assert.equal('verbosity' in body, false);
  assert.throws(
    () =>
      responsesToChatCompletionsRequest(
        {
          model: 'deepseek',
          input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
          text: { verbosity: 'low', unknown: true },
          store: false,
          stream: true,
        },
        'provider-model',
        4096,
        false
      ),
    /text controls/
  );
});

test('maps supported image detail and rejects Responses-only original detail', () => {
  const adapted = responsesToChatCompletionsRequest(
    {
      model: 'gemini',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_image', image_url: 'https://example.test/image.png', detail: 'high' }],
        },
      ],
      store: false,
      stream: true,
    },
    'provider-model',
    4096,
    true
  );
  const body = JSON.parse(adapted.body) as { messages: Array<{ content: unknown }> };
  assert.deepEqual(body.messages[0]?.content, [
    {
      type: 'image_url',
      image_url: { url: 'https://example.test/image.png', detail: 'high' },
    },
  ]);
  assert.throws(
    () =>
      responsesToChatCompletionsRequest(
        {
          model: 'gemini',
          input: [
            {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_image', image_url: 'https://example.test/image.png', detail: 'original' }],
            },
          ],
          store: false,
          stream: true,
        },
        'provider-model',
        4096,
        true
      ),
    /image detail/
  );
});

test('streams text in Codex order and emits terminal usage', async () => {
  const adapted = request([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }]);
  const response = chatCompletionsToResponsesStream(
    chatSse([
      {
        id: 'provider-1',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { role: 'assistant', content: '你' }, finish_reason: null }],
        usage: null,
      },
      {
        id: 'provider-1',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: '好' }, finish_reason: 'stop' }],
        usage: null,
      },
      {
        id: 'provider-1',
        object: 'chat.completion.chunk',
        choices: [],
        usage: {
          prompt_tokens: 8,
          completion_tokens: 2,
          total_tokens: 10,
          prompt_tokens_details: { cached_tokens: 3 },
        },
      },
    ]),
    { responseId: 'chat-invocation-1', tools: adapted.tools }
  );
  const stream = await response.text();
  const added = stream.indexOf('response.output_item.added');
  const delta = stream.indexOf('response.output_text.delta');
  const itemDone = stream.indexOf('response.output_item.done');
  const completed = stream.indexOf('response.completed');
  assert(added >= 0 && added < delta && delta < itemDone && itemDone < completed);
  assert.match(stream, /"text":"你好"/);
  assert.match(stream, /"cached_tokens":3/);
});

test('restores parallel function and custom tool calls from Chat chunks', async () => {
  const adapted = request([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Work' }] }]);
  const response = chatCompletionsToResponsesStream(
    chatSse([
      {
        id: 'provider-tools',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call-shell',
                  type: 'function',
                  function: { name: 'shell_command', arguments: '{"command":' },
                },
                {
                  index: 1,
                  id: 'call-patch',
                  type: 'function',
                  function: { name: 'apply_patch', arguments: '{"input":"*** Begin' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
        usage: null,
      },
      {
        id: 'provider-tools',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '"}' } },
                { index: 1, function: { arguments: ' Patch"}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: null,
      },
      {
        id: 'provider-tools',
        choices: [],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      },
    ]),
    { responseId: 'chat-invocation-tools', tools: adapted.tools }
  );
  const stream = await response.text();
  assert.match(stream, /"type":"function_call"/);
  assert.match(stream, /"type":"custom_tool_call"/);
  assert.match(stream, /"input":"\*\*\* Begin Patch"/);
  assert.match(stream, /"end_turn":false/);
});

test('fails closed when terminal usage is absent or raw reasoning accompanies tools', async () => {
  const adapted = request([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Work' }] }]);
  const noUsage = chatCompletionsToResponsesStream(
    chatSse([
      {
        id: 'provider-no-usage',
        choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: 'stop' }],
      },
    ]),
    { responseId: 'chat-no-usage', tools: adapted.tools }
  );
  await assert.rejects(noUsage.text(), /Incomplete chat completion stream/);

  const noDone = chatCompletionsToResponsesStream(
    new Response(
      'data: {"id":"provider-no-done","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
      { headers: { 'content-type': 'text/event-stream' } }
    ),
    { responseId: 'chat-no-done', tools: adapted.tools }
  );
  await assert.rejects(noDone.text(), /Incomplete chat completion stream/);

  const reasoningTool = chatCompletionsToResponsesStream(
    chatSse([
      {
        id: 'provider-reasoning-tool',
        choices: [
          {
            index: 0,
            delta: {
              reasoning_content: 'private reasoning',
              tool_calls: [
                {
                  index: 0,
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'shell_command', arguments: '{}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    ]),
    { responseId: 'chat-reasoning-tool', tools: adapted.tools }
  );
  await assert.rejects(reasoningTool.text(), /Reasoning tool calls are unsupported/);
});
