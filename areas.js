// Major climbing areas used for the climate comparison.
// Coordinates target the actual crag/valley, not just the nearest town,
// so the pulled weather reflects conditions on the rock.
const CLIMBING_AREAS = [
  { id: "yosemite", name: "Yosemite Valley", country: "USA", continent: "North America", lat: 37.7459, lon: -119.5332, elevationM: 1200, style: "Big wall / trad" },
  { id: "joshua-tree", name: "Joshua Tree", country: "USA", continent: "North America", lat: 34.0084, lon: -116.1663, elevationM: 1300, style: "Desert trad & bouldering" },
  { id: "red-river-gorge", name: "Red River Gorge", country: "USA", continent: "North America", lat: 37.7856, lon: -83.6524, elevationM: 240, style: "Sport" },
  { id: "rifle", name: "Rifle Mountain Park", country: "USA", continent: "North America", lat: 39.6039, lon: -107.7648, elevationM: 2010, style: "Sport" },
  { id: "indian-creek", name: "Indian Creek", country: "USA", continent: "North America", lat: 38.0447, lon: -109.5450, elevationM: 1700, style: "Splitter crack / trad" },
  { id: "smith-rock", name: "Smith Rock", country: "USA", continent: "North America", lat: 44.3651, lon: -121.1400, elevationM: 610, style: "Sport" },
  { id: "new-river-gorge", name: "New River Gorge", country: "USA", continent: "North America", lat: 38.0645, lon: -81.0826, elevationM: 320, style: "Sport & trad" },
  { id: "bishop", name: "Bishop (Buttermilks)", country: "USA", continent: "North America", lat: 37.3706, lon: -118.5615, elevationM: 2100, style: "Bouldering" },
  { id: "eldorado-canyon", name: "Eldorado Canyon", country: "USA", continent: "North America", lat: 39.9319, lon: -105.2897, elevationM: 1740, style: "Trad" },
  { id: "squamish", name: "Squamish", country: "Canada", continent: "North America", lat: 49.6997, lon: -123.1520, elevationM: 30, style: "Trad & bouldering" },
  { id: "chamonix", name: "Chamonix (Mont Blanc)", country: "France", continent: "Europe", lat: 45.9237, lon: 6.8694, elevationM: 1035, style: "Alpine & ice" },
  { id: "ceuse", name: "Céüse", country: "France", continent: "Europe", lat: 44.4833, lon: 5.9500, elevationM: 1700, style: "Sport" },
  { id: "fontainebleau", name: "Fontainebleau", country: "France", continent: "Europe", lat: 48.4048, lon: 2.6975, elevationM: 100, style: "Bouldering" },
  { id: "kalymnos", name: "Kalymnos", country: "Greece", continent: "Europe", lat: 36.9500, lon: 26.9833, elevationM: 50, style: "Sport (limestone)" },
  { id: "arco", name: "Arco", country: "Italy", continent: "Europe", lat: 45.9178, lon: 10.8836, elevationM: 90, style: "Sport" },
  { id: "frankenjura", name: "Frankenjura", country: "Germany", continent: "Europe", lat: 49.6167, lon: 11.3167, elevationM: 450, style: "Sport" },
  { id: "margalef", name: "Margalef", country: "Spain", continent: "Europe", lat: 41.2167, lon: 0.8500, elevationM: 400, style: "Sport" },
  { id: "el-chalten", name: "El Chaltén (Fitz Roy)", country: "Argentina", continent: "South America", lat: -49.3315, lon: -72.8875, elevationM: 400, style: "Alpine" },
  { id: "railay", name: "Railay", country: "Thailand", continent: "Asia", lat: 8.0104, lon: 98.8375, elevationM: 10, style: "Sport (limestone karst)" },
  { id: "yangshuo", name: "Yangshuo", country: "China", continent: "Asia", lat: 24.7778, lon: 110.4900, elevationM: 150, style: "Sport (limestone karst)" },
  { id: "rocklands", name: "Rocklands", country: "South Africa", continent: "Africa", lat: -31.9500, lon: 18.9500, elevationM: 200, style: "Bouldering" },
  { id: "grampians", name: "Grampians (Gariwerd)", country: "Australia", continent: "Oceania", lat: -37.2333, lon: 142.3667, elevationM: 300, style: "Trad & bouldering" },
];

const DEFAULT_SELECTED_IDS = ["yosemite", "chamonix", "kalymnos", "joshua-tree"];
const MAX_SELECTED = 5;
