// api/slip.js
// Serverless function บน Vercel (ไม่เก็บข้อมูล / ไม่เช็คซ้ำ)
// ทำหน้าที่รับ { img } แล้วส่งต่อไปปลายทางตรวจสลิป จากนั้นส่งผลลัพธ์กลับ

const REMOTE_API = process.env.REMOTE_API || 'https://slip-c.oiioioiiioooioio.download/api/slip';

// อ่าน JSON body จาก req (Node serverless)
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

module.exports = async (req, res) => {
  // CORS Preflight (ถ้าต้อง cross-origin)
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

    // ส่งต่อไปยังระบบตรวจสลิป
    const upstream = await fetch(REMOTE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ img }),
    });

    const text = await upstream.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}

    if (!upstream.ok || !parsed || typeof parsed !== 'object') {
      res.status(502).json({ message: 'รูปแบบผลลัพธ์จากระบบตรวจสอบไม่ถูกต้อง', raw: text });
      return;
    }

    // ส่งผลลัพธ์กลับไปแบบตรง ๆ (ไม่มีฟิลด์ duplicate/first_seen_at/stored_at)
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ message: 'เกิดข้อผิดพลาด', error: String(err?.message || err) });
  }
};
