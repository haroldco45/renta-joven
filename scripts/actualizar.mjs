// Robot de noticias · Renta Joven al Día (Vibras Positivas HM)
// Busca titulares nuevos en Google Noticias y los guarda en data/noticias.json
import { readFile, writeFile } from 'node:fs/promises';

const ARCHIVO = 'data/noticias.json';
const BUSQUEDAS = [
  '"Renta Joven"',
  '"Renta Joven" pago',
  '"Renta Joven" Prosperidad Social',
  '"Renta Joven" SENA universidades',
  'Prosperidad Social transferencia jóvenes'
];
const MAX = 80;

const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, '').trim();

const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };

async function buscar(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:30d')}&hl=es-419&gl=CO&ceid=CO:es-419`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (VibrasPositivasHM robot)' } });
  if (!r.ok) throw new Error(`${r.status} en ${q}`);
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    let titulo = tag(it, 'title');
    const fuente = tag(it, 'source');
    if (fuente && titulo.endsWith(' - ' + fuente)) titulo = titulo.slice(0, -(fuente.length + 3));
    return { titulo, url: tag(it, 'link'), fuente, fecha: new Date(tag(it, 'pubDate')).toISOString() };
  });
}

const clave = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '').slice(0, 70);

// Fotos reales de las noticias (GDELT trae la imagen principal de cada artículo)
async function conFotos() {
  const u = 'https://api.gdeltproject.org/api/v2/doc/doc?query=' + encodeURIComponent('"renta joven" sourcecountry:CO') + '&mode=artlist&format=json&maxrecords=75&sort=datedesc&timespan=30d';
  const r = await fetch(u); if (!r.ok) throw new Error('GDELT ' + r.status);
  const j = JSON.parse(await r.text() || '{}');
  return (j.articles || []).filter(a => a.title).map(a => ({
    titulo: a.title, url: a.url, fuente: a.domain, imagen: a.socialimage || '',
    fecha: (a.seendate || '').replace(/(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/, '$1-$2-$3T$4:$5:$6Z')
  }));
}

// Bing Noticias trae la foto de cada noticia y el enlace directo al medio
async function bing(q) {
  const r = await fetch('https://www.bing.com/news/search?format=rss&cc=CO&setlang=es&q=' + encodeURIComponent(q), { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('Bing ' + r.status);
  const xml = await r.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    let url = tag(it, 'link');
    try { const u = new URL(url).searchParams.get('url'); if (u) url = u; } catch {}
    let imagen = tag(it, 'News:Image');
    if (imagen) imagen = imagen.replace(/^http:/, 'https:').replace(/&amp;/g, '&') + (imagen.includes('?') ? '&w=400&h=300&c=7' : '');
    return { titulo: tag(it, 'title'), url, fuente: tag(it, 'News:Source'), imagen, fecha: new Date(tag(it, 'pubDate')).toISOString() };
  });
}

let previo = { noticias: [] };
try { previo = JSON.parse(await readFile(ARCHIVO, 'utf8')); } catch {}

const vistos = new Map(previo.noticias.map(n => [clave(n.titulo), n]));
let nuevas = 0;
for (const q of BUSQUEDAS) {
  try {
    for (const n of await buscar(q)) {
      if (!n.titulo || isNaN(Date.parse(n.fecha))) continue;
      const k = clave(n.titulo);
      if (!vistos.has(k)) { vistos.set(k, n); nuevas++; }
    }
  } catch (e) { console.log('Aviso:', e.message); }
}

for (const q of ['"Renta Joven"', '"Renta Joven" pago', 'Renta Joven Prosperidad Social']) {
  try {
    for (const n of await bing(q)) {
      if (!n.titulo || isNaN(Date.parse(n.fecha))) continue;
      const k = clave(n.titulo);
      if (vistos.has(k)) { const v = vistos.get(k); if (!v.imagen && n.imagen) v.imagen = n.imagen; }
      else { vistos.set(k, n); nuevas++; }
    }
  } catch (e) { console.log('Aviso Bing:', e.message); }
}

try {
  for (const n of await conFotos()) {
    if (isNaN(Date.parse(n.fecha))) continue;
    const k = clave(n.titulo);
    if (vistos.has(k)) { if (!vistos.get(k).imagen && n.imagen) vistos.get(k).imagen = n.imagen; }
    else { vistos.set(k, n); nuevas++; }
  }
} catch (e) { console.log('Aviso fotos:', e.message); }

const noticias = [...vistos.values()]
  .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha))
  .slice(0, MAX);

await writeFile(ARCHIVO, JSON.stringify({ actualizado: new Date().toISOString(), noticias }, null, 1) + '\n');
console.log(`Listo: ${nuevas} nuevas, ${noticias.length} en total.`);
