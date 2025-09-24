
import OpenAI from 'openai';
import { sequelize } from '../sql/db.js';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const EMB_MODEL = 'text-embedding-3-small'; // 1536 dims

export function simpleChunk(text, maxLen=800){
  const lines = text.split(/\n+/);
  const chunks = [];
  let buf = '';
  for(const ln of lines){
    if((buf + '\n' + ln).length > maxLen){
      if(buf.trim()) chunks.push(buf.trim());
      buf = ln;
    } else {
      buf = buf ? (buf + '\n' + ln) : ln;
    }
  }
  if(buf.trim()) chunks.push(buf.trim());
  return chunks;
}

export async function embedTexts(texts){
  const resp = await client.embeddings.create({
    model: EMB_MODEL,
    input: texts
  });
  return resp.data.map(e => e.embedding);
}

export async function upsertDocument({ title, tags=[], text }){
  const t = await sequelize.transaction();
  try {
    const [doc] = await sequelize.query(
      `INSERT INTO rag.documents(title, tags) VALUES ($1, $2) RETURNING id`,
      { bind:[title, tags], type: sequelize.QueryTypes.INSERT, transaction: t }
    );
    const docId = doc[0]?.id || doc?.id || doc;
    const chunks = simpleChunk(text);
    const embs = await embedTexts(chunks);
    for(let i=0;i<chunks.length;i++){
      await sequelize.query(
        `INSERT INTO rag.chunks(document_id, chunk_index, text, embedding) VALUES ($1,$2,$3,$4)`,
        { bind:[docId, i, chunks[i], embs[i]], type: sequelize.QueryTypes.INSERT, transaction: t }
      );
    }
    await t.commit();
    return { id: docId, chunks: chunks.length };
  } catch(e){
    await t.rollback();
    throw e;
  }
}

export async function deleteDocument(id){
  await sequelize.query(`DELETE FROM rag.documents WHERE id=$1`, { bind:[id] });
}

export async function listDocuments(){
  const [rows] = await sequelize.query(`
    SELECT d.id, d.title, d.tags, d.created_at, COUNT(c.id) as chunks
    FROM rag.documents d
    LEFT JOIN rag.chunks c ON c.document_id = d.id
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `);
  return rows;
}

export async function searchRag(query, k=6){
  const [emb] = await embedTexts([query]);
  const [rows] = await sequelize.query(
    `SELECT text, (embedding <#> $1::vector) AS distance
     FROM rag.chunks
     ORDER BY embedding <#> $1::vector ASC
     LIMIT $2`,
    { bind:[emb, k] }
  );
  return rows.map(r => ({ text: r.text, score: 1 - Number(r.distance) }));
}
