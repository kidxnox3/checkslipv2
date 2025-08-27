// api/slip.js
// Serverless function บน Vercel (แทน slip.php)

const REMOTE_API = process.env.REMOTE_API || 'https://slip-c.oiioioiiioooioio.download/api/slip';

let kv, put;
(async () => {
  // โหลด SDK แบบไดนามิก เผื่อรันในสภาพแวดล้อมที่ยังไม่ได้ลง dependency
  ({ kv } = await import('@vercel/kv'));
  ({ put } = await import('@vercel/blob'));
})();

/** อ่าน body (JSON) จาก req */
function readJson(req) {
  return new Promise((resolve, reject) => {
    try {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); }
        catch { resolve({}); }
      });
      req.on('error', reject);
    } catch (e) { reject(e); }
  });
}

/** แปลง dataURL -> Buffer และคืน mimetype/นามสกุล */
function dataUrlToBuffer(dataUrl) {
  const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(dataUrl || '');
  const mime = m?.[1] || 'image/jpeg';
  const b64 = m?.[2] || dataUrl;
  const buf = Buffer.from(b64, 'base64');
  const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  return { buf, mime, ext };
}

function makeKey(d) {
  const ref = d?.ref || '';
  if (ref) return ref;
  const mix = `${d?.amount || ''}|${d?.date || ''}|${d?.sender_name || ''}|${d?.receiver_name || ''}`;
  return 'no-ref:' + require('crypto').createHash('sha1').update(mix).digest('hex');
}

module.exports = async (req, res) => {
  // CORS (ถ้าเปิดใช้โดเมนอื่นเรียกมายังต้องเปิด; กรณีเดียวกันไม่จำเป็น)
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    const body = await readJson(req);
    const img = body?.img;
    if (!img) {
      res.status(400).json({ message: 'กรุณาส่งรูปภาพในฟิลด์ "img"' });
      return;
    }

    // 1) ส่งไปตรวจสลิปที่ปลายทางเดิม
    const upstream = await fetch(REMOTE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ img }),
    });

    const upstreamText = await upstream.text();
    let parsed;
    try { parsed = JSON.parse(upstreamText); } catch { parsed = null; }
    if (!upstream.ok || !parsed || !parsed.data) {
      res.status(502).json({ message: 'รูปแบบผลลัพธ์จากระบบตรวจสอบไม่ถูกต้อง', raw: upstreamText });
      return;
    }

    const data = parsed.data;
    const key  = makeKey(data);
    const nowIso = new Date().toISOString();

    // 2) ตรวจซ้ำด้วย KV
    const kvKey = `slip:${key}`;
    const existed = await kv.get(kvKey); // คืน object หรือ null
    let duplicate = !!existed;
    let firstSeenAt = existed?.created_at || null;

    // 3) อัปโหลดรูปไป Blob (ครั้งแรกเท่านั้น)
    let storedImage = existed?.stored_image || null;
    if (!duplicate) {
      const { buf, mime, ext } = dataUrlToBuffer(img);
      const filename = `slips/${new Date().toISOString().replace(/[:.]/g,'-')}-${Math.random().toString(36).slice(2,8)}.${ext}`;
      const putRes = await put(filename, buf, { access: 'private', contentType: mime });
      storedImage = putRes?.url || null;

      // เก็บเมตาดาต้าใน KV
      await kv.set(kvKey, {
        key,
        ref: data?.ref || null,
        amount: data?.amount ?? null,
        date: data?.date || null,
        sender_name: data?.sender_name || null,
        receiver_name: data?.receiver_name || null,
        stored_image: storedImage,
        created_at: nowIso,
      });
      firstSeenAt = null; // เพราะเพิ่งสร้าง
    }

    // 4) ตอบกลับตามฟอร์แมตเดิม
    res.status(200).json({
      message: duplicate ? 'Duplicate slip' : (parsed.message || 'Slip processed successfully.'),
      duplicate,
      first_seen_at: firstSeenAt,
      stored_at: nowIso,
      stored_image: storedImage,
      data,
    });
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาด', error: String(err?.message || err) });
  }
};
