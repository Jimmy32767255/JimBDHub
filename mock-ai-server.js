// Mock OpenAI 兼容服务器：用于本地测试 AI 总结的提示词与数据格式
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8900;
const LOG_FILE = path.join(__dirname, 'mock-ai-last-request.json');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url.startsWith('/v1/models') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: [
        { id: 'test-clinical-model', object: 'model', owned_by: 'mock' },
        { id: 'gpt-4o-mini', object: 'model', owned_by: 'mock' }
      ]
    }));
    return;
  }

  if (req.url.startsWith('/v1/chat/completions') && req.method === 'POST') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      // 保存完整请求用于检查提示词效果
      fs.writeFileSync(LOG_FILE, JSON.stringify(parsed, null, 2));
      console.log('[mock] chat/completions received. messages=' + (parsed.messages || []).length +
        ' stream=' + !!parsed.stream +
        ' systemPromptLen=' + ((parsed.messages || [])[0]?.content || '').length +
        ' userDataLen=' + ((parsed.messages || [])[1]?.content || '').length);
      const content = [
        '# 测试总结（Mock 回复）',
        '',
        '## 覆盖范围',
        '本总结覆盖用户自述的时间段内的情绪、服药、睡眠与事件记录。',
        '',
        '## 数据概览',
        '- 情绪记录：多条，数值在 -5 ~ +6 之间波动；',
        '- 睡眠记录：多数夜间觉醒 0~3 次，质量评分 1~4/5；',
        '- 服药记录：碳酸锂、拉莫三嗪、喹硫平，存在漏服补记；',
        '- 事件记录：包含复诊、人际冲突、消极念头、主动求助等。',
        '',
        '## 观察要点（模拟）',
        '1. 记录显示：中间时段以低落情绪为主，伴随早醒与睡眠质量下降（单次记录，需进一步确认趋势）；',
        '2. 记录出现"有过消极念头"线索，属于需要临床人员优先核实的安全相关信息；',
        '3. 后期情绪回升，出现精力增加、睡眠需求减少的记录，需关注是否与高涨相关；',
        '4. 存在漏服记录（晚上忘记吃了），用药依从性可进一步确认。',
        '',
        '> 提示：以上为 Mock 回复，仅用于验证请求格式与提示词注入是否正确。',
        '',
        '## 待临床确认的问题',
        '- 消极念头出现频率与是否有具体计划；',
        '- 睡眠减少与精力增加的持续时间；',
        '- 漏服的具体原因。'
      ].join('\n');

      if (parsed.stream) {
        // SSE 流式响应：逐块发送（带小延迟以便观察流式效果）
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });
        // 截断模拟：模型为 test-truncate-model 且非续写请求（无 assistant 历史）时，只输出一半并以 finish_reason:length 结束
        const isTruncateModel = parsed.model === 'test-truncate-model';
        const isContinueRequest = (parsed.messages || []).some(m => m.role === 'user' && /继续|continue/i.test(m.content || ''));
        const truncate = isTruncateModel && !isContinueRequest;
        const sendContent = truncate
          ? content.slice(0, Math.floor(content.length / 2))
          : (isTruncateModel ? content.slice(Math.floor(content.length / 2)) : content);
        const chunkSize = 40;
        const sendChunk = (i) => {
          if (i >= sendContent.length) {
            const finish = truncate ? 'length' : 'stop';
            res.write(`data: ${JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: parsed.model || 'test-clinical-model', choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          const chunk = sendContent.slice(i, i + chunkSize);
          res.write(`data: ${JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: parsed.model || 'test-clinical-model', choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] })}\n\n`);
          setTimeout(() => sendChunk(i + chunkSize), 40);
        };
        sendChunk(0);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: parsed.model || 'test-clinical-model',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2000, completion_tokens: 300, total_tokens: 2300 }
        }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not found: ' + req.url } }));
});

server.listen(PORT, () => {
  console.log(`Mock AI server listening on http://localhost:${PORT}/v1`);
});
