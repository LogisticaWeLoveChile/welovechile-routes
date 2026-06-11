// Vercel Serverless Function - Routes API (computeRoutes)
// Aceita horário de partida (departureTime) para usar trânsito histórico daquele horário.
// v7.1: repassa o status real do Google (400 ≠ 500) pra o cliente não fazer
// retry de pedido inválido; valida limite de 25 intermediários; guarda de origem.

import { origemPermitida, aplicarCors } from "./_guard.js";

export default async function handler(req, res) {
  aplicarCors(req, res, "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!origemPermitida(req)) return res.status(403).json({ error: "Origem não autorizada" });

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GOOGLE_MAPS_API_KEY não configurada" });

  const { points, optimize, departureTime } = req.body || {};

  if (!points || points.length < 2) {
    return res.status(400).json({ error: "Mínimo 2 pontos" });
  }
  // Limite da Routes API: 25 intermediários (27 pontos no total).
  // O frontend divide em pedaços antes de chamar; isto é a rede de segurança.
  if (points.length > 27) {
    return res.status(400).json({ error: "Máximo 27 pontos por chamada (25 intermediários). Divida a rota." });
  }

  const origin = points[0];
  const destination = points[points.length - 1];
  const intermediates = points.slice(1, -1);

  // Monta timestamp do horário de partida.
  // Se o horário já passou hoje, usa amanhã (senão Google recusa).
  let departureTimestamp = null;
  if (departureTime && /^\d{2}:\d{2}$/.test(departureTime)) {
    const [hh, mm] = departureTime.split(":").map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(hh, mm, 0, 0);
    if (target.getTime() <= now.getTime() + 60 * 1000) {
      target.setDate(target.getDate() + 1);
    }
    departureTimestamp = target.toISOString();
  }

  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
    travelMode: "DRIVE",
    // TRAFFIC_AWARE suporta otimização de waypoints. TRAFFIC_AWARE_OPTIMAL não.
    routingPreference: "TRAFFIC_AWARE",
    optimizeWaypointOrder: !!optimize,
    languageCode: "es-CL",
    units: "METRIC"
  };

  if (departureTimestamp) body.departureTime = departureTimestamp;

  if (intermediates.length > 0) {
    body.intermediates = intermediates.map(p => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } }
    }));
  }

  try {
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.legs.duration,routes.legs.distanceMeters,routes.optimizedIntermediateWaypointIndex"
      },
      body: JSON.stringify(body)
    });

    const data = await r.json();

    if (!r.ok || !data.routes?.length) {
      // Repassa o status do Google: 400/403/429 chegam como tal no cliente,
      // que só faz retry quando faz sentido (5xx e 429).
      const status = r.ok ? 502 : (r.status >= 400 && r.status < 600 ? r.status : 502);
      const msg = data?.error?.message || "Routes API erro";
      console.error("ROUTES_FAIL", { http: r.status, msg, n_points: points.length, optimize: !!optimize });
      return res.status(status).json({ error: msg, details: data });
    }

    const route = data.routes[0];
    const legs = (route.legs || []).map(leg => ({
      durationSec: parseInt((leg.duration || "0s").replace("s", ""), 10),
      distanceMeters: leg.distanceMeters || 0
    }));

    return res.status(200).json({
      optimizedOrder: route.optimizedIntermediateWaypointIndex || [],
      totalDurationSec: parseInt((route.duration || "0s").replace("s", ""), 10),
      totalDistanceMeters: route.distanceMeters || 0,
      legs: legs
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
