import React, { useState, useMemo, useEffect } from "react";
import { styles } from "./styles.js";

// ============================================================
// WeLoveChile Route Dispatcher v7.0.1 (v7.0 + Inversão de Sentido)
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

var TOURS_DEFAULT = [
  { nome: "Valle Nevado", horario: "05:00", vetor: "leste", invertido: false },
  { nome: "Farellones", horario: "06:00", vetor: "leste", invertido: false },
  { nome: "El Colorado", horario: "05:00", vetor: "leste", invertido: false },
  { nome: "Astronómico Santiago", horario: "14:30", vetor: "sudeste", invertido: false },
  { nome: "Concha y Toro", horario: "07:00", vetor: "sul", invertido: false },
  { nome: "Cousiño Macul", horario: "12:00", vetor: "leste", invertido: false },
  { nome: "Embalse El Yeso", horario: "05:00", vetor: "sudeste", invertido: false },
  { nome: "Isla Negra", horario: "07:30", vetor: "oeste", invertido: false },
  { nome: "Parque Safari", horario: "07:30", vetor: "sul", invertido: false },
  { nome: "Portillo", horario: "05:00", vetor: "norte", invertido: false },
  { nome: "Santa Rita", horario: "08:00", vetor: "sul", invertido: false },
  { nome: "El Principal", horario: "14:00", vetor: "sul", invertido: false },
  { nome: "Termas da Colina", horario: "05:00", vetor: "sudeste", invertido: false },
  { nome: "Transporte Alyan", horario: "14:30", vetor: "sul", invertido: false },
  { nome: "Undurraga", horario: "07:30", vetor: "oeste", invertido: false },
  { nome: "Valparaíso", horario: "06:30", vetor: "oeste", invertido: false }
];

var TIPOS_VAN_DEFAULT = [
  { id: "t6", capacidade: 6 }, { id: "t8", capacidade: 8 }, { id: "t9", capacidade: 9 },
  { id: "t10", capacidade: 10 }, { id: "t15", capacidade: 15 },
  { id: "t18", capacidade: 18 }, { id: "t19", capacidade: 19 }
];

// ============================================================
// VETORES E INVERSÃO
// ============================================================
var VETOR_OPOSTO = {
  "leste": "oeste",
  "oeste": "leste",
  "norte": "sul",
  "sul": "norte",
  "sudeste": "noroeste",
  "noroeste": "sudeste",
  "nordeste": "sudoeste",
  "sudoeste": "nordeste"
};

function inverterVetor(vetor) {
  return VETOR_OPOSTO[vetor] || vetor;
}

// Persistência da config dos tours em localStorage
var TOURS_KEY = "wlc_tours_v1";
function carregarTours() {
  try {
    var raw = localStorage.getItem(TOURS_KEY);
    if (!raw) return TOURS_DEFAULT;
    var saved = JSON.parse(raw);
    // Merge com default (caso novos tours sejam adicionados)
    return TOURS_DEFAULT.map(function (def) {
      var found = saved.find(function (s) { return s.nome === def.nome; });
      if (found) {
        return {
          nome: def.nome,
          vetor: def.vetor,
          horario: found.horario || def.horario,
          invertido: !!found.invertido
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

function ascendentePorVetor(vetor) {
  return (vetor === "leste" || vetor === "norte" || vetor === "sudeste" || vetor === "nordeste");
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
function chaveCache(end) {
  return end.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.,]/g, "");
}
function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function geocodificar(endereco, cache, tentativa) {
  tentativa = tentativa || 1;
  var k = chaveCache(endereco);
  if (cache[k]) return { ...cache[k], fonte: "cache" };
  try {
    var resp = await fetch("/api/geocode?address=" + encodeURIComponent(endereco));
    if (!resp.ok) {
      var err = await resp.json().catch(function () { return {}; });
      if (tentativa < 3) {
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
      if (tentativa < 3 && resp.status >= 500) {
        if (typeof console !== "undefined") console.warn("Routes retry " + tentativa + "/3:", err.error);
        await delay(400 * tentativa);
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

// Otimiza rota de uma van: força origem/destino nos extremos da longitude do vetor
async function otimizarVan(pontosVan, vetor, horarioPartida) {
  var n = pontosVan.length;
  if (n === 0) return [];
  if (n === 1) return pontosVan.slice();

  var ok = pontosVan.filter(function (p) { return p.lat; });
  var falhos = pontosVan.filter(function (p) { return !p.lat; });

  if (ok.length < 2) {
    return ok.concat(falhos);
  }

  var ascendente = ascendentePorVetor(vetor);
  var porLng = ok.slice().sort(function (a, b) { return a.lng - b.lng; });
  var entrada = ascendente ? porLng[0] : porLng[porLng.length - 1];
  var saida = ascendente ? porLng[porLng.length - 1] : porLng[0];

  if (ok.length === 2) {
    return [entrada, saida].concat(falhos);
  }

  var meio = ok.filter(function (p) { return p !== entrada && p !== saida; });
  var pts = [{ lat: entrada.lat, lng: entrada.lng }]
    .concat(meio.map(function (p) { return { lat: p.lat, lng: p.lng }; }))
    .concat([{ lat: saida.lat, lng: saida.lng }]);

  var r = await chamarRoutes(pts, horarioPartida, true);
  if (r.erro) {
    if (typeof console !== "undefined") console.warn("⚠️ Van falhou otimização, usando fallback por lng:", r.erro);
    var fallback = porLng;
    if (!ascendente) fallback = fallback.slice().reverse();
    return fallback.concat(falhos);
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

  return ordenadoLimpo.concat(falhos);
}

// ============================================================
// PARSER COLAGEM
// ============================================================
function parseColagem(texto) {
  var linhas = texto.split("\n").map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
  var reservas = [];
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
    if (endereco.length > 0 && pax > 0) {
      reservas.push({
        id: "r" + Date.now() + "_" + i + "_" + Math.random().toString(36).substring(2, 6),
        endereco: endereco, passageiros: pax
      });
    }
  }
  return reservas;
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

function particionarContiguoViavel(pontosOrd, vansSel) {
  var n = pontosOrd.length;
  var k = vansSel.length;
  if (k > n) return null;
  var pref = prefixSumPax(pontosOrd);
  var melhor = null;
  var cortes = new Array(k + 1);
  cortes[0] = 0; cortes[k] = n;

  function buscar(idx, inicio) {
    if (idx === k) {
      var paxs = [];
      for (var i = 0; i < k; i++) {
        var p = paxIntervalo(pref, cortes[i], cortes[i + 1]);
        if (p > vansSel[i].capacidade) return;
        paxs.push(p);
      }
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
  var pref = prefixSumPax(pontosOrd);
  var melhor = null;
  var cortes = new Array(k + 1);
  cortes[0] = 0; cortes[k] = n;

  function buscar(idx, inicio) {
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

function clusterizarPorVans(pontosOrd, vansDisponiveis) {
  var totalPax = pontosOrd.reduce(function (s, p) { return s + p.passageiros; }, 0);
  var K = calcularVansNecessarias(totalPax, vansDisponiveis);
  var vansSel = vansDisponiveis.slice().sort(function (a, b) { return b.capacidade - a.capacidade; }).slice(0, K);

  var todasIguais = vansSel.every(function (v) { return v.capacidade === vansSel[0].capacidade; });

  var melhor = null;
  if (todasIguais) {
    melhor = particionarContiguoViavel(pontosOrd, vansSel);
  } else {
    var perms = permutacoes(vansSel);
    for (var p = 0; p < perms.length; p++) {
      var r = particionarContiguoViavel(pontosOrd, perms[p]);
      if (r && (melhor === null || r.dif < melhor.dif)) melhor = r;
    }
  }

  if (melhor) return melhor;
  return particionarComRelaxamento(pontosOrd, vansSel);
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
async function processarRotaV7(reservas, vetor, horarioInicio, cache, vansDisponiveis, onProgress) {
  var enriquecidos = [];
  for (var i = 0; i < reservas.length; i++) {
    if (onProgress) onProgress("Geocodificando " + (i + 1) + "/" + reservas.length + ": " + reservas[i].endereco);
    var geo = await geocodificar(reservas[i].endereco, cache);
    enriquecidos.push({ ...reservas[i], ...geo });
    if (i < reservas.length - 1) await delay(150);
  }

  var ok = enriquecidos.filter(function (r) { return r.lat && r.lng; });
  var falhos = enriquecidos.filter(function (r) { return !r.lat; });

  if (ok.length === 0) {
    return { fatiasComRota: [{ van: vansDisponiveis[0] || { capacidade: 0, nome: "?" }, reservas: falhos }], tipoParticao: "vazio" };
  }

  var ascendente = ascendentePorVetor(vetor);
  var ordenados = ok.slice().sort(function (a, b) {
    return ascendente ? a.lng - b.lng : b.lng - a.lng;
  });

  if (typeof console !== "undefined") {
    console.log("=== V7 PIPELINE ===");
    console.log("Vetor aplicado:", vetor, "| Ascendente:", ascendente);
    console.log("Pontos geocodificados:", ok.length, "| Falhos:", falhos.length);
    console.log("Vans disponíveis:", vansDisponiveis.map(function (v) { return v.capacidade; }).join(","));
  }

  if (onProgress) onProgress("Dividindo " + ok.length + " paradas em vans...");
  var clusterResult = clusterizarPorVans(ordenados, vansDisponiveis);

  if (!clusterResult) {
    return {
      fatiasComRota: [{ van: vansDisponiveis[0], reservas: ordenados.concat(falhos) }],
      tipoParticao: "erro_capacidade"
    };
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

    var otimizados = await otimizarVan(fatia.pontos, vetor, horarioInicio);

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

  return { fatiasComRota: fatiasComRota, tipoParticao: clusterResult.tipo, dif: clusterResult.dif };
}

// ============================================================
// LINK GOOGLE MAPS
// ============================================================
function linkMaps(reservas) {
  if (reservas.length === 0) return "#";
  var pts = reservas.map(function (r) { return encodeURIComponent((r.formatted || r.endereco) + ", Santiago, Chile"); });
  if (pts.length === 1) return "https://www.google.com/maps/search/?api=1&query=" + pts[0];
  var url = "https://www.google.com/maps/dir/?api=1&origin=" + pts[0] + "&destination=" + pts[pts.length - 1];
  if (pts.length > 2) url += "&waypoints=" + pts.slice(1, -1).join("|");
  return url + "&travelmode=driving";
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
  // Inversão pontual: null = usa padrão do tour | true/false = override pontual
  var [invertirPontual, setInvertirPontual] = useState(null);

  useEffect(function () {
    setCache(carregarCache());
    setTours(carregarTours());
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

  var vansExp = useMemo(function () { return expandirVans(tiposVan, vansAtivas); }, [tiposVan, vansAtivas]);
  var totalPax = reservas.reduce(function (s, r) { return s + r.passageiros; }, 0);
  var totalCap = vansExp.reduce(function (s, v) { return s + v.capacidade; }, 0);

  function aplicarColagem() { setReservas(parseColagem(colagem)); }
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
    setInvertirPontual(null);
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
      var resultado7 = await processarRotaV7(unificadas, vetorEfetivo, horarioEf, cache, vansExp, setStatusMsg);

      var rotasFinais = resultado7.fatiasComRota.map(function (fatia) {
        var totalPaxR = fatia.reservas.reduce(function (s, r) { return s + r.passageiros; }, 0);
        return {
          van: fatia.van,
          reservas: fatia.reservas,
          totalPax: totalPaxR,
          excesso: totalPaxR > fatia.van.capacidade,
          linkMaps: linkMaps(fatia.reservas)
        };
      });

      setResultado({
        rotas: rotasFinais,
        tipoParticao: resultado7.tipoParticao,
        dif: resultado7.dif,
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
          linkMaps: linkMaps(reservasNew)
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

      var otimizados = await otimizarVan(reservasDest, vetorEfetivo, horarioEf);
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
        linkMaps: linkMaps(reservasNew)
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
        linkMaps: linkMaps(reservasOrigemNew)
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
            <div style={styles.subBrand}>Route Dispatcher · Santiago · v7.0.2 · Bug Fix</div>
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
                    v7.0.1: ordena por longitude no vetor do tour,<br />
                    divide em fatias balanceadas respeitando capacidade,<br />
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
                  {resultado.tipoParticao === "erro_capacidade" && (
                    <div style={{
                      padding: "10px 14px", marginBottom: 12,
                      background: "rgba(250, 80, 80, 0.1)", border: "1px solid rgba(250, 80, 80, 0.3)",
                      borderRadius: 4, fontSize: 12, color: "#fa5050"
                    }}>
                      ⚠ Capacidade total insuficiente. Adicione mais vans.
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
                        <a href={rota.linkMaps} target="_blank" rel="noopener noreferrer" style={styles.mapsLink}>
                          ▶ VERIFICAR NO GOOGLE MAPS ↗
                        </a>
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
                      var n = tiposVan.slice(); n[i] = { ...n[i], capacidade: parseInt(e.target.value) || 0 }; setTiposVan(n);
                    }} />
                    <span style={styles.capLbl}>pax</span>
                    <button style={styles.btnRem} onClick={function () { setTiposVan(tiposVan.filter(function (_, j) { return j !== i; })); }}>×</button>
                  </div>
                );
              })}
              <button style={styles.btnGhF} onClick={function () { setTiposVan(tiposVan.concat([{ id: "t" + Date.now(), capacidade: 10 }])); }}>+ adicionar tipo</button>
            </div>
          </section>

          <section style={styles.panel}>
            <div style={styles.pHead}><span style={styles.pNum}>◉</span><span style={styles.pTitle}>HORÁRIOS PADRÃO & SENTIDO</span></div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", padding: "0 0 12px 0", lineHeight: 1.5 }}>
              Clique no <strong style={{ color: "#fab43c" }}>↔</strong> ao lado do vetor pra inverter o sentido padrão de cada tour.
              Útil quando os motoristas começam pelo lado oposto ao natural (ex: Concha y Toro saindo do oeste).
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
        <span>WeLoveChile · v7.0.2 · Bug Fix (1 intermediário)</span>
        <span style={styles.fHint}>{Object.keys(cache).length} endereços em cache</span>
      </footer>
    </div>
  );
}
