import { readFile, writeFile, rename, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { LOG_SALT, SUPABASE_SECRET_KEY, SUPABASE_URL } from './env.js';

// Supabase가 설정돼 있으면 공유 DB, 아니면 로컬 개발용 JSON 파일에 저장한다.
// 같은 식당에 대해서는 항상 마지막에 누른 값이 남는다(upsert).

const TABLE = 'bplpay_status';
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);

function sbHeaders(extra = {}) {
  const h = { apikey: SUPABASE_SECRET_KEY, 'Content-Type': 'application/json', ...extra };
  // 기존 service_role 키(JWT)는 Authorization 헤더도 필요하다. 신규 sb_secret_ 키는 apikey만 쓴다.
  if (SUPABASE_SECRET_KEY.startsWith('eyJ')) h.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;
  return h;
}

async function sb(pathAndQuery, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { ...init, headers: sbHeaders(init.headers) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase 오류 ${res.status}: ${text}`);
  // 저장(return=minimal)은 201에 빈 본문으로 온다
  return text ? JSON.parse(text) : null;
}

// ---------- 로컬 파일 ----------

const FILE = path.join(process.cwd(), 'data', 'bplpay.json');
let fileData = null;
let writing = Promise.resolve();

async function loadFile() {
  if (!fileData) fileData = JSON.parse(await readFile(FILE, 'utf8').catch(() => '{}'));
  return fileData;
}

function saveFile() {
  writing = writing.then(async () => {
    await writeFile(`${FILE}.tmp`, JSON.stringify(fileData, null, 2));
    await rename(`${FILE}.tmp`, FILE);
  });
  return writing;
}

// ---------- 공개 함수 ----------

// bbox: [minLng, minLat, maxLng, maxLat] → { place_id: 'yes' | 'no' }
export async function statusesIn([minLng, minLat, maxLng, maxLat]) {
  if (useSupabase) {
    const q = new URLSearchParams([
      ['select', 'place_id,status'],
      ['lat', `gte.${minLat}`],
      ['lat', `lte.${maxLat}`],
      ['lng', `gte.${minLng}`],
      ['lng', `lte.${maxLng}`],
    ]);
    const rows = await sb(`${TABLE}?${q}`);
    return Object.fromEntries(rows.map((r) => [r.place_id, r.status]));
  }
  const data = await loadFile();
  return Object.fromEntries(Object.entries(data).map(([id, v]) => [id, v.status]));
}

// 로그인 없이 쓰는 대신 변경 기록만 남긴다: 익명 기기 ID + IP 해시(원본 IP는 저장 안 함)
const LOG_FILE = path.join(process.cwd(), 'data', 'bplpay-log.jsonl');

async function writeLog(id, status, place, { clientId, ip }) {
  const row = {
    place_id: id,
    place_name: place.name ?? null,
    status: status ?? 'reset',
    client_id: clientId,
    ip_hash: ip ? createHash('sha256').update(`${LOG_SALT}:${ip}`).digest('hex').slice(0, 16) : null,
  };
  try {
    if (useSupabase) await sb('bplpay_log', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    else if (!process.env.VERCEL) await appendFile(LOG_FILE, `${JSON.stringify({ ...row, created_at: new Date().toISOString() })}\n`);
  } catch (err) {
    // 로그 실패가 상태 저장을 막지는 않는다
    console.error('log error:', err.message);
  }
}

export async function setStatus(id, status, place = {}, who = {}) {
  await saveStatus(id, status, place);
  await writeLog(id, status, place, who);
}

async function saveStatus(id, status, place) {
  if (useSupabase) {
    if (status === null) {
      await sb(`${TABLE}?place_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      return;
    }
    await sb(`${TABLE}?on_conflict=place_id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        place_id: id,
        status,
        name: place.name ?? null,
        address: place.address ?? null,
        lat: place.lat ?? null,
        lng: place.lng ?? null,
        updated_at: new Date().toISOString(),
      }),
    });
    return;
  }
  if (process.env.VERCEL) throw new Error('배포 환경에서는 Supabase 설정(SUPABASE_URL, SUPABASE_SECRET_KEY)이 필요합니다.');
  const data = await loadFile();
  if (status === null) delete data[id];
  else data[id] = { status, ...place, updatedAt: new Date().toISOString() };
  await saveFile();
}
