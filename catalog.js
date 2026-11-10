// Small mock catalog so the demo runs anywhere. Swap `searchProducts` for a
// real product API (e.g. Channel3) without touching the agent or guardrails.

export const CATALOG = [
  { id: 'p01', name: 'Wireless Earbuds', price: 29.99, category: 'electronics', rating: 4.4, tags: ['audio', 'music', 'gift', 'gadget'] },
  { id: 'p02', name: 'Noise-Cancelling Headphones', price: 79.0, category: 'electronics', rating: 4.6, tags: ['audio', 'music', 'travel'] },
  { id: 'p03', name: 'Phone Stand', price: 12.5, category: 'electronics', rating: 4.3, tags: ['desk', 'phone', 'gift', 'office'] },
  { id: 'p04', name: 'USB-C Fast Charger', price: 18.0, category: 'electronics', rating: 4.5, tags: ['charger', 'phone', 'travel'] },
  { id: 'p05', name: 'Scented Soy Candle Set', price: 24.0, category: 'home', rating: 4.7, tags: ['gift', 'relax', 'candle', 'home'] },
  { id: 'p06', name: 'Ceramic Coffee Mug Set (4)', price: 26.5, category: 'home', rating: 4.5, tags: ['coffee', 'kitchen', 'gift'] },
  { id: 'p07', name: 'Pour-Over Coffee Kit', price: 44.0, category: 'home', rating: 4.6, tags: ['coffee', 'kitchen', 'gift'] },
  { id: 'p08', name: 'Hardcover Notebook (2-pack)', price: 14.0, category: 'stationery', rating: 4.6, tags: ['writing', 'office', 'student', 'gift'] },
  { id: 'p09', name: 'Gel Pen Collection (24)', price: 11.0, category: 'stationery', rating: 4.4, tags: ['writing', 'student', 'art'] },
  { id: 'p10', name: 'Yoga Mat', price: 32.0, category: 'fitness', rating: 4.5, tags: ['yoga', 'exercise', 'gift'] },
  { id: 'p11', name: 'Resistance Band Set', price: 19.5, category: 'fitness', rating: 4.4, tags: ['exercise', 'gym', 'home'] },
  { id: 'p12', name: 'Insulated Water Bottle', price: 22.0, category: 'fitness', rating: 4.7, tags: ['hydration', 'gym', 'travel', 'gift'] },
  { id: 'p13', name: 'Bestselling Novel (Paperback)', price: 9.5, category: 'books', rating: 4.5, tags: ['reading', 'gift', 'book'] },
  { id: 'p14', name: 'Premium Whisky Gift Pack', price: 55.0, category: 'alcohol', rating: 4.6, tags: ['gift', 'whisky', 'drink'] },
  { id: 'p15', name: 'Board Game: Strategy Night', price: 38.0, category: 'games', rating: 4.6, tags: ['gift', 'family', 'game'] },
  { id: 'p16', name: 'Mechanical Keyboard', price: 89.0, category: 'electronics', rating: 4.7, tags: ['desk', 'office', 'typing'] },
];

export function getProduct(id) {
  return CATALOG.find((p) => p.id === id);
}

export function searchProducts({ query = '', max_price } = {}) {
  const words = String(query).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const limit = Number.isFinite(Number(max_price)) && Number(max_price) > 0 ? Number(max_price) : Infinity;
  return CATALOG
    .map((p) => {
      const hay = `${p.name} ${p.category} ${p.tags.join(' ')}`.toLowerCase();
      const score = words.length ? words.filter((w) => hay.includes(w)).length : 1;
      return { p, score };
    })
    .filter(({ p, score }) => score > 0 && p.price <= limit)
    .sort((a, b) => b.score - a.score || b.p.rating - a.p.rating)
    .slice(0, 6)
    .map(({ p }) => p);
}
