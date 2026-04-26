// Vercel Serverless Function - Distance Matrix via Routes API (moderna)
// Usa o endpoint computeRouteMatrix da Routes API (mesma API do routes.js).
// Substitui a Distance Matrix legacy que está sendo descontinuada pelo Google.

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
  let departureTimestamp = null;
  if (departureTime && /^\d{2}:\d{2}$/.test(departureTime)) {
    const [hh, mm] = departureTime.split(":").map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(hh, mm, 0, 0);
    if (target.getTime() <= now.getTime() + 60 * 1000) target.setDate(target.getDate() + 1);
    departureTimestamp = target.toISOString();
  }

  // Função pra chamar computeRouteMatrix da Routes API (NÃO a legacy)
  // Recebe origens e destinos, retorna array com {originIndex, destinationIndex, distanceMeters, duration}
  async function callRouteMatrix(origins, destinations) {
    const body = {
      origins: origins.map(p => ({
        waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } }
      })),
      destinations: destinations.map(p => ({
        waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } }
      })),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE"
    };
    if (departureTimestamp) body.departureTime = departureTimestamp;

    const r = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,distanceMeters,duration,condition"
      },
      body: JSON.stringify(body)
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("ROUTE_MATRIX_FAIL", {
        http: r.status,
        body: errText.slice(0, 500),
        n_origins: origins.length,
        n_destinations: destinations.length
      });
      throw new Error("Routes API HTTP " + r.status + ": " + errText.slice(0, 200));
    }

    return await r.json();
  }

  try {
    if (pairs && Array.isArray(pairs) && pairs.length > 0) {
      // Modo pairs: agrupa por origem, faz lotes seguros (Routes API permite até 625 elementos = 25x25)
      const result = {};
      const grouped = {};
      pairs.forEach(([o, d]) => {
        const okey = `${o.lat},${o.lng}`;
        if (!grouped[okey]) grouped[okey] = { origem: o, destinos: [] };
        grouped[okey].destinos.push(d);
      });

      const groupKeys = Object.keys(grouped);
      const ORIG_BATCH = 10;
      const DEST_BATCH = 10;

      for (let gi = 0; gi < groupKeys.length; gi += ORIG_BATCH) {
        const origensLote = groupKeys.slice(gi, gi + ORIG_BATCH).map(k => grouped[k].origem);
        const destinosUnicos = {};
        groupKeys.slice(gi, gi + ORIG_BATCH).forEach(k => {
          grouped[k].destinos.forEach(d => {
            destinosUnicos[`${d.lat},${d.lng}`] = d;
          });
        });
        const destinosArr = Object.values(destinosUnicos);

        for (let dj = 0; dj < destinosArr.length; dj += DEST_BATCH) {
          const destLote = destinosArr.slice(dj, dj + DEST_BATCH);
          const data = await callRouteMatrix(origensLote, destLote);
          // Routes API retorna ARRAY de elementos (não rows como legacy)
          if (Array.isArray(data)) {
            data.forEach(el => {
              if (el.condition === "ROUTE_EXISTS" || (typeof el.distanceMeters === "number" && el.distanceMeters > 0)) {
                const o = origensLote[el.originIndex];
                const d = destLote[el.destinationIndex];
                if (o && d) {
                  const durSec = el.duration ? parseInt(String(el.duration).replace("s", ""), 10) : 0;
                  const key = `${o.lat},${o.lng}|${d.lat},${d.lng}`;
                  result[key] = {
                    distanceMeters: el.distanceMeters || 0,
                    durationSec: durSec
                  };
                }
              }
            });
          }
        }
      }
      return res.status(200).json({ pairs: result });
    }

    // Modo all (matriz NxN)
    if (!points || !Array.isArray(points) || points.length < 2) {
      return res.status(400).json({ error: "Forneça points (>=2) ou pairs" });
    }

    const n = points.length;
    const matrix = Array.from({ length: n }, () => new Array(n).fill(null));
    for (let i = 0; i < n; i++) matrix[i][i] = { distanceMeters: 0, durationSec: 0 };

    const BATCH = 10;
    for (let oi = 0; oi < n; oi += BATCH) {
      for (let di = 0; di < n; di += BATCH) {
        const oLote = points.slice(oi, oi + BATCH);
        const dLote = points.slice(di, di + BATCH);
        const data = await callRouteMatrix(oLote, dLote);
        if (Array.isArray(data)) {
          data.forEach(el => {
            if (el.condition === "ROUTE_EXISTS" || (typeof el.distanceMeters === "number" && el.distanceMeters > 0)) {
              const durSec = el.duration ? parseInt(String(el.duration).replace("s", ""), 10) : 0;
              matrix[oi + el.originIndex][di + el.destinationIndex] = {
                distanceMeters: el.distanceMeters || 0,
                durationSec: durSec
              };
            }
          });
        }
      }
    }
    return res.status(200).json({ matrix });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
