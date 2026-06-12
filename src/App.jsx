import React, { useState, useMemo, useEffect } from "react";
import { styles } from "./styles.js";

// ============================================================
// WeLoveChile Route Dispatcher v7.3.1 (Setorização + trocas 2↔1 com folga zero)
//
// MUDANÇA vs v7.0:
//  - Cada tour pode ter sentido invertido por padrão (configurável)
//  - Cada geração pode invertir pontualmente (override do padrão)
//  - Padrão dos tours salvo em localStorage
//
// Caso de uso: motoristas de Concha y Toro / Santa Rita moram no oeste,
// não faz sentido começar no leste. Joaquim agora pode marcar tours
// como "sentido invertido por padrão" e/ou inverter pontualmente.
// ============================================================

// Sistema simplificado: pickup só pode ser "leste" (oeste→leste) ou "oeste" (leste→oeste)
// Tours pro norte/nordeste/sudeste mapeiam pra "leste" (saída da cidade pelo lado leste)
// Tours pro sul/sudoeste/noroeste mapeiam pra "oeste" (saída pelo lado oeste/sul)
// PONTO DE SAÍDA: coordenada por onde a van deixa a cidade rumo ao tour.
// A última parada será a MAIS PRÓXIMA da saída; a primeira, a mais distante.
// Coordenadas aproximadas — ajuste fino na aba CONFIGURAÇÃO.
var SAIDAS_PADRAO = {
  leste: { lat: -33.395, lng: -70.510 },  // cordilheira (Las Condes)
  oeste: { lat: -33.450, lng: -70.780 }   // Ruta 68 (Pajaritos)
};

var TOURS_DEFAULT = [
  { nome: "Valle Nevado", horario: "05:00", vetor: "leste", invertido: false, saida: { lat: -33.356, lng: -70.517 } },   // Camino a Farellones
  { nome: "Farellones", horario: "06:00", vetor: "leste", invertido: false, saida: { lat: -33.356, lng: -70.517 } },
  { nome: "El Colorado", horario: "05:00", vetor: "leste", invertido: false, saida: { lat: -33.356, lng: -70.517 } },
  { nome: "Astronómico Santiago", horario: "14:30", vetor: "leste", invertido: false, saida: { lat: -33.396, lng: -70.537 } }, // Cerro Calán
  { nome: "Concha y Toro", horario: "07:00", vetor: "oeste", invertido: false, saida: { lat: -33.605, lng: -70.575 } },  // Puente Alto / Pirque
  { nome: "Cousiño Macul", horario: "12:00", vetor: "leste", invertido: false, saida: { lat: -33.490, lng: -70.558 } },  // Peñalolén
  { nome: "Embalse El Yeso", horario: "05:00", vetor: "leste", invertido: false, saida: { lat: -33.598, lng: -70.527 } }, // Las Vizcachas / Cajón
  { nome: "Isla Negra", horario: "07:30", vetor: "oeste", invertido: false, saida: { lat: -33.450, lng: -70.780 } },     // Ruta 68
  { nome: "Parque Safari", horario: "07:30", vetor: "oeste", invertido: false, saida: { lat: -33.630, lng: -70.700 } },  // Ruta 5 Sur
  { nome: "Portillo", horario: "05:00", vetor: "leste", invertido: false, saida: { lat: -33.330, lng: -70.680 } },       // Ruta 5 Norte → 57
  { nome: "Santa Rita", horario: "08:00", vetor: "oeste", invertido: false, saida: { lat: -33.630, lng: -70.680 } },     // Acceso Sur
  { nome: "El Principal", horario: "14:00", vetor: "oeste", invertido: false, saida: { lat: -33.610, lng: -70.570 } },   // Pirque
  { nome: "Termas da Colina", horario: "05:00", vetor: "leste", invertido: false, saida: { lat: -33.300, lng: -70.670 } }, // Ruta 5 Norte
  { nome: "Transporte Alyan", horario: "14:30", vetor: "oeste", invertido: false, saida: { lat: -33.450, lng: -70.780 } },
  { nome: "Undurraga", horario: "07:30", vetor: "oeste", invertido: false, saida: { lat: -33.520, lng: -70.770 } },      // Ruta 78 (Talagante)
  { nome: "Valparaíso", horario: "06:30", vetor: "oeste", invertido: false, saida: { lat: -33.450, lng: -70.780 } }      // Ruta 68
];

var TIPOS_VAN_DEFAULT = [
  { id: "t6", capacidade: 6 }, { id: "t8", capacidade: 8 }, { id: "t9", capacidade: 9 },
  { id: "t10", capacidade: 10 }, { id: "t15", capacidade: 15 },
  { id: "t18", capacidade: 18 }, { id: "t19", capacidade: 19 }
];

// ============================================================
// VETORES E INVERSÃO
// Sistema simplificado: só "leste" e "oeste" como pickup direction.
// ============================================================
function inverterVetor(vetor) {
  return vetor === "leste" ? "oeste" : "leste";
}

// Migração: vetores antigos (norte/sul/sudeste/etc) viram leste ou oeste
function migrarVetorAntigo(vetor) {
  // norte/nordeste/sudeste/leste → "leste" (saída pelo lado leste/cordilheira)
  // sul/sudoeste/noroeste/oeste → "oeste" (saída pelo lado oeste/costa)
  if (vetor === "leste" || vetor === "oeste") return vetor;
  if (vetor === "norte" || vetor === "nordeste" || vetor === "sudeste") return "leste";
  if (vetor === "sul" || vetor === "sudoeste" || vetor === "noroeste") return "oeste";
  return "leste"; // default
}

// Persistência da config dos tours em localStorage
var TOURS_KEY = "wlc_tours_v1";
function carregarTours() {
  try {
    var raw = localStorage.getItem(TOURS_KEY);
    if (!raw) return TOURS_DEFAULT;
    var saved = JSON.parse(raw);
    // Merge com default (caso novos tours sejam adicionados) + migração de vetor
    return TOURS_DEFAULT.map(function (def) {
      var found = saved.find(function (s) { return s.nome === def.nome; });
      if (found) {
        var saidaOk = found.saida && typeof found.saida.lat === "number" && typeof found.saida.lng === "number";
        return {
          nome: def.nome,
          // Usa o vetor salvo SE ele já for novo formato; senão migra
          vetor: migrarVetorAntigo(found.vetor || def.vetor),
          horario: found.horario || def.horario,
          invertido: !!found.invertido,
          // Migração v7.2: tours salvos antes não tinham ponto de saída
          saida: saidaOk ? found.saida : def.saida
        };
      }
      return def;
    });
  } catch (e) {
    return TOURS_DEFAULT;
  }
}
function salvarTours(tours) {
  try { localStorage.setItem(TOURS_KEY, JSON.stringify(tours)); } catch (e) {}
}

// Persistência dos tipos de van (a config era perdida ao recarregar a página)
var TIPOS_KEY = "wlc_vantipos_v1";
function carregarTipos() {
  try {
    var raw = localStorage.getItem(TIPOS_KEY);
    if (!raw) return TIPOS_VAN_DEFAULT;
    var saved = JSON.parse(raw);
    if (!Array.isArray(saved) || saved.length === 0) return TIPOS_VAN_DEFAULT;
    return saved.filter(function (t) { return t && t.id && t.capacidade > 0; });
  } catch (e) {
    return TIPOS_VAN_DEFAULT;
  }
}
function salvarTipos(tipos) {
  try { localStorage.setItem(TIPOS_KEY, JSON.stringify(tipos)); } catch (e) {}
}

function setorPorCoordenadas(lat, lng) {
  if (!lat || !lng) return 99;
  if (lat < -33.65 || lat > -33.30) return 99;
  if (lng < -70.80 || lng > -70.45) return 99;
  if (lng < -70.660) return 1;
  if (lng < -70.625) return 2;
  if (lng < -70.585) return 3;
  return 4;
}
function nomeSetor(setor) {
  if (setor === 1) return "Est. Central";
  if (setor === 2) return "Centro";
  if (setor === 3) return "Providencia";
  if (setor === 4) return "Las Condes";
  return "Outro";
}

// ============================================================
// SAÍDA DA CIDADE: helpers de distância e projeção
// A rota deve "fluir" rumo ao ponto de saída do tour.
// ============================================================
function distSaidaKm(p, saida) {
  return distanciaKm(p.lat, p.lng, saida.lat, saida.lng);
}
// Projeção de cada ponto no eixo centróide→saída. Ordenar por essa projeção
// faz as fatias seguirem o rumo da saída (generaliza o antigo "por longitude"
// e funciona pra qualquer direção: leste, sul, sudeste...).
function fazerProjecao(pontos, saida) {
  var n = pontos.length || 1;
  var cx = 0, cy = 0;
  pontos.forEach(function (p) { cx += p.lng; cy += p.lat; });
  cx /= n; cy /= n;
  var vx = saida.lng - cx, vy = saida.lat - cy;
  var norm = Math.sqrt(vx * vx + vy * vy) || 1;
  vx /= norm; vy /= norm;
  return function (p) { return (p.lng - cx) * vx + (p.lat - cy) * vy; };
}

// ============================================================
// CACHE GEOCODING
// ============================================================
var CACHE_KEY = "wlc_geocache_v1";
function carregarCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); }
  catch (e) { return {}; }
}
function salvarCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {}
}
// Remove rótulos de ponto de encontro do endereço antes do geocoding.
// "PONT. ENC. METRO TOESCA" → "METRO TOESCA"
// Cobre: ponto de encontro, pont. enc., pto enc, punto de encuentro, p.e.:
function limparEndereco(end) {
  return String(end || "")
    .replace(/\b(ponto|pont|pto|punto|p)\.?\s*(de\s*)?(encontro|encuentro|enc\b)\.?\s*[:\-]?\s*/gi, "")
    .replace(/\bp\.?\s*e\.?\s*[:\-]\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function chaveCache(end) {
  return end.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.,]/g, "");
}
function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function geocodificar(endereco, cache, tentativa) {
  tentativa = tentativa || 1;
  endereco = limparEndereco(endereco);
  if (!endereco) return { erro: "Endereço vazio" };
  var k = chaveCache(endereco);
  if (cache[k]) return { ...cache[k], fonte: "cache" };
  try {
    var resp = await fetch("/api/geocode?address=" + encodeURIComponent(endereco));
    if (!resp.ok) {
      var err = await resp.json().catch(function () { return {}; });
      // Retry só faz sentido em erro de servidor/rede (5xx, 429).
      // 404 = endereço não existe no Google — retry só queima tempo e cota.
      if (tentativa < 3 && (resp.status >= 500 || resp.status === 429)) {
        await delay(500 * tentativa);
        return await geocodificar(endereco, cache, tentativa + 1);
      }
      return { erro: err.error || "Erro " + resp.status };
    }
    var data = await resp.json();
    var resultado = {
      lat: data.lat, lng: data.lng,
      comuna: data.comuna,
      setor: setorPorCoordenadas(data.lat, data.lng),
      formatted: data.formatted
    };
    cache[k] = resultado;
    salvarCache(cache);
    return { ...resultado, fonte: "api" };
  } catch (e) {
    if (tentativa < 3) {
      await delay(500 * tentativa);
      return await geocodificar(endereco, cache, tentativa + 1);
    }
    return { erro: "Falha de rede: " + e.message };
  }
}

// ============================================================
// DISTÂNCIA E TEMPO FALLBACK
// ============================================================
function distanciaKm(lat1, lng1, lat2, lng2) {
  var R = 6371;
  var toRad = function (x) { return (x * Math.PI) / 180; };
  var dLat = toRad(lat2 - lat1);
  var dLng = toRad(lng2 - lng1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function tempoEstimadoMin(a, b) {
  if (!a.lat || !b.lat) return 10;
  var km = distanciaKm(a.lat, a.lng, b.lat, b.lng);
  var mesmoSetor = a.setor === b.setor;
  var fatorMalha = mesmoSetor ? 1.35 : 1.55;
  var velocKmH = mesmoSetor ? 22 : 28;
  var min = (km * fatorMalha / velocKmH) * 60 + 1.5;
  return arredondar5(min);
}

// ============================================================
// ROUTES API
// ============================================================
async function chamarRoutes(pontos, horarioPartida, otimizar, tentativa) {
  tentativa = tentativa || 1;
  if (pontos.length < 2) {
    return { ordem: pontos.map(function (_, i) { return i; }), legs: [] };
  }
  try {
    var resp = await fetch("/api/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: pontos, optimize: otimizar, departureTime: horarioPartida })
    });
    if (!resp.ok) {
      var err = await resp.json().catch(function () { return {}; });
      // 5xx = instabilidade (retry rápido). 429 = rate limit (backoff maior).
      // 4xx (exceto 429) = pedido inválido — retry nunca vai funcionar.
      if (tentativa < 3 && (resp.status >= 500 || resp.status === 429)) {
        var espera = resp.status === 429 ? 1200 * tentativa : 400 * tentativa;
        if (typeof console !== "undefined") console.warn("Routes retry " + tentativa + "/3 (" + resp.status + "):", err.error);
        await delay(espera);
        return await chamarRoutes(pontos, horarioPartida, otimizar, tentativa + 1);
      }
      return { erro: err.error || "Routes erro", statusCode: resp.status };
    }
    var data = await resp.json();
    var n = pontos.length;
    var ordem;
    if (otimizar) {
      // optimizedOrder vem da Google com os índices otimizados DOS INTERMEDIÁRIOS (0-indexed).
      // BUG fix: quando há só 1 intermediário, Google não retorna o campo (não há nada pra
      // otimizar). Nesse caso, mantemos a ordem natural: [0, 1, 2, ..., n-1].
      var intermediariosReais = n - 2; // descontando origem e destino
      var optimized = data.optimizedOrder;
      if (!Array.isArray(optimized) || optimized.length !== intermediariosReais) {
        // Sem otimização válida — mantém ordem original dos pontos enviados
        ordem = pontos.map(function (_, i) { return i; });
      } else {
        ordem = [0];
        optimized.forEach(function (i) { ordem.push(i + 1); });
        ordem.push(n - 1);
      }
    } else {
      ordem = pontos.map(function (_, i) { return i; });
    }
    return { ordem: ordem, legs: data.legs || [], totalDurationSec: data.totalDurationSec };
  } catch (e) {
    if (tentativa < 3) {
      await delay(400 * tentativa);
      return await chamarRoutes(pontos, horarioPartida, otimizar, tentativa + 1);
    }
    return { erro: e.message };
  }
}

// Otimiza rota de uma van: origem = ponto mais DISTANTE da saída da cidade,
// destino = ponto mais PRÓXIMO da saída. O Google otimiza o miolo.
// invertido = troca as âncoras (motorista começa pelo lado da saída).
async function otimizarVan(pontosVan, saidaTour, invertido, horarioPartida) {
  var n = pontosVan.length;
  if (n === 0) return [];
  if (n === 1) return pontosVan.slice();

  var ok = pontosVan.filter(function (p) { return p.lat; });
  var falhos = pontosVan.filter(function (p) { return !p.lat; });

  if (ok.length < 2) {
    return ok.concat(falhos);
  }

  // GEOCODING SUSPEITO (v7.3): ponto a >8 km do centróide da van quase sempre
  // é endereço mal geocodificado (ex: "Metro Tobalaba" caindo em Macul).
  // Não pode ser âncora — senão arrasta a rota inteira — e ganha aviso na UI.
  var centV = centroideFatia(ok);
  ok.forEach(function (p) {
    p.geoSuspeito = distanciaKm(p.lat, p.lng, centV.lat, centV.lng) > 8;
  });
  var confiaveis = ok.filter(function (p) { return !p.geoSuspeito; });
  var baseAncora = confiaveis.length >= 2 ? confiaveis : ok;
  if (typeof console !== "undefined" && confiaveis.length < ok.length) {
    ok.filter(function (p) { return p.geoSuspeito; }).forEach(function (p) {
      console.warn("⚠️ Geocoding suspeito (não-âncora): " + p.endereco);
    });
  }

  // Mais distante da saída primeiro → rota flui rumo à saída
  var porDist = baseAncora.slice().sort(function (a, b) { return distSaidaKm(b, saidaTour) - distSaidaKm(a, saidaTour); });
  if (invertido) porDist = porDist.slice().reverse();
  var entrada = porDist[0];
  var saida = porDist[porDist.length - 1];
  // fallback de erro precisa conter TODOS os pontos, suspeitos inclusos
  porDist = [entrada].concat(ok.filter(function (p) { return p !== entrada && p !== saida; })).concat([saida]);

  if (ok.length === 2) {
    return [entrada, saida].concat(falhos);
  }

  // ============================================================
  // CASO ESPECIAL: 3 pontos (1 intermediário)
  // Com origem/destino fixos pelo pickup, só existe UMA ordem possível:
  // entrada → meio → saída. Não precisa chamar Google pra otimizar.
  // (Google nem otimizaria com 1 intermediário e estava causando bugs)
  // ============================================================
  if (ok.length === 3) {
    var meioPt = ok.filter(function (p) { return p !== entrada && p !== saida; })[0];
    if (typeof console !== "undefined") {
      console.log("Van 3 pts (sem otimização Google): " + entrada.endereco + " → " + meioPt.endereco + " → " + saida.endereco);
    }
    return [entrada, meioPt, saida].concat(falhos);
  }

  var meio = ok.filter(function (p) { return p !== entrada && p !== saida; });

  // ============================================================
  // LIMITE GOOGLE: máx 25 intermediários por chamada.
  // Vans grandes (>27 pontos) são otimizadas em pedaços sequenciais:
  // ordena por longitude, otimiza cada lote de até 24 intermediários
  // encadeando (fim de um lote = início do próximo).
  // ============================================================
  if (meio.length > 25) {
    if (typeof console !== "undefined") console.log("Van grande (" + ok.length + " pts): otimizando em pedaços");
    var meioOrd = meio.slice().sort(function (a, b) {
      var d = distSaidaKm(b, saidaTour) - distSaidaKm(a, saidaTour);
      return invertido ? -d : d;
    });
    var rotaAcum = [entrada];
    var resto = meioOrd.slice();
    while (resto.length > 0) {
      var lote = resto.slice(0, 24);
      resto = resto.slice(24);
      var ehUltimo = resto.length === 0;
      var iniLote = rotaAcum[rotaAcum.length - 1];
      var fimLote = ehUltimo ? saida : lote[lote.length - 1];
      var interLote = ehUltimo ? lote : lote.slice(0, -1);
      var ptsLote = [{ lat: iniLote.lat, lng: iniLote.lng }]
        .concat(interLote.map(function (p) { return { lat: p.lat, lng: p.lng }; }))
        .concat([{ lat: fimLote.lat, lng: fimLote.lng }]);
      var rLote = await chamarRoutes(ptsLote, horarioPartida, true);
      var seqLote = [iniLote].concat(interLote).concat([fimLote]);
      if (rLote.erro) {
        if (typeof console !== "undefined") console.warn("⚠️ Pedaço falhou, mantendo ordem por lng:", rLote.erro);
        seqLote.slice(1).forEach(function (p) { rotaAcum.push(p); });
      } else {
        rLote.ordem.slice(1).forEach(function (i) { rotaAcum.push(seqLote[i]); });
      }
    }
    // Dedup defensivo + recuperação de faltantes
    var vistosCh = {}, limpoCh = [];
    rotaAcum.forEach(function (p) { if (p && !vistosCh[p.id]) { vistosCh[p.id] = true; limpoCh.push(p); } });
    ok.forEach(function (p) { if (p && !vistosCh[p.id]) { vistosCh[p.id] = true; limpoCh.push(p); } });
    return limpoCh.concat(falhos);
  }

  var pts = [{ lat: entrada.lat, lng: entrada.lng }]
    .concat(meio.map(function (p) { return { lat: p.lat, lng: p.lng }; }))
    .concat([{ lat: saida.lat, lng: saida.lng }]);

  var r = await chamarRoutes(pts, horarioPartida, true);
  if (r.erro) {
    if (typeof console !== "undefined") console.warn("⚠️ Van falhou otimização, usando fallback por distância à saída:", r.erro);
    return porDist.concat(falhos);
  }

  var todos = [entrada].concat(meio).concat([saida]);
  var ordenado = r.ordem.map(function (i) { return todos[i]; });

  // Proteção: se por algum motivo a ordem veio incompleta (faltando pontos)
  // ou com duplicatas, fazemos merge defensivo com `todos` pra garantir
  // que todos os pontos originais estejam presentes exatamente uma vez.
  var presentes = {};
  var ordenadoLimpo = [];
  ordenado.forEach(function (p) {
    if (p && !presentes[p.id]) {
      presentes[p.id] = true;
      ordenadoLimpo.push(p);
    }
  });
  // Adiciona qualquer ponto que ficou de fora (bug no Google ou no parse)
  todos.forEach(function (p) {
    if (p && !presentes[p.id]) {
      if (typeof console !== "undefined") console.warn("⚠️ Ponto faltante recuperado:", p.endereco);
      presentes[p.id] = true;
      ordenadoLimpo.push(p);
    }
  });

  // ============================================================
  // REFINAMENTO KM vs TEMPO (conservador)
  // Testa trocas de pares adjacentes no meio. Se encontrar variante
  // com km menor e tempo não piorando mais que 3 min, aceita.
  // Só roda quando há ≥4 pontos (≥2 intermediários) onde realmente há
  // trocas possíveis. Custa (n-3) chamadas Google extras no pior caso.
  // ============================================================
  // 2-OPT POR KM (v7.3): detecta cruzamentos na ordem do Google (linha reta,
  // sem API). Se achar melhora, confere com 1 chamada e adota se km cair
  // sem piorar o tempo em mais de 3 min.
  var legsAtuais = r.legs;
  if (ordenadoLimpo.length >= 5) {
    var tentativa2opt = doisOptKm(ordenadoLimpo);
    if (tentativa2opt.mudou) {
      var pts2 = tentativa2opt.rota.map(function (p) { return { lat: p.lat, lng: p.lng }; });
      var r2 = await chamarRoutes(pts2, horarioPartida, false);
      if (!r2.erro) {
        var t1 = (legsAtuais || []).reduce(function (sx, l) { return sx + (l.durationSec || 0); }, 0);
        var k1 = (legsAtuais || []).reduce(function (sx, l) { return sx + (l.distanceMeters || 0); }, 0);
        var t2 = (r2.legs || []).reduce(function (sx, l) { return sx + (l.durationSec || 0); }, 0);
        var k2 = (r2.legs || []).reduce(function (sx, l) { return sx + (l.distanceMeters || 0); }, 0);
        if (k2 < k1 - 300 && t2 - t1 < 180) {
          if (typeof console !== "undefined") {
            console.log("✂️ 2-opt aceito: " + ((k1 - k2) / 1000).toFixed(1) + " km a menos, Δt " + Math.round((t2 - t1) / 60) + " min");
          }
          ordenadoLimpo = tentativa2opt.rota;
          legsAtuais = r2.legs;
        }
      }
    }
  }

  if (ordenadoLimpo.length >= 4) {
    var refinamento = await refinarPorKm(ordenadoLimpo, legsAtuais, horarioPartida);
    if (refinamento.mudou) {
      if (typeof console !== "undefined") {
        console.log("🔧 Refinamento km: trocou [" + refinamento.trocas.join(", ") +
          "] | Δkm=" + refinamento.deltaKm.toFixed(2) + " Δmin=" + refinamento.deltaMin.toFixed(1));
      }
      return refinamento.rota.concat(falhos);
    }
  }

  return ordenadoLimpo.concat(falhos);
}

// ============================================================
// REFINAMENTO POR KM: testa trocas de vizinhos no meio
// ============================================================
async function refinarPorKm(rota, legsOriginais, horarioPartida) {
  var n = rota.length;
  if (n < 4) return { mudou: false };
  // v7.3: limite ampliado pra 16 (custo de API liberado pelo Joaquim) —
  // justamente as rotas grandes são as que mais zigue-zagueiam.
  if (n > 16) return { mudou: false };

  // Métricas da rota original (tempo e km)
  var tempoOriginal = (legsOriginais || []).reduce(function (s, l) { return s + (l.durationSec || 0); }, 0);
  var kmOriginal = (legsOriginais || []).reduce(function (s, l) { return s + (l.distanceMeters || 0); }, 0);

  // Se não tem legs original (não veio do Google), busca agora
  if (!tempoOriginal || !kmOriginal) {
    var ptsOrig = rota.map(function (p) { return { lat: p.lat, lng: p.lng }; });
    var rOrig = await chamarRoutes(ptsOrig, horarioPartida, false);
    if (rOrig.erro) return { mudou: false };
    tempoOriginal = (rOrig.legs || []).reduce(function (s, l) { return s + (l.durationSec || 0); }, 0);
    kmOriginal = (rOrig.legs || []).reduce(function (s, l) { return s + (l.distanceMeters || 0); }, 0);
  }

  // Testa trocas de vizinhos (i, i+1) para i em [1, n-2) — preserva origem (0) e destino (n-1).
  // Variantes avaliadas em paralelo (lotes de 3) pra reduzir tempo total sem estourar rate limit.
  var variantes = [];
  for (var i = 1; i < n - 2; i++) {
    var variante = rota.slice();
    var tmp = variante[i];
    variante[i] = variante[i + 1];
    variante[i + 1] = tmp;
    variantes.push({ idx: i, rota: variante });
  }

  var melhorVariante = null;
  var LOTE = 3;
  for (var li = 0; li < variantes.length; li += LOTE) {
    var lote = variantes.slice(li, li + LOTE);
    var resultados = await Promise.all(lote.map(function (v) {
      var ptsVar = v.rota.map(function (p) { return { lat: p.lat, lng: p.lng }; });
      return chamarRoutes(ptsVar, horarioPartida, false);
    }));
    for (var ri = 0; ri < lote.length; ri++) {
      var rVar = resultados[ri];
      if (rVar.erro) continue;
      var v = lote[ri];

      var tempoVar = (rVar.legs || []).reduce(function (s, l) { return s + (l.durationSec || 0); }, 0);
      var kmVar = (rVar.legs || []).reduce(function (s, l) { return s + (l.distanceMeters || 0); }, 0);

      var deltaKm = (kmVar - kmOriginal) / 1000; // em km
      var deltaMin = (tempoVar - tempoOriginal) / 60; // em min

      // Aceita se km menor E tempo não piora mais que 3 min
      if (deltaKm < -0.1 && deltaMin < 3) {
        if (!melhorVariante || deltaKm < melhorVariante.deltaKm) {
          melhorVariante = {
            rota: v.rota,
            trocas: [rota[v.idx].endereco + " ↔ " + rota[v.idx + 1].endereco],
            deltaKm: deltaKm,
            deltaMin: deltaMin
          };
        }
      }
    }
  }

  if (!melhorVariante) return { mudou: false };
  return {
    mudou: true,
    rota: melhorVariante.rota,
    trocas: melhorVariante.trocas,
    deltaKm: melhorVariante.deltaKm,
    deltaMin: melhorVariante.deltaMin
  };
}

// ============================================================
// PARSER COLAGEM
// ============================================================
function parseColagem(texto) {
  var linhas = texto.split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
  var reservas = [];
  var ignoradas = [];
  for (var i = 0; i < linhas.length; i++) {
    var linha = linhas[i];
    linha = linha.replace(/^\d+\s*[\)\.\-]\s*/, "");
    linha = linha.replace(/^~?\d{1,2}:\d{2}\s*[\/\-]\s*/, "");
    var matchSoma = linha.match(/(\d+)\s*\+\s*(\d+)\s*pax/i);
    var matchPax = linha.match(/(\d+)\s*pax/i);
    var pax = 0, semPax = linha;
    if (matchSoma) { pax = parseInt(matchSoma[1]) + parseInt(matchSoma[2]); semPax = linha.replace(matchSoma[0], "").trim(); }
    else if (matchPax) { pax = parseInt(matchPax[1]); semPax = linha.replace(matchPax[0], "").trim(); }
    semPax = semPax.replace(/^[\/\-\s]+/, "").replace(/[\/\-\s]+$/, "").trim();
    var partes = semPax.split(/\s*[\/]\s*/).map(function (p) { return p.trim(); }).filter(Boolean);
    var endereco = partes.length > 0 ? partes[partes.length - 1] : semPax;
    if (pax === 0) {
      var m = endereco.match(/^(\d+)\s+(.+)$/);
      if (m && parseInt(m[1]) <= 20 && m[2].match(/[a-zA-Z]/)) {
        pax = parseInt(m[1]); endereco = m[2].trim();
      }
    }
    endereco = limparEndereco(endereco);
    if (endereco.length > 0 && pax > 0) {
      reservas.push({
        id: "r" + Date.now() + "_" + i + "_" + Math.random().toString(36).substring(2, 6),
        endereco: endereco, passageiros: pax
      });
    } else {
      ignoradas.push(linhas[i]);
    }
  }
  return { reservas: reservas, ignoradas: ignoradas };
}

function unificarReservas(reservas) {
  var mapa = {}, ordem = [];
  reservas.forEach(function (r) {
    var k = chaveCache(r.endereco);
    if (mapa[k]) {
      mapa[k].passageiros += r.passageiros;
      mapa[k].origens.push(r.passageiros);
    } else {
      mapa[k] = { id: r.id, endereco: r.endereco, passageiros: r.passageiros, origens: [r.passageiros] };
      ordem.push(k);
    }
  });
  return ordem.map(function (k) { return mapa[k]; });
}

// ============================================================
// HORÁRIOS
// ============================================================
function somarMinutos(hora, min) {
  var p = hora.split(":");
  var total = parseInt(p[0]) * 60 + parseInt(p[1]) + min;
  while (total < 0) total += 24 * 60;
  var h = Math.floor(total / 60) % 24, m = total % 60;
  return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
}
function arredondar5(min) {
  var r = Math.round(min / 5) * 5;
  return r < 3 ? 3 : r;
}

// ============================================================
// EXPANDIR VANS
// ============================================================
function expandirVans(tipos, ativos) {
  var resultado = [];
  tipos.forEach(function (t) {
    var qtd = ativos[t.id] || 0;
    for (var i = 0; i < qtd; i++) {
      resultado.push({ id: t.id + "_" + i, nome: "Van " + t.capacidade + "p" + (qtd > 1 ? " #" + (i + 1) : ""), capacidade: t.capacidade });
    }
  });
  return resultado;
}

// ============================================================
// ALGORITMO: CLUSTERING GEOGRÁFICO BALANCEADO
// ============================================================

function prefixSumPax(pontos) {
  var pref = [0];
  for (var i = 0; i < pontos.length; i++) pref.push(pref[i] + pontos[i].passageiros);
  return pref;
}
function paxIntervalo(pref, i, j) { return pref[j] - pref[i]; }

function calcularVansNecessarias(totalPax, vansDisponiveis) {
  var sorted = vansDisponiveis.slice().sort(function (a, b) { return b.capacidade - a.capacidade; });
  var soma = 0;
  for (var i = 0; i < sorted.length; i++) {
    soma += sorted[i].capacidade;
    if (soma >= totalPax) return i + 1;
  }
  return sorted.length;
}

// Orçamento de busca: acima disso a recursão para e usa o melhor encontrado.
// Evita travar o navegador quando há muitas paradas × muitas vans.
var BUSCA_BUDGET = 200000;

function particionarContiguoViavel(pontosOrd, vansSel, maxParadas) {
  maxParadas = maxParadas || Infinity;
  var n = pontosOrd.length;
  var k = vansSel.length;
  if (k > n) return null;
  var pref = prefixSumPax(pontosOrd);
  var melhor = null;
  var cortes = new Array(k + 1);
  cortes[0] = 0; cortes[k] = n;
  var nos = 0;

  function buscar(idx, inicio) {
    if (++nos > BUSCA_BUDGET) return;
    if (idx === k) {
      var paxs = [];
      var maxLen = 0;
      for (var i = 0; i < k; i++) {
        var len = cortes[i + 1] - cortes[i];
        if (len > maxParadas) return;
        if (len > maxLen) maxLen = len;
        var p = paxIntervalo(pref, cortes[i], cortes[i + 1]);
        if (p > vansSel[i].capacidade) return;
        paxs.push(p);
      }
      var dif = Math.max.apply(null, paxs) - Math.min.apply(null, paxs);
      // Critério v7.3: minimiza primeiro o MÁXIMO de paradas (qualidade de
      // serviço — menos tempo do 1º pax na van), depois o desbalanceamento.
      if (melhor === null || maxLen < melhor.maxLen || (maxLen === melhor.maxLen && dif < melhor.dif)) {
        melhor = { cortes: cortes.slice(), paxs: paxs.slice(), dif: dif, maxLen: maxLen };
      }
      return;
    }
    var min = Math.max(inicio, cortes[idx - 1] + 1);
    var max = n - (k - idx);
    for (var c = min; c <= max; c++) {
      // PODA: a fatia (idx-1) é [cortes[idx-1], c). Pax e paradas só crescem
      // com c — se estourou capacidade ou limite de paradas, maiores também estouram.
      if (c - cortes[idx - 1] > maxParadas) break;
      if (paxIntervalo(pref, cortes[idx - 1], c) > vansSel[idx - 1].capacidade) break;
      cortes[idx] = c; buscar(idx + 1, c + 1);
    }
  }
  buscar(1, 1);
  if (!melhor) return null;

  var fatias = [];
  for (var i = 0; i < k; i++) {
    fatias.push({
      van: vansSel[i],
      pontos: pontosOrd.slice(melhor.cortes[i], melhor.cortes[i + 1]),
      pax: melhor.paxs[i]
    });
  }
  return { tipo: "contiguo", fatias: fatias, dif: melhor.dif };
}

function particionarOtimoSemCap(pontosOrd, k) {
  var n = pontosOrd.length;
  if (k > n) return null;
  var pref = prefixSumPax(pontosOrd);
  var melhor = null;
  var cortes = new Array(k + 1);
  cortes[0] = 0; cortes[k] = n;
  var nos = 0;

  function buscar(idx, inicio) {
    if (++nos > BUSCA_BUDGET) return;
    if (idx === k) {
      var paxs = [];
      for (var i = 0; i < k; i++) paxs.push(paxIntervalo(pref, cortes[i], cortes[i + 1]));
      var dif = Math.max.apply(null, paxs) - Math.min.apply(null, paxs);
      if (melhor === null || dif < melhor.dif) {
        melhor = { cortes: cortes.slice(), paxs: paxs.slice(), dif: dif };
      }
      return;
    }
    var min = Math.max(inicio, cortes[idx - 1] + 1);
    var max = n - (k - idx);
    for (var c = min; c <= max; c++) { cortes[idx] = c; buscar(idx + 1, c + 1); }
  }
  buscar(1, 1);
  return melhor;
}

function particionarComRelaxamento(pontosOrd, vansSel) {
  var k = vansSel.length;
  var otimo = particionarOtimoSemCap(pontosOrd, k);
  if (!otimo) return null;

  var fatias = [];
  for (var i = 0; i < k; i++) {
    fatias.push({
      van: vansSel[i],
      pontos: pontosOrd.slice(otimo.cortes[i], otimo.cortes[i + 1]),
      pax: otimo.paxs[i]
    });
  }

  var MAX = 100;
  for (var iter = 0; iter < MAX; iter++) {
    var pior = -1, maiorExc = 0;
    for (var i = 0; i < fatias.length; i++) {
      var exc = fatias[i].pax - fatias[i].van.capacidade;
      if (exc > maiorExc) { maiorExc = exc; pior = i; }
    }
    if (pior === -1) break;

    var melhorMov = null;
    for (var ip = 0; ip < fatias[pior].pontos.length; ip++) {
      var ponto = fatias[pior].pontos[ip];
      for (var j = 0; j < fatias.length; j++) {
        if (j === pior) continue;
        var folga = fatias[j].van.capacidade - fatias[j].pax;
        if (ponto.passageiros > folga) continue;
        var centroideJ = fatias[j].pontos.reduce(function (s, p) { return s + p.lng; }, 0) / fatias[j].pontos.length;
        var distorcao = Math.abs(ponto.lng - centroideJ);
        var penaltVizinho = Math.abs(j - pior) > 1 ? 0.1 : 0;
        var score = distorcao + penaltVizinho;
        if (melhorMov === null || score < melhorMov.score) {
          melhorMov = { de: pior, para: j, idx: ip, ponto: ponto, score: score };
        }
      }
    }
    if (!melhorMov) return null;

    fatias[melhorMov.de].pontos.splice(melhorMov.idx, 1);
    fatias[melhorMov.de].pax -= melhorMov.ponto.passageiros;
    var insertIdx = 0;
    for (var ii = 0; ii < fatias[melhorMov.para].pontos.length; ii++) {
      if (fatias[melhorMov.para].pontos[ii].lng < melhorMov.ponto.lng) insertIdx = ii + 1;
    }
    fatias[melhorMov.para].pontos.splice(insertIdx, 0, melhorMov.ponto);
    fatias[melhorMov.para].pax += melhorMov.ponto.passageiros;
  }

  var viavel = fatias.every(function (f) { return f.pax <= f.van.capacidade; });
  if (!viavel) return null;
  var paxs = fatias.map(function (f) { return f.pax; });
  var dif = Math.max.apply(null, paxs) - Math.min.apply(null, paxs);
  return { tipo: "relaxado", fatias: fatias, dif: dif };
}

// Casca soft (v7.3): tenta respeitar o limite de paradas; se não fechar,
// repete sem o limite e marca paradasExcedidas pra UI avisar — a regra
// orienta, não trava (decisão do Joaquim: limite sobreponível).
function clusterizarPorVans(pontosOrd, vansDisponiveis, maxParadas) {
  maxParadas = maxParadas || Infinity;
  if (maxParadas !== Infinity) {
    var comLimite = clusterizarNucleo(pontosOrd, vansDisponiveis, maxParadas);
    if (comLimite && comLimite.tipo !== "erro_encaixe") return comLimite; // pode trazer paradasExcedidas do encaixe
    var semLimite = clusterizarNucleo(pontosOrd, vansDisponiveis, Infinity);
    if (semLimite && semLimite.fatias) semLimite.paradasExcedidas = true;
    return semLimite;
  }
  return clusterizarNucleo(pontosOrd, vansDisponiveis, Infinity);
}

function clusterizarNucleo(pontosOrd, vansDisponiveis, maxParadas) {
  var totalPax = pontosOrd.reduce(function (s, p) { return s + p.passageiros; }, 0);
  var n = pontosOrd.length;
  var sorted = vansDisponiveis.slice().sort(function (a, b) { return b.capacidade - a.capacidade; });
  var capTotal = sorted.reduce(function (s, v) { return s + v.capacidade; }, 0);

  // Capacidade total realmente insuficiente: não há o que fazer.
  if (capTotal < totalPax) return null;

  var Kmin = calcularVansNecessarias(totalPax, sorted);
  // Com limite de paradas, o mínimo de vans também depende do nº de pontos
  if (maxParadas !== Infinity) {
    Kmin = Math.max(Kmin, Math.ceil(n / maxParadas));
  }
  var Kmax = Math.min(sorted.length, n);
  if (Kmin > Kmax) return null; // limite de paradas impossível com as vans ativas

  // BUG FIX v7.1: a versão anterior tentava só K=Kmin. Se a partição contígua
  // falhava (ex: reserva de 9 pax que não cabe em nenhuma fatia daquele arranjo)
  // e o relaxamento também, desistia e jogava tudo numa rota só com erro de
  // capacidade — mesmo havendo vans sobrando. Agora itera K até Kmax.
  for (var K = Kmin; K <= Kmax; K++) {
    var vansSel = sorted.slice(0, K);
    var capSel = vansSel.reduce(function (s, v) { return s + v.capacidade; }, 0);
    if (capSel < totalPax) continue;

    var todasIguais = vansSel.every(function (v) { return v.capacidade === vansSel[0].capacidade; });
    var melhor = null;

    if (todasIguais) {
      melhor = particionarContiguoViavel(pontosOrd, vansSel, maxParadas);
    } else {
      // Dedup por assinatura de capacidades: permutar vans de mesma capacidade
      // gera resultado idêntico. Ex: [19,19,10] tem 6 permutações mas só 3 únicas.
      var perms = K <= 6 ? permutacoes(vansSel) : [vansSel, vansSel.slice().reverse()];
      var vistos = {};
      perms = perms.filter(function (p) {
        var sig = p.map(function (v) { return v.capacidade; }).join(",");
        if (vistos[sig]) return false;
        vistos[sig] = true;
        return true;
      });
      for (var p = 0; p < perms.length; p++) {
        var r = particionarContiguoViavel(pontosOrd, perms[p], maxParadas);
        if (r && (melhor === null ||
          (r.maxLen || 0) < (melhor.maxLen || 0) ||
          ((r.maxLen || 0) === (melhor.maxLen || 0) && r.dif < melhor.dif))) melhor = r;
      }
    }

    if (melhor) return melhor;

    if (maxParadas === Infinity) {
      var relaxado = particionarComRelaxamento(pontosOrd, vansSel);
      if (relaxado) return relaxado;
    }
  }

  // Folga mínima: tenta fechar os grupos por encaixe puro (todas as vans)
  var forcado = particionarEncaixeForcado(pontosOrd, sorted.slice(0, Kmax), maxParadas);
  if (forcado.sobras.length === 0) {
    var paxsE = forcado.fatias.map(function (f) { return f.pax; });
    var maxLenE = Math.max.apply(null, forcado.fatias.map(function (f) { return f.pontos.length; }));
    return {
      tipo: "encaixe",
      fatias: forcado.fatias,
      dif: Math.max.apply(null, paxsE) - Math.min.apply(null, paxsE),
      paradasExcedidas: maxParadas !== Infinity && maxLenE > maxParadas
    };
  }

  // Capacidade total dá, mas não fecha sem dividir reservas
  return { tipo: "erro_encaixe", fatias: null };
}

// ============================================================
// ENCAIXE FORÇADO (v7.2.1) — bin packing best-fit decreasing
// Última linha de defesa quando a folga é mínima (ex: 254 pax / 255 lugares)
// e nem a partição contígua nem o relaxamento conseguem fechar os grupos.
// Sacrifica contiguidade geográfica; o reparo 2D melhora depois onde a
// folga permitir. Retorna null só se for matematicamente impossível
// encaixar sem dividir reservas.
// ============================================================
function particionarEncaixeForcado(pontosOrd, vansSel, maxParadas) {
  maxParadas = maxParadas || Infinity;
  var fatias = vansSel.map(function (v) { return { van: v, pontos: [], pax: 0 }; });
  // Maiores grupos primeiro (clássico do bin packing)
  var pontos = pontosOrd.slice().sort(function (a, b) { return b.passageiros - a.passageiros; });
  var sobras = [];

  function escolherBin(p, respeitarLimite) {
    var melhor = -1, melhorFolga = Infinity, melhorDist = Infinity;
    for (var j = 0; j < fatias.length; j++) {
      if (respeitarLimite && fatias[j].pontos.length >= maxParadas) continue;
      var folga = fatias[j].van.capacidade - fatias[j].pax;
      if (folga < p.passageiros) continue;
      // best-fit: menor folga que caiba; empate (±1 lugar) → centróide mais perto
      var d = 0;
      if (fatias[j].pontos.length > 0) {
        var c = centroideFatia(fatias[j].pontos);
        d = distanciaKm(p.lat || c.lat, p.lng || c.lng, c.lat, c.lng);
      }
      if (folga < melhorFolga - 1 || (Math.abs(folga - melhorFolga) <= 1 && d < melhorDist)) {
        melhor = j; melhorFolga = folga; melhorDist = d;
      }
    }
    return melhor;
  }

  for (var i = 0; i < pontos.length; i++) {
    var p = pontos[i];
    // v7.3.1: primeiro tenta vans abaixo do limite de paradas; se nenhuma
    // couber, relaxa o limite (regra suave — caber importa mais).
    var melhor = escolherBin(p, true);
    if (melhor === -1) melhor = escolherBin(p, false);
    if (melhor === -1) {
      sobras.push(p); // não cabe em lugar nenhum sem dividir a reserva
    } else {
      fatias[melhor].pontos.push(p);
      fatias[melhor].pax += p.passageiros;
    }
  }

  var usadas = fatias.filter(function (f) { return f.pontos.length > 0; });
  return { fatias: usadas, sobras: sobras };
}

// ============================================================
// REPARO 2D DE OUTLIERS (v7.2)
// O fatiamento é 1D (projeção no eixo da saída) e pode colocar um ponto
// geograficamente isolado na van "errada" (ex: Ñuñoa numa van do Centro).
// Aqui, ponto que está bem mais perto do centróide de OUTRA van (ganho
// > 0.8 km) e cabe nela, muda de van. Máx 15 movimentos.
// ============================================================
function centroideFatia(pontos) {
  var n = pontos.length || 1;
  var lat = 0, lng = 0;
  pontos.forEach(function (p) { lat += p.lat; lng += p.lng; });
  return { lat: lat / n, lng: lng / n };
}

function repararOutliers2D(fatias) {
  if (!fatias || fatias.length < 2) return fatias;
  var GANHO_MIN_KM = 0.8;
  var movimentos = 0;
  var houveMove = true;

  while (houveMove && movimentos < 15) {
    houveMove = false;
    var cents = fatias.map(function (f) { return centroideFatia(f.pontos); });
    var melhor = null;

    for (var i = 0; i < fatias.length; i++) {
      if (fatias[i].pontos.length <= 1) continue; // não esvazia van
      for (var pi = 0; pi < fatias[i].pontos.length; pi++) {
        var p = fatias[i].pontos[pi];
        var dPropria = distanciaKm(p.lat, p.lng, cents[i].lat, cents[i].lng);
        for (var j = 0; j < fatias.length; j++) {
          if (j === i) continue;
          if (fatias[j].pax + p.passageiros > fatias[j].van.capacidade) continue;
          var dOutra = distanciaKm(p.lat, p.lng, cents[j].lat, cents[j].lng);
          var ganho = dPropria - dOutra;
          if (ganho > GANHO_MIN_KM && (melhor === null || ganho > melhor.ganho)) {
            melhor = { de: i, para: j, idx: pi, ponto: p, ganho: ganho };
          }
        }
      }
    }

    if (melhor) {
      fatias[melhor.de].pontos.splice(melhor.idx, 1);
      fatias[melhor.de].pax -= melhor.ponto.passageiros;
      fatias[melhor.para].pontos.push(melhor.ponto);
      fatias[melhor.para].pax += melhor.ponto.passageiros;
      if (typeof console !== "undefined") {
        console.log("🔁 Outlier movido: " + melhor.ponto.endereco + " (van " + (melhor.de + 1) +
          " → " + (melhor.para + 1) + ", ganho " + melhor.ganho.toFixed(1) + " km)");
      }
      movimentos++;
      houveMove = true;
    }
  }
  return fatias;
}

// ============================================================
// BALANCEIO DE PARADAS (v7.3)
// Van com muitas paradas cede reservas PEQUENAS pra van com folga de
// lugares e poucas paradas, desde que o ponto esteja "no caminho":
// perto do centróide da van destino OU à frente dela rumo à saída
// (a van vai passar por ali de qualquer jeito).
// Ex. do Joaquim: van do Centro com 3 paradas (10+4+3) completa com
// 1 pax de Providencia — e a van de Providencia fica mais curta.
// ============================================================
function balancearParadas(fatias, maxParadas, saidaTour) {
  if (!fatias || fatias.length < 2) return fatias;
  maxParadas = maxParadas || Infinity;
  var DESVIO_MAX_KM = 3.0;
  var movimentos = 0;

  while (movimentos < 20) {
    var cents = fatias.map(function (f) { return centroideFatia(f.pontos); });
    var melhor = null;

    for (var i = 0; i < fatias.length; i++) {
      var nI = fatias[i].pontos.length;
      if (nI <= 2) continue;
      for (var j = 0; j < fatias.length; j++) {
        if (j === i) continue;
        var nJ = fatias[j].pontos.length;
        // Só vale se reduz o desequilíbrio de paradas de verdade:
        // origem estourada OU diferença grande (>= 3 paradas)
        var origemEstourada = nI > maxParadas;
        if (!origemEstourada && nI - nJ < 3) continue;
        if (nJ + 1 > maxParadas && !origemEstourada) continue;

        for (var pi = 0; pi < fatias[i].pontos.length; pi++) {
          var p = fatias[i].pontos[pi];
          if (p.passageiros > 2) continue; // só reservas pequenas mudam de van
          if (fatias[j].pax + p.passageiros > fatias[j].van.capacidade) continue;

          var dCent = distanciaKm(p.lat, p.lng, cents[j].lat, cents[j].lng);
          var aFrente = saidaTour ? distSaidaKm(p, saidaTour) < distSaidaKm(cents[j], saidaTour) : false;
          if (dCent > DESVIO_MAX_KM && !aFrente) continue;

          var score = (nI - nJ) * 10 - dCent; // prioriza maior alívio, menor desvio
          if (melhor === null || score > melhor.score) {
            melhor = { de: i, para: j, idx: pi, ponto: p, score: score, dCent: dCent };
          }
        }
      }
    }

    if (!melhor) break;
    fatias[melhor.de].pontos.splice(melhor.idx, 1);
    fatias[melhor.de].pax -= melhor.ponto.passageiros;
    fatias[melhor.para].pontos.push(melhor.ponto);
    fatias[melhor.para].pax += melhor.ponto.passageiros;
    if (typeof console !== "undefined") {
      console.log("⚖️ Balanceio: " + melhor.ponto.endereco + " (van " + (melhor.de + 1) +
        " → " + (melhor.para + 1) + ", desvio " + melhor.dCent.toFixed(1) + " km)");
    }
    movimentos++;
  }

  // ============================================================
  // TROCAS 2↔1 (v7.3.1)
  // Com ocupação 100% nenhum MOVIMENTO é possível (não há lugar livre) —
  // mas TROCAS pax-neutras sim: 2 reservas pequenas da van carregada
  // descem pra van leve, e 1 reserva maior sobe no lugar.
  // Van carregada: -2 paradas +1 = líquido -1. Van leve: +1.
  // É a única alavanca de equilíbrio no cenário folga-zero do Joaquim.
  // ============================================================
  var trocas = 0;
  while (trocas < 12) {
    var cents2 = fatias.map(function (f) { return centroideFatia(f.pontos); });
    var melhorT = null;

    for (var a = 0; a < fatias.length; a++) {
      var nA = fatias[a].pontos.length;
      for (var b = 0; b < fatias.length; b++) {
        if (a === b) continue;
        var nB = fatias[b].pontos.length;
        if (nA - nB < 3) continue; // só vale se reduz desequilíbrio de verdade
        var folgaA = fatias[a].van.capacidade - fatias[a].pax;
        var folgaB = fatias[b].van.capacidade - fatias[b].pax;

        for (var i1 = 0; i1 < fatias[a].pontos.length; i1++) {
          var p1 = fatias[a].pontos[i1];
          if (p1.passageiros > 2) continue;
          for (var i2 = i1 + 1; i2 < fatias[a].pontos.length; i2++) {
            var p2 = fatias[a].pontos[i2];
            if (p2.passageiros > 2) continue;
            var paxPar = p1.passageiros + p2.passageiros;
            for (var ib = 0; ib < fatias[b].pontos.length; ib++) {
              var pb = fatias[b].pontos[ib];
              // capacidades pós-troca dos dois lados
              if (fatias[a].pax - paxPar + pb.passageiros > fatias[a].van.capacidade) continue;
              if (fatias[b].pax - pb.passageiros + paxPar > fatias[b].van.capacidade) continue;
              // geografia: o par precisa fazer sentido na van leve, e o grupo na carregada
              var d1 = distanciaKm(p1.lat, p1.lng, cents2[b].lat, cents2[b].lng);
              var d2 = distanciaKm(p2.lat, p2.lng, cents2[b].lat, cents2[b].lng);
              var db = distanciaKm(pb.lat, pb.lng, cents2[a].lat, cents2[a].lng);
              if (d1 > 3.5 || d2 > 3.5 || db > 3.5) continue;
              var score = (nA - nB) * 10 - (d1 + d2 + db);
              if (melhorT === null || score > melhorT.score) {
                melhorT = { a: a, b: b, i1: i1, i2: i2, ib: ib, p1: p1, p2: p2, pb: pb, score: score };
              }
            }
          }
        }
      }
    }

    if (!melhorT) break;
    // remove (índice maior primeiro pra não deslocar)
    fatias[melhorT.a].pontos.splice(melhorT.i2, 1);
    fatias[melhorT.a].pontos.splice(melhorT.i1, 1);
    fatias[melhorT.b].pontos.splice(melhorT.ib, 1);
    fatias[melhorT.a].pontos.push(melhorT.pb);
    fatias[melhorT.b].pontos.push(melhorT.p1, melhorT.p2);
    fatias[melhorT.a].pax += melhorT.pb.passageiros - melhorT.p1.passageiros - melhorT.p2.passageiros;
    fatias[melhorT.b].pax += melhorT.p1.passageiros + melhorT.p2.passageiros - melhorT.pb.passageiros;
    if (typeof console !== "undefined") {
      console.log("🔄 Troca 2↔1: [" + melhorT.p1.endereco + " + " + melhorT.p2.endereco +
        "] ↔ [" + melhorT.pb.endereco + "] (van " + (melhorT.a + 1) + " ↔ van " + (melhorT.b + 1) + ")");
    }
    trocas++;
  }

  return fatias;
}

// ============================================================
// 2-OPT LOCAL POR KM (v7.3)
// Corrige cruzamentos grosseiros na ordem (vai-e-volta) usando distância
// em linha reta — zero chamadas de API. Âncoras (primeiro/último) fixas.
// ============================================================
function doisOptKm(rota) {
  var r = rota.slice();
  function d(a, b) { return distanciaKm(a.lat, a.lng, b.lat, b.lng); }
  var mudou = false;
  var melhorou = true;
  var guarda = 0;
  while (melhorou && guarda++ < 25) {
    melhorou = false;
    for (var i = 1; i < r.length - 2; i++) {
      for (var j = i + 1; j < r.length - 1; j++) {
        var antes = d(r[i - 1], r[i]) + d(r[j], r[j + 1]);
        var depois = d(r[i - 1], r[j]) + d(r[i], r[j + 1]);
        if (depois < antes - 0.05) {
          var seg = r.slice(i, j + 1).reverse();
          r = r.slice(0, i).concat(seg, r.slice(j + 1));
          melhorou = true;
          mudou = true;
        }
      }
    }
  }
  return { rota: r, mudou: mudou };
}

function permutacoes(arr) {
  if (arr.length <= 1) return [arr.slice()];
  var result = [];
  for (var i = 0; i < arr.length; i++) {
    var rest = arr.slice(0, i).concat(arr.slice(i + 1));
    var perms = permutacoes(rest);
    for (var j = 0; j < perms.length; j++) {
      result.push([arr[i]].concat(perms[j]));
    }
  }
  return result;
}

// ============================================================
// PIPELINE PRINCIPAL V7
// ============================================================
async function processarRotaV7(reservas, saidaTour, invertido, horarioInicio, cache, vansDisponiveis, maxParadas, onProgress) {
  // Geocoding em paralelo (4 workers). Cache local resolve na hora;
  // só endereços novos vão à API. Bem mais rápido que sequencial+delay.
  var enriquecidos = new Array(reservas.length);
  var proximo = 0, feitos = 0;
  async function geocodeWorker() {
    while (true) {
      var i = proximo++;
      if (i >= reservas.length) return;
      var geo = await geocodificar(reservas[i].endereco, cache);
      enriquecidos[i] = { ...reservas[i], ...geo };
      feitos++;
      if (onProgress) onProgress("Geocodificando " + feitos + "/" + reservas.length);
    }
  }
  await Promise.all([geocodeWorker(), geocodeWorker(), geocodeWorker(), geocodeWorker()]);

  var ok = enriquecidos.filter(function (r) { return r.lat && r.lng; });
  var falhos = enriquecidos.filter(function (r) { return !r.lat; });

  if (ok.length === 0) {
    return { fatiasComRota: [{ van: vansDisponiveis[0] || { capacidade: 0, nome: "?" }, reservas: falhos }], tipoParticao: "vazio" };
  }

  // SETORIZAÇÃO PRIMEIRO (v7.3): agrupa por setor, ordenando os blocos pela
  // projeção média rumo à saída. O fatiamento contíguo então gera vans
  // mono-setor sempre que os tamanhos permitem, misturando apenas setores
  // VIZINHOS na direção do trajeto — nunca pulando setor.
  var proj = fazerProjecao(ok, saidaTour);
  var rankSetor = {};
  ok.forEach(function (p) {
    var st = p.setor || 0;
    if (!rankSetor[st]) rankSetor[st] = { soma: 0, n: 0 };
    rankSetor[st].soma += proj(p);
    rankSetor[st].n++;
  });
  Object.keys(rankSetor).forEach(function (st) {
    rankSetor[st] = rankSetor[st].soma / rankSetor[st].n;
  });
  var ordenados = ok.slice().sort(function (a, b) {
    var ra = rankSetor[a.setor || 0], rb = rankSetor[b.setor || 0];
    if (ra !== rb) return invertido ? rb - ra : ra - rb;
    return invertido ? proj(b) - proj(a) : proj(a) - proj(b);
  });

  if (typeof console !== "undefined") {
    console.log("=== V7.2 PIPELINE ===");
    console.log("Saída do tour:", saidaTour.lat.toFixed(3) + "," + saidaTour.lng.toFixed(3), "| Invertido:", !!invertido);
    console.log("Pontos geocodificados:", ok.length, "| Falhos:", falhos.length);
    console.log("Vans disponíveis:", vansDisponiveis.map(function (v) { return v.capacidade; }).join(","));
  }

  if (onProgress) onProgress("Dividindo " + ok.length + " paradas em vans...");
  var clusterResult = clusterizarPorVans(ordenados, vansDisponiveis, maxParadas);

  var sobras = [];
  if (!clusterResult || clusterResult.tipo === "erro_encaixe") {
    // Capacidade menor que o total OU folga que não fecha os grupos.
    // Aloca o que cabe (best-fit com desempate geográfico) e lista as sobras —
    // muito mais útil que despejar tudo numa van só.
    if (onProgress) onProgress("Capacidade justa: alocando o que cabe...");
    var parcial = particionarEncaixeForcado(ordenados, vansDisponiveis, maxParadas);
    if (typeof console !== "undefined") {
      console.log("Encaixe parcial: " + parcial.fatias.length + " vans usadas, " +
        parcial.sobras.length + " reservas sem van");
    }
    if (parcial.fatias.length === 0) {
      return {
        fatiasComRota: [],
        tipoParticao: "erro_capacidade",
        sobras: ordenados.concat(falhos)
      };
    }
    sobras = parcial.sobras;
    var paxsF = parcial.fatias.map(function (f) { return f.pax; });
    clusterResult = {
      tipo: "sobras",
      fatias: parcial.fatias,
      dif: Math.max.apply(null, paxsF) - Math.min.apply(null, paxsF)
    };
  }

  // Reparo 2D: corrige pontos que caíram na van "errada" pelo corte 1D
  if (clusterResult.fatias.length > 1) {
    clusterResult.fatias = repararOutliers2D(clusterResult.fatias);
    // Balanceio de paradas (v7.3): van estourada cede reservas pequenas pra
    // van com folga que esteja "no caminho" rumo à saída.
    clusterResult.fatias = balancearParadas(clusterResult.fatias, maxParadas, saidaTour);
    var paxsR = clusterResult.fatias.map(function (f) { return f.pax; });
    clusterResult.dif = Math.max.apply(null, paxsR) - Math.min.apply(null, paxsR);
  }

  if (typeof console !== "undefined") {
    console.log("Clustering tipo:", clusterResult.tipo, "| Desbalanceamento:", clusterResult.dif);
    clusterResult.fatias.forEach(function (f, idx) {
      console.log("  Van " + (idx + 1) + " (" + f.van.capacidade + "p): " + f.pax + " pax, " + f.pontos.length + " paradas");
    });
  }

  var fatiasComRota = [];
  for (var fi = 0; fi < clusterResult.fatias.length; fi++) {
    var fatia = clusterResult.fatias[fi];
    if (onProgress) onProgress("Otimizando rota da van " + (fi + 1) + "/" + clusterResult.fatias.length + "...");

    var otimizados = await otimizarVan(fatia.pontos, saidaTour, invertido, horarioInicio);

    var legs = [];
    var ptsLeg = otimizados.filter(function (r) { return r.lat; }).map(function (r) { return { lat: r.lat, lng: r.lng }; });
    if (ptsLeg.length >= 2) {
      var rl = await chamarRoutes(ptsLeg, horarioInicio, false);
      if (!rl.erro) legs = rl.legs || [];
    }

    var horarios = [], deslocs = [];
    var idxLeg = 0;
    for (var j = 0; j < otimizados.length; j++) {
      if (j === 0) { horarios[j] = horarioInicio; deslocs[j] = 0; }
      else {
        var min;
        var at = otimizados[j], an = otimizados[j - 1];
        if (at.lat && an.lat && legs[idxLeg]) {
          min = arredondar5(legs[idxLeg].durationSec / 60 + 1.5);
          idxLeg++;
        } else if (at.lat && an.lat) {
          min = tempoEstimadoMin(an, at);
        } else {
          min = 10;
        }
        deslocs[j] = min;
        horarios[j] = somarMinutos(horarios[j - 1], min);
      }
    }

    var reservasFinais = otimizados.map(function (r, i) {
      return { ...r, horario: horarios[i], deslocamentoMin: deslocs[i] };
    });

    fatiasComRota.push({
      van: fatia.van,
      reservas: reservasFinais,
      paxClustering: fatia.pax
    });
  }

  if (falhos.length > 0 && fatiasComRota.length > 0) {
    var ultima = fatiasComRota[fatiasComRota.length - 1];
    var horarioFim = ultima.reservas.length > 0 ? ultima.reservas[ultima.reservas.length - 1].horario : horarioInicio;
    falhos.forEach(function (f, i) {
      var min = i === 0 ? 10 : 10;
      horarioFim = somarMinutos(horarioFim, min);
      ultima.reservas.push({ ...f, horario: horarioFim, deslocamentoMin: min });
    });
  }

  return {
    fatiasComRota: fatiasComRota,
    tipoParticao: clusterResult.tipo,
    dif: clusterResult.dif,
    sobras: sobras,
    paradasExcedidas: !!clusterResult.paradasExcedidas
  };
}

// ============================================================
// LINK GOOGLE MAPS
// ============================================================
// O link consumidor do Maps mostra no máx ~10-11 paradas. Rotas maiores
// viram múltiplos links encadeados (fim de um = início do próximo).
function linkMaps(reservas) {
  var links = linksMaps(reservas);
  return links.length > 0 ? links[0] : "#";
}
function linksMaps(reservas) {
  if (reservas.length === 0) return ["#"];
  var pts = reservas.map(function (r) { return encodeURIComponent((r.formatted || r.endereco) + ", Santiago, Chile"); });
  if (pts.length === 1) return ["https://www.google.com/maps/search/?api=1&query=" + pts[0]];

  var LIMITE = 10; // paradas por link
  var partes = [];
  var inicio = 0;
  while (inicio < pts.length - 1) {
    var fim = Math.min(inicio + LIMITE - 1, pts.length - 1);
    var trecho = pts.slice(inicio, fim + 1);
    var url = "https://www.google.com/maps/dir/?api=1&origin=" + trecho[0] +
      "&destination=" + trecho[trecho.length - 1];
    if (trecho.length > 2) url += "&waypoints=" + trecho.slice(1, -1).join("|");
    partes.push(url + "&travelmode=driving");
    inicio = fim; // overlap de 1: fim deste = início do próximo
  }
  return partes;
}

// ============================================================
// COMPONENTE
// ============================================================
export default function App() {
  var [tours, setTours] = useState(TOURS_DEFAULT);
  var [tiposVan, setTiposVan] = useState(TIPOS_VAN_DEFAULT);
  var [tourSel, setTourSel] = useState("Valle Nevado");
  var [horarioCustom, setHorarioCustom] = useState("");
  var [colagem, setColagem] = useState("");
  var [reservas, setReservas] = useState([]);
  var [vansAtivas, setVansAtivas] = useState({});
  var [resultado, setResultado] = useState(null);
  var [processando, setProcessando] = useState(false);
  var [statusMsg, setStatusMsg] = useState("");
  var [abaConfig, setAbaConfig] = useState(false);
  var [cache, setCache] = useState({});
  var [dragging, setDragging] = useState(null);
  var [linhasIgnoradas, setLinhasIgnoradas] = useState([]);
  var [maxParadas, setMaxParadas] = useState(10);
  // Inversão pontual: null = usa padrão do tour | true/false = override pontual
  var [invertirPontual, setInvertirPontual] = useState(null);

  useEffect(function () {
    setCache(carregarCache());
    setTours(carregarTours());
    setTiposVan(carregarTipos());
    try {
      var mp = parseInt(localStorage.getItem("wlc_maxparadas_v1"), 10);
      if (mp > 0) setMaxParadas(mp);
    } catch (e) {}
  }, []);

  // Quando o tour muda, reseta a inversão pontual (volta ao padrão do tour)
  useEffect(function () {
    setInvertirPontual(null);
  }, [tourSel]);

  var tourAtual = tours.find(function (t) { return t.nome === tourSel; }) || tours[0];
  var horarioEf = horarioCustom || tourAtual.horario;
  // Vetor efetivo: se houver override pontual, usa ele; senão, usa o padrão do tour
  var invertidoEfetivo = invertirPontual !== null ? invertirPontual : !!tourAtual.invertido;
  var vetorEfetivo = invertidoEfetivo ? inverterVetor(tourAtual.vetor) : tourAtual.vetor;
  var saidaEfetiva = (tourAtual.saida && typeof tourAtual.saida.lat === "number")
    ? tourAtual.saida
    : (SAIDAS_PADRAO[tourAtual.vetor] || SAIDAS_PADRAO.leste);

  var vansExp = useMemo(function () { return expandirVans(tiposVan, vansAtivas); }, [tiposVan, vansAtivas]);
  var totalPax = reservas.reduce(function (s, r) { return s + r.passageiros; }, 0);
  var totalCap = vansExp.reduce(function (s, v) { return s + v.capacidade; }, 0);

  function aplicarColagem() {
    var p = parseColagem(colagem);
    setReservas(p.reservas);
    setLinhasIgnoradas(p.ignoradas);
  }
  function atualizarReserva(id, campo, val) {
    setReservas(reservas.map(function (r) {
      if (r.id !== id) return r;
      return { ...r, [campo]: campo === "passageiros" ? parseInt(val) || 0 : val };
    }));
  }
  function removerReserva(id) { setReservas(reservas.filter(function (r) { return r.id !== id; })); }
  function addManual() {
    setReservas(reservas.concat([{ id: "r" + Date.now(), endereco: "", passageiros: 1 }]));
  }
  function ajustarVan(id, d) {
    var atual = vansAtivas[id] || 0;
    setVansAtivas({ ...vansAtivas, [id]: Math.max(0, atual + d) });
  }
  function limparTudo() {
    setColagem(""); setReservas([]); setResultado(null); setHorarioCustom(""); setVansAtivas({});
    setInvertirPontual(null); setLinhasIgnoradas([]);
  }
  function limparCache() {
    if (confirm("Limpar cache de geocoding?")) {
      localStorage.removeItem(CACHE_KEY); setCache({}); alert("Cache limpo.");
    }
  }
  function toggleInversaoTour(nomeTour) {
    var novos = tours.map(function (t) {
      if (t.nome !== nomeTour) return t;
      return { ...t, invertido: !t.invertido };
    });
    setTours(novos);
    salvarTours(novos);
  }
  function toggleInversaoPontual() {
    // Cycle: null (padrão) -> oposto do padrão -> null
    if (invertirPontual === null) {
      setInvertirPontual(!tourAtual.invertido);
    } else {
      setInvertirPontual(null);
    }
  }

  async function gerarRota() {
    if (reservas.length === 0 || vansExp.length === 0) return;
    setProcessando(true);
    setStatusMsg("Iniciando...");
    setResultado(null);

    try {
      var unificadas = unificarReservas(reservas);
      var resultado7 = await processarRotaV7(unificadas, saidaEfetiva, invertidoEfetivo, horarioEf, cache, vansExp, maxParadas, setStatusMsg);

      var rotasFinais = resultado7.fatiasComRota.map(function (fatia) {
        var totalPaxR = fatia.reservas.reduce(function (s, r) { return s + r.passageiros; }, 0);
        return {
          van: fatia.van,
          reservas: fatia.reservas,
          totalPax: totalPaxR,
          excesso: totalPaxR > fatia.van.capacidade,
          linksMaps: linksMaps(fatia.reservas)
        };
      });

      setResultado({
        rotas: rotasFinais,
        tipoParticao: resultado7.tipoParticao,
        dif: resultado7.dif,
        sobras: resultado7.sobras || [],
        paradasExcedidas: !!resultado7.paradasExcedidas,
        vetorAplicado: vetorEfetivo,
        invertido: invertidoEfetivo
      });
      setStatusMsg("");
    } catch (e) {
      setStatusMsg("Erro: " + e.message);
      if (typeof console !== "undefined") console.error(e);
    } finally {
      setProcessando(false);
    }
  }

  function onDragStart(rId, rotaIdx) { setDragging({ rId: rId, rotaIdx: rotaIdx }); }
  function onDragOver(e) { e.preventDefault(); }

  async function onDropParada(targetRotaIdx, targetReservaId, e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    if (!dragging) return;
    if (dragging.rId === targetReservaId) { setDragging(null); return; }

    if (dragging.rotaIdx === targetRotaIdx) {
      setProcessando(true);
      setStatusMsg("Reordenando e recalculando tempos...");
      try {
        var rotaOriginal = resultado.rotas[targetRotaIdx];
        var reservasR = rotaOriginal.reservas.slice();
        var fromIdx = reservasR.findIndex(function (x) { return x.id === dragging.rId; });
        var toIdx = reservasR.findIndex(function (x) { return x.id === targetReservaId; });
        if (fromIdx === -1 || toIdx === -1) { setDragging(null); setProcessando(false); return; }
        var movido = reservasR.splice(fromIdx, 1)[0];
        reservasR.splice(toIdx, 0, movido);

        var ptsOk = reservasR.filter(function (r) { return r.lat; }).map(function (r) { return { lat: r.lat, lng: r.lng }; });
        var novasLegs = [];
        if (ptsOk.length >= 2) {
          var rl = await chamarRoutes(ptsOk, horarioEf, false);
          if (!rl.erro) novasLegs = rl.legs || [];
        }

        var horarios = [], deslocs = [];
        var legIdx = 0;
        for (var i = 0; i < reservasR.length; i++) {
          if (i === 0) { horarios[i] = horarioEf; deslocs[i] = 0; }
          else {
            var min;
            var at = reservasR[i], an = reservasR[i - 1];
            if (at.lat && an.lat && novasLegs[legIdx]) {
              min = arredondar5(novasLegs[legIdx].durationSec / 60 + 1.5);
              legIdx++;
            } else if (at.lat && an.lat) {
              min = tempoEstimadoMin(an, at);
            } else { min = 10; }
            deslocs[i] = min;
            horarios[i] = somarMinutos(horarios[i - 1], min);
          }
        }

        var reservasNew = reservasR.map(function (r, i) {
          return { ...r, horario: horarios[i], deslocamentoMin: deslocs[i] };
        });
        var tp = reservasNew.reduce(function (s, r) { return s + r.passageiros; }, 0);
        var rotaNova = {
          van: rotaOriginal.van,
          reservas: reservasNew,
          totalPax: tp,
          excesso: tp > rotaOriginal.van.capacidade,
          linksMaps: linksMaps(reservasNew)
        };
        var novasRotas = resultado.rotas.slice();
        novasRotas[targetRotaIdx] = rotaNova;
        setResultado({ ...resultado, rotas: novasRotas });
        setStatusMsg("");
      } catch (e) {
        setStatusMsg("Erro ao reordenar: " + e.message);
      } finally {
        setProcessando(false);
        setDragging(null);
      }
    } else {
      await onDrop(targetRotaIdx);
    }
  }

  async function onDrop(target) {
    if (!dragging || dragging.rotaIdx === target) { setDragging(null); return; }
    setProcessando(true);
    setStatusMsg("Recalculando rota destino após movimento...");

    try {
      var rotaDestino = resultado.rotas[target];
      var movido = resultado.rotas[dragging.rotaIdx].reservas.find(function (x) { return x.id === dragging.rId; });
      var reservasDest = rotaDestino.reservas.concat([movido]);

      var otimizados = await otimizarVan(reservasDest, saidaEfetiva, invertidoEfetivo, horarioEf);
      var ptsLeg = otimizados.filter(function (r) { return r.lat; }).map(function (r) { return { lat: r.lat, lng: r.lng }; });
      var legs = [];
      if (ptsLeg.length >= 2) {
        var rl = await chamarRoutes(ptsLeg, horarioEf, false);
        if (!rl.erro) legs = rl.legs || [];
      }

      var horarios = [], deslocs = [];
      var idxLeg = 0;
      for (var j = 0; j < otimizados.length; j++) {
        if (j === 0) { horarios[j] = horarioEf; deslocs[j] = 0; }
        else {
          var min;
          var at = otimizados[j], an = otimizados[j - 1];
          if (at.lat && an.lat && legs[idxLeg]) { min = arredondar5(legs[idxLeg].durationSec / 60 + 1.5); idxLeg++; }
          else if (at.lat && an.lat) { min = tempoEstimadoMin(an, at); }
          else { min = 10; }
          deslocs[j] = min;
          horarios[j] = somarMinutos(horarios[j - 1], min);
        }
      }
      var reservasNew = otimizados.map(function (r, i) { return { ...r, horario: horarios[i], deslocamentoMin: deslocs[i] }; });
      var tpDest = reservasNew.reduce(function (s, r) { return s + r.passageiros; }, 0);
      var rotaDestNova = {
        van: rotaDestino.van,
        reservas: reservasNew,
        totalPax: tpDest,
        excesso: tpDest > rotaDestino.van.capacidade,
        linksMaps: linksMaps(reservasNew)
      };

      var reservasOrigem = resultado.rotas[dragging.rotaIdx].reservas.filter(function (x) { return x.id !== dragging.rId; });
      var horariosO = [], deslocsO = [];
      for (var jo = 0; jo < reservasOrigem.length; jo++) {
        if (jo === 0) { horariosO[jo] = horarioEf; deslocsO[jo] = 0; }
        else {
          var min2;
          var atO = reservasOrigem[jo], anO = reservasOrigem[jo - 1];
          if (atO.lat && anO.lat) min2 = tempoEstimadoMin(anO, atO);
          else min2 = 10;
          deslocsO[jo] = min2;
          horariosO[jo] = somarMinutos(horariosO[jo - 1], min2);
        }
      }
      var reservasOrigemNew = reservasOrigem.map(function (r, i) { return { ...r, horario: horariosO[i], deslocamentoMin: deslocsO[i] }; });
      var tpOrig = reservasOrigemNew.reduce(function (s, r) { return s + r.passageiros; }, 0);
      var rotaOrigNova = {
        van: resultado.rotas[dragging.rotaIdx].van,
        reservas: reservasOrigemNew,
        totalPax: tpOrig,
        excesso: false,
        linksMaps: linksMaps(reservasOrigemNew)
      };

      var novasRotas = resultado.rotas.slice();
      novasRotas[target] = rotaDestNova;
      novasRotas[dragging.rotaIdx] = rotaOrigNova;
      novasRotas = novasRotas.filter(function (r) { return r.reservas.length > 0; });

      setResultado({ ...resultado, rotas: novasRotas });
      setStatusMsg("");
    } catch (e) {
      setStatusMsg("Erro ao recalcular: " + e.message);
    } finally {
      setProcessando(false);
      setDragging(null);
    }
  }

  // Estilos inline pra elementos novos (não preciso mexer em styles.js)
  var styleBtnInverter = {
    padding: "4px 8px", fontSize: 10, background: "transparent",
    border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.55)",
    cursor: "pointer", borderRadius: 3, marginLeft: 6, fontFamily: "monospace"
  };
  var styleBtnInverterAtivo = {
    ...styleBtnInverter, background: "rgba(250, 180, 60, 0.15)",
    borderColor: "rgba(250, 180, 60, 0.5)", color: "#fab43c"
  };
  var styleVetorInvertido = {
    fontSize: 10, padding: "2px 6px", borderRadius: 3,
    background: "rgba(250, 180, 60, 0.15)", color: "#fab43c",
    border: "1px solid rgba(250, 180, 60, 0.3)", fontFamily: "monospace"
  };
  var styleSentidoToggle = {
    display: "flex", alignItems: "center", gap: 8, marginTop: 8,
    padding: "8px 10px", borderRadius: 4,
    background: invertidoEfetivo ? "rgba(250, 180, 60, 0.08)" : "rgba(255,255,255,0.03)",
    border: "1px solid " + (invertidoEfetivo ? "rgba(250, 180, 60, 0.3)" : "rgba(255,255,255,0.08)"),
    cursor: "pointer", fontSize: 12,
    color: invertidoEfetivo ? "#fab43c" : "rgba(255,255,255,0.6)"
  };

  return (
    <div style={styles.app}>
      <div style={styles.grain}></div>

      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>◈</div>
          <div>
            <div style={styles.brand}>WeLoveChile</div>
            <div style={styles.subBrand}>Route Dispatcher · Santiago · v7.3.1 · Setorização</div>
          </div>
        </div>
        <div style={styles.headerRight}>
          <button style={!abaConfig ? styles.tabActive : styles.tab} onClick={function () { setAbaConfig(false); }}>ROTEIRIZAR</button>
          <button style={abaConfig ? styles.tabActive : styles.tab} onClick={function () { setAbaConfig(true); }}>CONFIGURAÇÃO</button>
        </div>
      </header>

      {!abaConfig && (
        <main style={styles.main}>
          <section style={styles.col}>
            <div style={styles.panel}>
              <div style={styles.pHead}><span style={styles.pNum}>01</span><span style={styles.pTitle}>TOUR & HORÁRIO</span></div>
              <div style={styles.field}>
                <label style={styles.label}>Tour</label>
                <select value={tourSel} onChange={function (e) { setTourSel(e.target.value); setHorarioCustom(""); }} style={styles.select}>
                  {tours.map(function (t) {
                    var lbl = t.nome + " · " + t.horario + " · " + t.vetor + (t.invertido ? " (invertido)" : "");
                    return <option key={t.nome} value={t.nome}>{lbl}</option>;
                  })}
                </select>
              </div>
              <div style={styles.fieldRow}>
                <div style={styles.fieldHalf}>
                  <label style={styles.label}>Padrão</label>
                  <div style={styles.readonly}>{tourAtual.horario}</div>
                </div>
                <div style={styles.fieldHalf}>
                  <label style={styles.label}>Esta rota</label>
                  <input type="time" value={horarioCustom || tourAtual.horario} onChange={function (e) { setHorarioCustom(e.target.value); }} style={styles.input} />
                </div>
              </div>
              <div style={styles.meta}>
                <span style={styles.chip}>
                  vetor <strong>{vetorEfetivo}</strong>
                  {invertidoEfetivo && <span style={{ marginLeft: 6, color: "#fab43c" }}>↔ invertido</span>}
                </span>
                <span style={styles.chipHL}>1ª parada: <strong>{horarioEf}</strong></span>
              </div>

              {/* Toggle de inversão pontual */}
              <div style={styleSentidoToggle} onClick={toggleInversaoPontual}>
                <input
                  type="checkbox"
                  checked={invertidoEfetivo}
                  onChange={function () { }}
                  style={{ cursor: "pointer", accentColor: "#fab43c" }}
                />
                <span style={{ flex: 1 }}>
                  ↔ Inverter sentido desta rota
                  {invertirPontual !== null && (
                    <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>
                      (override do padrão)
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>
                  padrão: {tourAtual.invertido ? inverterVetor(tourAtual.vetor) : tourAtual.vetor}
                </span>
              </div>
            </div>

            <div style={styles.panel}>
              <div style={styles.pHead}>
                <span style={styles.pNum}>02</span><span style={styles.pTitle}>VANS DISPONÍVEIS</span>
                <div style={styles.pHeadAct}><button style={styles.miniBtn} onClick={function () { setVansAtivas({}); }}>limpar</button></div>
              </div>
              <div style={styles.vanList}>
                {tiposVan.slice().sort(function (a, b) { return a.capacidade - b.capacidade; }).map(function (t) {
                  var q = vansAtivas[t.id] || 0;
                  return (
                    <div key={t.id} style={q > 0 ? styles.vanRowAct : styles.vanRow}>
                      <div style={styles.vanLbl}><span style={styles.vanCap}>{t.capacidade}</span><span style={styles.vanSuf}>pax</span></div>
                      <div style={styles.counter}>
                        <button style={q === 0 ? styles.cBtnD : styles.cBtn} onClick={function () { ajustarVan(t.id, -1); }} disabled={q === 0}>−</button>
                        <div style={styles.cVal}>{q}</div>
                        <button style={styles.cBtn} onClick={function () { ajustarVan(t.id, 1); }}>+</button>
                      </div>
                      <div style={styles.vanTot}>{q > 0 ? "= " + (q * t.capacidade) + " pax" : ""}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 2px", fontSize: 12 }}>
                <span style={{ opacity: 0.7 }}>máx paradas/van</span>
                <input style={{ ...styles.inputN, width: 56 }} type="number" min="2" max="30" value={maxParadas}
                  title="Limite SUAVE de paradas por van (qualidade de serviço). Se a capacidade não permitir, o sistema excede e avisa."
                  onChange={function (e) {
                    var v = parseInt(e.target.value, 10) || 10;
                    setMaxParadas(v);
                    try { localStorage.setItem("wlc_maxparadas_v1", String(v)); } catch (err) {}
                  }} />
                <span style={{ opacity: 0.45, fontSize: 11 }}>limite suave · excede com aviso se precisar</span>
              </div>
              <div style={styles.capInfo}>
                <div style={styles.capItem}><span style={styles.capLbl}>Pax total</span><span style={styles.capVal}>{totalPax}</span></div>
                <div style={styles.capSep}>/</div>
                <div style={styles.capItem}><span style={styles.capLbl}>Capacidade</span>
                  <span style={totalCap === 0 ? styles.capValM : totalCap >= totalPax ? styles.capValOk : styles.capValAl}>{totalCap}</span>
                </div>
              </div>
            </div>

            <div style={styles.panel}>
              <div style={styles.pHead}>
                <span style={styles.pNum}>03</span><span style={styles.pTitle}>RESERVAS</span>
                <div style={styles.pHeadAct}>{reservas.length > 0 && <span style={styles.cntBadge}>{reservas.length}</span>}</div>
              </div>
              <label style={styles.label}>Cole a lista do sistema atual</label>
              <textarea style={styles.textarea} placeholder={"1) 06:30 / 4 PAX / Carmen 77\n2) ~21:00 / 2 PAX / Manuel Montt 234"} value={colagem} onChange={function (e) { setColagem(e.target.value); }} rows={5} />
              <div style={styles.btnRow}>
                <button style={colagem.trim() ? styles.btnSec : styles.btnSecD} onClick={aplicarColagem} disabled={!colagem.trim()}>
                  ↓ PROCESSAR COLAGEM
                </button>
              </div>

              {linhasIgnoradas.length > 0 && (
                <div style={{
                  marginTop: 8, padding: "8px 10px", borderRadius: 4, fontSize: 11,
                  background: "rgba(250, 180, 60, 0.08)", border: "1px solid rgba(250, 180, 60, 0.3)",
                  color: "#fab43c", lineHeight: 1.5
                }}>
                  ⚠ {linhasIgnoradas.length} linha{linhasIgnoradas.length > 1 ? "s" : ""} não interpretada{linhasIgnoradas.length > 1 ? "s" : ""} (sem pax ou endereço):
                  {linhasIgnoradas.slice(0, 5).map(function (l, i) {
                    return <div key={i} style={{ opacity: 0.8, fontFamily: "monospace" }}>· {l}</div>;
                  })}
                  {linhasIgnoradas.length > 5 && <div style={{ opacity: 0.6 }}>… e mais {linhasIgnoradas.length - 5}</div>}
                </div>
              )}

              {reservas.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={styles.listHead}>Reservas detectadas</div>
                  <div style={styles.resList}>
                    {reservas.map(function (r, i) {
                      return (
                        <div key={r.id} style={styles.resRow}>
                          <div style={styles.resNum}>{i + 1}</div>
                          <input type="text" value={r.endereco} onChange={function (e) { atualizarReserva(r.id, "endereco", e.target.value); }} style={styles.resEnd} />
                          <input type="number" min="1" value={r.passageiros} onChange={function (e) { atualizarReserva(r.id, "passageiros", e.target.value); }} style={styles.resPax} />
                          <span style={styles.paxSuf}>p</span>
                          <button style={styles.btnRem} onClick={function () { removerReserva(r.id); }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                  <button style={styles.btnAdd} onClick={addManual}>+ adicionar manual</button>
                </div>
              )}
            </div>

            <div style={styles.acts}>
              <button style={reservas.length > 0 && vansExp.length > 0 && !processando ? styles.btnPri : styles.btnPriD}
                onClick={gerarRota} disabled={reservas.length === 0 || vansExp.length === 0 || processando}>
                {processando ? "PROCESSANDO..." : "→ GERAR ROTA"}
              </button>
              <button style={styles.btnGh} onClick={limparTudo}>Limpar</button>
            </div>

            {processando && statusMsg && (
              <div style={styles.statusBox}>⚙ {statusMsg}</div>
            )}
          </section>

          <section style={styles.col}>
            <div style={styles.panel}>
              <div style={styles.pHead}><span style={styles.pNum}>04</span><span style={styles.pTitle}>ROTAS GERADAS</span></div>

              {!resultado && !processando && (
                <div style={styles.empty}>
                  <div style={styles.emptyMark}>∅</div>
                  <div>Aguardando entrada.</div>
                  <div style={styles.emptyHint}>
                    v7.3.0: vans setorizadas rumo à saída do tour,<br />
                    fatias balanceadas + reparo geográfico 2D,<br />
                    otimiza cada van separadamente no Google.<br />
                    <span style={{ color: "#fab43c" }}>↔ Sentido configurável por tour ou pontual</span>
                  </div>
                </div>
              )}

              {resultado && (
                <div>
                  {resultado.invertido && (
                    <div style={{
                      padding: "8px 12px", marginBottom: 10,
                      background: "rgba(250, 180, 60, 0.08)", border: "1px solid rgba(250, 180, 60, 0.25)",
                      borderRadius: 4, fontSize: 11, color: "#fab43c"
                    }}>
                      ↔ Sentido invertido aplicado · vetor: {resultado.vetorAplicado}
                    </div>
                  )}
                  {resultado.tipoParticao === "relaxado" && (
                    <div style={{
                      padding: "10px 14px", marginBottom: 12,
                      background: "rgba(250, 180, 60, 0.1)", border: "1px solid rgba(250, 180, 60, 0.3)",
                      borderRadius: 4, fontSize: 12, color: "#fab43c"
                    }}>
                      ℹ Capacidade apertada: alguns pontos foram movidos entre vans pra caber. Desbalanceamento: {resultado.dif} pax.
                    </div>
                  )}
                  {resultado.paradasExcedidas && (
                    <div style={{
                      padding: "10px 14px", marginBottom: 12,
                      background: "rgba(250, 180, 60, 0.1)", border: "1px solid rgba(250, 180, 60, 0.3)",
                      borderRadius: 4, fontSize: 12, color: "#fab43c"
                    }}>
                      ℹ Limite de {maxParadas} paradas/van excedido em alguma rota: a capacidade ativa não permitiu menos.
                      Pra rotas mais curtas, ative mais lugares ou ajuste o limite.
                    </div>
                  )}
                  {resultado.sobras && resultado.sobras.length > 0 && (
                    <div style={{
                      padding: "10px 14px", marginBottom: 12,
                      background: "rgba(250, 80, 80, 0.1)", border: "1px solid rgba(250, 80, 80, 0.3)",
                      borderRadius: 4, fontSize: 12, color: "#fa5050", lineHeight: 1.6
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        ⚠ {resultado.sobras.reduce(function (sx, r) { return sx + r.passageiros; }, 0)} pax em {resultado.sobras.length} reserva{resultado.sobras.length > 1 ? "s" : ""} SEM VAN
                      </div>
                      <div style={{ opacity: 0.85, marginBottom: 6 }}>
                        {totalCap >= totalPax
                          ? "A capacidade nominal (" + totalCap + ") cobre o total (" + totalPax + "), mas os tamanhos dos grupos não fecham nos lugares livres. Adicione 1 van de folga ou mova grupos manualmente."
                          : "Faltam " + (totalPax - totalCap) + " lugares (" + totalPax + " pax / " + totalCap + "). As rotas abaixo cobrem o que coube."}
                      </div>
                      {resultado.sobras.map(function (r) {
                        return (
                          <div key={r.id} style={{ fontFamily: "monospace", fontSize: 11, opacity: 0.9 }}>
                            · {r.endereco} — {r.passageiros}p
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {resultado.tipoParticao === "erro_capacidade" && (
                    <div style={{
                      padding: "10px 14px", marginBottom: 12,
                      background: "rgba(250, 80, 80, 0.1)", border: "1px solid rgba(250, 80, 80, 0.3)",
                      borderRadius: 4, fontSize: 12, color: "#fa5050"
                    }}>
                      ⚠ Capacidade total insuficiente: {totalPax} pax para {totalCap} lugares. Adicione mais vans.
                    </div>
                  )}
                  {resultado.tipoParticao === "encaixe" && (
                    <div style={{
                      padding: "10px 14px", marginBottom: 12,
                      background: "rgba(250, 180, 60, 0.1)", border: "1px solid rgba(250, 180, 60, 0.3)",
                      borderRadius: 4, fontSize: 12, color: "#fab43c"
                    }}>
                      ℹ Folga mínima ({totalCap - totalPax} {totalCap - totalPax === 1 ? "lugar livre" : "lugares livres"}):
                      a distribuição priorizou encaixar os grupos — a divisão geográfica entre vans pode ficar imperfeita.
                      Desbalanceamento: {resultado.dif} pax.
                    </div>
                  )}
                  {resultado.rotas.length > 1 && <div style={styles.dragHint}>↕ arraste clientes entre rotas</div>}

                  {resultado.rotas.map(function (rota, idx) {
                    var ocup = rota.van ? Math.round((rota.totalPax / rota.van.capacidade) * 100) : 0;
                    var dropT = dragging && dragging.rotaIdx !== idx;
                    return (
                      <div key={idx} style={dropT ? styles.rotaDrop : styles.rota} onDragOver={onDragOver} onDrop={function () { onDrop(idx); }}>
                        <div style={styles.rotaHead}>
                          <span style={styles.rotaNum}>ROTA {idx + 1}</span>
                          <span style={styles.rotaVan}>{rota.van.nome}</span>
                          <span style={styles.rotaPax}>{rota.totalPax}/{rota.van.capacidade} pax</span>
                          {rota.reservas.length > maxParadas && (
                            <span style={{
                              fontSize: 10, padding: "2px 6px", borderRadius: 3,
                              border: "1px solid rgba(250, 180, 60, 0.4)", color: "#fab43c"
                            }}>{rota.reservas.length} paradas</span>
                          )}
                          <span style={styles.rotaOcup(ocup, rota.excesso)}>{rota.excesso ? "EXCESSO" : ocup + "%"}</span>
                        </div>
                        <div style={styles.paradas}>
                          {rota.reservas.map(function (r, i) {
                            var unif = r.origens && r.origens.length > 1;
                            var isDragTarget = dragging && dragging.rId !== r.id;
                            return (
                              <div
                                key={r.id}
                                draggable
                                onDragStart={function () { onDragStart(r.id, idx); }}
                                onDragOver={onDragOver}
                                onDrop={function (e) { onDropParada(idx, r.id, e); }}
                                style={isDragTarget ? styles.paradaDragTarget : styles.parada}
                              >
                                <div style={styles.pDrag}>⋮⋮</div>
                                <div style={styles.pNum}>{i + 1}</div>
                                <div style={styles.pHora}>{r.horario}</div>
                                <div style={styles.pInfo}>
                                  <div style={styles.pEnd}>{r.endereco}</div>
                                  <div style={styles.pMeta}>
                                    {i > 0 && r.deslocamentoMin > 0 && <span style={styles.deslocCh}>+{r.deslocamentoMin}min</span>}
                                    {r.comuna && <span style={styles.comunaCh}>{r.comuna}</span>}
                                    {unif && <span style={styles.unifCh}>{r.origens.length} reservas · {r.origens.join("+")}</span>}
                                    {!r.lat && <span style={styles.errCh}>não geocodificado</span>}
                                    {r.lat && r.setor === 99 && <span style={styles.errCh}>⚠ fora da área — conferir endereço</span>}
                                    {r.lat && r.geoSuspeito && r.setor !== 99 && <span style={styles.errCh}>⚠ longe da rota — conferir endereço</span>}
                                  </div>
                                </div>
                                <div style={styles.pRight}>
                                  <span style={styles.setorCh(r.setor)}>{nomeSetor(r.setor)}</span>
                                  <span style={styles.paxBadge}>{r.passageiros}p</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {(rota.linksMaps || []).map(function (lk, li) {
                          return (
                            <a key={li} href={lk} target="_blank" rel="noopener noreferrer" style={styles.mapsLink}>
                              ▶ VERIFICAR NO GOOGLE MAPS{rota.linksMaps.length > 1 ? " · PARTE " + (li + 1) : ""} ↗
                            </a>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      {abaConfig && (
        <main style={styles.mainConfig}>
          <section style={styles.panel}>
            <div style={styles.pHead}><span style={styles.pNum}>◉</span><span style={styles.pTitle}>TIPOS DE VAN</span></div>
            <div style={styles.cfgList}>
              {tiposVan.map(function (t, i) {
                return (
                  <div key={t.id} style={styles.cfgRow}>
                    <span style={styles.cfgLbl}>Capacidade</span>
                    <input style={styles.inputN} type="number" value={t.capacidade} onChange={function (e) {
                      var n = tiposVan.slice(); n[i] = { ...n[i], capacidade: parseInt(e.target.value) || 0 }; setTiposVan(n); salvarTipos(n);
                    }} />
                    <span style={styles.capLbl}>pax</span>
                    <button style={styles.btnRem} onClick={function () { var n = tiposVan.filter(function (_, j) { return j !== i; }); setTiposVan(n); salvarTipos(n); }}>×</button>
                  </div>
                );
              })}
              <button style={styles.btnGhF} onClick={function () { var n = tiposVan.concat([{ id: "t" + Date.now(), capacidade: 10 }]); setTiposVan(n); salvarTipos(n); }}>+ adicionar tipo</button>
            </div>
          </section>

          <section style={styles.panel}>
            <div style={styles.pHead}><span style={styles.pNum}>◉</span><span style={styles.pTitle}>HORÁRIOS PADRÃO & SENTIDO</span></div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", padding: "0 0 12px 0", lineHeight: 1.5 }}>
              Clique no <strong style={{ color: "#fab43c" }}>↔</strong> ao lado do vetor pra inverter o sentido padrão de cada tour.
              <strong style={{ color: "#fab43c" }}> Saída</strong> = coordenada (lat / lng) por onde a van deixa a cidade rumo ao tour:
              a última parada da rota será a mais próxima dela. Pegue a coordenada clicando com botão direito no Google Maps.
            </div>
            <div style={styles.cfgList}>
              {tours.map(function (t, i) {
                var vetorMostrado = t.invertido ? inverterVetor(t.vetor) : t.vetor;
                return (
                  <div key={t.nome} style={styles.cfgRow}>
                    <div style={styles.tourNm}>{t.nome}</div>
                    <input style={styles.inputT} type="time" value={t.horario} onChange={function (e) {
                      var n = tours.slice(); n[i] = { ...n[i], horario: e.target.value }; setTours(n); salvarTours(n);
                    }} />
                    {t.invertido ? (
                      <span style={styleVetorInvertido}>
                        {t.vetor} → <strong>{vetorMostrado}</strong>
                      </span>
                    ) : (
                      <span style={styles.vetCh}>{t.vetor}</span>
                    )}
                    <span style={{ fontSize: 10, opacity: 0.5, marginLeft: 6 }}>saída:</span>
                    <input style={{ ...styles.inputN, width: 72 }} type="number" step="0.001" value={t.saida ? t.saida.lat : ""}
                      title="Latitude do ponto de saída da cidade"
                      onChange={function (e) {
                        var n = tours.slice();
                        n[i] = { ...n[i], saida: { ...(n[i].saida || SAIDAS_PADRAO[n[i].vetor]), lat: parseFloat(e.target.value) || 0 } };
                        setTours(n); salvarTours(n);
                      }} />
                    <input style={{ ...styles.inputN, width: 72 }} type="number" step="0.001" value={t.saida ? t.saida.lng : ""}
                      title="Longitude do ponto de saída da cidade"
                      onChange={function (e) {
                        var n = tours.slice();
                        n[i] = { ...n[i], saida: { ...(n[i].saida || SAIDAS_PADRAO[n[i].vetor]), lng: parseFloat(e.target.value) || 0 } };
                        setTours(n); salvarTours(n);
                      }} />
                    <button
                      style={t.invertido ? styleBtnInverterAtivo : styleBtnInverter}
                      onClick={function () { toggleInversaoTour(t.nome); }}
                      title={t.invertido ? "Restaurar sentido padrão" : "Inverter sentido padrão"}
                    >
                      ↔ {t.invertido ? "invertido" : "inverter"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section style={styles.panel}>
            <div style={styles.pHead}><span style={styles.pNum}>◉</span><span style={styles.pTitle}>CACHE DE GEOCODING</span></div>
            <div style={styles.cfgHint}>
              Endereços já consultados: <strong>{Object.keys(cache).length}</strong>.<br />
              Cada endereço repetido NÃO consome API.
            </div>
            <button style={styles.btnGhF} onClick={limparCache}>Limpar cache</button>
          </section>
        </main>
      )}

      <footer style={styles.footer}>
        <span>WeLoveChile · v7.3.1 · Setorização</span>
        <span style={styles.fHint}>{Object.keys(cache).length} endereços em cache</span>
      </footer>
    </div>
  );
}
