module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Anthropic API key not configured' });

  const prompt = `You are helping a business consultant extract a learning from a document or article.

Read this content and extract the single most valuable insight for someone working in AI adoption consulting in Latin America.

Return ONLY a valid JSON object — no markdown, no backticks:
{
  "what": "The single most important insight. Be specific and concrete, not generic. 2-3 sentences max.",
  "why": "One sentence on why this matters specifically for an AI consulting team working with Latin American companies."
}`;

  try {
    const isPdf = await detectPdf(url);

    if (isPdf) {
      // Fetch PDF as binary
      const pdfRes = await fetch(url);
      if (!pdfRes.ok) throw new Error(`Could not download PDF (${pdfRes.status})`);

      // Reject if over 20MB to avoid timeouts
      const contentLength = pdfRes.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 20 * 1024 * 1024) {
        throw new Error('PDF is too large (max 20MB). Try a smaller file.');
      }

      const buffer = await pdfRes.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');

      // Send to Claude as a native document — Claude reads PDFs natively, no parsing library needed
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'document',
                source: { type: 'base64', media_type: 'application/pdf', data: base64 },
              },
              { type: 'text', text: prompt },
            ],
          }],
        }),
      });

      const claudeData = await claudeRes.json();
      if (!claudeRes.ok) throw new Error(claudeData?.error?.message || 'Claude API error');
      return res.status(200).json(parseClaudeResponse(claudeData));

    } else {
      // Use Jina Reader for web articles
      const jinaUrl = `https://r.jina.ai/${url}`;
      const articleRes = await fetch(jinaUrl, {
        headers: { 'Accept': 'text/plain', 'X-Return-Format': 'text' },
      });
      if (!articleRes.ok) throw new Error(`Could not fetch article (${articleRes.status})`);
      const articleText = await articleRes.text();
      if (!articleText || articleText.length < 100) throw new Error('Article content is too short or empty');

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `${prompt}\n\nArticle content:\n${articleText.slice(0, 9000)}`,
          }],
        }),
      });

      const claudeData = await claudeRes.json();
      if (!claudeRes.ok) throw new Error(claudeData?.error?.message || 'Claude API error');
      return res.status(200).json(parseClaudeResponse(claudeData));
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

async function detectPdf(url) {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('.pdf') || urlLower.includes('export=download')) return true;
  try {
    const headRes = await fetch(url, { method: 'HEAD' });
    const ct = headRes.headers.get('content-type') || '';
    return ct.includes('application/pdf');
  } catch {
    return false;
  }
}

function parseClaudeResponse(data) {
  const raw = data.content?.map(b => b.text || '').join('') || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse Claude response');
  const parsed = JSON.parse(match[0]);
  return { what: parsed.what || '', why: parsed.why || '' };
}
