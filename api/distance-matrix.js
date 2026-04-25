// Vercel Serverless Function - Distance Matrix API
// Recebe lista de pontos {lat, lng}, retorna matriz N×N de km e tempo reais por estrada.
// Usa Google Distance Matrix API (legacy, estável, barata).

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GOOGLE_MAPS_API_KEY não configurada" });

  // Aceita 2 modos:
  // 1) "all" — passa array `points` e retorna matriz NxN entre todos
  // 2) "pairs" — passa array `pairs: [[origem, destino], ...]` e retorna apenas esses pares
  const { points, pairs, departureTime } = req.body || {};

  // Calcula timestamp de partida (mesmo padrão do routes.js)
  let departureParam = "";
  if (departureTime && /^\d{2}:\d{2}$/.test(departureTime)) {
    const [hh, mm] = departureTime.split(":").map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(hh, mm, 0, 0);
    if (target.getTime() <= now.getTime() + 60 * 1000) target.setDate(target.getDate() + 1);
    const sec = Math.floor(target.getTime() / 1000);
    departureParam = `&departure_time=${sec}&traffic_model=best_guess`;
  } else {
    departureParam = "&departure_time=now";
  }

  // Função pra fazer 1 chamada com origins e destinations
  async function callMatrix(origins, destinations) {
    const orig = origins.map(p => `${p.lat},${p.lng}`).join("|");
    const dest = destinations.map(p => `${p.lat},${p.lng}`).join("|");
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(orig)}&destinations=${encodeURIComponent(dest)}&mode=driving${departureParam}&language=es-CL&key=${apiKey}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.status !== "OK") throw new Error("Distance Matrix erro: " + data.status + " " + (data.error_message || ""));
    return data;
  }

  try {
    if (pairs && Array.isArray(pairs) && pairs.length > 0) {
      // Modo pairs: agrupa por origem pra economizar elementos
      // Cada chamada API limita 25×25=625 elementos. Vamos fazer em lotes seguros de 10×10.
      const result = {};
      const grouped = {};
      pairs.forEach(([o, d]) => {
        const okey = `${o.lat},${o.lng}`;
        if (!grouped[okey]) grouped[okey] = { origem: o, destinos: [] };
        grouped[okey].destinos.push(d);
      });

      const groupKeys = Object.keys(grouped);
      // Agrupa origens em lotes (max 10 origens × 10 destinos por chamada)
      const ORIG_BATCH = 10;
      const DEST_BATCH = 10;

      for (let gi = 0; gi < groupKeys.length; gi += ORIG_BATCH) {
        const origensLote = groupKeys.slice(gi, gi + ORIG_BATCH).map(k => grouped[k].origem);
        // Coleta todos os destinos únicos desse lote
        const destinosUnicos = {};
        groupKeys.slice(gi, gi + ORIG_BATCH).forEach(k => {
          grouped[k].destinos.forEach(d => {
            destinosUnicos[`${d.lat},${d.lng}`] = d;
          });
        });
        const destinosArr = Object.values(destinosUnicos);

        for (let dj = 0; dj < destinosArr.length; dj += DEST_BATCH) {
          const destLote = destinosArr.slice(dj, dj + DEST_BATCH);
          const data = await callMatrix(origensLote, destLote);
          // Itera resposta
          data.rows.forEach((row, oi) => {
            row.elements.forEach((el, di) => {
              if (el.status === "OK") {
                const o = origensLote[oi];
                const d = destLote[di];
                const key = `${o.lat},${o.lng}|${d.lat},${d.lng}`;
                result[key] = {
                  distanceMeters: el.distance.value,
                  durationSec: (el.duration_in_traffic || el.duration).value
                };
              }
            });
          });
        }
      }
      return res.status(200).json({ pairs: result });
    }

    // Modo all (matriz NxN)
    if (!points || !Array.isArray(points) || points.length < 2) {
      return res.status(400).json({ error: "Forneça points (>=2) ou pairs" });
    }

    // Matriz NxN. Faz lotes 10x10 pra não estourar limite Google
    const n = points.length;
    const matrix = Array.from({ length: n }, () => new Array(n).fill(null));
    for (let i = 0; i < n; i++) matrix[i][i] = { distanceMeters: 0, durationSec: 0 };

    const BATCH = 10;
    for (let oi = 0; oi < n; oi += BATCH) {
      for (let di = 0; di < n; di += BATCH) {
        const oLote = points.slice(oi, oi + BATCH);
        const dLote = points.slice(di, di + BATCH);
        const data = await callMatrix(oLote, dLote);
        data.rows.forEach((row, ri) => {
          row.elements.forEach((el, ci) => {
            if (el.status === "OK") {
              matrix[oi + ri][di + ci] = {
                distanceMeters: el.distance.value,
                durationSec: (el.duration_in_traffic || el.duration).value
              };
            }
          });
        });
      }
    }
    return res.status(200).json({ matrix });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
