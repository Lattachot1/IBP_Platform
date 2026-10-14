export type Port = {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
};
export type Shipment = {
  id: string;
  direction: "inbound" | "outbound";
  origin: string;
  destination: string;
  partner: string;
  product: string;
  tons: number;
  departure: number;
  transitDays: number;
  dueDay: number;
  freightPerTon: number;
};
export const DEMO_START = "2026-09-01";
export const DEMO_DAYS = 61;
export const PORTS: Port[] = [
  {
    id: "th",
    name: "Thailand hub",
    country: "Thailand",
    lat: 12.7,
    lon: 101.15,
  },
  { id: "sg", name: "Singapore", country: "Singapore", lat: 1.26, lon: 103.84 },
  { id: "jp", name: "Yokkaichi", country: "Japan", lat: 34.95, lon: 136.63 },
  { id: "kr", name: "Busan", country: "South Korea", lat: 35.08, lon: 129.04 },
  { id: "cn", name: "Shanghai", country: "China", lat: 31.23, lon: 121.47 },
  { id: "in", name: "Mumbai", country: "India", lat: 18.95, lon: 72.95 },
  {
    id: "nl",
    name: "Rotterdam",
    country: "Netherlands",
    lat: 51.95,
    lon: 4.14,
  },
  {
    id: "us",
    name: "Los Angeles",
    country: "United States",
    lat: 33.74,
    lon: -118.27,
  },
];
export const MOCK_SHIPMENTS: Shipment[] = [
  {
    id: "IN-001",
    direction: "inbound",
    origin: "sg",
    destination: "th",
    partner: "Supplier A (mock)",
    product: "Butadiene",
    tons: 1100,
    departure: 2,
    transitDays: 6,
    dueDay: 10,
    freightPerTon: 48,
  },
  {
    id: "IN-002",
    direction: "inbound",
    origin: "jp",
    destination: "th",
    partner: "Supplier B (mock)",
    product: "Butadiene",
    tons: 850,
    departure: 12,
    transitDays: 13,
    dueDay: 27,
    freightPerTon: 82,
  },
  {
    id: "IN-003",
    direction: "inbound",
    origin: "sg",
    destination: "th",
    partner: "Supplier A (mock)",
    product: "Butadiene",
    tons: 1250,
    departure: 31,
    transitDays: 6,
    dueDay: 39,
    freightPerTon: 48,
  },
  {
    id: "OUT-001",
    direction: "outbound",
    origin: "th",
    destination: "in",
    partner: "Customer A (mock)",
    product: "BR150",
    tons: 430,
    departure: 7,
    transitDays: 12,
    dueDay: 22,
    freightPerTon: 96,
  },
  {
    id: "OUT-002",
    direction: "outbound",
    origin: "th",
    destination: "kr",
    partner: "Customer B (mock)",
    product: "BR150L",
    tons: 320,
    departure: 11,
    transitDays: 10,
    dueDay: 25,
    freightPerTon: 75,
  },
  {
    id: "OUT-003",
    direction: "outbound",
    origin: "th",
    destination: "cn",
    partner: "Customer C (mock)",
    product: "BR150B",
    tons: 390,
    departure: 17,
    transitDays: 9,
    dueDay: 29,
    freightPerTon: 65,
  },
  {
    id: "OUT-004",
    direction: "outbound",
    origin: "th",
    destination: "nl",
    partner: "Customer D (mock)",
    product: "VCR-617",
    tons: 210,
    departure: 5,
    transitDays: 32,
    dueDay: 40,
    freightPerTon: 155,
  },
  {
    id: "OUT-005",
    direction: "outbound",
    origin: "th",
    destination: "us",
    partner: "Customer E (mock)",
    product: "VCR-412",
    tons: 180,
    departure: 22,
    transitDays: 28,
    dueDay: 53,
    freightPerTon: 170,
  },
];
export function port(id: string): Port {
  const found = PORTS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown port: ${id}`);
  return found;
}
export function dayISO(day: number): string {
  const date = new Date(`${DEMO_START}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + day);
  return date.toISOString().slice(0, 10);
}
export function dateDay(value: string): number {
  return Math.round(
    (Date.parse(`${value}T00:00:00Z`) - Date.parse(`${DEMO_START}T00:00:00Z`)) /
      86400000,
  );
}
export function dayLabel(day: number): string {
  return new Date(`${dayISO(day)}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
export function shipmentState(shipment: Shipment, day: number, delay: number) {
  const arrival = shipment.departure + shipment.transitDays + delay;
  return {
    arrival,
    lateDays: Math.max(0, arrival - shipment.dueDay),
    status:
      day < shipment.departure
        ? "Scheduled"
        : day >= arrival
          ? "Arrived"
          : "In transit",
    progress: Math.max(
      0,
      Math.min(1, (day - shipment.departure) / (shipment.transitDays + delay)),
    ),
    slack: shipment.dueDay - arrival,
  };
}
export function summarizeShipments(
  shipments: Shipment[],
  day: number,
  delay: number,
) {
  let tons = 0,
    inTransit = 0,
    arrived = 0,
    lateTons = 0,
    lateCount = 0,
    freight = 0;
  for (const s of shipments) {
    const state = shipmentState(s, day, delay);
    tons += s.tons;
    if (state.status === "In transit") inTransit += s.tons;
    if (state.status === "Arrived") arrived += s.tons;
    if (state.lateDays > 0) {
      lateTons += s.tons;
      lateCount++;
    }
    freight += s.tons * s.freightPerTon;
  }
  return {
    tons,
    inTransit,
    arrived,
    lateTons,
    lateCount,
    freight,
    onTimePct: tons ? (1 - lateTons / tons) * 100 : 0,
  };
}
export function greatCircleKm(origin: Port, destination: Port) {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((destination.lat - origin.lat) * rad) / 2) ** 2 +
    Math.cos(origin.lat * rad) *
      Math.cos(destination.lat * rad) *
      Math.sin(((destination.lon - origin.lon) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}
