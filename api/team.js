const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const DEFAULT_TEAM = [
  { name: 'Alan', role: 'Partner' },
  { name: 'Partner 2', role: 'Partner' },
  { name: 'Partner 3', role: 'Partner' },
  { name: 'Partner 4', role: 'Partner' },
  { name: 'Analyst 1', role: 'Analyst' },
  { name: 'Analyst 2', role: 'Analyst' },
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('team_config')
      .select('*')
      .order('id', { ascending: false })
      .limit(1);
    if (error) return res.status(500).json({ error: error.message });
    const members = data?.[0]?.members ?? DEFAULT_TEAM;
    return res.status(200).json(members);
  }

  if (req.method === 'POST') {
    const members = req.body;
    // Replace the single config row
    await supabase.from('team_config').delete().neq('id', 0);
    const { error } = await supabase.from('team_config').insert([{ members }]);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
