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

  try {
    // Jina Reader converts any URL to clean readable text — free, no key needed
    const jinaUrl = `https://r.jina.ai/${url}`;
    const articleRes = await fetch(jinaUrl, {
      headers: { 'Accept': 'text/plain', 'X-Return-Format': 'text' }
    });
    if (!articleRes.ok) throw new Error(`Could not fetch article (${articleRes.status})`);
    const articleText = await articleRes.text();
    if (!articleText || articleText.length < 100) throw new Error('Article content is too short or empty');

    // Truncate to keep the prompt manageable
    const truncated = articleText.slice(0, 9000);

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
          content: `You are helping a business consultant extract a learning from an article.

Read this article and extract the single most valuable insight for someone working in AI adoption consulting in Latin America.

Article content:
${truncated}

Return ONLY a valid JSON object — no markdown, no backticks:
{
  "what": "The single most important insight from this article. Be specific and concrete, not generic. 2-3 sentences max.",
  "why": "One sentence on why this matters specifically for an AI consulting team working with Latin American companies."
}`,
        }],
      }),
    });

    const claudeData = await claudeRes.json();
    if (!claudeRes.ok) throw new Error(claudeData?.error?.message || 'Claude API error');

    const raw = claudeData.content?.map(b => b.text || '').join('') || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse Claude response');
    const parsed = JSON.parse(match[0]);

    return res.status(200).json({ what: parsed.what || '', why: parsed.why || '' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
