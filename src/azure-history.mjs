export async function withAzureClient(connectionString, action) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search) {
    throw new Error('Usa una URL PostgreSQL sin parámetros de conexión.');
  }
  const {Client} = (await import('pg')).default;
  const client = new Client({
    connectionString,
    ssl: {rejectUnauthorized: true},
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000
  });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

export async function fetchAzureCuts(connectionString) {
  return withAzureClient(connectionString, async client => {
    const {rows} = await client.query('SELECT payload FROM public.electoral_cuts WHERE published ORDER BY id');
    return rows.map(row => row.payload);
  });
}

export async function publishAzureCuts(connectionString, cuts) {
  return withAzureClient(connectionString, async client => {
    const rows = cuts.map(cut => ({id: cut.id, payload: cut}));
    await client.query(`
      INSERT INTO public.electoral_cuts (id, payload, published)
      SELECT id, payload, true FROM jsonb_to_recordset($1::jsonb) AS incoming(id text, payload jsonb)
      ON CONFLICT (id) DO NOTHING
    `, [JSON.stringify(rows)]);
  });
}
