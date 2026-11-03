import { setStatus } from '../lib/status.js';

// PUT /api/status  { id, status: 'yes' | 'no' | null, place: { name, address, lat, lng } }
export async function PUT(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }
  const { id, status, place = {} } = body;
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id)) return Response.json({ error: '잘못된 식당 ID입니다.' }, { status: 400 });
  if (![null, 'yes', 'no'].includes(status)) return Response.json({ error: 'status는 yes, no, null 중 하나여야 합니다.' }, { status: 400 });
  const clean = {
    name: typeof place.name === 'string' ? place.name.slice(0, 200) : null,
    address: typeof place.address === 'string' ? place.address.slice(0, 300) : null,
    lat: Number.isFinite(place.lat) ? place.lat : null,
    lng: Number.isFinite(place.lng) ? place.lng : null,
  };
  const rawClient = request.headers.get('x-client-id') || '';
  const who = {
    clientId: /^[\w-]{8,64}$/.test(rawClient) ? rawClient : null,
    // Vercel은 x-forwarded-for의 첫 값이 실제 접속 IP
    ip: (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null,
  };
  try {
    await setStatus(id, status, clean, who);
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message }, { status: 500 });
  }
  return Response.json({ id, status });
}
